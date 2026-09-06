declare const process: { exit(code: number): void };

import {
  parseStormEventsCsv, StormIndex, stormProfile, haversineKm, claimLikelihood, formatDay,
  roofAge, ownerProfile, isRoofingPermit,
  runRoofingPipeline, releaseUnderQuota, buildHook,
  accruedValue, freeQuota, freeBurn, launch, listPrice, billedPrice, isFreeLaunch,
  type AssessorRecord, type PermitRecord, type ContactRecord,
} from './src/index';

const rule = (s: string) => console.log(`\n${'─'.repeat(74)}\n${s}\n${'─'.repeat(74)}`);

/** Fixed so the demo is deterministic and the ages below stay stable. */
const ASOF = new Date('2026-09-06T12:00:00Z');
const MARSHALL = { lat: 32.5449, lon: -94.3674 };

// ---------------------------------------------------------------------------
// 1. NOAA Storm Events, in the real published CSV shape
// ---------------------------------------------------------------------------

const STORM_CSV = [
  'BEGIN_YEARMONTH,BEGIN_DAY,EPISODE_ID,EVENT_ID,STATE,STATE_FIPS,YEAR,MONTH_NAME,EVENT_TYPE,CZ_TYPE,CZ_FIPS,CZ_NAME,BEGIN_DATE_TIME,MAGNITUDE,MAGNITUDE_TYPE,BEGIN_LAT,BEGIN_LON,EVENT_NARRATIVE',
  // The big one — right over town.
  '202605,14,188201,1140233,TEXAS,48,2026,May,Hail,C,203,HARRISON,"14-MAY-26 17:42:00",1.75,,32.5455,-94.3681,"Golf ball sized hail reported along US-80."',
  // A second, smaller but still claimable, a year earlier. Repeat exposure.
  '202504,2,181044,1098771,TEXAS,48,2025,April,Hail,C,203,HARRISON,"02-APR-25 19:05:00",1.25,,32.5462,-94.3702,"Half dollar hail near downtown Marshall."',
  // Sub-inch. Real weather, not a claim — must not be counted.
  '202406,11,175310,1071882,TEXAS,48,2024,June,Hail,C,203,HARRISON,"11-JUN-24 16:20:00",0.75,,32.5451,-94.3669,"Penny sized hail."',
  // Severe, but outside the 3-year window.
  '202105,1,150221,0944110,TEXAS,48,2021,May,Hail,C,203,HARRISON,"01-MAY-21 15:10:00",2.50,,32.5450,-94.3670,"Tennis ball hail."',
  // Wind, in knots — the unit trap.
  '202603,20,186110,1131004,TEXAS,48,2026,March,Thunderstorm Wind,C,203,HARRISON,"20-MAR-26 21:15:00",65,EG,32.5470,-94.3650,"Trees down on FM 1997."',
  // Zone row with no coordinates — only findable by county.
  '202602,8,185002,1128440,TEXAS,48,2026,February,Hail,C,203,HARRISON,"08-FEB-26 14:00:00",1.50,,,,"Hail reported countywide, no precise location logged."',
  // Different county, 40km away. Must never match.
  '202605,14,188201,1140299,TEXAS,48,2026,May,Hail,C,401,RUSK,"14-MAY-26 18:10:00",2.00,,32.1980,-94.7600,"Hail near Henderson."',
].join('\n');

const events = parseStormEventsCsv(STORM_CSV);
const index = new StormIndex(events);

rule('1. NOAA STORM EVENTS — parsed from the published CSV format');
console.log(`  ${events.length} events indexed (${index.size} rows)\n`);
for (const e of events) {
  const unit = e.type === 'hail' ? '"' : e.type === 'wind' ? ' mph' : '';
  const loc = e.lat !== undefined ? `${e.lat}, ${e.lon}` : `county ${e.countyFips} only`;
  console.log(`    ${e.date}  ${e.type.padEnd(8)} ${String(e.magnitude ?? '—').padStart(5)}${unit.padEnd(4)}  ${loc}`);
}
console.log(`\n  Wind converted from knots: 65 kt → ${events.find((e) => e.type === 'wind')?.magnitude} mph`);

// ---------------------------------------------------------------------------
// 2. Parcels
// ---------------------------------------------------------------------------

const parcels: AssessorRecord[] = [
  { parcelId: 'R-8801-004', ownerName: 'WHITAKER DANA L', situsAddress: '1180 Cottonwood Rd', situsPostal: '75672',
    mailingAddress: '1180 Cottonwood Rd', mailingPostal: '75672', city: 'Marshall', state: 'TX',
    yearBuilt: 1998, assessedValue: 284000, lotSizeSqft: 12500, buildingSqft: 2140,
    landUse: 'single-family', lat: 32.5460, lon: -94.3690, countyFips: '48203' },

  { parcelId: 'R-8801-011', ownerName: 'REYES MARTIN A', situsAddress: '1204 Cottonwood Rd', situsPostal: '75672',
    mailingAddress: '1204 Cottonwood Rd', mailingPostal: '75672', city: 'Marshall', state: 'TX',
    yearBuilt: 1996, assessedValue: 268000, lotSizeSqft: 11800, buildingSqft: 2010,
    landUse: 'single-family', lat: 32.5458, lon: -94.3695, countyFips: '48203' },

  { parcelId: 'R-9114-220', ownerName: 'OKAFOR CHINWE', situsAddress: '88 Ridgeline Dr', situsPostal: '75670',
    mailingAddress: '88 Ridgeline Dr', mailingPostal: '75670', city: 'Marshall', state: 'TX',
    yearBuilt: 1994, assessedValue: 301000, lotSizeSqft: 15000, buildingSqft: 2400,
    landUse: 'single-family', lat: 32.6200, lon: -94.3674, countyFips: '48203' },

  { parcelId: 'R-8801-019', ownerName: 'PINEHURST HOLDINGS LLC', situsAddress: '1260 Cottonwood Rd', situsPostal: '75672',
    mailingAddress: 'PO Box 4410', mailingPostal: '75604', city: 'Marshall', state: 'TX',
    yearBuilt: 1991, assessedValue: 214000, lotSizeSqft: 10900, buildingSqft: 1780,
    landUse: 'single-family', lat: 32.5456, lon: -94.3699, countyFips: '48203' },
  { parcelId: 'R-8801-023', ownerName: 'PINEHURST HOLDINGS LLC', situsAddress: '1272 Cottonwood Rd', situsPostal: '75672',
    mailingAddress: 'PO Box 4410', mailingPostal: '75604', city: 'Marshall', state: 'TX',
    yearBuilt: 1991, assessedValue: 209000, lat: 32.5454, lon: -94.3701, countyFips: '48203' },
  { parcelId: 'R-8801-027', ownerName: 'PINEHURST HOLDINGS LLC', situsAddress: '1284 Cottonwood Rd', situsPostal: '75672',
    mailingAddress: 'PO Box 4410', mailingPostal: '75604', city: 'Marshall', state: 'TX',
    yearBuilt: 1991, assessedValue: 211000, lat: 32.5452, lon: -94.3703, countyFips: '48203' },

  { parcelId: 'R-7702-140', ownerName: 'BRENNAN SUSAN K', situsAddress: '17 Willow Bend', situsPostal: '75670',
    mailingAddress: '17 Willow Bend', mailingPostal: '75670', city: 'Marshall', state: 'TX',
    yearBuilt: 1989, assessedValue: 246000, landUse: 'single-family', countyFips: '48203' },
];

const permits: PermitRecord[] = [
  { parcelId: 'R-8801-011', permitType: 'Residential Re-Roof', workDescription: 'Tear off and replace, 28sq architectural',
    issuedDate: '2023-08-14', valuation: 14200, contractorName: 'Caddo Exteriors', status: 'Finaled' },
  { parcelId: 'R-9114-220', permitType: 'MECHANICAL', workDescription: 'Replace 4-ton condenser and air handler',
    issuedDate: '2019-06-02', valuation: 8400, contractorName: 'Piney Woods HVAC', status: 'Finaled' },
  { parcelId: 'R-8801-004', permitType: 'ROOFING', workDescription: 'Reroof - comp shingle',
    issuedDate: '2019-03-11', valuation: 11800, contractorName: 'Ark-La-Tex Roofing', status: 'VOID - withdrawn' },
  { parcelId: 'R-8801-019', permitType: 'Building', workDescription: 'Interior remodel, kitchen',
    issuedDate: '2022-02-20', valuation: 22000, contractorName: 'Selby Builders', status: 'Finaled' },
];

const materials: Record<string, string> = {
  'R-8801-004': 'asphalt-3tab',
  'R-8801-011': 'asphalt-architectural',
  'R-9114-220': 'asphalt-3tab',
  'R-8801-019': 'asphalt-3tab',
  'R-8801-023': 'metal',
  'R-8801-027': 'asphalt-3tab',
  'R-7702-140': 'asphalt-3tab',
};

rule('2. STORM PROXIMITY — same county, different answers');
for (const p of [parcels[0], parcels[2], parcels[6]]) {
  const pt = p.lat !== undefined ? { lat: p.lat, lon: p.lon!, countyFips: p.countyFips } : { lat: 0, lon: 0, countyFips: p.countyFips };
  const hasCoords = p.lat !== undefined;
  const prof = hasCoords ? stormProfile(pt, index, { asOf: ASOF }) : stormProfile({ lat: NaN, lon: NaN, countyFips: p.countyFips }, index, { asOf: ASOF });
  const dist = hasCoords ? `${haversineKm(MARSHALL, { lat: p.lat!, lon: p.lon! }).toFixed(2)} km from the cell` : 'no coordinates';
  console.log(`\n  ${p.situsAddress}  (${dist})`);
  console.log(`    located hail (3y):   ${prof.hailEventsLast3y}   max ${prof.hailMaxInches ?? '—'}"   last ${prof.lastHailDate ?? '—'}`);
  console.log(`    county-wide only:    ${prof.hailEventsCountyWide}   max ${prof.countyHailMaxInches ?? '—'}"   (context, not evidence)`);
  console.log(`    wind events: ${prof.windEventsLast3y}   max ${prof.windMaxMph ?? '—'} mph`);
  console.log(`    hook: ${prof.hook ? `"${prof.hook}"` : '(none — nothing located, so nothing claimed)'}`);
}
console.log('\n  0.75" hail and the 2021 event are both in the feed and both correctly excluded — one is');
console.log('  below the claimable threshold, the other is outside the 3-year window. The 8 February');
console.log('  report is real but NOAA logged no coordinates, so it counts as county context and');
console.log('  never as evidence about a particular roof.');

rule('3. ROOF AGE — permit first, year built as the weak fallback');
for (const p of parcels.slice(0, 4)) {
  const a = roofAge(p, permits, ASOF);
  console.log(`  ${(p.situsAddress ?? '').padEnd(22)} ${String(a.years ?? '—').padStart(5)} yr  via ${a.basis.padEnd(10)} conf ${a.confidence}${a.asOfDate ? `  (${a.asOfDate})` : ''}`);
}
console.log('\n  1180 Cottonwood had a 2019 roofing permit — but it was withdrawn, so it does not count.');
console.log(`  isRoofingPermit on "Interior remodel, kitchen": ${isRoofingPermit(permits[3])}`);

// ---------------------------------------------------------------------------
// 4. Full pipeline
// ---------------------------------------------------------------------------

const contacts: Record<string, ContactRecord> = {
  'R-8801-004': { phone: '9032214480', phoneType: 'landline', email: 'dana.whitaker@example.com',
    dncScrubbedAt: '2026-09-05T08:00:00Z', dncListed: false, timezone: 'America/Chicago' },
  'R-8801-011': { phone: '9032217731', phoneType: 'wireless', email: 'm.reyes@example.com',
    dncScrubbedAt: '2026-09-05T08:00:00Z', dncListed: true, timezone: 'America/Chicago' },
  'R-9114-220': { phone: '9032219902', phoneType: 'wireless',
    dncScrubbedAt: '2026-06-01T08:00:00Z', dncListed: false, timezone: 'America/Chicago' },
  'R-8801-019': { phone: '9032215566', phoneType: 'landline', email: 'ops@pinehurstholdings.example',
    dncScrubbedAt: '2026-09-05T08:00:00Z', isBusiness: true, timezone: 'America/Chicago' },
  'R-8801-023': { email: 'ops@pinehurstholdings.example', dncScrubbedAt: '2026-09-05T08:00:00Z', isBusiness: true },
};

const leads = runRoofingPipeline(
  { parcels, permits, storms: index, contacts, materials },
  { asOf: ASOF }
);

rule('4. SCORED AND RANKED');
for (const l of leads) {
  const chans = l.release.allowedChannels.join(', ') || 'none';
  console.log(
    `\n  ${String(l.score.score).padStart(3)} ${l.score.grade}  ${(l.address ?? '').padEnd(22)} ${(l.ownerName ?? '').padEnd(24)}`
  );
  console.log(
    `        roof ${String(l.roof.years ?? '—').padStart(5)}yr (${l.roof.basis})   hail ${l.storm.hailEventsLast3y}` +
    `${l.storm.hailMaxInches ? ` @ ${l.storm.hailMaxInches}"` : ''}` +
    `${l.storm.hailEventsCountyWide ? ` (+${l.storm.hailEventsCountyWide} county-wide)` : ''}   ${l.owner.segment}` +
    `${l.owner.portfolioSize > 1 ? ` (${l.owner.portfolioSize} parcels)` : ''}`
  );
  console.log(`        channels: ${chans}${l.withheld ? `   — ${l.withheld}` : ''}`);
  if (l.hook) console.log(`        hook: "${l.hook}"`);
}

rule('5. RELEASE UNDER A FREE ACCOUNT');
const account = { planId: 'pro' as const, industries: ['roofing'], used: 0, free: true, foundingMember: true };
const rel = releaseUnderQuota(leads, account);
console.log(`  free quota this cycle: ${freeQuota().leadsPerMonth} leads`);
console.log(`  released:              ${rel.released.length}  (contactable, drawn from quota)`);
console.log(`  held for enrichment:   ${rel.heldForEnrichment.length}  (no contact resolved — not charged)`);
console.log(`  blocked on compliance: ${rel.blocked.length}  (not charged either)`);
console.log(`  remaining:             ${rel.remaining}`);
for (const l of rel.blocked) console.log(`    ✗ ${l.address} — ${l.withheld}`);

rule('6. WHAT THEY WOULD HAVE PAID');
console.log(`  launch mode: ${launch.mode}   list price stays visible: ${launch.anchor.showListPrice}`);
console.log(`  Pro list ${'$' + listPrice('pro')}/mo → billed today ${'$' + billedPrice('pro', account)}   (free launch: ${isFreeLaunch()})\n`);

const value = accruedValue({ leadsPerMonth: 214, industries: 1, seats: 1 }, { cyclesActive: 4, closedJobs: 3, closedValue: 41200 });
console.log(`  ${value.headline}`);
console.log(`  ${value.detail}`);
if (value.roi) console.log(`  ${value.roi}`);
console.log(`\n  founding rate at conversion: $${value.foundingRate}/mo for ${launch.founding.lockMonths} months`);
console.log(`  burn at 100 active free accounts: $${freeBurn(100)}/mo`);

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

const byId = new Map(leads.map((l) => [l.parcelId, l]));

// Five parcels, one absentee owner — the threshold where a landlord stops being
// a homeowner with a rental and starts being one conversation worth five roofs.
const bigPortfolio: AssessorRecord[] = Array.from({ length: 5 }, (_, i) => ({
  parcelId: `R-6600-${100 + i}`,
  ownerName: 'CADDO LAKE PROPERTIES LP',
  situsAddress: `${300 + i * 4} Lakeview Ter`,
  situsPostal: '75670',
  mailingAddress: 'PO Box 9912',
  mailingPostal: '75604',
}));
const old3tab = byId.get('R-8801-004')!;      // 28yr roof, in swath, owner-occupied
const newRoof = byId.get('R-8801-011')!;      // 3yr roof, in swath
const outOfSwath = byId.get('R-9114-220')!;   // 32yr roof, 8km away
const metalRoof = byId.get('R-8801-023')!;    // metal, in swath
const noCoords = byId.get('R-7702-140')!;     // county-level only

const checks: [string, boolean][] = [
  ['knots converted to mph on wind events', events.find((e) => e.type === 'wind')?.magnitude === 75],
  ['sub-inch hail excluded from the claimable count', old3tab.storm.hailEventsLast3y === 2],
  ['unlocated county report kept out of the located count', old3tab.storm.hailEventsCountyWide === 1],
  ['an ungeocoded parcel still sees the county history', noCoords.storm.hailEventsCountyWide === 3],
  ['nothing located means no storm is claimed', noCoords.storm.hook === undefined],
  ['the lead still gets a non-storm hook to open on',
    !!noCoords.hook && !/hail/i.test(noCoords.hook)],
  ['hail outside the 3-year window excluded', (old3tab.storm.hailMaxInches ?? 0) === 1.75],
  ['neighbouring county storm never matched', old3tab.storm.hailMaxInches !== 2.0],
  ['8km away sees no located hail from this cell', outOfSwath.storm.hailEventsLast3y === 0],
  ['parcel with no coordinates falls back to county', noCoords.storm.countyLevelOnly === true],
  ['withdrawn roofing permit ignored', old3tab.roof.basis === 'yearBuilt'],
  ['finaled re-roof permit beats year built', newRoof.roof.basis === 'permit' && (newRoof.roof.years ?? 0) < 4],
  ['a 3-year-old roof in the swath is not a lead', newRoof.score.score < old3tab.score.score],
  ['storm exposure beats a slightly older roof', old3tab.score.score > outOfSwath.score.score],
  ['metal roof ranks below asphalt on the same street', metalRoof.score.score < old3tab.score.score],
  ['absentee LLC with 3 parcels reads as a small landlord',
    byId.get('R-8801-019')!.owner.segment === 'small-landlord' && byId.get('R-8801-019')!.owner.portfolioSize === 3],
  ['PO Box mailing address defeats owner-occupancy', byId.get('R-8801-019')!.owner.occupied === false],
  ['the same owner across 5+ parcels tips to portfolio landlord',
    ownerProfile(bigPortfolio[0], bigPortfolio).segment === 'portfolio-landlord'],
  ['DNC-listed contact cannot be called but stays mailable',
    !newRoof.release.allowedChannels.includes('call') && newRoof.release.allowedChannels.includes('mail')],
  ['96-day-old DNC scrub blocks calling', !outOfSwath.release.allowedChannels.includes('call')],
  ['unresolved contact is held, not charged', rel.heldForEnrichment.some((l) => l.parcelId === 'R-8801-027')],
  ['the hook names the storm date, not the roof', (old3tab.hook ?? '').includes('May')],
  ['claim likelihood rises with hail severity',
    claimLikelihood({ hailMaxInches: 2.0, hailEventsLast3y: 2 }, 25, 'asphalt-3tab') >
    claimLikelihood({ hailMaxInches: 1.0, hailEventsLast3y: 1 }, 25, 'asphalt-3tab')],
  ['free quota never exceeds the plan it borrows', (freeQuota().leadsPerMonth ?? 0) <= 300],
  ['list price still quoted while billing is free', listPrice('pro') === 29 && billedPrice('pro', account) === 0],
  ['founding rate is half of list', value.foundingRate === listPrice(value.planThatFits) / 2],
];

rule('ASSERTIONS');
let failed = 0;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? '✓' : '✗'} ${label}`);
  if (!pass) failed += 1;
}
console.log(`\n  ${checks.length - failed}/${checks.length} passed`);
if (failed) process.exit(1);

void [formatDay, buildHook];
