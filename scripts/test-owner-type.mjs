/**
 * Owner classification tests.
 *
 * Every case here is a real record that was misclassified in production data,
 * kept as a regression so the next parcel source cannot quietly reintroduce it.
 * Both functions decide whether a contractor knocks a door, and both failed
 * silently rather than loudly when they were wrong: organisations sat at the
 * top of a storm-ranked list, and 97% of owners were marked absentee.
 *
 *   node --experimental-strip-types scripts/test-owner-type.mjs
 */
import assert from 'node:assert/strict';
import { looksLikeOrganization, isAbsenteeOwner } from '../src/owner-type.ts';

const ORGANISATIONS = [
  'HCAD',                              // appraisal district, fused acronym
  'MARSHALL ISD',
  'EAST TEXAS BAPTIST UNIVERSITY',
  'KROGER CO',                         // 'co' alone, no other marker
  'BANCORP SOUTH',
  'MARSHALL COLLISION CENTER',
  'TEXAS HISTORICAL COMMISSION',
  'UNITED STATES GOVERNMENT',
  'HARRISON CO HOSPITAL ASSOC',
  'EVERARDO PROPERTIES LLC',
  'MARSHALL HOUSING AUTHORITY',
];

// Trusts and trustees are overwhelmingly families holding an ordinary house.
// Excluding them would drop a large share of genuine residential owners.
const PEOPLE = [
  'REED REESE & RONNA REED',
  'PARKER ANGELA LYNN',
  'GREEN THOMAS & PIXIE',
  'BOSCHETTI GIAMPAOLO',
  'ARNOLD FAMILY IRREVOCABLE TRUST',
  'PALMER W F TRUSTEE',
  'LENZINI CHRISTOPHER & ERIN',
  'SHERROD, BETTY COOPER',
  'HAUSER-FIELDS LIVING TRUST',
];

const OCCUPANCY = [
  // Marshall's situs record omits the street type the mailing record carries.
  ['4426 JEFF DAVIS', '4426 JEFF DAVIS ST MARSHALL', false],
  // Guilford spells the same street with and without the apostrophe.
  ['607 OROURKE DR', "607 O'ROURKE DR", false],
  ['8313 TRIAD DR', 'PO BOX 18863', true],
  ['1800 ELM ST N', '10319 WESTLAKE DR UNIT 175', true],
  // No mailing address is unknown, not owner-occupied.
  ['200 MACY ST', null, null],
];

for (const name of ORGANISATIONS) {
  assert.equal(looksLikeOrganization(name), true, `should be an organisation: ${name}`);
}
for (const name of PEOPLE) {
  assert.equal(looksLikeOrganization(name), false, `should be a person: ${name}`);
}
for (const [site, mail, expected] of OCCUPANCY) {
  assert.equal(isAbsenteeOwner(site, mail), expected, `occupancy: ${site} vs ${mail}`);
}

console.log(
  `owner-type OK — ${ORGANISATIONS.length} organisations, ${PEOPLE.length} people, ${OCCUPANCY.length} occupancy cases`
);
