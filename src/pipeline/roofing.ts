import { StormIndex, stormProfile, claimLikelihood, formatDay, type GeoPoint, type StormProfile } from '../sources/noaa-storm';
import { roofAge, ownerProfile, pointFor, type AssessorRecord, type PermitRecord, type AgeEstimate } from '../sources/property';
import { scoreLead, type LeadScore, type SignalValues } from '../scoring';
import { evaluateRelease, type ContactRecord, type ReleaseDecision, type Channel } from '../compliance';
import { entitlements, type AccountState, type ScoringTier } from '../plans';

/**
 * The roofing vertical, end to end.
 *
 * Parcels, permits and storm history in; scored, compliance-gated, ready-to-work
 * leads out. Everything is passed in rather than fetched, so the pipeline is
 * pure and testable and the ingest workers can be swapped without touching any
 * of the logic that decides what a lead is worth.
 *
 * The ordering matters and is not arbitrary:
 *
 *   1. Derive signals from the raw records — this is where county formats stop
 *      mattering and everything downstream sees one shape.
 *   2. Score, with the plan's tier.
 *   3. Gate on compliance *last but before release*, so a lead that cannot be
 *      contacted on any channel never consumes quota. Charging someone a lead
 *      credit for a row they are not allowed to call is the kind of detail that
 *      loses an account permanently.
 */

export interface RoofingInput {
  parcels: AssessorRecord[];
  permits: PermitRecord[];
  storms: StormIndex;
  /** Keyed by parcelId. Absent means no contact was resolved yet. */
  contacts?: Record<string, ContactRecord>;
  /** Roof material per parcel, from imagery inference. Absent scores as unknown. */
  materials?: Record<string, string>;
}

export interface RoofingLead {
  parcelId: string;
  address?: string;
  city?: string;
  ownerName?: string;
  score: LeadScore;
  storm: StormProfile;
  roof: AgeEstimate;
  owner: ReturnType<typeof ownerProfile>;
  release: ReleaseDecision;
  /** Ready to drop into the outreach template. */
  hook?: string;
  /** Set when the lead is scored but must not be released. */
  withheld?: string;
}

export interface RoofingOptions {
  asOf?: Date;
  radiusKm?: number;
  /** Only return leads at or above this score. */
  minScore?: number;
  /** Cap on released leads, so a month's quota is not spent in one pull. */
  limit?: number;
  tier?: ScoringTier;
  fcraAttested?: boolean;
}

/** Turn raw county and NOAA records into the roofing module's signal set. */
export function roofingSignals(
  parcel: AssessorRecord,
  permits: PermitRecord[],
  storms: StormIndex,
  options: { asOf?: Date; radiusKm?: number; material?: string } = {}
): { values: SignalValues; storm: StormProfile; roof: AgeEstimate } {
  const asOf = options.asOf ?? new Date();
  const roof = roofAge(parcel, permits, asOf);

  const point = pointFor(parcel);
  const storm: StormProfile = point
    ? stormProfile(point as GeoPoint, storms, { asOf, radiusKm: options.radiusKm })
    : { hailEventsLast3y: 0, hailEventsCountyWide: 0, windEventsLast3y: 0, countyLevelOnly: false };

  const material = options.material ?? 'unknown';
  const occupied = ownerProfile(parcel, [parcel]).occupied;

  return {
    values: {
      roofAgeYears: roof.years,
      hailEventsLast3y: storm.hailEventsLast3y,
      windEventsLast3y: storm.windEventsLast3y,
      roofMaterial: material,
      propertyValue: parcel.assessedValue,
      ownerOccupied: occupied,
      insuranceClaimLikelihood: claimLikelihood(storm, roof.years, material),
    },
    storm,
    roof,
  };
}

export function runRoofingPipeline(input: RoofingInput, options: RoofingOptions = {}): RoofingLead[] {
  const asOf = options.asOf ?? new Date();
  const permitsByParcel = new Map<string, PermitRecord[]>();
  for (const p of input.permits) {
    const bucket = permitsByParcel.get(p.parcelId);
    if (bucket) bucket.push(p);
    else permitsByParcel.set(p.parcelId, [p]);
  }

  const leads: RoofingLead[] = [];

  for (const parcel of input.parcels) {
    const permits = permitsByParcel.get(parcel.parcelId) ?? [];
    const { values, storm, roof } = roofingSignals(parcel, permits, input.storms, {
      asOf,
      radiusKm: options.radiusKm,
      material: input.materials?.[parcel.parcelId],
    });

    const score = scoreLead('roofing', values, {
      tier: options.tier ?? 'advanced',
      fcraAttested: options.fcraAttested,
    });

    const contact = input.contacts?.[parcel.parcelId];
    // No contact resolved yet is not the same as a blocked contact. The first
    // is an enrichment gap; the second is a legal stop. Conflating them either
    // wastes leads or breaks the law, depending which way you get it wrong.
    const release: ReleaseDecision = contact
      ? evaluateRelease(contact, asOf)
      : {
          released: false,
          allowedChannels: ['mail'] as Channel[],
          blockedChannels: [],
          withheldReason: 'No contact resolved — needs enrichment',
          warnings: [],
        };

    leads.push({
      parcelId: parcel.parcelId,
      address: parcel.situsAddress,
      city: parcel.city,
      ownerName: parcel.ownerName,
      score,
      storm,
      roof,
      owner: ownerProfile(parcel, input.parcels),
      release,
      hook: buildHook(storm, roof),
      withheld: release.released ? undefined : release.withheldReason,
    });
  }

  const ranked = leads
    .filter((l) => l.score.score >= (options.minScore ?? 0))
    .sort((a, b) => b.score.score - a.score.score);

  return options.limit ? ranked.slice(0, options.limit) : ranked;
}

/**
 * The first line of the email.
 *
 * A storm date beats every other opener, and by a distance. "The 14 May hail
 * ran right through your street" is a fact the homeowner remembers and can
 * verify; "your roof looks old" is an insult delivered by a stranger. When
 * there is no storm to name, fall back to the permit record — also a fact,
 * also verifiable, and still not a judgement about their house.
 */
export function buildHook(
  storm: StormProfile,
  roof: AgeEstimate,
  monthsSinceHail?: number | null
): string | undefined {
  if (storm.hook) return storm.hook;
  if (storm.hailEventsLast3y > 0 && storm.lastHailDate) {
    // Naming the date is good; naming the date and the fact that time is
    // running out is the difference between a reply and a filed email. Only
    // said when the record supports it — an invented deadline is worse than
    // no opener at all.
    const window = claimWindow(monthsSinceHail);
    const day = formatDay(storm.lastHailDate);
    if (window === 'closing') return `hail on ${day}, and that claim is nearly two years old`;
    if (window === 'prime' || window === 'open') return `hail on ${day}, still inside the claim window`;
    return `hail on ${day}`;
  }
  if (roof.basis === 'permit' && roof.asOfDate && (roof.years ?? 0) > 12) {
    return `the roof permit from ${roof.asOfDate.slice(0, 4)}`;
  }
  if (roof.basis === 'yearBuilt' && roof.years !== undefined && roof.years > 20) {
    return `homes on your street from the ${Math.floor((new Date().getUTCFullYear() - roof.years) / 10) * 10}s`;
  }
  return undefined;
}

/**
 * Release under an account's quota.
 *
 * Only contactable leads are charged. Everything else is returned as pipeline
 * output the customer can see and enrich, but it does not draw down the
 * month's allowance — the quota is for leads they can act on.
 */
export function releaseUnderQuota(
  leads: RoofingLead[],
  account: AccountState
): { released: RoofingLead[]; heldForEnrichment: RoofingLead[]; blocked: RoofingLead[]; remaining: number | null } {
  const ent = entitlements(account);
  const remaining = ent.quota.remaining;

  const contactable = leads.filter((l) => l.release.released);
  const noContact = leads.filter((l) => !l.release.released && l.release.withheldReason?.startsWith('No contact'));
  const blocked = leads.filter((l) => !l.release.released && !l.release.withheldReason?.startsWith('No contact'));

  const released = remaining === null ? contactable : contactable.slice(0, Math.max(0, remaining));

  return {
    released,
    heldForEnrichment: noContact,
    blocked,
    remaining: remaining === null ? null : Math.max(0, remaining - released.length),
  };
}

/**
 * How much time is left to sell against a storm.
 *
 * Not legal advice and deliberately not phrased as a deadline: policies differ and
 * a contractor is not the one who decides. It reports how a carrier tends to
 * treat a claim of this age, which is what changes whether the visit is worth
 * making this week or at all.
 */
export type ClaimWindow = 'fresh' | 'prime' | 'open' | 'closing' | 'stale' | 'none';

export function claimWindow(monthsSinceHail?: number | null): ClaimWindow {
  if (monthsSinceHail == null) return 'none';
  if (monthsSinceHail <= 3) return 'fresh';
  if (monthsSinceHail <= 9) return 'prime';
  if (monthsSinceHail <= 18) return 'open';
  if (monthsSinceHail <= 24) return 'closing';
  return 'stale';
}

export function claimWindowLabel(w: ClaimWindow): string {
  switch (w) {
    case 'fresh':
      return 'Damage is days or weeks old — and so is every competitor’s door knock.';
    case 'prime':
      return 'Best window. Adjusters have caught up and the claim is unambiguously timely.';
    case 'open':
      return 'Still claimable, but the homeowner should not keep waiting.';
    case 'closing':
      return 'Approaching the notice period in most policies.';
    case 'stale':
      return 'A carrier can no longer tie the damage to one dated storm.';
    case 'none':
      return 'No hail on record near this parcel in ten years.';
  }
}
