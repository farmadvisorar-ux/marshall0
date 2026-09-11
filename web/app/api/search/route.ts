import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import {
  getAccountByClerkId,
  getServiceArea,
  countLeadsSince,
  currentCycleStart,
  upsertLead,
  type LeadInput,
} from '@/lib/db';
import { entitlements, type PlanId } from '@engine';

export async function POST(request: Request) {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const account = await getAccountByClerkId(userId);
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  let body: { serviceAreaId?: string; industry?: string; minScore?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { serviceAreaId, industry = 'roofing', minScore = 0 } = body;
  if (!serviceAreaId) {
    return NextResponse.json({ error: 'Pick a service area' }, { status: 400 });
  }

  const serviceArea = await getServiceArea(account.id, serviceAreaId);
  if (!serviceArea) {
    return NextResponse.json({ error: 'Service area not found' }, { status: 404 });
  }

  const used = await countLeadsSince(account.id, currentCycleStart());
  const ent = entitlements({
    planId: account.plan_id as PlanId,
    industries: [industry],
    used,
    free: account.free,
    foundingMember: account.founding_member,
  });

  if (ent.quota.remaining !== null && ent.quota.remaining <= 0) {
    return NextResponse.json(
      {
        error: `You have used all ${ent.quota.included} leads in this month's quota.`,
        used: ent.quota.used,
        included: ent.quota.included,
      },
      { status: 429 }
    );
  }

  const candidates = demoLeads(serviceArea.state || 'TX').filter(
    (lead) => lead.score.value >= minScore
  );
  // Never release more than the quota allows, even when the search matches more.
  const released =
    ent.quota.remaining === null ? candidates : candidates.slice(0, ent.quota.remaining);

  try {
    for (const lead of released) {
      await upsertLead(account.id, serviceArea.id, industry, lead as LeadInput);
    }
  } catch (error) {
    console.error('Failed to save leads:', error);
    return NextResponse.json({ error: 'Failed to save leads' }, { status: 500 });
  }

  return NextResponse.json({
    leads: released,
    count: released.length,
    // Until the assessor, permit and NOAA feeds are connected to live
    // endpoints, these are worked examples rather than real parcels. Saying so
    // in the payload keeps a demo from being mistaken for a territory.
    demo: true,
  });
}

function demoLeads(state: string) {
  return [
    {
      parcelId: 'R-8801-001',
      address: '512 West Grand Avenue',
      city: 'Marshall',
      state,
      ownerName: 'J. Whitfield',
      score: { value: 82, grade: 'A' },
      signals: {
        hailEventsLast3y: 3,
        hailMaxInches: 1.75,
        roofAgeYears: 17,
        ownerOccupied: true,
      },
      contributions: { hailMaxInches: 31, roofAgeYears: 28, hailEventsLast3y: 15 },
      storm: {
        hailEventsLast3y: 3,
        hailEventsCountyWide: 6,
        hailMaxInches: 1.75,
        lastHailDate: '2025-04-28',
      },
      roof: { ageYears: 17, ageConfidence: 0.9, material: 'composition' },
      owner: { occupied: true, portfolioSize: 1, segment: 'owner-occupier' },
      hook: 'Golf-ball hail was recorded on your street on April 28, 2025, on a roof already 17 years old.',
    },
    {
      parcelId: 'R-8801-002',
      address: '1180 Cottonwood Road',
      city: 'Marshall',
      state,
      ownerName: 'M. Orozco',
      score: { value: 64, grade: 'B' },
      signals: {
        hailEventsLast3y: 1,
        hailMaxInches: 1.0,
        roofAgeYears: 21,
        ownerOccupied: true,
      },
      contributions: { roofAgeYears: 34, hailMaxInches: 18, hailEventsLast3y: 8 },
      storm: {
        hailEventsLast3y: 1,
        hailEventsCountyWide: 6,
        hailMaxInches: 1.0,
        lastHailDate: '2024-06-02',
      },
      roof: { ageYears: 21, ageConfidence: 0.75, material: 'composition' },
      owner: { occupied: true, portfolioSize: 1, segment: 'owner-occupier' },
      hook: 'A 21-year-old roof that took quarter-size hail in June 2024 — past the point most carriers still pay full replacement.',
    },
    {
      parcelId: 'R-8802-114',
      address: '77 Pinecrest Drive',
      city: 'Hallsville',
      state,
      ownerName: 'Redbud Holdings LLC',
      score: { value: 41, grade: 'C' },
      signals: {
        hailEventsLast3y: 0,
        roofAgeYears: 14,
        ownerOccupied: false,
      },
      contributions: { roofAgeYears: 22, ownerOccupied: 9 },
      storm: { hailEventsLast3y: 0, hailEventsCountyWide: 6 },
      roof: { ageYears: 14, ageConfidence: 0.6, material: 'architectural' },
      owner: { occupied: false, portfolioSize: 7, segment: 'portfolio-landlord' },
      hook: 'Seven-parcel owner with a 14-year-old roof here — worth a portfolio conversation, not a storm pitch.',
    },
  ];
}
