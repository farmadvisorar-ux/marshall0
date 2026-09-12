import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import {
  getAccountByClerkId,
  getServiceArea,
  countLeadsSince,
  currentCycleStart,
  countyStormProfile,
  countyParcelCount,
  scoredCandidates,
  upsertLead,
} from '@/lib/db';
import { entitlements, scoreLead, type PlanId } from '@engine';

export const maxDuration = 60;

export async function POST(request: Request) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const account = await getAccountByClerkId(userId);
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  let body: { serviceAreaId?: string; industry?: string; minScore?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { serviceAreaId, industry = 'roofing', minScore = 0 } = body;
  if (!serviceAreaId) return NextResponse.json({ error: 'Pick a service area' }, { status: 400 });

  const area = await getServiceArea(account.id, serviceAreaId);
  if (!area) return NextResponse.json({ error: 'Service area not found' }, { status: 404 });
  if (!area.county_fips) {
    return NextResponse.json({ error: 'This service area has no county attached' }, { status: 400 });
  }

  const used = await countLeadsSince(account.id, currentCycleStart());
  const ent = entitlements({
    planId: account.plan_id as PlanId,
    industries: [industry],
    used,
    free: account.free,
    foundingMember: account.founding_member,
  });
  if (ent.quota.remaining !== null && ent.quota.remaining <= 0) {
    return NextResponse.json(
      { error: `You have used all ${ent.quota.included} leads in this month's quota.`, used: ent.quota.used },
      { status: 429 }
    );
  }

  const [storm, parcelCount] = await Promise.all([
    countyStormProfile(area.county_fips),
    countyParcelCount(area.county_fips),
  ]);

  // No parcel source wired for this county yet. Return the storm record, which
  // is real and measured, rather than inventing properties to fill the page.
  if (parcelCount === 0) {
    return NextResponse.json({
      leads: [],
      count: 0,
      parcelsAvailable: false,
      county: { fips: area.county_fips, name: area.name },
      storm,
      message:
        `No parcel source is connected for ${area.name} yet, so there are no addresses to score. ` +
        `The storm record for this county is real and shown above.`,
    });
  }

  const thisYear = new Date().getFullYear();
  const candidates = await scoredCandidates(area.county_fips);

  const scored = candidates.map((p) => {
    const roofAgeYears = p.year_built ? thisYear - p.year_built : undefined;
    const hailMax = p.hail_max_in ? Number(p.hail_max_in) : null;

    // The module defines this as derived from hail severity and roof age; it is
    // computed here rather than left missing so the model is not scored on a
    // signal it was designed to calculate for itself.
    const claim =
      hailMax !== null && roofAgeYears !== undefined
        ? Math.max(0, Math.min(1, (hailMax / 2) * (roofAgeYears / 25)))
        : undefined;

    const score = scoreLead(industry, {
      roofAgeYears,
      hailEventsLast3y: p.hail_3y,
      windEventsLast3y: p.wind_3y,
      propertyValue: p.parcel_value ? Number(p.parcel_value) : undefined,
      // Mailing address differing from the property is the assessor's own
      // signal that nobody who can say yes lives there.
      ownerOccupied: p.absentee_owner === null ? undefined : !p.absentee_owner,
      insuranceClaimLikelihood: claim,
    }, { tier: ent.scoring });

    return {
      parcelId: p.parcel_no ?? p.id,
      address: p.site_address ?? '',
      city: p.site_city ?? '',
      state: p.site_state ?? area.state ?? '',
      ownerName: p.owner_name ?? '',
      score: { value: score.score, grade: score.grade, confidence: score.confidence },
      signals: {
        roofAgeYears,
        yearBuilt: p.year_built,
        hailEventsLast3y: p.hail_3y,
        windEventsLast3y: p.wind_3y,
        propertyValue: p.parcel_value ? Number(p.parcel_value) : null,
        ownerOccupied: p.absentee_owner === null ? null : !p.absentee_owner,
      },
      contributions: Object.fromEntries(score.contributions.map((c) => [c.id, c.points])),
      storm: {
        hailEventsLast3y: p.hail_3y,
        hailMaxInches: hailMax,
        lastHailDate: p.hail_last,
        windEventsLast3y: p.wind_3y,
      },
      roof: { ageYears: roofAgeYears ?? null, yearBuilt: p.year_built },
      owner: {
        occupied: p.absentee_owner === null ? null : !p.absentee_owner,
        segment: p.absentee_owner ? 'absentee-owner' : 'owner-occupier',
      },
      // The engine's own best reason, so the opening line is something the data
      // actually supports rather than a template.
      hook: score.reasons[0] ?? '',
      unscoredPoints: score.unscoredPoints,
    };
  });

  const matching = scored.filter((l) => l.score.value >= minScore);
  const released = ent.quota.remaining === null ? matching : matching.slice(0, ent.quota.remaining);

  try {
    for (const lead of released) {
      await upsertLead(account.id, area.id, industry, lead);
    }
  } catch (error) {
    console.error('Failed to save leads:', error);
    return NextResponse.json({ error: 'Failed to save leads' }, { status: 500 });
  }

  return NextResponse.json({
    leads: released,
    count: released.length,
    scanned: candidates.length,
    parcelsAvailable: true,
    parcelsInCounty: parcelCount,
    county: { fips: area.county_fips, name: area.name },
    storm,
  });
}
