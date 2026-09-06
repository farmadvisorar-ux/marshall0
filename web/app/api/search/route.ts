import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { sql } from '@vercel/postgres';
import { entitlements, quotaState } from '@engine';

export async function POST(request: NextRequest) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get account
  let account;
  try {
    const result = await sql`
      SELECT id, user_id, plan_id, free, founding_member
      FROM accounts
      WHERE clerk_id = ${userId}
    `;
    account = result.rows[0];
  } catch (error) {
    console.error('Failed to fetch account:', error);
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { serviceAreaId, industry, minScore, filters } = body;

    if (!serviceAreaId || !industry) {
      return NextResponse.json(
        { error: 'Missing required fields: serviceAreaId, industry' },
        { status: 400 }
      );
    }

    // Get service area
    let serviceArea;
    try {
      const result = await sql`
        SELECT id, name, county_fips, state
        FROM service_areas
        WHERE id = ${serviceAreaId} AND account_id = ${account.id}
      `;
      serviceArea = result.rows[0];
    } catch (error) {
      console.error('Failed to fetch service area:', error);
      return NextResponse.json(
        { error: 'Service area not found' },
        { status: 404 }
      );
    }

    if (!serviceArea) {
      return NextResponse.json(
        { error: 'Service area not found' },
        { status: 404 }
      );
    }

    // Check quota
    const entitlementInfo = entitlements({
      plan_id: account.plan_id,
      free: account.free,
      founding_member: account.founding_member,
    });

    // Get current month's lead count
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    let monthlyLeadsCount = 0;
    try {
      const result = await sql`
        SELECT COUNT(*) as count
        FROM leads
        WHERE account_id = ${account.id} AND created_at >= ${monthStart}
      `;
      monthlyLeadsCount = parseInt(result.rows[0].count as string, 10);
    } catch (error) {
      console.error('Failed to fetch monthly leads:', error);
    }

    const quota = quotaState({
      plan_id: account.plan_id,
      leadsReleased: monthlyLeadsCount,
      free: account.free,
    });

    if (!quota.available) {
      return NextResponse.json(
        {
          error: 'Monthly quota exceeded',
          current: quota.leadsUsed,
          limit: entitlementInfo.leadsPerMonth,
        },
        { status: 429 }
      );
    }

    // TODO: Integrate with actual data sources
    // 1. Fetch parcels from assessor service for the area
    // 2. Fetch permits for those parcels
    // 3. Fetch storm events from NOAA
    // 4. Run roofing pipeline
    // For now, return mock data for demo

    const mockLeads = generateMockLeads(account.id as string, serviceArea, minScore);

    // Write leads to database
    let insertedCount = 0;
    try {
      for (const lead of mockLeads) {
        await sql`
          INSERT INTO leads (
            account_id, service_area_id, industry, parcel_id,
            address, city, state, owner_name,
            signals, contributions, score, storm, roof, owner, hook,
            status, created_at, updated_at
          ) VALUES (
            ${account.id}, ${serviceArea.id}, ${industry}, ${lead.parcelId},
            ${lead.address}, ${lead.city}, ${lead.state}, ${lead.ownerName},
            ${JSON.stringify(lead.signals)}, ${JSON.stringify(lead.contributions)},
            ${JSON.stringify(lead.score)}, ${JSON.stringify(lead.storm)},
            ${JSON.stringify(lead.roof)}, ${JSON.stringify(lead.owner)}, ${lead.hook},
            'available', NOW(), NOW()
          )
        `;
        insertedCount++;
      }
    } catch (error) {
      console.error('Failed to insert leads:', error);
      return NextResponse.json(
        { error: 'Failed to save leads', details: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      leads: mockLeads,
      count: insertedCount,
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    );
  }
}

function generateMockLeads(accountId: string, serviceArea: any, minScore: number) {
  // Demo mock leads for testing the UI
  const leads = [
    {
      parcelId: 'R-8801-001',
      address: '512 West Grand Avenue',
      city: 'Marshall',
      state: 'TX',
      ownerName: 'John Smith',
      score: {
        value: Math.max(minScore, 72),
        grade: 'A',
      },
      signals: {
        hailEventsLast3y: 3,
        hailMaxInches: 1.2,
        windEventsLast3y: 1,
        roofAgeYears: 15,
        ownerOccupied: true,
      },
      contributions: {
        hailEventsLast3y: 25,
        hailMaxInches: 12,
        roofAgeYears: 35,
      },
      storm: {
        hailEventsLast3y: 3,
        hailMaxInches: 1.2,
        lastHailDate: '2024-05-14',
        daysSinceLastHail: 240,
      },
      roof: {
        ageYears: 15,
        ageConfidence: 0.95,
        material: 'composition',
      },
      owner: {
        occupied: true,
        portfolioSize: 1,
        segment: 'owner-occupier',
      },
      release: {
        permitted: true,
        withheldReason: null,
      },
      hook: 'Hail damage reported nearby on May 14, 2024 — your roof was already 12 years old.',
    },
    {
      parcelId: 'R-8801-002',
      address: '1180 Cottonwood Road',
      city: 'Marshall',
      state: 'TX',
      ownerName: 'Jane Doe',
      score: {
        value: Math.max(minScore, 58),
        grade: 'B',
      },
      signals: {
        hailEventsLast3y: 2,
        hailMaxInches: 0.8,
        windEventsLast3y: 0,
        roofAgeYears: 18,
        ownerOccupied: true,
      },
      contributions: {
        hailEventsLast3y: 20,
        roofAgeYears: 36,
      },
      storm: {
        hailEventsLast3y: 2,
        hailMaxInches: 0.8,
        lastHailDate: '2024-06-02',
        daysSinceLastHail: 226,
      },
      roof: {
        ageYears: 18,
        ageConfidence: 0.9,
        material: 'composition',
      },
      owner: {
        occupied: true,
        portfolioSize: 1,
        segment: 'owner-occupier',
      },
      release: {
        permitted: true,
        withheldReason: null,
      },
      hook: 'Hail activity in the county — roof is 18 years old.',
    },
  ].filter((lead) => lead.score.value >= minScore);

  return leads;
}
