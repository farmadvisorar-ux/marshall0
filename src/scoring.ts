import industriesData from '../data/industries.json';
import type { PlanId, ScoringTier } from './plans';

/**
 * Lead scoring.
 *
 * The output is a 0-100 number, but the number is not the product — the
 * breakdown is. A rep who can see "roof is 24 years old (+19), 2in hail in
 * May (+18), owner-occupied (+12)" will make the call. A rep handed "87" will
 * not, because they have been sold black-box scores before and those lists
 * were padded.
 *
 * So every score carries: the contribution of each signal, which sources fed
 * it, and how much of the model was actually present in the data. Missing
 * signals are excluded and the remaining weights are renormalised, then
 * `confidence` reports how much of the model ran. A 90 built from two of seven
 * signals is a guess, and the caller is told so rather than left to find out.
 */

export type SignalType = 'numeric' | 'boolean' | 'categorical' | 'band';

export interface Band {
  /** Upper bound of the band, inclusive. null means "and above". */
  max: number | null;
  score: number;
  note?: string;
}

export interface Signal {
  id: string;
  label: string;
  weight: number;
  type: SignalType;
  unit?: string;
  range?: [number, number];
  direction?: 'higher' | 'lower';
  bands?: Band[];
  categories?: Record<string, number>;
  sources?: string[];
  derived?: boolean;
  derivation?: string;
  /** Modelled from regulated or aggregate data. Gated behind an attestation. */
  restricted?: boolean;
}

export interface IndustryModule {
  slug: string;
  name: string;
  icon: string;
  summary: string;
  thesis: string;
  minPlan: PlanId;
  regulated?: boolean;
  regulatoryNote?: string;
  geographyLevel?: string;
  signals: Signal[];
  filters: string[];
  outreachAngle: string;
}

export const modules: IndustryModule[] = (industriesData as any).modules;

const bySlug = new Map(modules.map((m) => [m.slug, m]));

export function industryModule(slug: string): IndustryModule {
  const m = bySlug.get(slug);
  if (!m) throw new Error(`unknown industry module: ${slug}`);
  return m;
}

/** Raw observations for one lead, keyed by signal id. */
export type SignalValues = Record<string, number | boolean | string | null | undefined>;

export interface SignalContribution {
  id: string;
  label: string;
  /** As supplied. Kept so the UI can show "24 years" rather than "0.82". */
  raw: number | boolean | string;
  /** 0-1 after normalisation. */
  normalised: number;
  /** Weight actually applied, after renormalising around missing signals. */
  weight: number;
  /** Points of the final 0-100 this signal is responsible for. */
  points: number;
  sources: string[];
  note?: string;
  restricted?: boolean;
}

export interface LeadScore {
  industry: string;
  score: number;
  /** Share of the model's weight that had data behind it, 0-1. */
  confidence: number;
  /** Points of the 100 that no signal could speak to. Shown, not hidden. */
  unscoredPoints: number;
  grade: 'A' | 'B' | 'C' | 'D';
  contributions: SignalContribution[];
  missing: string[];
  /** Signals withheld because the account has not attested to marketing-only use. */
  withheld: string[];
  /** Ordered plain-English reasons, best first — the outreach hook comes from here. */
  reasons: string[];
}

export interface ScoreOptions {
  /** 'basic' runs the four heaviest signals only. It is the Starter model. */
  tier?: ScoringTier;
  /** Account has signed the FCRA marketing-use attestation. */
  fcraAttested?: boolean;
  /** Days since the underlying data was refreshed. Old data scores lower. */
  dataAgeDays?: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Normalise one observation to 0-1, or null when it cannot be read. */
function normalise(signal: Signal, raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;

  switch (signal.type) {
    case 'boolean': {
      if (typeof raw !== 'boolean') return null;
      return signal.direction === 'lower' ? (raw ? 0 : 1) : raw ? 1 : 0;
    }

    case 'categorical': {
      if (typeof raw !== 'string') return null;
      const hit = signal.categories?.[raw];
      // An unmapped category is not a zero — a zero would actively push the
      // lead down for the crime of having a value we have not seen before.
      return hit ?? signal.categories?.unknown ?? null;
    }

    case 'band': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      for (const b of signal.bands ?? []) {
        if (b.max === null || n <= b.max) return clamp01(b.score);
      }
      return null;
    }

    case 'numeric':
    default: {
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      const [lo, hi] = signal.range ?? [0, 1];
      if (hi === lo) return 0;
      const scaled = clamp01((n - lo) / (hi - lo));
      return signal.direction === 'lower' ? 1 - scaled : scaled;
    }
  }
}

/** The band note or a generated sentence, for the reasons list. */
function noteFor(signal: Signal, raw: unknown, normalised: number): string | undefined {
  if (signal.type === 'band') {
    const n = Number(raw);
    for (const b of signal.bands ?? []) {
      if (b.max === null || n <= b.max) return b.note;
    }
  }
  if (signal.type === 'boolean' && raw === true) return signal.label;
  return normalised >= 0.75 ? `${signal.label}: ${String(raw)}${signal.unit ? ` ${signal.unit}` : ''}` : undefined;
}

/**
 * Basic tier: the four heaviest signals.
 *
 * Deliberately a subset of the same model rather than a different one. A
 * Starter customer who upgrades should see their existing leads re-rank in a
 * way that makes sense, not watch the scores scramble into something
 * unrecognisable — that reads as the first set having been fake.
 */
const BASIC_SIGNAL_COUNT = 4;

/**
 * Below this share of the model, no score is issued at all.
 *
 * The alternative is scoring a lead off one field and shrinking it toward the
 * middle, which puts near-empty rows in the middle of the list where reps work
 * them. Refusing is better: it sends the row back to enrichment instead of
 * wasting a phone call.
 */
const MIN_COVERAGE = 0.25;

/**
 * What an unmeasured signal is worth.
 *
 * Renormalising around missing signals — the obvious implementation — says a
 * lead with two of seven signals, both perfect, is a 100. It is not; it is two
 * good facts and five open questions. Missing weight is held at a neutral 0.5
 * instead, so the score can only reach the top when the model actually ran.
 */
const NEUTRAL_PRIOR = 0.5;

export function scoreLead(
  industrySlug: string,
  values: SignalValues,
  options: ScoreOptions = {}
): LeadScore {
  const mod = industryModule(industrySlug);
  const tier = options.tier ?? 'advanced';

  const active =
    tier === 'basic'
      ? [...mod.signals].sort((a, b) => b.weight - a.weight).slice(0, BASIC_SIGNAL_COUNT)
      : mod.signals;

  const contributions: SignalContribution[] = [];
  const missing: string[] = [];
  const withheld: string[] = [];
  let liveWeight = 0;

  for (const signal of active) {
    if (signal.restricted && !options.fcraAttested) {
      withheld.push(signal.id);
      continue;
    }
    const raw = values[signal.id];
    const normalised = normalise(signal, raw);
    if (normalised === null) {
      missing.push(signal.id);
      continue;
    }
    liveWeight += signal.weight;
    contributions.push({
      id: signal.id,
      label: signal.label,
      raw: raw as number | boolean | string,
      normalised,
      weight: signal.weight,
      points: 0, // filled once liveWeight is known
      sources: signal.sources ?? [],
      note: noteFor(signal, raw, normalised),
      restricted: signal.restricted,
    });
  }

  const totalWeight = active.reduce((a, s) => a + s.weight, 0);
  const coverage = totalWeight === 0 ? 0 : liveWeight / totalWeight;

  if (coverage < MIN_COVERAGE) {
    return {
      industry: mod.slug,
      score: 0,
      confidence: round2(coverage),
      unscoredPoints: 100,
      grade: 'D',
      contributions: [],
      missing,
      withheld,
      reasons: [
        liveWeight === 0
          ? 'No usable signals for this lead.'
          : `Only ${Math.round(coverage * 100)}% of the model had data — needs enrichment before it is worth a call.`,
      ],
    };
  }

  // Each signal keeps its share of the whole model, so the points a lead earns
  // are the points it actually evidenced. The unmeasured remainder is held at
  // the neutral prior rather than redistributed.
  let observed = 0;
  for (const c of contributions) {
    const share = c.weight / totalWeight;
    c.points = round1(c.normalised * share * 100);
    observed += c.normalised * share;
  }

  const confidence = round2(coverage);
  const total = observed + (1 - coverage) * NEUTRAL_PRIOR;

  // Stale data decays rather than expires. A 40-day-old permit record is still
  // worth something; pretending it is as good as this morning's is not.
  const decay = options.dataAgeDays ? Math.max(0.7, 1 - options.dataAgeDays / 365) : 1;
  const score = Math.round(clamp01(total) * 100 * decay);

  contributions.sort((a, b) => b.points - a.points);

  return {
    industry: mod.slug,
    score,
    confidence,
    unscoredPoints: round1((1 - coverage) * 100),
    grade: gradeFor(score),
    contributions,
    missing,
    withheld,
    reasons: contributions
      .filter((c) => c.note && c.points > 0)
      .slice(0, 4)
      .map((c) => c.note as string),
  };
}

/**
 * Letter grade.
 *
 * Graded on the score alone, because the score already carries the
 * uncertainty: a lead evidencing two of seven signals cannot climb past ~69
 * however good those two are, since the other 31 points are pinned at the
 * neutral prior. Discounting the grade on top of that would penalise the same
 * gap twice.
 */
function gradeFor(score: number): 'A' | 'B' | 'C' | 'D' {
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

/** Score one lead against every module the account has unlocked, best first. */
export function scoreAcrossIndustries(
  slugs: string[],
  values: SignalValues,
  options: ScoreOptions = {}
): LeadScore[] {
  return slugs
    .map((s) => scoreLead(s, values, options))
    .sort((a, b) => b.score - a.score);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
