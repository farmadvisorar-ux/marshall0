/**
 * The shapes crossing the network, defined once.
 *
 * Both the route handler that builds these and the client that reads them
 * import from here, so a field renamed on the server is a compile error in the
 * component rather than an undefined at runtime. A separately deployed API
 * cannot have this: its types live in another build, and the only thing
 * keeping the two in step is whoever remembers to update both.
 */

export type Storm = {
  id: string;
  type: string;
  date: string;
  magnitude: number | null;
  lat: number;
  lng: number;
  distanceKm: number;
  county: string | null;
  state: string | null;
};

export type PropertyLead = {
  id: string;
  parcelId: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  countyFips: string | null;
  lat: number;
  lng: number;
  distanceKm: number;
  ownerName: string | null;
  ownerOccupied: boolean | null;
  yearBuilt: number | null;
  damageScore: number;
  grade: string;
  confidence: number;
  hailEventsLast3y: number;
  hailMaxInches: number | null;
  lastHailDate: string | null;
};

export type StormImpactResponse = {
  center: { lat: number; lng: number; radiusKm: number };
  storms: Storm[];
  properties: PropertyLead[];
  counts: { storms: number; properties: number };
};
