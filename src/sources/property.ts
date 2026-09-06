import { normAddress, normPersonName } from '../identity-graph';

/**
 * County assessor and building permit records.
 *
 * Between them these carry every property signal the roofing module needs
 * except the storm history, and they are public by statute in every state. The
 * work is not access, it is normalisation: roughly 3,100 counties, each with
 * its own column names, date formats and permit vocabulary. That work is also
 * the moat — the APIs are a weekend, the counties are a year.
 */

export interface AssessorRecord {
  parcelId: string;
  ownerName?: string;
  /** Where the tax bill goes. */
  mailingAddress?: string;
  mailingPostal?: string;
  /** Where the building physically is. */
  situsAddress?: string;
  situsPostal?: string;
  city?: string;
  state?: string;
  yearBuilt?: number;
  assessedValue?: number;
  lotSizeSqft?: number;
  buildingSqft?: number;
  landUse?: string;
  lat?: number;
  lon?: number;
  countyFips?: string;
}

export interface PermitRecord {
  parcelId: string;
  permitType?: string;
  workDescription?: string;
  issuedDate?: string;
  valuation?: number;
  contractorName?: string;
  status?: string;
}

/**
 * Permit vocabulary varies by county but the words do not.
 *
 * `reroof`, `re-roof`, `roof replacement`, `tear off`, `comp shingle` all mean
 * the same job. Missing one means reading a 2019 re-roof as a 1974 roof and
 * sending a crew to a house that does not need them.
 */
const ROOFING = /\b(re[\s-]?roof|roofing|roof\s+(replace|repl|repair|cover)|shingle|tear[\s-]?off|comp(osition)?\s+roof)\b/i;
const MECHANICAL = /\b(hvac|mechanical|a\/?c\b|air\s+cond|furnace|heat\s?pump|condenser)\b/i;

export const isRoofingPermit = (p: PermitRecord): boolean =>
  ROOFING.test(`${p.permitType ?? ''} ${p.workDescription ?? ''}`);

export const isMechanicalPermit = (p: PermitRecord): boolean =>
  MECHANICAL.test(`${p.permitType ?? ''} ${p.workDescription ?? ''}`);

/** Permits that were applied for and abandoned say nothing about the roof. */
const isLive = (p: PermitRecord): boolean =>
  !p.status || !/\b(void|cancel|withdraw|expired|denied)\b/i.test(p.status);

export interface AgeEstimate {
  years?: number;
  basis: 'permit' | 'yearBuilt' | 'unknown';
  /** The permit or build date the estimate came from. */
  asOfDate?: string;
  confidence: number;
}

const yearsBetween = (iso: string, asOf: Date): number =>
  (asOf.getTime() - Date.parse(`${iso.slice(0, 10)}T12:00:00Z`)) / (365.25 * 86_400_000);

/**
 * Roof age, from the most recent roofing permit, falling back to year built.
 *
 * The fallback is the weaker claim by a wide margin and is marked as such: a
 * lot of roofs get replaced without anyone pulling a permit, so a 1974 house
 * with no roofing permit is *probably* on its second or third roof. The module
 * handles that by scoring 31-plus years lower than the 20-30 band rather than
 * higher — past a certain age the absence of a permit stops being evidence of
 * an old roof and starts being evidence of unpermitted work.
 */
export function roofAge(
  parcel: AssessorRecord,
  permits: PermitRecord[],
  asOf = new Date()
): AgeEstimate {
  const roofPermits = permits
    .filter((p) => p.parcelId === parcel.parcelId && isLive(p) && isRoofingPermit(p) && p.issuedDate)
    .sort((a, b) => (a.issuedDate! < b.issuedDate! ? 1 : -1));

  if (roofPermits.length) {
    const last = roofPermits[0];
    return {
      years: Math.max(0, Math.round(yearsBetween(last.issuedDate!, asOf) * 10) / 10),
      basis: 'permit',
      asOfDate: last.issuedDate,
      confidence: 0.9,
    };
  }

  if (parcel.yearBuilt && parcel.yearBuilt > 1800) {
    const years = asOf.getUTCFullYear() - parcel.yearBuilt;
    return {
      years,
      basis: 'yearBuilt',
      asOfDate: `${parcel.yearBuilt}-01-01`,
      // Weak on purpose, and it decays with age: the older the house, the more
      // likely an unrecorded re-roof has already happened.
      confidence: years > 30 ? 0.35 : 0.6,
    };
  }

  return { basis: 'unknown', confidence: 0 };
}

/** Same idea for HVAC — most recent mechanical permit, else year built. */
export function systemAge(
  parcel: AssessorRecord,
  permits: PermitRecord[],
  asOf = new Date()
): AgeEstimate {
  const mech = permits
    .filter((p) => p.parcelId === parcel.parcelId && isLive(p) && isMechanicalPermit(p) && p.issuedDate)
    .sort((a, b) => (a.issuedDate! < b.issuedDate! ? 1 : -1));

  if (mech.length) {
    return {
      years: Math.max(0, Math.round(yearsBetween(mech[0].issuedDate!, asOf) * 10) / 10),
      basis: 'permit',
      asOfDate: mech[0].issuedDate,
      confidence: 0.85,
    };
  }
  if (parcel.yearBuilt && parcel.yearBuilt > 1800) {
    return {
      years: asOf.getUTCFullYear() - parcel.yearBuilt,
      basis: 'yearBuilt',
      asOfDate: `${parcel.yearBuilt}-01-01`,
      confidence: 0.5,
    };
  }
  return { basis: 'unknown', confidence: 0 };
}

/**
 * Owner-occupancy, from mailing address against situs address.
 *
 * The strongest single predictor of who can say yes on a doorstep, and it
 * costs nothing — every assessor roll carries both fields. Compared on the
 * normalised street line without the unit, so "512 W Grand Ave" and "512 West
 * Grand Avenue" resolve to the same property.
 */
export function ownerOccupied(parcel: AssessorRecord): boolean | undefined {
  const mailing = normAddress(parcel.mailingAddress, parcel.mailingPostal);
  const situs = normAddress(parcel.situsAddress, parcel.situsPostal);
  if (!mailing || !situs) return undefined;
  return mailing.key === situs.key;
}

/** Other parcels held by the same owner. The tell for a landlord portfolio. */
export function portfolioOf(parcel: AssessorRecord, all: AssessorRecord[]): AssessorRecord[] {
  const owner = normPersonName(parcel.ownerName);
  if (!owner) return [];
  return all.filter((p) => p.parcelId !== parcel.parcelId && normPersonName(p.ownerName) === owner);
}

/**
 * Absentee owners of several parcels behave differently from a homeowner:
 * slower to decide, harder on price, and worth far more when they say yes,
 * because one conversation covers every roof they hold.
 */
export function ownerProfile(
  parcel: AssessorRecord,
  all: AssessorRecord[]
): { occupied?: boolean; portfolioSize: number; segment: 'owner-occupier' | 'small-landlord' | 'portfolio-landlord' | 'unknown' } {
  const occupied = ownerOccupied(parcel);
  const portfolioSize = portfolioOf(parcel, all).length + 1;
  const segment =
    occupied === undefined ? 'unknown'
    : occupied ? 'owner-occupier'
    : portfolioSize >= 5 ? 'portfolio-landlord'
    : 'small-landlord';
  return { occupied, portfolioSize, segment };
}

/**
 * Geocode fallback.
 *
 * Assessor rolls carry parcel centroids more often than people expect, but not
 * always. Without a coordinate the storm query drops to county precision,
 * which is a genuinely weaker claim — so this reports what it has rather than
 * inventing a point.
 */
export function pointFor(parcel: AssessorRecord): { lat: number; lon: number; countyFips?: string } | { countyFips: string } | undefined {
  if (parcel.lat !== undefined && parcel.lon !== undefined) {
    return { lat: parcel.lat, lon: parcel.lon, countyFips: parcel.countyFips };
  }
  return parcel.countyFips ? { countyFips: parcel.countyFips } : undefined;
}
