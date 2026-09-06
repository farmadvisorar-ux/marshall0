import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { sql } from '@vercel/postgres';

const webhookSecret = process.env.CLERK_WEBHOOK_SECRET || '';

async function handler(request: Request) {
  // Get the headers
  const headerPayload = headers();
  const svix_id = headerPayload.get('svix-id');
  const svix_timestamp = headerPayload.get('svix-timestamp');
  const svix_signature = headerPayload.get('svix-signature');

  // If there are no headers, error out
  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response('Error: Missing Svix headers', {
      status: 400,
    });
  }

  // Get the body
  const body = await request.text();

  // Create a new Svix instance with your secret
  const wh = new Webhook(webhookSecret);

  let evt;
  // Verify the payload
  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    });
  } catch (err) {
    console.error('Webhook verification failed:', err);
    return new Response('Error: Could not verify webhook', {
      status: 400,
    });
  }

  // Handle the webhook
  const eventType = evt.type;
  const eventData = evt.data;

  if (eventType === 'user.created') {
    const clerkId = eventData.id;
    const email = eventData.email_addresses?.[0]?.email_address;
    const firstName = eventData.first_name;
    const lastName = eventData.last_name;
    const fullName = `${firstName || ''} ${lastName || ''}`.trim();

    if (!email) {
      return new Response('Error: No email provided', { status: 400 });
    }

    try {
      // Create user record
      await sql`
        INSERT INTO users (clerk_id, email, name)
        VALUES (${clerkId}, ${email}, ${fullName || null})
        ON CONFLICT (clerk_id) DO NOTHING
      `;

      // Get the user ID
      const userResult = await sql`
        SELECT id FROM users WHERE clerk_id = ${clerkId}
      `;

      if (!userResult.rows.length) {
        throw new Error('Failed to create user');
      }

      const userId = userResult.rows[0].id;

      // Create account with free plan
      const accountResult = await sql`
        INSERT INTO accounts (user_id, plan_id, free, founding_member)
        VALUES (${userId}, 'pro', true, false)
        RETURNING id
      `;

      if (!accountResult.rows.length) {
        throw new Error('Failed to create account');
      }

      const accountId = accountResult.rows[0].id;

      // Create default service area (Marshall, TX for demo)
      await sql`
        INSERT INTO service_areas (account_id, name, county_fips, state)
        VALUES (${accountId}, 'Marshall, TX (Demo)', '48203', 'TX')
      `;

      // Create default roofing saved search
      const searchResult = await sql`
        INSERT INTO saved_searches (account_id, name, industry, filters)
        VALUES (${accountId}, 'Roofing - All Properties', 'roofing', ${'{"minScore": 30}'})
        RETURNING id
      `;

      // Log the event
      await sql`
        INSERT INTO events (account_id, event_type, data)
        VALUES (${accountId}, 'account_created', ${'{"plan": "pro", "free": true}'})
      `;

      return new Response('Webhook processed successfully', { status: 200 });
    } catch (error) {
      console.error('Webhook processing error:', error);
      return new Response('Error processing webhook', { status: 500 });
    }
  }

  return new Response('Webhook processed', { status: 200 });
}

export const POST = handler;
