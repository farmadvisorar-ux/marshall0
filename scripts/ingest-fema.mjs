/**
 * FEMA disaster declarations -> Postgres.
 *
 * A county under a federal declaration has insurance adjusters, assistance money
 * and homeowner urgency all moving at once. It is the difference between a roof
 * that needs replacing and a roof someone is actively trying to get replaced.
 *
 *   DATABASE_URL=... node scripts/ingest-fema.mjs [sinceFiscalYear]
 */
import { neon } from '@neondatabase/serverless';

const API = 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries';
const FIELDS = 'disasterNumber,state,declarationType,incidentType,declarationDate,declarationTitle,fipsStateCode,fipsCountyCode';
const COLS = ['id','disaster_number','county_fips','state','incident_type','declaration_type','declared_date','title'];

const sql = neon(process.env.DATABASE_URL);
const since = Number(process.argv[2] || 2015);

async function flush(batch) {
  if (!batch.length) return 0;
  const ph = batch
    .map((_, i) => '(' + COLS.map((__, j) => `$${i * COLS.length + j + 1}`).join(',') + ')')
    .join(',');
  await sql.query(
    `INSERT INTO fema_declarations (${COLS.join(',')}) VALUES ${ph} ON CONFLICT (id) DO NOTHING`,
    batch.flat()
  );
  return batch.length;
}

let skip = 0, loaded = 0, batch = [];
for (;;) {
  const url = `${API}?$filter=fyDeclared ge ${since}&$select=${FIELDS}&$top=1000&$skip=${skip}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FEMA http ${res.status}`);
  const rows = (await res.json()).DisasterDeclarationsSummaries ?? [];
  if (!rows.length) break;

  for (const r of rows) {
    const st = String(r.fipsStateCode ?? '').padStart(2, '0');
    const co = String(r.fipsCountyCode ?? '').padStart(3, '0');
    // Statewide rows carry no county and would otherwise mark every territory
    // in the state as federally declared.
    if (st === '00' || co === '000') continue;
    const fips = st + co;
    batch.push([
      `${r.disasterNumber}-${fips}`, r.disasterNumber, fips, r.state,
      r.incidentType, r.declarationType,
      (r.declarationDate || '').slice(0, 10) || null, r.declarationTitle,
    ]);
    if (batch.length >= 500) { loaded += await flush(batch); batch = []; }
  }
  skip += 1000;
}
loaded += await flush(batch);
console.log(`county-level declarations: ${loaded.toLocaleString()}`);
