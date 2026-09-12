import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getAccountByClerkId, listServiceAreas } from '@/lib/db';
import { ingestCounty } from '@/lib/ingest-parcels';

// Ingestion is network-bound against a county GIS server, so it gets the whole
// function budget rather than the default.
export const maxDuration = 60;

export async function POST(request: Request) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const account = await getAccountByClerkId(userId);
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  let fips: string | undefined;
  try {
    fips = (await request.json())?.fips;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!fips) return NextResponse.json({ error: 'Missing fips' }, { status: 400 });

  // Only counties the account actually holds. Otherwise this is an open pipe
  // for anyone to make us scrape any county in the country on demand.
  const held = await listServiceAreas(account.id);
  if (!held.some((a) => a.county_fips === fips)) {
    return NextResponse.json({ error: 'Add this county as a service area first' }, { status: 403 });
  }

  try {
    const result = await ingestCounty(fips, { maxRows: 6000, deadlineMs: 45_000 });
    if (result.status === 'no-source') {
      return NextResponse.json({
        ...result,
        message:
          'No open parcel source is wired for this county yet. Storm and disaster history still work.',
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('Parcel ingest failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Ingest failed' },
      { status: 502 }
    );
  }
}
