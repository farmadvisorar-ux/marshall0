/**
 * Census ACS 5-year county profiles -> Postgres.
 *
 * Owner-occupancy and median year built are the two property signals available
 * for every county in the country, including the thousands with no open parcel
 * roll. They are what lets a territory be ranked before a single address is known.
 *
 *   CENSUS_API_KEY=... DATABASE_URL=... node scripts/ingest-census.mjs [vintage]
 */
import { neon } from '@neondatabase/serverless';

const VARS = {
  households: 'B25003_001E',
  owner_occupied: 'B25003_002E',
  median_year_built: 'B25035_001E',
  median_income: 'B19013_001E',
  median_home_value: 'B25077_001E',
};
const COLS = ['fips', ...Object.keys(VARS)];

const sql = neon(process.env.DATABASE_URL);
const key = process.env.CENSUS_API_KEY;
if (!key) throw new Error('CENSUS_API_KEY is not set');
const vintage = process.argv[2] || '2023';

// ACS negative sentinels (-666666666 and friends) mean "not estimable", which is
// not the same as zero and must not be scored as one.
const clean = (v) => {
  const n = Number(v);
  return !Number.isFinite(n) || n < 0 ? null : n;
};

const url = `https://api.census.gov/data/${vintage}/acs/acs5?get=${Object.values(VARS).join(',')}&for=county:*&key=${key}`;
const res = await fetch(url);
if (!res.ok) throw new Error(`census http ${res.status}: ${(await res.text()).slice(0, 200)}`);
const rows = await res.json();
const head = rows[0];
const idx = Object.fromEntries(Object.entries(VARS).map(([k, v]) => [k, head.indexOf(v)]));
const stIdx = head.indexOf('state'), coIdx = head.indexOf('county');

let batch = [], loaded = 0;
const flush = async () => {
  if (!batch.length) return;
  const ph = batch
    .map((_, i) => '(' + COLS.map((__, j) => `$${i * COLS.length + j + 1}`).join(',') + ')')
    .join(',');
  await sql.query(
    `INSERT INTO census_county (${COLS.join(',')}) VALUES ${ph}
     ON CONFLICT (fips) DO UPDATE SET
       households = excluded.households, owner_occupied = excluded.owner_occupied,
       median_year_built = excluded.median_year_built, median_income = excluded.median_income,
       median_home_value = excluded.median_home_value, updated_at = NOW()`,
    batch.flat()
  );
  loaded += batch.length; batch = [];
};

for (const r of rows.slice(1)) {
  batch.push([r[stIdx] + r[coIdx], ...Object.keys(VARS).map((k) => clean(r[idx[k]]))]);
  if (batch.length >= 500) await flush();
}
await flush();
console.log(`census county profiles: ${loaded.toLocaleString()} (ACS ${vintage} 5-year)`);
