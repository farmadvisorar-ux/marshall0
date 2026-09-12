/**
 * Bulk parcel ingestion from the command line.
 *
 * Shares one registry with the app (src/parcel-sources.ts) so a field mapping
 * cannot drift between what a backfill loads and what the on-demand path
 * loads. This exists for backfilling a county in one pass, which a request
 * cannot do — the app's loader is bounded by the function timeout.
 *
 *   DATABASE_URL=... node --experimental-strip-types \
 *     scripts/ingest-parcels-arcgis.mjs <fips> [maxRows]
 */
import { neon } from '@neondatabase/serverless';
import { sourceForCounty, PARCEL_SOURCES } from '../src/parcel-sources.ts';
import { looksLikeOrganization, isAbsenteeOwner } from '../src/owner-type.ts';

const COLS = ['id','county_fips','parcel_no','owner_name','owner_name2','site_address','site_city',
  'site_state','site_zip','mail_address','mail_city','absentee_owner','owner_is_org','year_built',
  'parcel_value','improvement_value','land_use','acres','lat','lon','source'];

const sql = neon(process.env.DATABASE_URL);
const [, , fips, maxRowsArg] = process.argv;

if (!fips) {
  console.error('usage: ingest-parcels-arcgis.mjs <5-digit county FIPS> [maxRows]');
  console.error('sources wired:');
  for (const s of PARCEL_SOURCES) console.error(`  ${s.state}  ${s.label}`);
  process.exit(1);
}

const source = sourceForCounty(fips);
if (!source) {
  console.error(`no parcel source wired for FIPS ${fips}`);
  process.exit(1);
}

const maxRows = Number(maxRowsArg || 100000);
const PAGE = 1000;

async function flush(rows) {
  if (!rows.length) return 0;
  // Postgres refuses an ON CONFLICT touching the same row twice in one
  // statement, and a multi-polygon parcel arrives as several features sharing
  // one parcel number.
  const batch = [...new Map(rows.map((r) => [r[0], r])).values()];
  const ph = batch
    .map((_, i) => '(' + COLS.map((__, j) => `$${i * COLS.length + j + 1}`).join(',') + ')')
    .join(',');
  await sql.query(
    `INSERT INTO parcels (${COLS.join(',')}) VALUES ${ph}
     ON CONFLICT (id) DO UPDATE SET
       owner_name = excluded.owner_name, site_address = excluded.site_address,
       site_city = excluded.site_city, site_zip = excluded.site_zip,
       mail_address = excluded.mail_address, absentee_owner = excluded.absentee_owner,
       owner_is_org = excluded.owner_is_org, year_built = excluded.year_built,
       parcel_value = excluded.parcel_value, improvement_value = excluded.improvement_value,
       lat = excluded.lat, lon = excluded.lon, updated_at = NOW()`,
    batch.flat()
  );
  return batch.length;
}

let offset = 0, loaded = 0, skipped = 0, batch = [];

while (loaded < maxRows) {
  const params = new URLSearchParams({
    where: source.where(fips),
    outFields: source.outFields.join(','),
    orderByFields: source.orderBy,
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    returnGeometry: source.geometry === 'point' ? 'true' : 'false',
    outSR: '4326',
    f: 'json',
  });
  if (source.geometry === 'centroid') params.set('returnCentroid', 'true');

  const res = await fetch(`${source.url}?${params}`);
  if (!res.ok) { console.error('http', res.status); break; }
  const data = await res.json();
  if (data.error) { console.error('arcgis:', JSON.stringify(data.error).slice(0, 200)); break; }
  const feats = data.features ?? [];
  if (!feats.length) break;

  for (const f of feats) {
    const m = source.map(f.attributes);
    if (!m) { skipped++; continue; }
    const geom = source.geometry === 'centroid' ? f.centroid : f.geometry;
    const lat = source.geometry === 'attribute' ? m.lat ?? null : geom?.y ?? null;
    const lon = source.geometry === 'attribute' ? m.lon ?? null : geom?.x ?? null;
    const identity = (m.parcelNo ?? '').toString().trim() || String(m.key);

    batch.push([
      `${source.id}:${fips}:${identity}`, fips, m.parcelNo ?? null, m.ownerName ?? null,
      m.ownerName2 ?? null, m.siteAddress, m.siteCity ?? null, m.siteState ?? null,
      m.siteZip ?? null, m.mailAddress ?? null, m.mailCity ?? null,
      isAbsenteeOwner(m.siteAddress, m.mailAddress),
      looksLikeOrganization(m.ownerName),
      m.yearBuilt ?? null, m.parcelValue ?? null, m.improvementValue ?? null,
      m.landUse ?? null, m.acres ?? null, lat, lon, source.id,
    ]);
    if (batch.length >= 500) { loaded += await flush(batch); batch = []; }
  }
  offset += PAGE;
  if (feats.length < PAGE) break;
  if (offset % 10000 === 0) console.log(`  ${offset.toLocaleString()} scanned, ${loaded.toLocaleString()} loaded`);
}
loaded += await flush(batch);

await sql`
  INSERT INTO parcel_sources (id, name, state, url, field_map, counties, last_run_at, last_run_rows)
  VALUES (${source.id}, ${source.label}, ${source.state}, ${source.url}, '{}'::jsonb, ${fips}, NOW(), ${loaded})
  ON CONFLICT (id) DO UPDATE SET last_run_at = NOW(), last_run_rows = ${loaded}, counties = ${fips}
`;
console.log(`${source.label} / ${fips}: ${loaded.toLocaleString()} loaded, ${skipped.toLocaleString()} skipped`);
