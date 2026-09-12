/**
 * Public ArcGIS parcel services -> Postgres.
 *
 * Hundreds of counties and several states publish their parcel roll as an open
 * ArcGIS feature service. That is a real, free, licensable source of the one
 * thing NOAA cannot give us: an address and the name of the person who owns it.
 *
 *   DATABASE_URL=... node scripts/ingest-parcels-arcgis.mjs nc <countyName> [maxRows]
 */
import { neon } from '@neondatabase/serverless';

const SOURCES = {
  // NC OneMap publishes all 100 counties as a single statewide point layer.
  nc: {
    id: 'nc-onemap',
    url: 'https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer/0/query',
    countyField: 'cntyname',
    fipsField: 'stcntyfips',
    orderBy: 'objectid',
    fields: {
      parcel_no: 'parno', owner_name: 'ownname', owner_name2: 'ownname2',
      site_address: 'siteadd', site_city: 'scity', site_state: 'sstate', site_zip: 'szip',
      mail_address: 'mailadd', mail_city: 'mcity',
      year_built: 'structyear', parcel_value: 'parval', improvement_value: 'improvval',
      land_use: 'parusedesc', acres: 'gisacres',
    },
    // Counties populate the schema inconsistently: Wake fills the combined
    // siteadd, Guilford leaves it empty and fills only the components. Dropping
    // rows without siteadd would silently discard 187,000 real Guilford
    // properties, so the address is composed when the combined field is blank.
    // The street name lives in saddstr. saddstname is empty in several counties
    // including Guilford, and 'stname' holds the STATE despite its name, so
    // composing from those alone yields "1526 ST" with no street at all.
    addressParts: ['saddno', 'saddpref', 'saddstr', 'saddstname', 'saddsttyp', 'saddstsuf'],
  },
};

const COLS = ['id','county_fips','parcel_no','owner_name','owner_name2','site_address','site_city',
  'site_state','site_zip','mail_address','mail_city','absentee_owner','year_built','parcel_value',
  'improvement_value','land_use','acres','lat','lon','source'];

const sql = neon(process.env.DATABASE_URL);
const [, , sourceKey, countyName, maxRowsArg] = process.argv;
const src = SOURCES[sourceKey];
if (!src || !countyName) {
  console.error('usage: ingest-parcels-arcgis.mjs <' + Object.keys(SOURCES).join('|') + '> <county> [maxRows]');
  process.exit(1);
}
const maxRows = Number(maxRowsArg || 50000);
const PAGE = 1000;
const outFields = [
  src.orderBy, src.fipsField, ...Object.values(src.fields), ...(src.addressParts ?? []),
].join(',');

const composeAddress = (a) => {
  const street = (a.saddstr || a.saddstname || '').toString().trim();
  if (!street) return '';
  return [a.saddno, a.saddpref, street, a.saddsttyp, a.saddstsuf]
    .map((v) => (v ?? '').toString().trim())
    .filter(Boolean)
    .join(' ')
    .trim();
};

async function flush(batch) {
  if (!batch.length) return 0;
  const ph = batch
    .map((_, i) => '(' + COLS.map((__, j) => `$${i * COLS.length + j + 1}`).join(',') + ')')
    .join(',');
  await sql.query(
    `INSERT INTO parcels (${COLS.join(',')}) VALUES ${ph}
     ON CONFLICT (id) DO UPDATE SET
       owner_name = excluded.owner_name, site_address = excluded.site_address,
       year_built = excluded.year_built, parcel_value = excluded.parcel_value,
       absentee_owner = excluded.absentee_owner, updated_at = NOW()`,
    batch.flat()
  );
  return batch.length;
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
// Punctuation is not consistent between the situs and mailing records — the
// same house appears as OROURKE DR on one and O'ROURKE DR on the other. Comparing
// raw strings marks those owners absentee, which suppresses the heaviest
// property signal on exactly the homeowners most likely to answer the door.
const norm = (s) =>
  (s ?? '').toString().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

let offset = 0, loaded = 0, batch = [];
while (loaded < maxRows) {
  const params = new URLSearchParams({
    // Only structures worth roofing, and only ones old enough to be a lead.
    where: `${src.countyField}='${countyName}' AND structyear>1900`,
    outFields, orderByFields: src.orderBy, resultOffset: String(offset),
    resultRecordCount: String(PAGE), returnGeometry: 'true', outSR: '4326', f: 'json',
  });
  const res = await fetch(`${src.url}?${params}`);
  if (!res.ok) { console.error('http', res.status); break; }
  const data = await res.json();
  if (data.error) { console.error('arcgis:', JSON.stringify(data.error).slice(0, 200)); break; }
  const feats = data.features ?? [];
  if (!feats.length) break;

  for (const f of feats) {
    const a = f.attributes, g = f.geometry ?? {};
    const fips = a[src.fipsField];
    const site = (a[src.fields.site_address] || '').trim() || composeAddress(a);
    if (!fips || !site) continue;
    const mail = a[src.fields.mail_address];
    batch.push([
      `${src.id}:${fips}:${a[src.orderBy]}`, fips,
      a[src.fields.parcel_no], a[src.fields.owner_name], a[src.fields.owner_name2],
      site, a[src.fields.site_city], a[src.fields.site_state], a[src.fields.site_zip],
      mail, a[src.fields.mail_city],
      // The assessor's own tell: bills posted elsewhere means nobody who can say
      // yes answers this door.
      mail ? norm(mail) !== norm(site) : null,
      num(a[src.fields.year_built]), num(a[src.fields.parcel_value]),
      num(a[src.fields.improvement_value]), a[src.fields.land_use], num(a[src.fields.acres]),
      num(g.y), num(g.x), src.id,
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
  VALUES (${src.id}, ${'NC OneMap statewide parcels'}, ${'NC'}, ${src.url},
          ${JSON.stringify(src.fields)}::jsonb, ${countyName}, NOW(), ${loaded})
  ON CONFLICT (id) DO UPDATE SET last_run_at = NOW(), last_run_rows = ${loaded}, counties = ${countyName}
`;
console.log(`${countyName}: ${loaded.toLocaleString()} parcels loaded`);
