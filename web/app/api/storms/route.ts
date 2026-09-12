import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getAccountByClerkId, stormsNearPoint, parcelsNearPoint } from '@/lib/db';
import { scoreLead } from '@engine';

export const maxDuration = 30;

/**
 * GET /api/storms?lat=..&lng=..&radiusKm=..
 *
 * Storm impacts around a point, and the properties under them. Radius rather
 * than county because that is the question a contractor standing in a
 * neighbourhood actually asks, and because it is what a map needs.
 */
export async function GET(request: Request) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const account = await getAccountByClerkId(userId);
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const params = new URL(request.url).searchParams;
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const radiusKm = Number(params.get('radiusKm') ?? 5);
  const sinceYears = Number(params.get('sinceYears') ?? 3);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng required' }, { status: 400 });
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: 'lat or lng out of range' }, { status: 400 });
  }
  // An unbounded radius is a full table scan dressed as a query.
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 80) {
    return NextResponse.json({ error: 'radiusKm must be between 0 and 80' }, { status: 400 });
  }

  try {
    const [storms, nearby] = await Promise.all([
      stormsNearPoint(lat, lng, radiusKm, { sinceYears }),
      parcelsNearPoint(lat, lng, radiusKm),
    ]);

    const thisYear = new Date().getFullYear();
    const properties = nearby.map((p) => {
      const roofAgeYears = p.year_built ? thisYear - p.year_built : undefined;
      const hailMax = p.hail_max_in ? Number(p.hail_max_in) : null;
      const claim =
        hailMax !== null && roofAgeYears !== undefined
          ? Math.max(0, Math.min(1, (hailMax / 2) * (roofAgeYears / 25)))
          : undefined;

      const score = scoreLead('roofing', {
        roofAgeYears,
        hailEventsLast3y: p.hail_3y,
        windEventsLast3y: p.wind_3y,
        propertyValue: p.parcel_value ? Number(p.parcel_value) : undefined,
        ownerOccupied: p.absentee_owner === null ? undefined : !p.absentee_owner,
        insuranceClaimLikelihood: claim,
      });

      return {
        id: p.id,
        parcelId: p.parcel_no,
        address: p.site_address,
        city: p.site_city,
        state: p.site_state,
        zip: p.site_zip,
        countyFips: p.county_fips,
        lat: p.lat,
        lng: p.lon,
        distanceKm: Number(p.distance_km),
        ownerName: p.owner_name,
        ownerOccupied: p.absentee_owner === null ? null : !p.absentee_owner,
        yearBuilt: p.year_built,
        // The engine's number, not a separate one invented for the map. A
        // property must not score differently depending on which screen it is on.
        damageScore: score.score,
        grade: score.grade,
        confidence: score.confidence,
        hailEventsLast3y: p.hail_3y,
        hailMaxInches: hailMax,
        lastHailDate: p.hail_last,
      };
    });

    return NextResponse.json({
      center: { lat, lng, radiusKm },
      storms: storms.map((s) => ({
        id: s.event_id,
        type: s.event_type,
        date: s.begin_date,
        magnitude: s.magnitude === null ? null : Number(s.magnitude),
        lat: s.lat,
        lng: s.lon,
        distanceKm: Number(s.distance_km),
        county: s.cz_name,
        state: s.state,
      })),
      properties,
      counts: { storms: storms.length, properties: properties.length },
    });
  } catch (error) {
    console.error('Storm impact query failed:', error);
    return NextResponse.json({ error: 'Failed to load storm impacts' }, { status: 500 });
  }
}
