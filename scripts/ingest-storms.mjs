/**
 * NOAA Storm Events -> Postgres.
 *
 * The national hail and wind record, which is the single strongest predictor of
 * roofing demand and the only one of our sources that is free, authoritative and
 * covers every county. Re-runnable: events are keyed on NOAA's own EVENT_ID, so
 * a second pass refreshes the year rather than duplicating it.
 *
 *   DATABASE_URL=... node scripts/ingest-storms.mjs [startYear] [endYear]
 */
import { neon } from '@neondatabase/serverless';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import readline from 'node:readline';

const BASE = 'https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/';
// Wind and hail damage roofs; flood and drought do not. Scoring only ever sees
// event types a contractor can actually sell against.
const SCOREABLE = new Set(['Hail', 'Thunderstorm Wind', 'High Wind', 'Tornado', 'Strong Wind']);
const COLS = ['event_id','event_type','state','county_fips','cz_name','begin_date','magnitude','lat','lon'];

const sql = neon(process.env.DATABASE_URL);
const startYear = Number(process.argv[2] || 2015);
const endYear = Number(process.argv[3] || new Date().getFullYear());

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (v) => { const n = Number(v); return v === '' || Number.isNaN(n) ? null : n; };

async function flush(batch) {
  if (!batch.length) return 0;
  const ph = batch
    .map((_, i) => '(' + COLS.map((__, j) => `$${i * COLS.length + j + 1}`).join(',') + ')')
    .join(',');
  await sql.query(
    `INSERT INTO storm_events (${COLS.join(',')}) VALUES ${ph}
     ON CONFLICT (event_id) DO UPDATE SET magnitude = excluded.magnitude, lat = excluded.lat, lon = excluded.lon`,
    batch.flat()
  );
  return batch.length;
}

const index = await (await fetch(BASE)).text();
let grand = 0;

for (let year = startYear; year <= endYear; year++) {
  const re = new RegExp(`StormEvents_details-ftp_v1\\.0_d${year}_c\\d+\\.csv\\.gz`, 'g');
  const file = [...new Set(index.match(re) ?? [])].sort().pop();
  if (!file) { console.log(`${year}: no file published`); continue; }

  const res = await fetch(BASE + file);
  if (!res.ok) { console.log(`${year}: http ${res.status}`); continue; }

  const rl = readline.createInterface({
    input: Readable.fromWeb(res.body).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  let header = null, batch = [], loaded = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const f = splitCsv(line);
    if (!header) { header = Object.fromEntries(f.map((h, i) => [h, i])); continue; }
    const type = f[header.EVENT_TYPE];
    if (!SCOREABLE.has(type)) continue;
    // CZ_TYPE 'C' is a county code; 'Z' is a forecast zone that does not map to
    // a FIPS, and a zone cannot be sold as a territory.
    if (f[header.CZ_TYPE] !== 'C') continue;

    const ym = f[header.BEGIN_YEARMONTH], day = Number(f[header.BEGIN_DAY]);
    const eventId = Number(f[header.EVENT_ID]);
    const stateFips = Number(f[header.STATE_FIPS]), czFips = Number(f[header.CZ_FIPS]);
    if (!ym || !day || !eventId || !stateFips || !czFips) continue;

    batch.push([
      eventId, type, f[header.STATE],
      String(stateFips).padStart(2, '0') + String(czFips).padStart(3, '0'),
      f[header.CZ_NAME],
      `${ym.slice(0, 4)}-${ym.slice(4, 6)}-${String(day).padStart(2, '0')}`,
      num(f[header.MAGNITUDE]), num(f[header.BEGIN_LAT]), num(f[header.BEGIN_LON]),
    ]);
    if (batch.length >= 1000) { loaded += await flush(batch); batch = []; }
  }
  loaded += await flush(batch);
  grand += loaded;
  console.log(`${year}: ${loaded.toLocaleString()} scoreable events`);
}

console.log(`total: ${grand.toLocaleString()}`);
