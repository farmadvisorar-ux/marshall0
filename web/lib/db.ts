import { neon } from '@neondatabase/serverless';

/**
 * Lazy, because the connection string is a runtime secret. Resolving it at
 * module scope would throw during `next build`, where pages are imported to be
 * analysed and no database is reachable.
 */
let client: ReturnType<typeof neon> | null = null;
function db() {
  if (!client) {
    const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    client = neon(url);
  }
  return client;
}

export type Account = {
  id: string;
  user_id: string;
  plan_id: string;
  free: boolean;
  founding_member: boolean;
  created_at: string;
};

export type ServiceArea = {
  id: string;
  name: string;
  county_fips: string | null;
  state: string | null;
};

export type Lead = {
  id: string;
  account_id: string;
  industry: string;
  parcel_id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  owner_name: string | null;
  signals: Record<string, unknown> | null;
  contributions: Record<string, number> | null;
  score: { value?: number; grade?: string } | null;
  storm: Record<string, unknown> | null;
  roof: Record<string, unknown> | null;
  owner: Record<string, unknown> | null;
  hook: string | null;
  status: string;
  created_at: string;
};

/**
 * Start of the current billing month. Quota is counted from here rather than
 * from accounts.cycle_start because nothing advances that column yet — reading
 * it would keep counting against the month the account was created.
 */
export function currentCycleStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function getAccountByClerkId(clerkId: string): Promise<Account | null> {
  const rows = (await db()`
    SELECT a.id, a.user_id, a.plan_id, a.free, a.founding_member, a.created_at
    FROM accounts a
    JOIN users u ON a.user_id = u.id
    WHERE u.clerk_id = ${clerkId}
  `) as Account[];
  return rows[0] ?? null;
}

/**
 * Provisioning is idempotent on purpose: it runs from the Clerk webhook, and
 * again lazily on first page load if the webhook has not landed yet. Without
 * the second path a user who signs up and redirects faster than Svix delivers
 * arrives at a dashboard with no account and bounces back to /login forever.
 */
export async function provisionAccount(
  clerkId: string,
  email: string,
  name: string | null
): Promise<Account> {
  const existing = await getAccountByClerkId(clerkId);
  if (existing) return existing;

  const userRows = (await db()`
    INSERT INTO users (clerk_id, email, name)
    VALUES (${clerkId}, ${email}, ${name})
    ON CONFLICT (clerk_id) DO UPDATE
      SET email = excluded.email, name = excluded.name, updated_at = NOW()
    RETURNING id
  `) as { id: string }[];
  const userId = userRows[0].id;

  const accountRows = (await db()`
    INSERT INTO accounts (user_id, plan_id, free, founding_member)
    VALUES (${userId}, 'pro', true, true)
    ON CONFLICT (user_id) DO UPDATE SET user_id = excluded.user_id
    RETURNING id, user_id, plan_id, free, founding_member, created_at
  `) as Account[];
  const account = accountRows[0];

  // A brand new account with no territory can run no searches, so seed one
  // county that has both a parcel roll and storm history loaded. Not labelled
  // a demo, because it is not one: the search over it returns real owners at
  // real addresses scored against the real NOAA record.
  await db()`
    INSERT INTO service_areas (account_id, name, county_fips, state)
    SELECT ${account.id}, 'Harrison County, TX', '48203', 'TX'
    WHERE NOT EXISTS (SELECT 1 FROM service_areas WHERE account_id = ${account.id})
  `;

  await db()`
    INSERT INTO events (account_id, event_type, data)
    VALUES (${account.id}, 'account_created', ${JSON.stringify({ plan: 'pro', free: true })}::jsonb)
  `;

  return account;
}

export async function listServiceAreas(accountId: string): Promise<ServiceArea[]> {
  return (await db()`
    SELECT id, name, county_fips, state
    FROM service_areas
    WHERE account_id = ${accountId}
    ORDER BY created_at
  `) as ServiceArea[];
}

export async function getServiceArea(
  accountId: string,
  serviceAreaId: string
): Promise<ServiceArea | null> {
  const rows = (await db()`
    SELECT id, name, county_fips, state
    FROM service_areas
    WHERE id = ${serviceAreaId} AND account_id = ${accountId}
  `) as ServiceArea[];
  return rows[0] ?? null;
}

export async function countLeadsSince(accountId: string, since: Date): Promise<number> {
  const rows = (await db()`
    SELECT COUNT(*)::int AS count
    FROM leads
    WHERE account_id = ${accountId} AND created_at >= ${since.toISOString()}
  `) as { count: number }[];
  return rows[0]?.count ?? 0;
}

export async function listLeads(accountId: string, limit = 200): Promise<Lead[]> {
  return (await db()`
    SELECT * FROM leads
    WHERE account_id = ${accountId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as Lead[];
}

export async function getLead(accountId: string, parcelId: string): Promise<Lead | null> {
  const rows = (await db()`
    SELECT * FROM leads
    WHERE account_id = ${accountId} AND parcel_id = ${parcelId}
  `) as Lead[];
  return rows[0] ?? null;
}

export type ParcelInsert = {
  id: string;
  county_fips: string;
  parcel_no: string | null;
  owner_name: string | null;
  owner_name2: string | null;
  site_address: string;
  site_city: string | null;
  site_state: string | null;
  site_zip: string | null;
  mail_address: string | null;
  mail_city: string | null;
  absentee_owner: boolean | null;
  owner_is_org: boolean;
  year_built: number | null;
  parcel_value: number | null;
  improvement_value: number | null;
  land_use: string | null;
  acres: number | null;
  lat: number | null;
  lon: number | null;
  source: string;
};

const PARCEL_COLS: (keyof ParcelInsert)[] = [
  'id', 'county_fips', 'parcel_no', 'owner_name', 'owner_name2', 'site_address', 'site_city',
  'site_state', 'site_zip', 'mail_address', 'mail_city', 'absentee_owner', 'owner_is_org',
  'year_built', 'parcel_value', 'improvement_value', 'land_use', 'acres', 'lat', 'lon', 'source',
];

/**
 * Bulk upsert of a parcel batch.
 *
 * Rows are collapsed on id first: Postgres refuses an ON CONFLICT that touches
 * the same row twice in one statement, and a multi-polygon parcel arrives as
 * several features sharing one parcel number. Collapsing is also the
 * de-duplication the customer needs — one roof, one lead.
 */
export async function insertParcels(rows: ParcelInsert[]): Promise<number> {
  if (!rows.length) return 0;
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
  const n = PARCEL_COLS.length;
  const placeholders = unique
    .map((_, i) => '(' + PARCEL_COLS.map((__, j) => `$${i * n + j + 1}`).join(',') + ')')
    .join(',');
  const params = unique.flatMap((r) => PARCEL_COLS.map((c) => r[c] ?? null));

  await db().query(
    `INSERT INTO parcels (${PARCEL_COLS.join(',')}) VALUES ${placeholders}
     ON CONFLICT (id) DO UPDATE SET
       owner_name = excluded.owner_name, site_address = excluded.site_address,
       site_city = excluded.site_city, site_zip = excluded.site_zip,
       mail_address = excluded.mail_address, absentee_owner = excluded.absentee_owner,
       owner_is_org = excluded.owner_is_org, year_built = excluded.year_built,
       parcel_value = excluded.parcel_value, improvement_value = excluded.improvement_value,
       lat = excluded.lat, lon = excluded.lon, updated_at = NOW()`,
    params
  );
  return unique.length;
}

export async function recordSourceRun(
  id: string,
  label: string,
  state: string,
  url: string,
  fips: string,
  rows: number
): Promise<void> {
  await db()`
    INSERT INTO parcel_sources (id, name, state, url, field_map, counties, last_run_at, last_run_rows)
    VALUES (${id}, ${label}, ${state}, ${url}, '{}'::jsonb, ${fips}, NOW(), ${rows})
    ON CONFLICT (id) DO UPDATE SET
      last_run_at = NOW(), last_run_rows = ${rows}, counties = ${fips}
  `;
}

export type CountyRow = {
  fips: string;
  state: string;
  name: string;
  lat: number | null;
  lon: number | null;
};

/** Type-ahead over all 3,235 county-equivalents. Matches name, state or FIPS. */
export async function searchCounties(q: string, limit = 25): Promise<CountyRow[]> {
  const term = `%${q}%`;
  return (await db()`
    SELECT fips, state, name, lat, lon
    FROM counties
    WHERE name ILIKE ${term} OR state = UPPER(${q}) OR fips = ${q}
    ORDER BY state, name
    LIMIT ${limit}
  `) as CountyRow[];
}

export async function addServiceArea(
  accountId: string,
  fips: string
): Promise<ServiceArea | null> {
  const county = (await db()`
    SELECT fips, state, name FROM counties WHERE fips = ${fips}
  `) as { fips: string; state: string; name: string }[];
  if (!county[0]) return null;

  const label = `${county[0].name}, ${county[0].state}`;
  const rows = (await db()`
    INSERT INTO service_areas (account_id, name, county_fips, state)
    SELECT ${accountId}, ${label}, ${county[0].fips}, ${county[0].state}
    WHERE NOT EXISTS (
      SELECT 1 FROM service_areas WHERE account_id = ${accountId} AND county_fips = ${county[0].fips}
    )
    RETURNING id, name, county_fips, state
  `) as ServiceArea[];

  // Already held: return the existing row rather than a duplicate.
  if (!rows[0]) {
    const existing = (await db()`
      SELECT id, name, county_fips, state FROM service_areas
      WHERE account_id = ${accountId} AND county_fips = ${fips}
    `) as ServiceArea[];
    return existing[0] ?? null;
  }
  return rows[0];
}

export async function removeServiceArea(accountId: string, id: string): Promise<void> {
  await db()`DELETE FROM service_areas WHERE id = ${id} AND account_id = ${accountId}`;
}

export type StormProfile = {
  hail_events: number;
  hail_recent: number;
  max_hail_in: number | null;
  last_hail: string | null;
  wind_events: number;
  tornado_events: number;
  fema_declarations: number;
};

/**
 * What the national storm record says about one county. This is the scoring
 * substrate for territories where no parcel source is wired yet — it is real
 * measured history rather than an estimate, so it can be shown as fact.
 */
export async function countyStormProfile(fips: string): Promise<StormProfile> {
  const rows = (await db()`
    SELECT
      COUNT(*) FILTER (WHERE event_type = 'Hail')::int AS hail_events,
      COUNT(*) FILTER (WHERE event_type = 'Hail' AND begin_date >= CURRENT_DATE - INTERVAL '3 years')::int AS hail_recent,
      MAX(magnitude) FILTER (WHERE event_type = 'Hail') AS max_hail_in,
      MAX(begin_date) FILTER (WHERE event_type = 'Hail') AS last_hail,
      COUNT(*) FILTER (WHERE event_type LIKE '%Wind%')::int AS wind_events,
      COUNT(*) FILTER (WHERE event_type = 'Tornado')::int AS tornado_events,
      (SELECT COUNT(*)::int FROM fema_declarations f WHERE f.county_fips = ${fips}) AS fema_declarations
    FROM storm_events
    WHERE county_fips = ${fips}
  `) as StormProfile[];
  return rows[0];
}

export type StormImpact = {
  event_id: string;
  event_type: string;
  state: string | null;
  county_fips: string | null;
  cz_name: string | null;
  begin_date: string;
  magnitude: string | null;
  lat: number;
  lon: number;
  distance_km: number;
};

/**
 * Storm events within a true radius of a point.
 *
 * Unlike the per-parcel scoring path, which uses a bounding box because it runs
 * against thousands of candidates at once, this refines to real great-circle
 * distance. The result set is small and the number is shown to a customer —
 * "1.8km away" has to survive being checked against a map.
 *
 * The box is still applied first so the query uses the lat/lon index instead of
 * computing a haversine across 319,576 rows.
 */
export async function stormsNearPoint(
  lat: number,
  lon: number,
  radiusKm: number,
  opts: { sinceYears?: number; limit?: number } = {}
): Promise<StormImpact[]> {
  const sinceYears = opts.sinceYears ?? 3;
  const limit = opts.limit ?? 200;
  const degLat = radiusKm / 111.0;
  const degLon = radiusKm / Math.max(111.0 * Math.cos((lat * Math.PI) / 180), 1);

  return (await db()`
    SELECT event_id::text, event_type, state, county_fips, cz_name,
           begin_date, magnitude, lat, lon,
           ROUND((6371 * ACOS(LEAST(1, GREATEST(-1,
             COS(RADIANS(${lat})) * COS(RADIANS(lat)) * COS(RADIANS(lon) - RADIANS(${lon}))
             + SIN(RADIANS(${lat})) * SIN(RADIANS(lat))
           ))))::numeric, 2) AS distance_km
    FROM storm_events
    WHERE lat BETWEEN ${lat - degLat} AND ${lat + degLat}
      AND lon BETWEEN ${lon - degLon} AND ${lon + degLon}
      AND begin_date >= (CURRENT_DATE - (${sinceYears} || ' years')::interval)
      AND 6371 * ACOS(LEAST(1, GREATEST(-1,
            COS(RADIANS(${lat})) * COS(RADIANS(lat)) * COS(RADIANS(lon) - RADIANS(${lon}))
            + SIN(RADIANS(${lat})) * SIN(RADIANS(lat))
          ))) <= ${radiusKm}
    ORDER BY begin_date DESC
    LIMIT ${limit}
  `) as StormImpact[];
}

export type NearbyParcel = {
  id: string;
  parcel_no: string | null;
  owner_name: string | null;
  site_address: string | null;
  site_city: string | null;
  site_state: string | null;
  site_zip: string | null;
  county_fips: string;
  absentee_owner: boolean | null;
  year_built: number | null;
  parcel_value: string | null;
  lat: number;
  lon: number;
  distance_km: number;
  hail_3y: number;
  hail_max_in: string | null;
  hail_last: string | null;
  wind_3y: number;
};

/**
 * Properties within a radius of a point, carrying their own storm exposure.
 *
 * Exposure is measured around each parcel rather than around the search point:
 * a house at the edge of a 10km search may have taken hail the centre never
 * saw, and averaging over the radius would erase exactly the variation a
 * contractor is looking for.
 */
export async function parcelsNearPoint(
  lat: number,
  lon: number,
  radiusKm: number,
  opts: { limit?: number } = {}
): Promise<NearbyParcel[]> {
  const limit = opts.limit ?? 200;
  const degLat = radiusKm / 111.0;
  const degLon = radiusKm / Math.max(111.0 * Math.cos((lat * Math.PI) / 180), 1);
  const EXPOSURE_DEG = 3 / 111.0;

  return (await db()`
    WITH near AS (
      SELECT id, parcel_no, owner_name, site_address, site_city, site_state, site_zip,
             county_fips, absentee_owner, year_built, parcel_value, lat, lon,
             ROUND((6371 * ACOS(LEAST(1, GREATEST(-1,
               COS(RADIANS(${lat})) * COS(RADIANS(lat)) * COS(RADIANS(lon) - RADIANS(${lon}))
               + SIN(RADIANS(${lat})) * SIN(RADIANS(lat))
             ))))::numeric, 2) AS distance_km
      FROM parcels
      WHERE lat BETWEEN ${lat - degLat} AND ${lat + degLat}
        AND lon BETWEEN ${lon - degLon} AND ${lon + degLon}
        AND owner_is_org IS NOT TRUE
        AND site_address IS NOT NULL
      LIMIT 2000
    )
    SELECT n.*, COALESCE(s.hail_3y, 0)::int AS hail_3y, s.hail_max_in, s.hail_last,
           COALESCE(s.wind_3y, 0)::int AS wind_3y
    FROM near n
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE e.event_type = 'Hail')::int AS hail_3y,
             MAX(e.magnitude) FILTER (WHERE e.event_type = 'Hail') AS hail_max_in,
             MAX(e.begin_date) FILTER (WHERE e.event_type = 'Hail') AS hail_last,
             COUNT(*) FILTER (WHERE e.event_type LIKE '%Wind%')::int AS wind_3y
      FROM storm_events e
      WHERE e.begin_date >= CURRENT_DATE - INTERVAL '3 years'
        AND e.lat BETWEEN n.lat - ${EXPOSURE_DEG} AND n.lat + ${EXPOSURE_DEG}
        AND e.lon BETWEEN n.lon - (${EXPOSURE_DEG} / GREATEST(COS(RADIANS(n.lat)), 0.01))
                      AND n.lon + (${EXPOSURE_DEG} / GREATEST(COS(RADIANS(n.lat)), 0.01))
    ) s ON TRUE
    WHERE n.distance_km <= ${radiusKm}
    ORDER BY COALESCE(s.hail_3y, 0) DESC, n.distance_km ASC
    LIMIT ${limit}
  `) as NearbyParcel[];
}

export type ParcelRow = {
  id: string;
  parcel_no: string | null;
  owner_name: string | null;
  site_address: string | null;
  site_city: string | null;
  site_state: string | null;
  site_zip: string | null;
  absentee_owner: boolean | null;
  year_built: number | null;
  parcel_value: string | null;
  lat: number | null;
  lon: number | null;
};

export async function countyParcelCount(fips: string): Promise<number> {
  const rows = (await db()`
    SELECT COUNT(*)::int AS count FROM parcels WHERE county_fips = ${fips}
  `) as { count: number }[];
  return rows[0]?.count ?? 0;
}

/**
 * Candidate properties in a county, oldest roofs first.
 *
 * Age is the one property signal that is knowable from public record and
 * genuinely predicts replacement, so it orders the list where no richer signal
 * exists yet.
 */
export async function candidateParcels(
  fips: string,
  opts: { builtBefore?: number; limit?: number } = {}
): Promise<ParcelRow[]> {
  const builtBefore = opts.builtBefore ?? new Date().getFullYear() - 12;
  const limit = opts.limit ?? 200;
  return (await db()`
    SELECT id, parcel_no, owner_name, site_address, site_city, site_state, site_zip,
           absentee_owner, year_built, parcel_value, lat, lon
    FROM parcels
    WHERE county_fips = ${fips}
      AND year_built IS NOT NULL
      AND year_built BETWEEN 1900 AND ${builtBefore}
      AND site_address IS NOT NULL
    ORDER BY year_built ASC
    LIMIT ${limit}
  `) as ParcelRow[];
}

export type ScoredCandidate = ParcelRow & {
  hail_3y: number;
  hail_max_in: number | null;
  hail_last: string | null;
  wind_3y: number;
};

/**
 * Candidate parcels with their measured storm exposure, in one round trip.
 *
 * Exposure is counted inside a bounding box rather than a true radius: the box
 * is derived from the parcel's own latitude so it stays ~3km on both axes
 * instead of collapsing toward the poles. NOAA reports a storm as a point, and
 * hail swaths are wider than the reporting precision, so a box of this size is
 * already inside the error bars of the source — a haversine refinement would be
 * false precision, and it would cost the index scan.
 */
export async function scoredCandidates(
  fips: string,
  opts: { builtBefore?: number; limit?: number } = {}
): Promise<ScoredCandidate[]> {
  const builtBefore = opts.builtBefore ?? new Date().getFullYear() - 12;
  const limit = opts.limit ?? 250;
  const KM = 3;
  const DEG_LAT = KM / 111.0;

  return (await db()`
    WITH candidates AS (
      SELECT id, parcel_no, owner_name, site_address, site_city, site_state, site_zip,
             absentee_owner, year_built, parcel_value, lat, lon
      FROM parcels
      WHERE county_fips = ${fips}
        AND site_address IS NOT NULL
        AND site_address !~ '^0 '
        AND lat IS NOT NULL
        -- A university, a hospital or a Kroger scores well on hail and is still
        -- not a residential roofing job.
        AND owner_is_org IS NOT TRUE
        -- Not every roll publishes year built — Marshall TX does not. Requiring
        -- it would return nothing at all for those counties, so an unknown age
        -- is carried through and the engine reports the lower confidence.
        AND (year_built IS NULL OR year_built BETWEEN 1900 AND ${builtBefore})
        -- Bare land has no roof; a campus is not a house. Value and lot size
        -- stand in for the land-use code these rolls do not all publish.
        AND (improvement_value IS NULL OR improvement_value >= 10000)
        AND (acres IS NULL OR acres < 5)
        AND (parcel_value IS NULL OR parcel_value < 2000000)
      ORDER BY year_built ASC NULLS LAST
      LIMIT ${limit}
    )
    SELECT c.*,
      COALESCE(s.hail_3y, 0)::int  AS hail_3y,
      s.hail_max_in,
      s.hail_last,
      COALESCE(s.wind_3y, 0)::int  AS wind_3y
    FROM candidates c
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE e.event_type = 'Hail')::int AS hail_3y,
        MAX(e.magnitude) FILTER (WHERE e.event_type = 'Hail') AS hail_max_in,
        MAX(e.begin_date) FILTER (WHERE e.event_type = 'Hail') AS hail_last,
        COUNT(*) FILTER (WHERE e.event_type LIKE '%Wind%')::int AS wind_3y
      FROM storm_events e
      WHERE e.begin_date >= CURRENT_DATE - INTERVAL '3 years'
        AND e.lat BETWEEN c.lat - ${DEG_LAT} AND c.lat + ${DEG_LAT}
        AND e.lon BETWEEN c.lon - (${DEG_LAT} / GREATEST(COS(RADIANS(c.lat)), 0.01))
                      AND c.lon + (${DEG_LAT} / GREATEST(COS(RADIANS(c.lat)), 0.01))
    ) s ON TRUE
    ORDER BY COALESCE(s.hail_3y, 0) DESC, c.year_built ASC
  `) as ScoredCandidate[];
}

export const LEAD_STATUSES = ['available', 'contacted', 'won', 'lost', 'discarded'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * Move a lead through the pipeline.
 *
 * Scoped by account, not just lead id: without that, knowing a parcel number
 * would be enough to alter another contractor's pipeline. Returns null when
 * nothing matched, so the caller reports "not found" rather than a silent
 * success on someone else's row.
 */
export async function updateLeadStatus(
  accountId: string,
  parcelId: string,
  status: LeadStatus
): Promise<Lead | null> {
  const rows = (await db()`
    UPDATE leads SET status = ${status}, updated_at = NOW()
    WHERE account_id = ${accountId} AND parcel_id = ${parcelId}
    RETURNING *
  `) as Lead[];
  return rows[0] ?? null;
}

export type LeadInput = {
  parcelId: string;
  address: string;
  city: string;
  state: string;
  ownerName: string;
  signals: unknown;
  contributions: unknown;
  score: unknown;
  storm: unknown;
  roof: unknown;
  owner: unknown;
  hook: string;
};

export async function upsertLead(
  accountId: string,
  serviceAreaId: string,
  industry: string,
  lead: LeadInput
): Promise<void> {
  await db()`
    INSERT INTO leads (
      account_id, service_area_id, industry, parcel_id,
      address, city, state, owner_name,
      signals, contributions, score, storm, roof, owner, hook
    ) VALUES (
      ${accountId}, ${serviceAreaId}, ${industry}, ${lead.parcelId},
      ${lead.address}, ${lead.city}, ${lead.state}, ${lead.ownerName},
      ${JSON.stringify(lead.signals)}::jsonb,
      ${JSON.stringify(lead.contributions)}::jsonb,
      ${JSON.stringify(lead.score)}::jsonb,
      ${JSON.stringify(lead.storm)}::jsonb,
      ${JSON.stringify(lead.roof)}::jsonb,
      ${JSON.stringify(lead.owner)}::jsonb,
      ${lead.hook}
    )
    ON CONFLICT (account_id, parcel_id) DO UPDATE SET
      signals = excluded.signals,
      contributions = excluded.contributions,
      score = excluded.score,
      storm = excluded.storm,
      roof = excluded.roof,
      owner = excluded.owner,
      hook = excluded.hook,
      updated_at = NOW()
  `;
}

export type MappableArea = {
  id: string;
  name: string;
  fips: string;
  lat: number;
  lon: number;
  parcels: number;
};

/**
 * The account's service areas as points a map can open on.
 *
 * A county with no parcels loaded is dropped rather than shown empty: the map
 * would centre on it and render nothing, which reads as a broken map instead
 * of an unloaded county. The search page is where a county gets loaded.
 */
export async function mappableAreas(accountId: string): Promise<MappableArea[]> {
  return (await db()`
    SELECT s.id, s.name, c.fips, c.lat, c.lon, p.count AS parcels
    FROM service_areas s
    JOIN counties c ON c.fips = s.county_fips
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS count FROM parcels WHERE county_fips = c.fips
    ) p
    WHERE s.account_id = ${accountId}
      AND c.lat IS NOT NULL
      AND c.lon IS NOT NULL
      AND p.count > 0
    ORDER BY p.count DESC, s.name
  `) as MappableArea[];
}

export type HealthCheck = {
  ok: boolean;
  latencyMs: number;
  error?: string;
  tables?: Record<string, number | null>;
};

/**
 * Liveness for the database.
 *
 * Row counts come from the planner's estimates in pg_class rather than
 * COUNT(*): a monitor hits this every thirty seconds, and counting 319,576
 * storm events each time to prove the connection is up would cost more than
 * the thing it is checking. The numbers are approximate by design — this
 * answers "is the schema there and populated", not "how many exactly".
 *
 * A table that has never been analysed reports reltuples = -1, which means
 * unknown, not empty. It is returned as null: a monitor that reads 0 accounts
 * and pages someone is worse than one that reads nothing at all.
 */
export async function healthCheck(): Promise<HealthCheck> {
  const started = Date.now();
  try {
    const rows = (await db()`
      SELECT relname AS table,
             CASE WHEN reltuples < 0 THEN NULL ELSE reltuples::bigint END AS rows
      FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relkind = 'r'
        AND relname IN ('counties', 'parcels', 'storm_events', 'accounts', 'leads')
    `) as { table: string; rows: string | null }[];

    const tables: Record<string, number | null> = {};
    for (const r of rows) tables[r.table] = r.rows === null ? null : Number(r.rows);

    return { ok: true, latencyMs: Date.now() - started, tables };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'unknown error',
    };
  }
}
