import plansData from '../data/plans.json';
import platform from '../data/platform.json';

/**
 * Plans, entitlements and billing arithmetic.
 *
 * Two rules run through all of this and are worth stating up front, because
 * every awkward branch below exists to hold one of them:
 *
 *   1. A customer is never charged more than the cheapest way to buy what they
 *      asked for. Volume brackets create cliffs — 99 leads at $0.50 costs more
 *      than 100 at $0.35 — and a customer who finds that cliff has found a bug,
 *      not a deal.
 *
 *   2. An upgrade is only ever recommended when it genuinely costs less than
 *      staying put. `recommendPlan` computes real totals and returns whatever
 *      wins, including "you are on the right plan" and including a downgrade.
 *      Recommending an upgrade that costs more is how a product gets a
 *      reputation, and reputations do not un-earn.
 */

export type PlanId = 'starter' | 'pro' | 'elite' | 'enterprise';
export type ScoringTier = 'basic' | 'advanced';

export interface PlanQuota {
  /** null means unlimited. */
  leadsPerMonth: number | null;
  industries: number | null;
  savedSearches: number | null;
  seats: number | null;
  serviceAreas: number | null;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  audience: string;
  monthly: number;
  annual: number;
  order: number;
  popular?: boolean;
  quota: PlanQuota;
  /** Soft ceiling on an "unlimited" plan. Published, not a surprise. */
  fairUsePerMonth?: number;
  overagePerLead: number;
  scoring: ScoringTier;
  spiderwebDepth: number;
  refreshHours: number;
  features: string[];
  why: string;
}

interface Bracket {
  min: number;
  max: number | null;
  perLead: number;
}

const data = plansData as unknown as {
  currency: string;
  product: { name: string; positioning: string; billingCycleDays: number };
  plans: Plan[];
  trial: { days: number; leads: number; industries: number; cardRequired: boolean };
  payPerLead: { enabled: boolean; brackets: Bracket[] };
  industryUnlock: { monthly: number; appliesTo: PlanId[] };
  referral: { leadsPerReferral: number; referrerCapPerMonth: number; refereeBonusLeads: number };
  annual: { monthsCharged: number; label: string };
};

export const plans: Plan[] = [...data.plans].sort((a, b) => a.order - b.order);
export const trial = data.trial;
export const referral = data.referral;
export const industryUnlock = data.industryUnlock;

const byId = new Map<PlanId, Plan>(plans.map((p) => [p.id, p]));

export function plan(id: PlanId): Plan {
  const found = byId.get(id);
  if (!found) throw new Error(`unknown plan: ${id}`);
  return found;
}

/** Ordering used for every `minPlan` gate in the data files. */
export const rank = (id: PlanId): number => plan(id).order;

/** Does `held` satisfy a feature's `minPlan` requirement? */
export const allows = (held: PlanId, required: PlanId): boolean => rank(held) >= rank(required);

export const usd = (n: number): string =>
  n % 1 === 0 ? `$${n.toLocaleString('en-US')}` : `$${n.toFixed(2)}`;

const isUnlimited = (n: number | null): n is null => n === null;

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

export interface QuotaState {
  included: number | null;
  purchased: number;
  used: number;
  /** null when unlimited. Never negative. */
  remaining: number | null;
  /** Leads beyond everything included and purchased. Billed at the overage rate. */
  overage: number;
  overageCost: number;
  percentUsed: number | null;
  /** Fair-use ceiling crossed on an unlimited plan — a conversation, not a charge. */
  fairUseExceeded: boolean;
}

/**
 * Where an account stands in its cycle.
 *
 * Purchased packs are consumed *before* overage is charged, which matters:
 * a customer who topped up and then got billed overage anyway would be right
 * to be angry about it.
 */
export function quotaState(planId: PlanId, used: number, purchased = 0): QuotaState {
  const p = plan(planId);
  const included = p.quota.leadsPerMonth;
  const consumedUsed = Math.max(0, used);

  if (isUnlimited(included)) {
    const cap = p.fairUsePerMonth;
    return {
      included: null,
      purchased,
      used: consumedUsed,
      remaining: null,
      overage: 0,
      overageCost: 0,
      percentUsed: null,
      fairUseExceeded: cap !== undefined && consumedUsed > cap,
    };
  }

  const available = included + purchased;
  const overage = Math.max(0, consumedUsed - available);
  return {
    included,
    purchased,
    used: consumedUsed,
    remaining: Math.max(0, available - consumedUsed),
    overage,
    overageCost: round2(overage * p.overagePerLead),
    percentUsed: available === 0 ? 0 : Math.round((consumedUsed / available) * 100),
    fairUseExceeded: false,
  };
}

// ---------------------------------------------------------------------------
// Pay per lead
// ---------------------------------------------------------------------------

export interface LeadPackQuote {
  requested: number;
  /** What they are actually billed for — sometimes more than requested, always cheaper. */
  billedQuantity: number;
  unitPrice: number;
  total: number;
  /** Free leads from being pushed up into a cheaper bracket. */
  bonusLeads: number;
  bestPriceApplied: boolean;
  savedVsSticker: number;
}

const brackets: Bracket[] = [...data.payPerLead.brackets].sort((a, b) => a.min - b.min);

const bracketFor = (qty: number): Bracket => {
  const hit = brackets.find((b) => qty >= b.min && (b.max === null || qty <= b.max));
  // Above the last bracket's max (which is null) or below the first min — clamp.
  return hit ?? (qty < brackets[0].min ? brackets[0] : brackets[brackets.length - 1]);
};

/**
 * Price a lead pack, never charging more than a larger pack would cost.
 *
 * Ask for 99 and the sticker is $49.50; 100 costs $35.00. Charging the sticker
 * would be defensible and stupid. This returns the 100-lead price with the
 * extra lead free, and says so in the response so the UI can show the customer
 * they were bumped up rather than quietly moving the number on them.
 */
export function quoteLeadPack(requested: number): LeadPackQuote {
  const qty = Math.max(1, Math.floor(requested));
  const sticker = round2(qty * bracketFor(qty).perLead);

  let best = { quantity: qty, unitPrice: bracketFor(qty).perLead, total: sticker };
  for (const b of brackets) {
    if (b.min <= qty) continue; // only larger packs can rescue a cliff
    const total = round2(b.min * b.perLead);
    if (total < best.total) best = { quantity: b.min, unitPrice: b.perLead, total };
  }

  return {
    requested: qty,
    billedQuantity: best.quantity,
    unitPrice: best.unitPrice,
    total: best.total,
    bonusLeads: best.quantity - qty,
    bestPriceApplied: best.quantity !== qty,
    savedVsSticker: round2(sticker - best.total),
  };
}

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

export interface AccountState {
  planId: PlanId;
  /** Industry module slugs the account has turned on. */
  industries: string[];
  /** Leads consumed this cycle. */
  used?: number;
  /** Extra leads bought as packs this cycle. */
  purchased?: number;
  seats?: number;
  /** Set once the account signs the FCRA marketing-use attestation. */
  fcraAttestedAt?: string | null;
}

export interface Entitlements {
  planId: PlanId;
  scoring: ScoringTier;
  spiderwebDepth: number;
  refreshHours: number;
  /** Industries beyond the plan's included count, billed as add-ons. */
  extraIndustries: number;
  industriesOverLimit: boolean;
  seatsOverLimit: boolean;
  capabilities: string[];
  integrations: string[];
  restrictedSignals: boolean;
  quota: QuotaState;
}

const capabilityDefs = (platform as any).capabilities as { id: string; minPlan: PlanId }[];
const integrationDefs = (platform as any).integrations as { id: string; minPlan: PlanId }[];

export function entitlements(state: AccountState): Entitlements {
  const p = plan(state.planId);
  const limit = p.quota.industries;
  const extraIndustries = isUnlimited(limit)
    ? 0
    : Math.max(0, state.industries.length - limit);

  const seatLimit = p.quota.seats;
  const seatsOverLimit = !isUnlimited(seatLimit) && (state.seats ?? 1) > seatLimit;

  return {
    planId: p.id,
    scoring: p.scoring,
    spiderwebDepth: p.spiderwebDepth,
    refreshHours: p.refreshHours,
    extraIndustries,
    // Only billable where unlocks are sold. On a plan that does not sell them,
    // going over is a hard stop rather than a silent charge.
    industriesOverLimit: extraIndustries > 0 && !industryUnlock.appliesTo.includes(p.id),
    seatsOverLimit,
    capabilities: capabilityDefs.filter((c) => allows(p.id, c.minPlan)).map((c) => c.id),
    integrations: integrationDefs.filter((i) => allows(p.id, i.minPlan)).map((i) => i.id),
    restrictedSignals: !!state.fcraAttestedAt,
    quota: quotaState(p.id, state.used ?? 0, state.purchased ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export interface CostBreakdown {
  planId: PlanId;
  base: number;
  industryUnlocks: number;
  overage: number;
  total: number;
  /** False when the plan cannot serve the usage at any price. */
  feasible: boolean;
  blockedBy: string[];
}

export interface UsageProfile {
  leadsPerMonth: number;
  industries: number;
  seats?: number;
  needsApi?: boolean;
  needsCrm?: boolean;
  spiderwebDepth?: number;
}

/** What a given plan would actually cost for a given month of usage. */
export function costFor(planId: PlanId, usage: UsageProfile): CostBreakdown {
  const p = plan(planId);
  const blockedBy: string[] = [];

  const industryLimit = p.quota.industries;
  const extra = isUnlimited(industryLimit) ? 0 : Math.max(0, usage.industries - industryLimit);
  const canUnlock = industryUnlock.appliesTo.includes(p.id);
  if (extra > 0 && !canUnlock) blockedBy.push(`${usage.industries} industries`);

  const seatLimit = p.quota.seats;
  if (!isUnlimited(seatLimit) && (usage.seats ?? 1) > seatLimit) {
    blockedBy.push(`${usage.seats} seats`);
  }
  if (usage.needsApi && !allows(p.id, 'elite')) blockedBy.push('API access');
  if (usage.needsCrm && !allows(p.id, 'pro')) blockedBy.push('CRM export');
  if ((usage.spiderwebDepth ?? 0) > p.spiderwebDepth) {
    blockedBy.push(`expansion depth ${usage.spiderwebDepth}`);
  }

  const unlocks = canUnlock ? extra * industryUnlock.monthly : 0;
  const overage = quotaState(p.id, usage.leadsPerMonth).overageCost;

  return {
    planId: p.id,
    base: p.monthly,
    industryUnlocks: unlocks,
    overage,
    total: round2(p.monthly + unlocks + overage),
    feasible: blockedBy.length === 0,
    blockedBy,
  };
}

export interface Recommendation {
  best: CostBreakdown;
  current?: CostBreakdown;
  /** Positive when moving saves money. Zero when they are already right. */
  savesPerMonth: number;
  action: 'stay' | 'upgrade' | 'downgrade';
  reason: string;
  /** Every feasible plan, cheapest first. Shown so the customer can check the maths. */
  options: CostBreakdown[];
}

/**
 * The upsell engine — which is really a "what should this cost" engine.
 *
 * A Starter account pulling 300 leads pays $9 + 250 x $0.25 = $71.50. Pro
 * serves the same month for $29. Telling them that costs $42.50 a month in
 * revenue and buys an account that does not churn the first time they add it
 * up themselves, because they will.
 */
export function recommendPlan(usage: UsageProfile, currentPlanId?: PlanId): Recommendation {
  const options = plans
    .map((p) => costFor(p.id, usage))
    .filter((c) => c.feasible)
    .sort((a, b) => a.total - b.total || rank(a.planId) - rank(b.planId));

  // Only reachable if a usage profile exceeds even Enterprise's feature set,
  // which today it cannot — but a future gate could, and a crash here would
  // take out the billing page.
  const best = options[0] ?? costFor('enterprise', usage);
  const current = currentPlanId ? costFor(currentPlanId, usage) : undefined;

  if (!current || current.planId === best.planId) {
    return {
      best,
      current,
      savesPerMonth: 0,
      action: 'stay',
      reason: current
        ? `${plan(best.planId).name} is already the cheapest plan for ${usage.leadsPerMonth.toLocaleString('en-US')} leads a month.`
        : `${plan(best.planId).name} covers ${usage.leadsPerMonth.toLocaleString('en-US')} leads a month at ${usd(best.total)}.`,
      options,
    };
  }

  const saves = round2(current.total - best.total);
  const up = rank(best.planId) > rank(current.planId);
  const overageShare = current.overage > 0 ? ` — ${usd(current.overage)} of that is overage` : '';

  return {
    best,
    current,
    savesPerMonth: saves,
    action: up ? 'upgrade' : 'downgrade',
    reason: saves > 0
      ? `At ${usage.leadsPerMonth.toLocaleString('en-US')} leads a month, ${plan(current.planId).name} costs ${usd(current.total)}${overageShare}. ${plan(best.planId).name} costs ${usd(best.total)} — ${usd(saves)} less.`
      : `${plan(current.planId).name} is fine at this volume; ${plan(best.planId).name} is not cheaper.`,
    options,
  };
}

/** Annual price and what skipping it costs. */
export function annual(planId: PlanId): { price: number; monthlyEquivalent: number; saves: number; label: string } {
  const p = plan(planId);
  return {
    price: p.annual,
    monthlyEquivalent: round2(p.annual / 12),
    saves: round2(p.monthly * 12 - p.annual),
    label: data.annual.label,
  };
}

/** Effective per-lead cost at full quota — the number that wins comparisons. */
export function effectivePerLead(planId: PlanId): number | null {
  const p = plan(planId);
  const q = p.quota.leadsPerMonth;
  return isUnlimited(q) ? null : round2(p.monthly / q);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
