/**
 * Where parcel rolls come from, and how to read each one.
 *
 * A parcel source is the only thing that turns a storm record into a lead: NOAA
 * says where the hail fell, this says who owns the roof under it. Coverage is
 * therefore a per-source question, not a national one, and the registry is
 * explicit about that rather than implying a map of the whole country.
 *
 * Every mapping below was written by reading live records, not by trusting
 * column names. That is not caution for its own sake — the names lie often
 * enough that guessing produced addresses like "1526 ST" with no street on it.
 *
 * No imports on purpose: ingestion scripts run this under Node's type
 * stripping, which cannot follow a JSON import.
 */

export type ParcelGeometry = 'point' | 'centroid' | 'attribute';

export interface MappedParcel {
  key: string | number;
  parcelNo?: string | null;
  ownerName?: string | null;
  ownerName2?: string | null;
  siteAddress: string;
  siteCity?: string | null;
  siteState?: string | null;
  siteZip?: string | null;
  mailAddress?: string | null;
  mailCity?: string | null;
  yearBuilt?: number | null;
  parcelValue?: number | null;
  improvementValue?: number | null;
  landUse?: string | null;
  acres?: number | null;
  lat?: number | null;
  lon?: number | null;
}

export interface ParcelSource {
  id: string;
  label: string;
  /** Two-letter state, or 'US' for a multi-state service. */
  state: string;
  url: string;
  /** Stable sort key; ArcGIS paging is undefined without one. */
  orderBy: string;
  /**
   * Where the coordinates live. 'point' is a point layer's own geometry,
   * 'centroid' asks a polygon layer for one, 'attribute' reads lat/lon columns.
   */
  geometry: ParcelGeometry;
  outFields: string[];
  /** Counties this source can serve, as 5-digit FIPS. */
  covers: (fips: string) => boolean;
  /** Server-side filter for one county, already narrowed to real buildings. */
  where: (fips: string) => string;
  map: (a: Record<string, any>) => MappedParcel | null;
}

const str = (v: unknown): string => (v ?? '').toString().trim();
const num = (v: unknown): number | null =>
  v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v);
const join = (...parts: unknown[]): string =>
  parts.map(str).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

/** State FIPS prefix -> whether a 5-digit code belongs to that state. */
const inState = (fips: string, statePrefix: string): boolean => fips.startsWith(statePrefix);

export const PARCEL_SOURCES: ParcelSource[] = [
  {
    id: 'nc-onemap',
    label: 'NC OneMap statewide parcels',
    state: 'NC',
    url: 'https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer/0/query',
    orderBy: 'objectid',
    geometry: 'point',
    covers: (fips) => inState(fips, '37'),
    // Filtering on the FIPS column rather than the county name: names vary in
    // spelling and case between layers, a FIPS code does not.
    where: (fips) => `stcntyfips='${fips}' AND structyear>1900`,
    outFields: [
      'objectid', 'stcntyfips', 'parno', 'ownname', 'ownname2', 'siteadd', 'scity', 'sstate',
      'szip', 'mailadd', 'mcity', 'structyear', 'parval', 'improvval', 'parusedesc', 'gisacres',
      'saddno', 'saddpref', 'saddstr', 'saddstname', 'saddsttyp', 'saddstsuf',
    ],
    map: (a) => {
      // Wake fills the combined siteadd; Guilford leaves it empty and fills only
      // components. The street name is in saddstr — saddstname is empty in
      // several counties, and 'stname' holds the STATE despite its name.
      const street = str(a.saddstr) || str(a.saddstname);
      const site =
        str(a.siteadd) || (street ? join(a.saddno, a.saddpref, street, a.saddsttyp, a.saddstsuf) : '');
      if (!site) return null;
      return {
        key: a.objectid,
        parcelNo: a.parno,
        ownerName: a.ownname,
        ownerName2: a.ownname2,
        siteAddress: site,
        siteCity: a.scity,
        siteState: a.sstate,
        siteZip: a.szip,
        mailAddress: a.mailadd,
        mailCity: a.mcity,
        yearBuilt: num(a.structyear),
        parcelValue: num(a.parval),
        improvementValue: num(a.improvval),
        landUse: a.parusedesc,
        acres: num(a.gisacres),
      };
    },
  },

  {
    id: 'wi-statewide',
    label: 'Wisconsin statewide parcels',
    state: 'WI',
    url: 'https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0/query',
    orderBy: 'OBJECTID',
    geometry: 'attribute',
    covers: (fips) => inState(fips, '55'),
    // PARCELFIPS is the three-digit county code, not the full five, so the
    // county is matched on its last three digits.
    // IMPVALUE above zero is the test for a structure: bare land has no roof.
    where: (fips) =>
      `PARCELFIPS='${fips.slice(2)}' AND OWNERNME1 IS NOT NULL AND IMPVALUE > 10000`,
    outFields: [
      'OBJECTID', 'PARCELID', 'OWNERNME1', 'OWNERNME2', 'PSTLADRESS', 'SITEADRESS',
      'PLACENAME', 'ZIPCODE', 'PARCELFIPS', 'CNTASSDVALUE', 'IMPVALUE', 'GISACRES',
      'PROPCLASS', 'LATITUDE', 'LONGITUDE',
    ],
    map: (a) => {
      const site = str(a.SITEADRESS);
      if (!site) return null;
      return {
        key: a.OBJECTID,
        parcelNo: a.PARCELID,
        ownerName: a.OWNERNME1,
        ownerName2: a.OWNERNME2,
        siteAddress: site,
        siteCity: a.PLACENAME,
        siteState: 'WI',
        siteZip: a.ZIPCODE,
        // The mailing address arrives as one line with city and state in it,
        // which the containment test for owner-occupancy handles.
        mailAddress: a.PSTLADRESS,
        mailCity: null,
        // Wisconsin publishes no construction year; TAXROLLYEAR is the roll,
        // not the building. Left null so the model reports the gap instead of
        // scoring a tax year as a roof age.
        yearBuilt: null,
        parcelValue: num(a.CNTASSDVALUE),
        improvementValue: num(a.IMPVALUE),
        landUse: str(a.PROPCLASS) || null,
        acres: num(a.GISACRES),
        lat: num(a.LATITUDE),
        lon: num(a.LONGITUDE),
      };
    },
  },

  {
    id: 'marshall-tx',
    label: 'City of Marshall TX parcels',
    state: 'TX',
    url: 'https://services6.arcgis.com/deHuGpt8nOXApIC6/arcgis/rest/services/City_of_Marshall_TX_Parcels_2026/FeatureServer/0/query',
    orderBy: 'OBJECTID',
    geometry: 'centroid',
    // Harrison County has no county-wide open roll; the city publishes its own,
    // so this covers one county and says so rather than claiming Texas.
    covers: (fips) => fips === '48203',
    where: () => 'situs_street IS NOT NULL AND file_as_name IS NOT NULL AND imprv_val > 0',
    outFields: [
      'OBJECTID', 'prop_id_text', 'file_as_name', 'situs_num', 'situs_street_prefx',
      'situs_street', 'situs_city', 'situs_state', 'situs_zip', 'addr_line1', 'addr_city',
      'market', 'imprv_val', 'legal_acreage',
    ],
    map: (a) => {
      // situs_street_sufix is excluded deliberately: it holds a city
      // abbreviation ("MAR"), not a street suffix, so including it produces
      // "4426 JEFF DAVIS MAR" for a house on Jeff Davis St.
      const site = join(a.situs_num, a.situs_street_prefx, a.situs_street);
      if (!site) return null;
      return {
        key: a.OBJECTID,
        parcelNo: a.prop_id_text,
        ownerName: a.file_as_name,
        ownerName2: null,
        siteAddress: site,
        siteCity: str(a.situs_city) || 'Marshall',
        siteState: str(a.situs_state) || 'TX',
        siteZip: a.situs_zip,
        mailAddress: a.addr_line1,
        mailCity: a.addr_city,
        yearBuilt: null,
        parcelValue: num(a.market),
        improvementValue: num(a.imprv_val),
        landUse: null,
        acres: num(a.legal_acreage),
      };
    },
  },
];

/** The source that can serve a county, or null when none is wired yet. */
export function sourceForCounty(fips: string): ParcelSource | null {
  return PARCEL_SOURCES.find((s) => s.covers(fips)) ?? null;
}

/**
 * Counties a source could serve, for honest coverage reporting.
 *
 * Deliberately not a promise that every one has been ingested — only that a
 * mapping exists and the county can be loaded on demand.
 */
export function coverageSummary(): { id: string; label: string; state: string }[] {
  return PARCEL_SOURCES.map(({ id, label, state }) => ({ id, label, state }));
}
