import { sourceForCounty, type ParcelSource, type MappedParcel } from '@engine/parcel-sources';
import { looksLikeOrganization, isAbsenteeOwner } from '@engine/owner-type';
import { insertParcels, recordSourceRun, countyParcelCount, type ParcelInsert } from './db';

const PAGE = 1000;

export type IngestResult =
  | { status: 'no-source'; fips: string; loaded: 0; total: number }
  | { status: 'loaded' | 'partial'; fips: string; source: string; label: string; loaded: number; total: number };

/**
 * Pull a county's parcel roll on demand.
 *
 * Bounded rather than exhaustive, because this runs inside a request: a large
 * county is hundreds of thousands of rows and a serverless function has
 * seconds. Each call extends coverage from where the last one stopped, so a
 * county fills in over repeated calls instead of timing out on the first.
 *
 * Loading on demand is also the only affordable shape. There are roughly 150
 * million parcels in the country and a contractor works a handful of counties;
 * storing the rest would be paying to warehouse land nobody has asked about.
 */
export async function ingestCounty(
  fips: string,
  opts: { maxRows?: number; deadlineMs?: number } = {}
): Promise<IngestResult> {
  const existing = await countyParcelCount(fips);
  const source = sourceForCounty(fips);
  if (!source) return { status: 'no-source', fips, loaded: 0, total: existing };

  const maxRows = opts.maxRows ?? 6000;
  const deadline = Date.now() + (opts.deadlineMs ?? 45_000);

  // Resume where the last call stopped. Approximate rather than exact — the
  // upstream ordering is stable but rows we skipped as unmappable are not
  // counted here, so a repeat pass may re-see a few. The upsert makes that
  // harmless.
  let offset = existing;
  let loaded = 0;

  while (loaded < maxRows && Date.now() < deadline) {
    const rows = await fetchPage(source, fips, offset);
    if (!rows.length) break;
    loaded += await insertParcels(rows);
    offset += PAGE;
    if (rows.length < PAGE) break;
  }

  const total = await countyParcelCount(fips);
  if (loaded > 0) {
    await recordSourceRun(source.id, source.label, source.state, source.url, fips, total);
  }

  return {
    status: loaded >= maxRows ? 'partial' : 'loaded',
    fips,
    source: source.id,
    label: source.label,
    loaded,
    total,
  };
}

async function fetchPage(
  source: ParcelSource,
  fips: string,
  offset: number
): Promise<ParcelInsert[]> {
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
  if (!res.ok) throw new Error(`${source.id}: http ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`${source.id}: ${JSON.stringify(data.error).slice(0, 160)}`);

  const out: ParcelInsert[] = [];
  for (const feature of data.features ?? []) {
    const mapped = source.map(feature.attributes);
    if (!mapped) continue;
    const row = toRow(source, fips, mapped, feature);
    if (row) out.push(row);
  }
  return out;
}

function toRow(
  source: ParcelSource,
  fips: string,
  m: MappedParcel,
  feature: any
): ParcelInsert | null {
  const geom = source.geometry === 'centroid' ? feature.centroid : feature.geometry;
  const lat = source.geometry === 'attribute' ? m.lat ?? null : geom?.y ?? null;
  const lon = source.geometry === 'attribute' ? m.lon ?? null : geom?.x ?? null;

  // Keyed on the assessor's parcel number, not the feature id: a multi-polygon
  // parcel arrives as one feature per ring, and keying on the feature id ships
  // the same roof several times against the customer's quota.
  const identity = (m.parcelNo ?? '').toString().trim() || String(m.key);

  return {
    id: `${source.id}:${fips}:${identity}`,
    county_fips: fips,
    parcel_no: m.parcelNo ?? null,
    owner_name: m.ownerName ?? null,
    owner_name2: m.ownerName2 ?? null,
    site_address: m.siteAddress,
    site_city: m.siteCity ?? null,
    site_state: m.siteState ?? null,
    site_zip: m.siteZip ?? null,
    mail_address: m.mailAddress ?? null,
    mail_city: m.mailCity ?? null,
    absentee_owner: isAbsenteeOwner(m.siteAddress, m.mailAddress),
    owner_is_org: looksLikeOrganization(m.ownerName),
    year_built: m.yearBuilt ?? null,
    parcel_value: m.parcelValue ?? null,
    improvement_value: m.improvementValue ?? null,
    land_use: m.landUse ?? null,
    acres: m.acres ?? null,
    lat,
    lon,
    source: source.id,
  };
}
