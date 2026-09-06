/**
 * Runnable walkthrough of the whole pipeline, on a made-up roofing contractor
 * in Marshall, TX. Doubles as the smoke test — every engine is exercised and
 * the assertions at the end fail loudly if the behaviour changes.
 *
 *   npm run demo:lead-finder
 */
// Node's globals without pulling in @types/node for one call.
declare const process: { exit(code: number): void };

import {
  resolveIdentities, spiderweb, matchRecords, type SourceRecord,
  scoreLead, quotaState, quoteLeadPack, recommendPlan, costFor, effectivePerLead,
  evaluateRelease, renderOutreach, ComplianceError, restrictedSignalsAllowed,
  entitlements, plan,
} from './src/index';

const rule = (s: string) => console.log(`\n${'─'.repeat(72)}\n${s}\n${'─'.repeat(72)}`);

// ---------------------------------------------------------------------------
// 1. Eight records, five sources, one contractor and one homeowner
// ---------------------------------------------------------------------------

const records: SourceRecord[] = [
  { id: 'gp-1', source: 'google-places', placeId: 'ChIJmarshall01',
    name: 'M & J Roofing', phone: '(903) 923-7418', website: 'https://www.mjroofingtx.com',
    address: '512 W Grand Ave', city: 'Marshall', state: 'TX', postal: '75670' },

  { id: 'yl-1', source: 'yelp-fusion',
    name: 'M and J Roofing Co', phone: '903-923-7418',
    address: '512 West Grand Avenue', city: 'Marshall', state: 'TX', postal: '75670-2210' },

  { id: 'sos-1', source: 'sos-business-filings',
    entityName: 'M&J ROOFING LLC', registeredAgent: 'MARCUS J HALE', phone: '9039237418',
    address: '512 W GRAND AVE', city: 'MARSHALL', state: 'TX', postal: '75670' },

  { id: 'fb-1', source: 'facebook-pages',
    name: 'M&J Roofing', website: 'mjroofingtx.com',
    city: 'Marshall', state: 'TX' },

  // The parcel the business trades from. Same address, different kind of thing
  // — this must NOT merge with the business records.
  { id: 'ca-1', source: 'county-assessor', parcelId: 'R-8802-114',
    ownerName: 'HALE MARCUS J', address: '512 W Grand Ave', city: 'Marshall', state: 'TX', postal: '75670' },

  // A second property the same owner holds, four miles away. Nobody searched
  // for this; the graph finds it.
  { id: 'ca-2', source: 'county-assessor', parcelId: 'R-4417-002',
    ownerName: 'HALE MARCUS J', address: '1180 Cottonwood Rd', city: 'Marshall', state: 'TX', postal: '75672' },

  { id: 'cp-1', source: 'county-permits', parcelId: 'R-4417-002', ownerName: 'HALE MARCUS J',
    workDescription: 'Reroof — 30sq architectural', address: '1180 Cottonwood Rd', postal: '75672' },

  // An unrelated business at the same street address, different suite.
  { id: 'gp-2', source: 'google-places', placeId: 'ChIJmarshall02',
    name: 'Grand Avenue Tax Service', phone: '(903) 923-9001',
    address: '512 W Grand Ave Suite 200', city: 'Marshall', state: 'TX', postal: '75670' },
];

rule('1. IDENTITY RESOLUTION — 8 records across 5 sources');

for (const profile of resolveIdentities(records)) {
  const label = profile.fields.entityName?.value ?? profile.fields.name?.value ?? profile.fields.ownerName?.value ?? '(unnamed)';
  console.log(`\n  ${label}`);
  console.log(`    records:    ${profile.recordIds.join(', ')}`);
  console.log(`    sources:    ${profile.sources.join(', ')}`);
  console.log(`    confidence: ${profile.confidence}`);
  for (const [field, v] of Object.entries(profile.fields)) {
    if (!v.alternates.length) continue;
    console.log(`    ${field}: "${v.value}" (${v.source}, trust ${v.trust}) — also saw ${v.alternates.map((a) => `"${a.value}" (${a.source})`).join(', ')}`);
  }
  for (const r of profile.review) console.log(`    ⚠ review: ${r.a} ~ ${r.b} at ${r.confidence}`);
}

rule('2. WHY THE TAX OFFICE DID NOT MERGE IN');

const rejected = matchRecords(records[0], records[7]);
console.log(`  confidence ${rejected.confidence} → ${rejected.decision}`);
for (const e of rejected.evidence) console.log(`    + ${e.field.padEnd(10)} ${e.weight}  ${e.detail ?? ''}`);
for (const c of rejected.conflicts) console.log(`    − ${c.field.padEnd(10)} ${c.weight}  ${c.detail ?? ''}`);

rule('3. SPIDERWEB — seed on the Places listing, walk outward');

const web = spiderweb('gp-1', records, { maxDepth: 3, minConfidence: 0.05 });
for (const node of web.nodes) {
  const rec = records.find((r) => r.id === node.recordId)!;
  const label = rec.entityName ?? rec.name ?? rec.ownerName ?? rec.id;

  const path = node.path.map((p) => `${p.via}=${p.value}`).join(' → ') || 'seed';
  console.log(`  hop ${node.depth}  ${String(node.confidence).padEnd(6)} ${label.padEnd(30)} [${rec.source}]`);
  if (node.path.length) console.log(`          via ${path}`);
}
if (web.suppressedHubs.length) {
  console.log(`\n  hubs suppressed: ${web.suppressedHubs.map((h) => `${h.kind}=${h.value} (${h.count})`).join(', ')}`);
}

// ---------------------------------------------------------------------------
// 4. Score the property the graph turned up
// ---------------------------------------------------------------------------

rule('4. SCORING — 1180 Cottonwood Rd against the roofing module');

const observed = {
  roofAgeYears: 24,
  hailEventsLast3y: 3,
  windEventsLast3y: 2,
  roofMaterial: 'asphalt-3tab',
  propertyValue: 284000,
  ownerOccupied: true,
  insuranceClaimLikelihood: 0.78,
};

const full = scoreLead('roofing', observed);
console.log(`  score ${full.score}/100  grade ${full.grade}  confidence ${full.confidence}`);
for (const c of full.contributions) {
  console.log(`    ${String(c.points).padStart(5)} pts  ${c.label.padEnd(24)} ${String(c.raw).padEnd(16)} [${c.sources.join(', ')}]`);
}
console.log(`  hooks: ${full.reasons.join(' | ')}`);

const partial = scoreLead('roofing', { roofAgeYears: 24, ownerOccupied: true });
console.log(`\n  same lead, only 2 of 7 signals present:`);
console.log(`    score ${partial.score}/100  grade ${partial.grade}  confidence ${partial.confidence}  missing: ${partial.missing.join(', ')}`);
console.log(`    (${full.score} at full data vs ${partial.score} here — and the grade is held back by confidence)`);

const basic = scoreLead('roofing', observed, { tier: 'basic' });
console.log(`\n  Starter's basic model on the same lead: ${basic.score}/100 (${basic.contributions.length} signals)`);

const withheld = scoreLead('general-contractor', { permitActivityLast12m: 2, ownerEquityEstimate: 0.8, propertyAgeYears: 40 });
console.log(`\n  restricted signals without an attestation: withheld = [${withheld.withheld.join(', ')}]`);

// ---------------------------------------------------------------------------
// 5. Billing
// ---------------------------------------------------------------------------

rule('5. BILLING');

for (const id of ['starter', 'pro', 'elite', 'enterprise'] as const) {
  const p = plan(id);
  const eff = effectivePerLead(id);
  console.log(`  ${p.name.padEnd(11)} $${String(p.monthly).padEnd(4)} ${String(p.quota.leadsPerMonth ?? 'unlimited').padStart(9)} leads   ${eff ? `$${eff.toFixed(3)}/lead` : 'n/a'}   overage $${p.overagePerLead.toFixed(2)}`);
}

const q = quotaState('starter', 300);
console.log(`\n  Starter account that pulled 300 leads:`);
console.log(`    included ${q.included}, used ${q.used}, overage ${q.overage} @ $0.25 = $${q.overageCost}`);

const rec = recommendPlan({ leadsPerMonth: 300, industries: 2, seats: 1 }, 'starter');
console.log(`\n  → ${rec.action.toUpperCase()}: ${rec.reason}`);
console.log(`    saves $${rec.savesPerMonth}/mo`);
console.log(`    all options: ${rec.options.map((o) => `${o.planId} $${o.total}`).join('  ')}`);

const down = recommendPlan({ leadsPerMonth: 40, industries: 1, seats: 1 }, 'elite');
console.log(`\n  → ${down.action.toUpperCase()}: ${down.reason}`);

console.log('\n  Lead packs — the bracket cliff, closed:');
for (const qty of [50, 99, 100, 480, 500, 1990, 9500]) {
  const quote = quoteLeadPack(qty);
  const flag = quote.bestPriceApplied ? `  ← bumped to ${quote.billedQuantity}, +${quote.bonusLeads} free, saved $${quote.savedVsSticker}` : '';
  console.log(`    ${String(qty).padStart(5)} leads → $${quote.total.toFixed(2)} @ $${quote.unitPrice.toFixed(2)}${flag}`);
}

const ent = entitlements({ planId: 'pro', industries: ['roofing', 'hvac', 'solar', 'insurance'], used: 280, seats: 2 });
console.log(`\n  Pro account, 4 industries: ${ent.extraIndustries} unlock(s) billed, depth ${ent.spiderwebDepth}, ${ent.quota.remaining} leads left (${ent.quota.percentUsed}% used)`);
console.log(`    monthly: $${costFor('pro', { leadsPerMonth: 280, industries: 4, seats: 2 }).total}`);

// ---------------------------------------------------------------------------
// 6. Compliance
// ---------------------------------------------------------------------------

rule('6. COMPLIANCE');

const fresh = new Date();
const cases = [
  { label: 'Clean, scrubbed yesterday', c: { phone: '9039237418', phoneType: 'landline' as const, email: 'marcus@mjroofingtx.com', dncScrubbedAt: new Date(Date.now() - 864e5).toISOString(), dncListed: false, isBusiness: true, timezone: 'America/Chicago' } },
  { label: 'Scrub 45 days old',        c: { phone: '9039237418', phoneType: 'wireless' as const, dncScrubbedAt: new Date(Date.now() - 45 * 864e5).toISOString(), timezone: 'America/Chicago' } },
  { label: 'On the DNC registry',      c: { phone: '9035550100', phoneType: 'wireless' as const, email: 'x@example.com', dncScrubbedAt: fresh.toISOString(), dncListed: true, timezone: 'America/Chicago' } },
  { label: 'Serial TCPA plaintiff',    c: { phone: '9039237419', dncScrubbedAt: fresh.toISOString(), litigatorFlag: true } },
  { label: 'Opted out',                c: { email: 'nope@example.com', optedOut: true } },
];
for (const { label, c } of cases) {
  const d = evaluateRelease(c, fresh);
  console.log(`  ${label.padEnd(28)} released=${String(d.released).padEnd(5)} allowed=[${d.allowedChannels.join(', ')}]`);
  if (d.withheldReason) console.log(`    withheld: ${d.withheldReason}`);
  for (const b of d.blockedChannels.filter((x) => x.channel !== 'mail')) console.log(`    ✗ ${b.channel}: ${b.reason}`);
}

const ctx = {
  lead: { ownerFirstName: 'Marcus', street: '1180 Cottonwood Rd', city: 'Marshall', roofAgeYears: 24 },
  signal: { hailMaxInches: 1.75, lastHailDate: '14 May' },
  business: { name: 'Any Size Exteriors', senderName: 'John', phone: '(903) 690-5969', senderPostalAddress: '360 PR 1031, Marshall, TX 75672' },
  unsubscribeUrl: 'https://example.com/u/8f21c',
};

console.log('\n  Generated first touch:\n');
const email = renderOutreach('roofing-storm-email', ctx);
console.log(`    Subject: ${email.subject}`);
console.log(email.body.split('\n').map((l) => `    ${l}`).join('\n'));

console.log('\n  Same template with the unsubscribe URL missing:');
let refused = false;
try {
  renderOutreach('roofing-storm-email', { ...ctx, unsubscribeUrl: '' });
} catch (e) {
  refused = e instanceof ComplianceError;
  console.log(`    ✓ refused — ${(e as Error).message}`);
}

console.log(`\n  Restricted signals allowed without attestation: ${restrictedSignalsAllowed({})}`);
console.log(`  ...with one on file: ${restrictedSignalsAllowed({ fcraAttestedAt: '2026-09-01T12:00:00Z' })}`);

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

const checks: [string, boolean][] = [
  ['business records merged across places/yelp/sos', resolveIdentities(records).some((p) => p.recordIds.includes('gp-1') && p.recordIds.includes('sos-1') && p.recordIds.includes('yl-1'))],
  ['tax office at the same address did not merge', !resolveIdentities(records).some((p) => p.recordIds.includes('gp-1') && p.recordIds.includes('gp-2'))],
  ['parcel record did not merge into the business', !resolveIdentities(records).some((p) => p.recordIds.includes('gp-1') && p.recordIds.includes('ca-1'))],
  ['spiderweb reached the owner\'s second property', web.nodes.some((n) => n.recordId === 'ca-2')],
  ['spiderweb reached the permit on it', web.nodes.some((n) => n.recordId === 'cp-1')],
  ['full-data score beats partial-data score', full.score > partial.score],
  ['thin data cannot reach an A', partial.confidence < 0.5 && partial.grade !== 'A'],
  ['a lead under 25% coverage is not scored at all', scoreLead('roofing', { ownerOccupied: true }).score === 0],
  ['restricted signal withheld without attestation', withheld.withheld.includes('ownerEquityEstimate')],
  ['starter at 300 leads recommends an upgrade', rec.action === 'upgrade' && rec.best.planId === 'pro'],
  ['elite at 40 leads recommends a downgrade', down.action === 'downgrade'],
  ['99-lead pack is priced at the 100 rate', quoteLeadPack(99).total === 35 && quoteLeadPack(99).bonusLeads === 1],
  ['stale DNC scrub blocks calling', evaluateRelease(cases[1].c, fresh).allowedChannels.includes('call') === false],
  ['litigator is withheld entirely', evaluateRelease(cases[3].c, fresh).released === false],
  ['template without unsubscribe is refused', refused],
];

rule('ASSERTIONS');
let failed = 0;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? '✓' : '✗'} ${label}`);
  if (!pass) failed += 1;
}
console.log(`\n  ${checks.length - failed}/${checks.length} passed`);
if (failed) process.exit(1);
