/**
 * Climate stress per county, from the NOAA/NCEI 1991-2020 Climate Normals.
 *
 * Roof age is the heaviest signal in the roofing model, and it is the one most
 * often read wrong, because a year does not weather a shingle the same way
 * everywhere. Asphalt fails by thermal cycling: every freeze and every 90F
 * afternoon expands and contracts the mat until the granules let go. Denver
 * runs about 197 such days a year and San Diego about one, so the same twenty
 * years of calendar buys wildly different amounts of remaining life.
 *
 * There is no bulk file for these normals and the data service refuses a
 * bounding box, so stations come from the published directory listing and are
 * batched through the API.
 *
 * Only the USW first-order stations carry these fields — 1,162 of the 15,323
 * with any 1991-2020 normals. The 8,048 USC cooperative sites and the 5,147
 * US1 CoCoRaHS sites are precipitation-first and return a row with the
 * temperature-days columns simply absent, so querying them all costs 77
 * requests to learn nothing. Counties are matched to the nearest station that
 * does report both.
 *
 *   DATABASE_URL=... node scripts/ingest-climate-normals.mjs
 */
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

const BASE = 'https://www.ncei.noaa.gov';
const FIELDS = ['ANN-TMIN-AVGNDS-LSTH032', 'ANN-TMAX-AVGNDS-GRTH090'];
const BATCH = 100;
// Beyond this the station is describing a different climate, and a wrong
// number is worse than an absent one: the model reports missing signals as
// missing and renormalises, but it cannot know a present number is nonsense.
const MAX_STATION_KM = 160;

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const sql = neon(url);

const haversine = (aLat, aLon, bLat, bLon) => {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

/**
 * A normals value, scaled back from tenths, with GHCN's sentinels resolved.
 *
 * -7777 is "a non-zero value that rounds to zero" and -8888 a trace, both of
 * which mean zero days for a count of days: the Oregon coast and the Alaskan
 * interior really do get no afternoons above 90F. Taking them literally puts
 * -777.7 stress days on a county and sorts it below a roof in San Diego.
 * -9999 is genuinely missing. A day count cannot be negative for any other
 * reason, so anything else below zero is treated as missing too.
 */
const scaled = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n === -7777 || n === -8888 || n === -6666) return 0;
  if (n < 0) return null;
  return n / 10;
};

async function stationIds() {
  const res = await fetch(`${BASE}/data/normals-annualseasonal/1991-2020/access/`);
  const html = await res.text();
  const all = [...new Set([...html.matchAll(/href="([A-Z]{2}[A-Z0-9]{9})\.csv"/g)].map((m) => m[1]))];
  // Third character 'W' is the first-order/airport network. Nothing else
  // publishes the temperature-days normals this reads.
  return all.filter((id) => id[2] === 'W');
}

async function fetchBatch(ids) {
  const params = new URLSearchParams({
    dataset: 'normals-annualseasonal',
    stations: ids.join(','),
    startDate: '2010-01-01',
    endDate: '2010-12-31',
    format: 'json',
    dataTypes: FIELDS.join(','),
    includeStationLocation: '1',
  });
  const res = await fetch(`${BASE}/access/services/data/v1?${params}`);
  if (!res.ok) throw new Error(`NCEI ${res.status} for ${ids.length} stations`);
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}

const ids = await stationIds();
console.log(`${ids.length} stations with 1991-2020 normals`);

const stations = [];
for (let i = 0; i < ids.length; i += BATCH) {
  const slice = ids.slice(i, i + BATCH);
  let rows = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      rows = await fetchBatch(slice);
      break;
    } catch (err) {
      if (attempt === 2) console.warn(`\n  batch at ${i} failed: ${err.message}`);
      else await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  for (const r of rows) {
    const freeze = r[FIELDS[0]];
    const hot = r[FIELDS[1]];
    const lat = Number(r.LATITUDE);
    const lon = Number(r.LONGITUDE);
    // Both fields are required: a station with only one describes half a
    // climate.
    if (freeze == null || hot == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const f = scaled(freeze);
    const h = scaled(hot);
    if (f === null || h === null) continue;
    stations.push({ id: r.STATION, name: r.NAME ?? null, lat, lon, freeze: f, hot: h });
  }
  process.stdout.write(`\r  ${Math.min(i + BATCH, ids.length)}/${ids.length} queried, ${stations.length} usable`);
}
console.log(`\n${stations.length} stations report both normals`);

const counties = JSON.parse(readFileSync(new URL('../data/counties.json', import.meta.url), 'utf8')).counties;
const rows = [];
let unmatched = 0;
for (const c of counties) {
  if (c.lat == null || c.lon == null) { unmatched++; continue; }
  let best = null;
  let bestKm = Infinity;
  for (const s of stations) {
    const km = haversine(c.lat, c.lon, s.lat, s.lon);
    if (km < bestKm) { bestKm = km; best = s; }
  }
  if (!best || bestKm > MAX_STATION_KM) { unmatched++; continue; }
  rows.push({
    fips: c.fips,
    freeze: best.freeze,
    hot: best.hot,
    cycles: Math.round((best.freeze + best.hot) * 10) / 10,
    stationId: best.id,
    stationName: best.name,
    km: Math.round(bestKm * 10) / 10,
  });
}
console.log(`${rows.length} counties matched, ${unmatched} without a station within ${MAX_STATION_KM}km`);

const WRITE = 500;
let written = 0;
for (let i = 0; i < rows.length; i += WRITE) {
  const batch = rows.slice(i, i + WRITE);
  const values = batch
    .map((_, n) => `($${n * 7 + 1}, $${n * 7 + 2}, $${n * 7 + 3}, $${n * 7 + 4}, $${n * 7 + 5}, $${n * 7 + 6}, $${n * 7 + 7})`)
    .join(', ');
  const params = batch.flatMap((r) => [r.fips, r.freeze, r.hot, r.cycles, r.stationId, r.stationName, r.km]);
  await sql.query(
    `INSERT INTO county_climate (fips, freeze_days, hot_days, thermal_cycles, station_id, station_name, station_km)
     VALUES ${values}
     ON CONFLICT (fips) DO UPDATE SET
       freeze_days = excluded.freeze_days, hot_days = excluded.hot_days,
       thermal_cycles = excluded.thermal_cycles, station_id = excluded.station_id,
       station_name = excluded.station_name, station_km = excluded.station_km,
       updated_at = NOW()`,
    params
  );
  written += batch.length;
  process.stdout.write(`\r  ${written}/${rows.length} written`);
}
console.log(`\ndone — ${written} counties`);
