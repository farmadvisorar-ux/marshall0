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
