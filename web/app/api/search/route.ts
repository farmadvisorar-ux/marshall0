import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { entitlements, quotaState } from '@engine';

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get account
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (accountError || !account) {
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
    const { data: serviceArea, error: areaError } = await supabase
      .from('service_areas')
      .select('*')
      .eq('id', serviceAreaId)
      .eq('account_id', account.id)
      .single();

    if (areaError || !serviceArea) {
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

    const { data: monthlyLeads } = await supabase
      .from('leads')
      .select('id', { count: 'exact' })
      .eq('account_id', account.id)
      .gte('created_at', monthStart);

    const quota = quotaState({
      plan_id: account.plan_id,
      leadsReleased: monthlyLeads?.length || 0,
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

    const mockLeads = generateMockLeads(account.id, serviceArea, minScore);

    // Write leads to database
    const leadsToInsert = mockLeads.map((lead) => ({
      account_id: account.id,
      service_area_id: serviceArea.id,
      industry,
      parcel_id: lead.parcelId,
      address: lead.address,
      city: lead.city,
      state: lead.state,
      owner_name: lead.ownerName,
      signals: lead.signals,
      contributions: lead.contributions,
      score: lead.score,
      storm: lead.storm,
      roof: lead.roof,
      owner: lead.owner,
      release: lead.release,
      hook: lead.hook,
      status: 'available',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { data: insertedLeads, error: insertError } = await supabase
      .from('leads')
      .insert(leadsToInsert)
      .select();

    if (insertError) {
      console.error('Failed to insert leads:', insertError);
      return NextResponse.json(
        { error: 'Failed to save leads', details: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      leads: insertedLeads || mockLeads,
      count: insertedLeads?.length || mockLeads.length,
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
