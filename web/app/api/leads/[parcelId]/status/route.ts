import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getAccountByClerkId, updateLeadStatus, LEAD_STATUSES, type LeadStatus } from '@/lib/db';

export async function PATCH(
  request: Request,
  { params }: { params: { parcelId: string } }
) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const account = await getAccountByClerkId(userId);
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  let status: string | undefined;
  try {
    status = (await request.json())?.status;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Checked against the list rather than passed through: the column has a check
  // constraint, and a rejected write should read as a bad request here instead
  // of surfacing a database error to the caller.
  if (!status || !LEAD_STATUSES.includes(status as LeadStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${LEAD_STATUSES.join(', ')}` },
      { status: 400 }
    );
  }

  const lead = await updateLeadStatus(
    account.id,
    decodeURIComponent(params.parcelId),
    status as LeadStatus
  );
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  return NextResponse.json({ lead });
}
