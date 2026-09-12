/**
 * Public ArcGIS parcel services -> Postgres.
 *
 * Hundreds of counties and several states publish their parcel roll as an open
 * ArcGIS feature service. That is a real, free, licensable source of the one
 * thing NOAA cannot give us: an address and the name of the person who owns it.
 *
 * Every source below needed its own reading of the schema. Field names repeat
 * across counties but their meaning does not, so each mapping is written from
 * inspecting live records rather than assumed from the column name.
 *
 *   DATABASE_URL=... node scripts/ingest-parcels-arcgis.mjs <source> [county] [maxRows]
 */
import { neon } from '@neondatabase/serverless';
import { looksLikeOrganization, isAbsenteeOwner } from '../src/owner-type.ts';

const str = (v) => (v ?? '').toString().trim();
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const join = (...parts) => parts.map(str).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

const SOURCES = {
  // NC OneMap publishes all 100 counties as one statewide point layer.
  'nc-onemap': {
    label: 'NC OneMap statewide parcels',
    state: 'NC',
    url: 'https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer/0/query',
    orderBy: 'objectid',
    geometry: 'point',
    requiresCounty: true,
    countyClause: (county) => `cntyname='${county}' AND structyear>1900`,
    outFields: [
      'objectid', 'stcntyfips', 'parno', 'ownname', 'ownname2', 'siteadd', 'scity', 'sstate',
      'szip', 'mailadd', 'mcity', 'structyear', 'parval', 'improvval', 'parusedesc', 'gisacres',
      'saddno', 'saddpref', 'saddstr', 'saddstname', 'saddsttyp', 'saddstsuf',
    ],
    map: (a) => ({
      key: a.objectid,
      county_fips: a.stcntyfips,
      parcel_no: a.parno,
      owner_name: a.ownname,
      owner_name2: a.ownname2,
      // Wake fills the combined siteadd; Guilford leaves it empty and fills only
      // components. The street name is in saddstr — saddstname is empty in
      // several counties, and 'stname' holds the STATE despite its name.
      site_address: str(a.siteadd) || join(a.saddno, a.saddpref, a.saddstr || a.saddstname, a.saddsttyp, a.saddstsuf),
      site_city: a.scity,
      site_state: a.sstate,
      site_zip: a.szip,
      mail_address: a.mailadd,
      mail_city: a.mcity,
      year_built: num(a.structyear),
      parcel_value: num(a.parval),
      improvement_value: num(a.improvval),
      land_use: a.parusedesc,
      acres: num(a.gisacres),
    }),
  },

  // Harrison County TX has no county-wide open roll; the City of Marshall
  // publishes its own. The layer carries no FIPS and no year built.
  'marshall-tx': {
    label: 'City of Marshall TX parcels',
    state: 'TX',
    url: 'https://services6.arcgis.com/deHuGpt8nOXApIC6/arcgis/rest/services/City_of_Marshall_TX_Parcels_2026/FeatureServer/0/query',
    orderBy: 'OBJECTID',
    geometry: 'centroid',
    fixedFips: '48203',
    requiresCounty: false,
    // imprv_val of zero is bare land. A parcel with no structure has no roof,
    // and shipping it as a roofing lead wastes a door knock.
    countyClause: () => "situs_street IS NOT NULL AND file_as_name IS NOT NULL AND imprv_val > 0",
    outFields: [
      'OBJECTID', 'prop_id_text', 'file_as_name', 'situs_num', 'situs_street_prefx',
      'situs_street', 'situs_city', 'situs_state', 'situs_zip', 'addr_line1', 'addr_city',
      'market', 'imprv_val', 'legal_acreage',
    ],
    map: (a) => ({
      key: a.OBJECTID,
      parcel_no: a.prop_id_text,
      owner_name: a.file_as_name,
      owner_name2: null,
      // situs_street_sufix is excluded deliberately: it holds a city
      // abbreviation ("MAR"), not a street suffix, so including it produces
      // "4426 JEFF DAVIS MAR" for a house on Jeff Davis St.
      site_address: join(a.situs_num, a.situs_street_prefx, a.situs_street),
      site_city: str(a.situs_city) || 'Marshall',
      site_state: str(a.situs_state) || 'TX',
      site_zip: a.situs_zip,
      mail_address: a.addr_line1,
      mail_city: a.addr_city,
      year_built: null,
      parcel_value: num(a.market),
      improvement_value: num(a.imprv_val),
      land_use: null,
      acres: num(a.legal_acreage),
    }),
  },
};

const COLS = ['id','county_fips','parcel_no','owner_name','owner_name2','site_address','site_city',
  'site_state','site_zip','mail_address','mail_city','absentee_owner','owner_is_org','year_built',
  'parcel_value','improvement_value','land_use','acres','lat','lon','source'];

const sql = neon(process.env.DATABASE_URL);
const [, , sourceKey, arg1, arg2] = process.argv;
const src = SOURCES[sourceKey];
if (!src) {
  console.error(`usage: ingest-parcels-arcgis.mjs <${Object.keys(SOURCES).join('|')}> [county] [maxRows]`);
  process.exit(1);
}
const county = src.requiresCounty ? arg1 : null;
if (src.requiresCounty && !county) {
  console.error(`${sourceKey} requires a county name`);
  process.exit(1);
}
const maxRows = Number((src.requiresCounty ? arg2 : arg1) || 50000);
const PAGE = 1000;

async function flush(rows) {
  if (!rows.length) return 0;
  // Postgres refuses an ON CONFLICT that touches the same row twice in one
  // statement, and a multi-polygon parcel arrives as several features sharing
  // one parcel number. Collapsing them here is the same de-duplication the
  // customer needs anyway: one roof, one lead.
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
       owner_is_org = excluded.owner_is_org,
       year_built = excluded.year_built, parcel_value = excluded.parcel_value,
       improvement_value = excluded.improvement_value,
       lat = excluded.lat, lon = excluded.lon, updated_at = NOW()`,
    batch.flat()
  );
  return batch.length;
}

let offset = 0, loaded = 0, skipped = 0, batch = [];
while (loaded < maxRows) {
  const params = new URLSearchParams({
    where: src.countyClause(county),
    outFields: src.outFields.join(','),
    orderByFields: src.orderBy,
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    returnGeometry: src.geometry === 'point' ? 'true' : 'false',
    outSR: '4326',
    f: 'json',
  });
  if (src.geometry === 'centroid') params.set('returnCentroid', 'true');

  const res = await fetch(`${src.url}?${params}`);
  if (!res.ok) { console.error('http', res.status); break; }
  const data = await res.json();
  if (data.error) { console.error('arcgis:', JSON.stringify(data.error).slice(0, 200)); break; }
  const feats = data.features ?? [];
  if (!feats.length) break;

  for (const f of feats) {
    const a = f.attributes;
    const m = src.map(a);
    const fips = src.fixedFips ?? m.county_fips;
    const geom = src.geometry === 'centroid' ? f.centroid : f.geometry;
    if (!fips || !m.site_address) { skipped++; continue; }

    // Keyed on the assessor's parcel number, not the feature id. Marshall
    // splits a multi-polygon parcel into one feature per ring, so keying on
    // OBJECTID shipped 305 Henley Perry three times — the same roof, three
    // times against the customer's quota.
    const identity = str(m.parcel_no) || String(m.key);

    batch.push([
      `${sourceKey}:${fips}:${identity}`, fips, m.parcel_no, m.owner_name, m.owner_name2,
      m.site_address, m.site_city, m.site_state, m.site_zip, m.mail_address, m.mail_city,
      isAbsenteeOwner(m.site_address, m.mail_address),
      looksLikeOrganization(m.owner_name),
      m.year_built, m.parcel_value, m.improvement_value, m.land_use, m.acres,
      num(geom?.y), num(geom?.x), sourceKey,
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
  VALUES (${sourceKey}, ${src.label}, ${src.state}, ${src.url},
          ${JSON.stringify(src.outFields)}::jsonb, ${county ?? src.fixedFips ?? null}, NOW(), ${loaded})
  ON CONFLICT (id) DO UPDATE SET last_run_at = NOW(), last_run_rows = ${loaded},
    counties = ${county ?? src.fixedFips ?? null}
`;
console.log(`${src.label}${county ? ` (${county})` : ''}: ${loaded.toLocaleString()} loaded, ${skipped.toLocaleString()} skipped`);
