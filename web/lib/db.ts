import { sql } from '@vercel/postgres';

export async function query(text: string, params?: unknown[]) {
  try {
    const result = await sql.query(text, params);
    return result;
  } catch (error) {
    console.error('Database error:', error);
    throw error;
  }
}

export async function getUser(userId: string) {
  const result = await sql`
    SELECT id, clerk_id, email, name, created_at
    FROM users
    WHERE clerk_id = ${userId}
  `;
  return result.rows[0] || null;
}

export async function getAccount(userId: string) {
  const result = await sql`
    SELECT a.*
    FROM accounts a
    JOIN users u ON a.user_id = u.id
    WHERE u.clerk_id = ${userId}
  `;
  return result.rows[0] || null;
}

export async function createOrUpdateUser(clerkId: string, email: string, name?: string) {
  const result = await sql`
    INSERT INTO users (clerk_id, email, name)
    VALUES (${clerkId}, ${email}, ${name || null})
    ON CONFLICT (clerk_id) DO UPDATE
    SET email = ${email}, name = ${name || null}, updated_at = NOW()
    RETURNING *
  `;
  return result.rows[0];
}

export async function getLeads(accountId: string, limit = 100, offset = 0) {
  const result = await sql`
    SELECT * FROM leads
    WHERE account_id = ${accountId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return result.rows;
}

export async function getLead(accountId: string, parcelId: string) {
  const result = await sql`
    SELECT * FROM leads
    WHERE account_id = ${accountId} AND parcel_id = ${parcelId}
  `;
  return result.rows[0] || null;
}

export async function insertLeads(accountId: string, leads: any[]) {
  const values = leads
    .map(
      (lead, i) =>
        `(${i * 15 + 1}, ${i * 15 + 2}, ${i * 15 + 3}, ${i * 15 + 4}, ${i * 15 + 5}, ${i * 15 + 6}, ${i * 15 + 7}, ${i * 15 + 8}, ${i * 15 + 9}, ${i * 15 + 10}, ${i * 15 + 11}, ${i * 15 + 12}, ${i * 15 + 13}, ${i * 15 + 14}, ${i * 15 + 15})`
    )
    .join(',');

  // Using dynamic query - be careful with SQL injection
  const placeholders = leads
    .map((_, i) => {
      const base = i * 15 + 1;
      return `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14})`;
    })
    .join(',');

  const params = leads.flatMap((lead) => [
    accountId,
    lead.service_area_id,
    lead.industry,
    lead.parcel_id,
    lead.address,
    lead.city,
    lead.state,
    lead.owner_name,
    JSON.stringify(lead.signals),
    JSON.stringify(lead.contributions),
    JSON.stringify(lead.score),
    JSON.stringify(lead.storm),
    JSON.stringify(lead.roof),
    JSON.stringify(lead.owner),
    lead.hook,
  ]);

  try {
    const result = await sql.query(
      `INSERT INTO leads (account_id, service_area_id, industry, parcel_id, address, city, state, owner_name, signals, contributions, score, storm, roof, hook, created_at)
       VALUES ${placeholders}
       RETURNING *`,
      params
    );
    return result.rows;
  } catch (error) {
    console.error('Failed to insert leads:', error);
    throw error;
  }
}

export async function updateLeadStatus(leadId: string, status: string) {
  const result = await sql`
    UPDATE leads
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${leadId}
    RETURNING *
  `;
  return result.rows[0];
}
