import { headers } from 'next/headers';
import { Webhook } from 'svix';
import { provisionAccount } from '@/lib/db';

type ClerkUserEvent = {
  type: string;
  data: {
    id: string;
    email_addresses?: { id: string; email_address: string }[];
    primary_email_address_id?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  };
};

export async function POST(request: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error('CLERK_WEBHOOK_SECRET is not set');
    return new Response('Webhook not configured', { status: 500 });
  }

  const headerPayload = headers();
  const svixId = headerPayload.get('svix-id');
  const svixTimestamp = headerPayload.get('svix-timestamp');
  const svixSignature = headerPayload.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response('Missing Svix headers', { status: 400 });
  }

  const body = await request.text();

  let event: ClerkUserEvent;
  try {
    event = new Webhook(secret).verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkUserEvent;
  } catch (error) {
    console.error('Webhook verification failed:', error);
    return new Response('Invalid signature', { status: 400 });
  }

  if (event.type !== 'user.created' && event.type !== 'user.updated') {
    return new Response('Ignored', { status: 200 });
  }

  const { id, email_addresses = [], primary_email_address_id, first_name, last_name } = event.data;
  const email =
    email_addresses.find((e) => e.id === primary_email_address_id)?.email_address ??
    email_addresses[0]?.email_address;

  if (!email) {
    // Nothing to provision against, and retrying will not produce an address.
    return new Response('No email on user', { status: 200 });
  }

  try {
    await provisionAccount(id, email, [first_name, last_name].filter(Boolean).join(' ') || null);
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Provisioning failed:', error);
    // 500 so Svix retries — a dropped provisioning leaves a paying-ready user
    // with no account, and the lazy path in requireAccount is a safety net for
    // the race, not a substitute for this succeeding.
    return new Response('Provisioning failed', { status: 500 });
  }
}
