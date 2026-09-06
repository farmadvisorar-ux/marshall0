/**
 * Invariant check for the Marshall0 lead-finder package.
 *
 * The commercial model lives in JSON so it can be changed without a deploy.
 * That is the point, and it is also the risk: a one-character edit to an
 * overage rate can quietly make a tier dominated, or make the upgrade the
 * engine recommends more expensive than staying put. Nothing in a build
 * notices, so this does.
 *
 * The cost arithmetic here is re-derived from the data rather than imported
 * from plans.ts. That duplication is deliberate — a validator sharing an
 * implementation with the thing it validates only proves the code agrees with
 * itself, which is exactly the bug class this is meant to catch.
 *
 *   node lead-finder/check.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(readFileSync(join(here, 'data', f), 'utf8'));

const plansData = read('plans.json');
const industries = read('industries.json');
const sourcesData = read('sources.json');
const platform = read('platform.json');

const problems = [];
const fail = (msg) => problems.push(msg);

const plans = [...plansData.plans].sort((a, b) => a.order - b.order);
const planIds = new Set(plans.map((p) => p.id));
const sourceIds = new Set(sourcesData.sources.map((s) => s.id));
const moduleSlugs = new Set(industries.modules.map((m) => m.slug));
const unlockPrice = plansData.industryUnlock.monthly;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// --- industry modules ------------------------------------------------------

for (const m of industries.modules) {
  const sum = m.signals.reduce((a, s) => a + s.weight, 0);
  if (Math.abs(sum - 1) > 1e-6) {
    fail(`${m.slug}: signal weights sum to ${sum.toFixed(4)}, must be exactly 1.0`);
  }
  if (!planIds.has(m.minPlan)) fail(`${m.slug}: minPlan "${m.minPlan}" is not a plan`);

  const seen = new Set();
  for (const s of m.signals) {
    if (seen.has(s.id)) fail(`${m.slug}: duplicate signal id "${s.id}"`);
    seen.add(s.id);

    for (const src of s.sources ?? []) {
      if (!sourceIds.has(src)) fail(`${m.slug}.${s.id}: unknown source "${src}"`);
    }
    if (!s.derived && !(s.sources ?? []).length) {
      fail(`${m.slug}.${s.id}: has no sources and is not marked derived`);
    }
    if (s.restricted && !s.derivation && !m.regulatoryNote) {
      fail(`${m.slug}.${s.id}: restricted but undocumented — needs a derivation or a module regulatoryNote`);
    }

    switch (s.type) {
      case 'numeric':
        if (!Array.isArray(s.range) || s.range.length !== 2) fail(`${m.slug}.${s.id}: numeric needs a [min,max] range`);
        else if (s.range[0] >= s.range[1]) fail(`${m.slug}.${s.id}: range min >= max`);
        if (!s.direction) fail(`${m.slug}.${s.id}: numeric needs a direction`);
        break;
      case 'band': {
        if (!Array.isArray(s.bands) || !s.bands.length) { fail(`${m.slug}.${s.id}: band needs bands`); break; }
        const last = s.bands[s.bands.length - 1];
        // Without an open-ended final band, any value past the last bound
        // normalises to null and silently drops out of the score.
        if (last.max !== null) fail(`${m.slug}.${s.id}: final band must have "max": null to catch everything above`);
        let prev = -Infinity;
        for (const b of s.bands) {
          if (b.max !== null && b.max <= prev) fail(`${m.slug}.${s.id}: band bounds must ascend`);
          if (b.max !== null) prev = b.max;
          if (b.score < 0 || b.score > 1) fail(`${m.slug}.${s.id}: band score ${b.score} is outside 0-1`);
        }
        break;
      }
      case 'categorical':
        if (!s.categories || !Object.keys(s.categories).length) fail(`${m.slug}.${s.id}: categorical needs categories`);
        // An unmapped value must not score zero — that punishes a lead for
        // carrying a category we have not seen before.
        else if (s.categories.unknown === undefined) fail(`${m.slug}.${s.id}: categorical needs an "unknown" fallback`);
        else for (const [k, v] of Object.entries(s.categories)) {
          if (v < 0 || v > 1) fail(`${m.slug}.${s.id}: category "${k}" scores ${v}, outside 0-1`);
        }
        break;
      case 'boolean':
        break;
      default:
        fail(`${m.slug}.${s.id}: unknown signal type "${s.type}"`);
    }
  }
}

// --- sources ---------------------------------------------------------------

const ACCESS = new Set(['api', 'public-record', 'licensed', 'partner-required', 'first-party']);
for (const s of sourcesData.sources) {
  if (!ACCESS.has(s.access)) fail(`source ${s.id}: unknown access mode "${s.access}"`);
  if (!planIds.has(s.minPlan)) fail(`source ${s.id}: minPlan "${s.minPlan}" is not a plan`);
  if (typeof s.trust !== 'number' || s.trust <= 0 || s.trust > 1) fail(`source ${s.id}: trust must be in (0,1]`);
  if (s.access === 'partner-required' && s.status !== 'not-ingested') {
    fail(`source ${s.id}: partner-required sources must be marked "not-ingested" until an agreement exists`);
  }
}

// Suppression has to be on every plan. A cheap tier without DNC scrubbing
// hands its customers the liability the expensive tier is protected from.
for (const s of sourcesData.sources.filter((x) => x.mandatory)) {
  if (s.minPlan !== plans[0].id) fail(`source ${s.id}: mandatory but gated above ${plans[0].id}`);
}
if (!sourcesData.sources.some((s) => s.category === 'suppression' && s.mandatory)) {
  fail('no mandatory suppression source — DNC scrubbing must not be optional');
}

// --- plan ladder -----------------------------------------------------------

const unl = (n) => (n === null ? Infinity : n);

for (let i = 1; i < plans.length; i += 1) {
  const lo = plans[i - 1];
  const hi = plans[i];

  for (const key of ['leadsPerMonth', 'industries', 'savedSearches', 'seats', 'serviceAreas']) {
    if (unl(hi.quota[key]) < unl(lo.quota[key])) {
      fail(`${hi.id} offers less ${key} than ${lo.id} — a higher tier must never deliver less`);
    }
  }
  if (hi.monthly <= lo.monthly) fail(`${hi.id} is not priced above ${lo.id}`);
  if (hi.spiderwebDepth < lo.spiderwebDepth) fail(`${hi.id} has shallower expansion than ${lo.id}`);
  if (hi.refreshHours > lo.refreshHours) fail(`${hi.id} refreshes slower than ${lo.id}`);
  if (hi.overagePerLead > lo.overagePerLead) fail(`${hi.id} overage is dearer than ${lo.id}`);

  // The upgrade has to land somewhere real. If the crossover volume exceeds
  // the next tier's own quota, the engine recommends an upgrade that puts the
  // customer straight into overage again — which is the worst possible
  // upgrade experience and destroys trust in the recommendation.
  if (lo.quota.leadsPerMonth !== null && lo.overagePerLead > 0) {
    const crossover = lo.quota.leadsPerMonth + (hi.monthly - lo.monthly) / lo.overagePerLead;
    if (crossover > unl(hi.quota.leadsPerMonth)) {
      fail(
        `${lo.id} -> ${hi.id}: crossover at ${Math.ceil(crossover)} leads exceeds ${hi.id}'s ` +
        `${hi.quota.leadsPerMonth} included — the recommended upgrade would start in overage`
      );
    }
  }
}

for (const p of plans) {
  if (p.annual !== p.monthly * plansData.annual.monthsCharged) {
    fail(`${p.id}: annual ${p.annual} != ${p.monthly} x ${plansData.annual.monthsCharged}`);
  }
  if (p.quota.leadsPerMonth !== null) {
    const effective = p.monthly / p.quota.leadsPerMonth;
    // Overage cheaper than the subscription means the rational move is to buy
    // the smallest plan and live in overage forever.
    if (p.overagePerLead <= effective) {
      fail(`${p.id}: overage ${p.overagePerLead} is at or below its own effective rate ${round2(effective)}`);
    }
  } else if (!p.fairUsePerMonth) {
    fail(`${p.id}: unlimited plans must publish a fairUsePerMonth ceiling`);
  }
  if (!p.features?.length) fail(`${p.id}: no features listed`);
}

// --- pay per lead ----------------------------------------------------------

const brackets = [...plansData.payPerLead.brackets].sort((a, b) => a.min - b.min);
for (let i = 0; i < brackets.length; i += 1) {
  const b = brackets[i];
  if (b.perLead < 0.1 || b.perLead > 0.5) fail(`bracket ${b.min}+: ${b.perLead} is outside the published $0.10-$0.50 band`);
  if (i === 0 && b.min !== 1) fail('first bracket must start at 1');
  if (i > 0) {
    const prev = brackets[i - 1];
    if (prev.max === null) fail(`bracket ${prev.min}+ is open-ended but not last`);
    else if (b.min !== prev.max + 1) fail(`gap or overlap between brackets at ${prev.max} -> ${b.min}`);
    if (b.perLead >= prev.perLead) fail(`bracket ${b.min}+ is not cheaper than ${prev.min}+`);
  }
}
if (brackets[brackets.length - 1].max !== null) fail('last bracket must be open-ended (max: null)');

// The subscription must always beat buying the same volume as packs, or the
// subscription has no reason to exist.
const cheapestPack = (qty) => {
  const hit = brackets.find((b) => qty >= b.min && (b.max === null || qty <= b.max));
  let best = qty * hit.perLead;
  for (const b of brackets) if (b.min > qty) best = Math.min(best, b.min * b.perLead);
  return round2(best);
};
for (const p of plans) {
  if (p.quota.leadsPerMonth === null) continue;
  if (p.monthly >= cheapestPack(p.quota.leadsPerMonth)) {
    fail(`${p.id}: $${p.monthly} for ${p.quota.leadsPerMonth} leads costs more than packs ($${cheapestPack(p.quota.leadsPerMonth)})`);
  }
}

// --- no dead tier ----------------------------------------------------------

/** Re-derived cost model. Deliberately independent of plans.ts. */
function cost(p, usage) {
  const extra = p.quota.industries === null ? 0 : Math.max(0, usage.industries - p.quota.industries);
  const canUnlock = plansData.industryUnlock.appliesTo.includes(p.id);
  if (extra > 0 && !canUnlock) return null;
  if (p.quota.seats !== null && (usage.seats ?? 1) > p.quota.seats) return null;
  if (usage.needsApi && p.order < plans.find((x) => x.id === 'elite').order) return null;
  const over = p.quota.leadsPerMonth === null ? 0 : Math.max(0, usage.leads - p.quota.leadsPerMonth) * p.overagePerLead;
  return round2(p.monthly + extra * unlockPrice + over);
}

const winners = new Set();
for (const leads of [10, 50, 120, 300, 500, 900, 1000, 1800, 3000, 8000, 20000]) {
  for (const inds of [1, 2, 3, 5, 8]) {
    for (const seats of [1, 3, 8, 25]) {
      for (const needsApi of [false, true]) {
        const usage = { leads, industries: inds, seats, needsApi };
        const priced = plans
          .map((p) => ({ id: p.id, order: p.order, total: cost(p, usage) }))
          .filter((x) => x.total !== null)
          .sort((a, b) => a.total - b.total || a.order - b.order);
        if (priced.length) winners.add(priced[0].id);
      }
    }
  }
}
for (const p of plans) {
  // A tier that is never the right answer is a tier nobody should buy, and
  // its presence on the pricing page costs conversions on the ones that work.
  if (!winners.has(p.id)) fail(`${p.id} is never the cheapest option for any tested usage — dead tier`);
}

// --- capabilities, integrations, templates ---------------------------------

for (const c of platform.capabilities) if (!planIds.has(c.minPlan)) fail(`capability ${c.id}: bad minPlan "${c.minPlan}"`);
for (const i of platform.integrations) if (!planIds.has(i.minPlan)) fail(`integration ${i.id}: bad minPlan "${i.minPlan}"`);

const required = platform.compliance.canSpamRequiredFields;
for (const t of platform.outreachTemplates) {
  if (t.industry !== '*' && !moduleSlugs.has(t.industry)) fail(`template ${t.id}: unknown industry "${t.industry}"`);
  if (t.channel === 'email') {
    for (const f of required) {
      const token = f === 'unsubscribeUrl' ? '{{unsubscribeUrl}}' : `{{business.${f}}}`;
      // Strict liability, per message. The renderer refuses to send without
      // these, so a template missing one is dead weight that fails at runtime.
      if (!t.body.includes(token)) fail(`template ${t.id}: email is missing the CAN-SPAM token ${token}`);
    }
    if (!t.subject) fail(`template ${t.id}: email has no subject`);
  }
  for (const r of t.requires ?? []) {
    if (!t.body.includes(`{{${r}}}`) && !(t.subject ?? '').includes(`{{${r}}}`)) {
      fail(`template ${t.id}: declares "${r}" as required but never uses it`);
    }
  }
}

if (platform.compliance.dncScrubMaxAgeDays > 31) {
  fail(`dncScrubMaxAgeDays is ${platform.compliance.dncScrubMaxAgeDays} — the TCPA safe harbour is 31 days`);
}

// --- report ----------------------------------------------------------------

if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\n${problems.length} problem(s) in the lead-finder model`);
  process.exit(1);
}

console.log(
  `lead-finder OK — ${plans.length} plans, ${industries.modules.length} industry modules ` +
  `(${industries.modules.reduce((a, m) => a + m.signals.length, 0)} signals), ` +
  `${sourcesData.sources.length} sources, ${platform.capabilities.length} capabilities, ` +
  `${platform.outreachTemplates.length} templates`
);
