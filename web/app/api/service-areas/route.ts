import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getAccountByClerkId, listServiceAreas, addServiceArea, removeServiceArea } from '@/lib/db';
import { plan, freeQuota, isFreeLaunch, type PlanId } from '@engine';

async function account() {
  const { userId } = auth();
  if (!userId) return null;
  return getAccountByClerkId(userId);
}

export async function GET() {
  const acct = await account();
  if (!acct) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ serviceAreas: await listServiceAreas(acct.id) });
}

export async function POST(request: Request) {
  const acct = await account();
  if (!acct) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let fips: string | undefined;
  try {
    fips = (await request.json())?.fips;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!fips) return NextResponse.json({ error: 'Missing fips' }, { status: 400 });

  // The plan sells territory, so the cap is enforced here rather than in the UI.
  // A free-launch account borrows the granted plan's features but keeps the
  // launch quota, which is the same rule entitlements() applies to leads.
  const held = await listServiceAreas(acct.id);
  const onFree = isFreeLaunch() && acct.free;
  const limit = onFree
    ? freeQuota().serviceAreas
    : plan(acct.plan_id as PlanId).quota.serviceAreas;
  const alreadyHeld = held.some((a) => a.county_fips === fips);
  if (!alreadyHeld && typeof limit === 'number' && held.length >= limit) {
    return NextResponse.json(
      { error: `Your plan covers ${limit} service area${limit === 1 ? '' : 's'}. Remove one to add another.` },
      { status: 403 }
    );
  }

  const area = await addServiceArea(acct.id, fips);
  if (!area) return NextResponse.json({ error: 'Unknown county' }, { status: 404 });
  return NextResponse.json({ serviceArea: area });
}

export async function DELETE(request: Request) {
  const acct = await account();
  if (!acct) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  await removeServiceArea(acct.id, id);
  return NextResponse.json({ ok: true });
}
