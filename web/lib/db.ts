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

  // A brand new account with no territory can run no searches, so seed the
  // demo county the roofing pipeline already has NOAA coverage for.
  await db()`
    INSERT INTO service_areas (account_id, name, county_fips, state)
    SELECT ${account.id}, 'Harrison County, TX (Demo)', '48203', 'TX'
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
