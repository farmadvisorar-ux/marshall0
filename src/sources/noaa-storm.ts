/**
 * NOAA Storm Events — the roofing module's engine.
 *
 * Free, public domain, and authoritative. Storm-chasing roofers pay four
 * figures a month for repackaged versions of this exact feed, which tells you
 * both that the data is valuable and that nobody has bothered to make it
 * usable.
 *
 * Reads the Storm Events Database detail CSVs
 * (`StormEvents_details-ftp_v1.0_dYYYY_*.csv.gz`) published at
 * ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/. Two things about that
 * format bite immediately and are handled here rather than left to the caller:
 *
 *   1. MAGNITUDE means different units per event type. Hail is inches; wind is
 *      knots. Reading both as one number puts 60-knot gusts on the same scale
 *      as 1.75-inch hail, which is how you end up scoring a windy day as a
 *      roof replacement.
 *   2. Coordinates are frequently absent. Zone-based rows (CZ_TYPE 'Z') often
 *      carry no lat/lon at all, so a purely spatial query silently drops a
 *      chunk of real events. County FIPS is the fallback, and the result says
 *      which precision it used.
 */

export type StormType = 'hail' | 'wind' | 'tornado' | 'other';

export interface StormEvent {
  eventId: string;
  type: StormType;
  /** ISO date, day precision — which is all a roofing pitch ever needs. */
  date: string;
  lat?: number;
  lon?: number;
  /** 5-digit county FIPS, for rows with no coordinates. */
  countyFips?: string;
  county?: string;
  state?: string;
  /** Hail in inches, wind in mph. Normalised from NOAA's mixed units. */
  magnitude?: number;
  magnitudeType?: string;
  narrative?: string;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Falls back to county matching when the parcel has no coordinates. */
  countyFips?: string;
}

const KNOTS_TO_MPH = 1.15078;

/**
 * Hail that actually damages asphalt shingles.
 *
 * Below about an inch — dime and penny size — asphalt takes bruising that an
 * adjuster will not pay for. Counting those events inflates every score in the
 * county and sends crews to doors where there is no claim, which is the single
 * fastest way to lose a roofing customer's trust in a lead list.
 */
export const DAMAGING_HAIL_INCHES = 1.0;

/** Hail swaths are narrow. 3km is the width the claim actually follows. */
export const DEFAULT_RADIUS_KM = 3;

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Split one CSV line, honouring quoted fields and doubled quotes inside them. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

const num = (v?: string): number | undefined => {
  if (v === undefined) return undefined;
  const t = v.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

function classify(eventType: string): StormType {
  const t = eventType.toLowerCase();
  if (t.includes('hail')) return 'hail';
  if (t.includes('tornado')) return 'tornado';
  if (t.includes('wind')) return 'wind';
  return 'other';
}

/**
 * NOAA writes BEGIN_DATE_TIME as "14-MAY-24 17:42:00" — a two-digit year with
 * no century, which `Date.parse` reads inconsistently across runtimes. The
 * YEAR column is authoritative and present on every row, so it wins.
 */
const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

export function parseEventDate(beginDateTime: string, year?: number, yearMonth?: string, day?: number): string | undefined {
  const m = beginDateTime?.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})/);
  if (m && year) {
    const mm = MONTHS[m[2].toUpperCase()];
    if (mm) return `${year}-${mm}-${m[1].padStart(2, '0')}`;
  }
  // BEGIN_YEARMONTH + BEGIN_DAY is the belt-and-braces path.
  if (yearMonth && yearMonth.length === 6 && day) {
    return `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-${String(day).padStart(2, '0')}`;
  }
  return undefined;
}

/**
 * Parse a Storm Events detail CSV.
 *
 * Column order is not stable across NOAA's yearly files, so everything is
 * addressed by header name. Rows that cannot yield a date are dropped — an
 * undated storm cannot answer "was this recent enough to claim", which is the
 * only question being asked of it.
 */
export function parseStormEventsCsv(csv: string): StormEvent[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toUpperCase());
  const col = (row: string[], name: string): string | undefined => {
    const i = header.indexOf(name);
    return i === -1 ? undefined : row[i];
  };

  const events: StormEvent[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const row = splitCsvLine(lines[i]);
    const eventType = col(row, 'EVENT_TYPE') ?? '';
    const type = classify(eventType);

    const date = parseEventDate(
      col(row, 'BEGIN_DATE_TIME') ?? '',
      num(col(row, 'YEAR')),
      col(row, 'BEGIN_YEARMONTH')?.trim(),
      num(col(row, 'BEGIN_DAY'))
    );
    if (!date) continue;

    const raw = num(col(row, 'MAGNITUDE'));
    // The unit switch. Hail inches and wind knots are not the same axis.
    const magnitude =
      raw === undefined ? undefined
      : type === 'hail' ? raw
      : type === 'wind' || type === 'tornado' ? Math.round(raw * KNOTS_TO_MPH)
      : raw;

    const stateFips = col(row, 'STATE_FIPS')?.trim();
    const czFips = col(row, 'CZ_FIPS')?.trim();
    const czType = col(row, 'CZ_TYPE')?.trim().toUpperCase();

    events.push({
      eventId: col(row, 'EVENT_ID')?.trim() || `${date}-${i}`,
      type,
      date,
      lat: num(col(row, 'BEGIN_LAT')),
      lon: num(col(row, 'BEGIN_LON')),
      // CZ_FIPS is a county code only when CZ_TYPE is 'C'; for 'Z' rows it is a
      // forecast zone, which is a different numbering scheme entirely and would
      // match the wrong county if treated as one.
      countyFips:
        czType === 'C' && stateFips && czFips
          ? `${stateFips.padStart(2, '0')}${czFips.padStart(3, '0')}`
          : undefined,
      county: col(row, 'CZ_NAME')?.trim() || undefined,
      state: col(row, 'STATE')?.trim() || undefined,
      magnitude,
      magnitudeType: col(row, 'MAGNITUDE_TYPE')?.trim() || undefined,
      narrative: col(row, 'EVENT_NARRATIVE')?.trim() || undefined,
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance. Accurate to well under a metre at these scales. */
export function haversineKm(a: GeoPoint, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export const kmToMiles = (km: number): number => km * 0.621371;

/**
 * Grid index over storm events.
 *
 * A county-year of storm data is tens of thousands of rows and a service area
 * is tens of thousands of parcels; the cross product is not something you scan.
 * Events are bucketed into ~0.25° cells and a query touches only the cells the
 * search radius can reach, which turns the scan into a handful of bucket
 * lookups regardless of how much history is loaded.
 */
export class StormIndex {
  private cells = new Map<string, StormEvent[]>();
  private byCounty = new Map<string, StormEvent[]>();
  private readonly cellDeg = 0.25;
  readonly size: number;

  constructor(events: StormEvent[]) {
    this.size = events.length;
    for (const e of events) {
      if (e.lat !== undefined && e.lon !== undefined) {
        const key = this.cellKey(e.lat, e.lon);
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(e);
        else this.cells.set(key, [e]);
      }
      if (e.countyFips) {
        const bucket = this.byCounty.get(e.countyFips);
        if (bucket) bucket.push(e);
        else this.byCounty.set(e.countyFips, [e]);
      }
    }
  }

  private cellKey(lat: number, lon: number): string {
    return `${Math.floor(lat / this.cellDeg)}:${Math.floor(lon / this.cellDeg)}`;
  }

  /**
   * Events within `radiusKm` of a point, since `sinceISO`.
   *
   * Falls back to county matching for parcels with no coordinates and for
   * events NOAA published without any. Each hit is tagged with the precision
   * that found it, because a county-level match is a much weaker claim than a
   * 3km one and the score has to be able to tell the difference.
   */
  near(
    point: GeoPoint,
    radiusKm = DEFAULT_RADIUS_KM,
    sinceISO?: string
  ): { event: StormEvent; distanceKm?: number; precision: 'point' | 'county' }[] {
    const hits: { event: StormEvent; distanceKm?: number; precision: 'point' | 'county' }[] = [];
    const seen = new Set<string>();
    const hasPoint = Number.isFinite(point.lat) && Number.isFinite(point.lon);

    if (hasPoint) {
      // One cell is ~27.75km of latitude, so the span covers any sane radius.
      const span = Math.max(1, Math.ceil(radiusKm / (this.cellDeg * 111)));
      const baseLat = Math.floor(point.lat / this.cellDeg);
      const baseLon = Math.floor(point.lon / this.cellDeg);

      for (let dy = -span; dy <= span; dy += 1) {
        for (let dx = -span; dx <= span; dx += 1) {
          for (const event of this.cells.get(`${baseLat + dy}:${baseLon + dx}`) ?? []) {
            if (sinceISO && event.date < sinceISO) continue;
            const distanceKm = haversineKm(point, { lat: event.lat!, lon: event.lon! });
            if (distanceKm > radiusKm) continue;
            seen.add(event.eventId);
            hits.push({ event, distanceKm, precision: 'point' });
          }
        }
      }
    }

    if (point.countyFips) {
      for (const event of this.byCounty.get(point.countyFips) ?? []) {
        if (seen.has(event.eventId)) continue;
        if (sinceISO && event.date < sinceISO) continue;
        // A parcel we could not geocode still sits somewhere in this county, so
        // every county event is a candidate for it — just not a locatable one.
        // A parcel we *did* geocode has already been matched precisely against
        // every event carrying coordinates, so only the coordinate-less rows
        // are still unresolved for it.
        if (hasPoint && event.lat !== undefined && event.lon !== undefined) continue;
        hits.push({ event, precision: 'county' });
      }
    }

    return hits.sort((a, b) => (a.event.date < b.event.date ? 1 : -1));
  }
}

// ---------------------------------------------------------------------------
// Roofing signals
// ---------------------------------------------------------------------------

export interface StormProfile {
  /**
   * Claimable hail actually located near this parcel. This is the number the
   * score uses, and the only one a rep may repeat to a homeowner.
   */
  hailEventsLast3y: number;
  hailMaxInches?: number;
  lastHailDate?: string;
  daysSinceLastHail?: number;
  /**
   * Claimable hail known only to have hit the county somewhere. Real weather,
   * but not evidence about this street — kept separate so it can be shown as
   * context without inflating the score or the pitch.
   */
  hailEventsCountyWide: number;
  countyHailMaxInches?: number;
  windEventsLast3y: number;
  windMaxMph?: number;
  /** True when nothing could be located precisely — usually an ungeocoded parcel. */
  countyLevelOnly: boolean;
  /** First line of the email. Built only from located events. */
  hook?: string;
}

const isoDaysAgo = (days: number, asOf: Date): string =>
  new Date(asOf.getTime() - days * 86_400_000).toISOString().slice(0, 10);

/**
 * Build the roofing module's storm signals for one property.
 *
 * The hail count deliberately excludes sub-inch reports: the module is looking
 * for claimable damage, not weather. A property with nine dime-hail events and
 * no claimable one is a worse lead than a property with a single 1.75-inch
 * event, and counting raw reports would rank them the other way round.
 */
export function stormProfile(
  point: GeoPoint,
  index: StormIndex,
  options: { radiusKm?: number; years?: number; asOf?: Date; hailThreshold?: number } = {}
): StormProfile {
  const asOf = options.asOf ?? new Date();
  const years = options.years ?? 3;
  const threshold = options.hailThreshold ?? DAMAGING_HAIL_INCHES;
  const since = isoDaysAgo(years * 365, asOf);

  const hits = index.near(point, options.radiusKm ?? DEFAULT_RADIUS_KM, since);

  const claimable = hits.filter((h) => h.event.type === 'hail' && (h.event.magnitude ?? 0) >= threshold);
  const hail = claimable.filter((h) => h.precision === 'point');
  const countyHail = claimable.filter((h) => h.precision === 'county');
  const wind = hits.filter((h) => (h.event.type === 'wind' || h.event.type === 'tornado') && h.precision === 'point');

  const hailMax = hail.length ? Math.max(...hail.map((h) => h.event.magnitude ?? 0)) : undefined;
  const windMax = wind.length ? Math.max(...wind.map((h) => h.event.magnitude ?? 0)) : undefined;
  const lastHail = hail.length ? hail[0].event.date : undefined;

  const daysSince = lastHail
    ? Math.floor((asOf.getTime() - Date.parse(`${lastHail}T12:00:00Z`)) / 86_400_000)
    : undefined;

  return {
    hailEventsLast3y: hail.length,
    hailMaxInches: hailMax,
    lastHailDate: lastHail,
    daysSinceLastHail: daysSince,
    hailEventsCountyWide: countyHail.length,
    countyHailMaxInches: countyHail.length
      ? Math.max(...countyHail.map((h) => h.event.magnitude ?? 0))
      : undefined,
    windEventsLast3y: wind.length,
    windMaxMph: windMax,
    countyLevelOnly: hits.length > 0 && hail.length === 0 && countyHail.length > 0,
    // Only ever built from a located event. "Hail hit your street on 14 May" is
    // checkable and it is why the email works; saying it off a report that was
    // only ever pinned to the county is a claim you cannot support, to somebody
    // who was standing there that day and knows whether it is true.
    hook: lastHail && hailMax
      ? `${hailMax.toFixed(2).replace(/0$/, '')}" hail on ${formatDay(lastHail)}`
      : undefined,
  };
}

/** "14 May" — how a homeowner refers to the day it happened. */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d} ${names[m - 1]}${y === new Date().getUTCFullYear() ? '' : ` ${y}`}`;
}

/**
 * Claim likelihood, 0-1.
 *
 * Severity times exposure times how badly the material takes a hit. Explicitly
 * a marketing-suitability estimate: it ranks doors to knock, and it is never an
 * insurance eligibility determination — that use would make this a consumer
 * report and the seller a consumer reporting agency.
 */
export function claimLikelihood(
  storm: Pick<StormProfile, 'hailMaxInches' | 'hailEventsLast3y'>,
  roofAgeYears?: number,
  roofMaterial?: string
): number {
  if (!storm.hailMaxInches || storm.hailEventsLast3y === 0) return 0;

  // 2" is where adjusters stop arguing.
  const severity = Math.min(1, storm.hailMaxInches / 2);
  // A 20-year roof takes damage a 3-year roof shrugs off.
  const exposure = roofAgeYears === undefined ? 0.6 : Math.min(1, roofAgeYears / 20);
  const vulnerability: Record<string, number> = {
    'asphalt-3tab': 1.0,
    'asphalt-architectural': 0.85,
    'wood-shake': 0.8,
    tile: 0.4,
    metal: 0.25,
  };
  const material = vulnerability[roofMaterial ?? ''] ?? 0.7;

  // Repeat events compound — a second storm on an already-bruised roof is what
  // turns a denied claim into an approved one.
  const repeat = Math.min(1.15, 1 + (storm.hailEventsLast3y - 1) * 0.08);

  return Math.min(1, Math.round(severity * exposure * material * repeat * 100) / 100);
}
