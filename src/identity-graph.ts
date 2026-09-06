import sourcesData from '../data/sources.json';

/**
 * Identity resolution and spiderweb expansion.
 *
 * This is the part that is hard to copy. Anyone can pull a directory; the
 * value is in deciding that "M&J Roofing LLC" on a Secretary of State filing,
 * "M and J Roofing" on Places, and the owner name on a parcel record are one
 * business — and then walking outward from there to the three other properties
 * the same owner holds and the second DBA they trade under.
 *
 * Three things keep it from degenerating into mush:
 *
 *   1. Blocking. Only records sharing a candidate key are ever compared, so
 *      this is near-linear rather than quadratic. At a million records the
 *      naive version is 500 billion comparisons and simply does not run.
 *
 *   2. Inverse-frequency weighting. An identifier on 400 records tells you
 *      almost nothing — commercial registered agents represent thousands of
 *      LLCs, and a shared suite number is an office building, not a company.
 *      Edge strength is scaled by how rare the identifier is, and hubs past
 *      `maxFanOut` are skipped entirely.
 *
 *   3. Provenance. Every merged field records which source won and what lost,
 *      and every expansion step records the path that reached it. "Why is this
 *      in my list" has to be answerable, or the customer stops trusting the
 *      list — and they are right to.
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface SourceRecord {
  id: string;
  /** Source id from sources.json. Drives trust in conflict resolution. */
  source: string;
  observedAt?: string;
  name?: string;
  entityName?: string;
  ownerName?: string;
  registeredAgent?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  postal?: string;
  parcelId?: string;
  placeId?: string;
  [key: string]: unknown;
}

const trustBySource = new Map<string, number>(
  ((sourcesData as any).sources as { id: string; trust: number }[]).map((s) => [s.id, s.trust])
);

const trustOf = (source: string): number => trustBySource.get(source) ?? 0.5;

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** NANP digits only. Anything that is not a plausible US number is dropped. */
export function normPhone(input?: string): string | undefined {
  if (!input) return undefined;
  let d = input.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return undefined;
  // 555-01xx is reserved for fiction and shows up in seeded test data.
  if (/^\d{3}55501\d{2}$/.test(d)) return undefined;
  return d;
}

export function normEmail(input?: string): string | undefined {
  if (!input) return undefined;
  const e = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : undefined;
}

export function normDomain(input?: string): string | undefined {
  if (!input) return undefined;
  const d = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0];
  if (!d.includes('.')) return undefined;
  // Free mail hosts are not an organisation. Treating them as one merges every
  // sole trader who uses gmail into a single vast company.
  const FREE = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'msn.com', 'live.com']);
  return FREE.has(d) ? undefined : d;
}

const SUFFIX: Record<string, string> = {
  street: 'st', str: 'st', st: 'st',
  avenue: 'ave', ave: 'ave', av: 'ave',
  road: 'rd', rd: 'rd',
  drive: 'dr', dr: 'dr',
  lane: 'ln', ln: 'ln',
  boulevard: 'blvd', blvd: 'blvd',
  court: 'ct', ct: 'ct',
  circle: 'cir', cir: 'cir',
  place: 'pl', pl: 'pl',
  highway: 'hwy', hwy: 'hwy',
  parkway: 'pkwy', pkwy: 'pkwy',
  trail: 'trl', trl: 'trl',
  terrace: 'ter', ter: 'ter',
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};

const UNIT = /\b(apt|apartment|unit|suite|ste|#|bldg|building|fl|floor|rm|room)\b\.?\s*([\w-]+)/i;

export interface NormalisedAddress {
  /** Street line with suffixes and directionals collapsed. */
  line: string;
  unit?: string;
  postal?: string;
  /** Join key. Deliberately excludes the unit — see below. */
  key: string;
}

/**
 * Address normalisation.
 *
 * `key` omits the unit on purpose. Two records at the same street address in
 * different units are a *co-location*, not a match: an office park, a strip
 * mall, a duplex. The expansion engine wants that edge and the merge engine
 * must not have it, so the unit is carried separately and merge scoring
 * penalises a conflict on it.
 *
 * Production sends this through USPS CASS first — this is the fallback for
 * records CASS cannot resolve, and it is good enough to block on.
 */
export function normAddress(address?: string, postal?: string): NormalisedAddress | undefined {
  if (!address) return undefined;

  const unitMatch = address.match(UNIT);
  const unit = unitMatch ? unitMatch[2].toLowerCase() : undefined;

  const line = address
    .replace(UNIT, ' ')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/[^a-z0-9\s#-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => SUFFIX[t] ?? t)
    .join(' ')
    .trim();

  if (!line) return undefined;
  const zip5 = postal?.replace(/\D/g, '').slice(0, 5) || undefined;
  return { line, unit, postal: zip5, key: zip5 ? `${line}|${zip5}` : line };
}

const ORG_NOISE = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|pllc|dba|the|and|&)\b/g;

export function normName(input?: string): string | undefined {
  if (!input) return undefined;
  const n = input
    .toLowerCase()
    .replace(/[.,'"]/g, '')
    .replace(ORG_NOISE, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .trim();
  return n || undefined;
}

/**
 * Person names, with tokens sorted.
 *
 * Public records are not consistent about name order. An assessor roll writes
 * "HALE MARCUS J", the Secretary of State writes "MARCUS J HALE", and they are
 * the same human being. Sorting the tokens makes those one key.
 *
 * This is deliberately NOT used for business names, where order is meaning:
 * "Anderson Windows" and "Windows Anderson" are not the same company, and
 * collapsing them would merge unrelated businesses across a whole county.
 */
export function normPersonName(input?: string): string | undefined {
  const n = normName(input);
  if (!n) return undefined;
  return n.split(' ').sort().join(' ');
}

/** Jaccard over token sets. Cheap, and order-insensitive, which names need. */
export function nameSimilarity(a?: string, b?: string): number {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const sa = new Set(na.split(' '));
  const sb = new Set(nb.split(' '));
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared += 1;
  const union = sa.size + sb.size - shared;
  return union === 0 ? 0 : shared / union;
}

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------

interface Keyed {
  record: SourceRecord;
  phone?: string;
  email?: string;
  domain?: string;
  address?: NormalisedAddress;
  name?: string;
  parcelId?: string;
  placeId?: string;
}

function keyOf(record: SourceRecord): Keyed {
  const address = normAddress(record.address, record.postal);
  return {
    record,
    phone: normPhone(record.phone),
    email: normEmail(record.email),
    domain: normDomain(record.website) ?? normEmail(record.email)?.split('@')[1],
    address,
    name: normName(record.entityName ?? record.name ?? record.ownerName),
    parcelId: record.parcelId?.replace(/\W/g, '').toLowerCase() || undefined,
    placeId: record.placeId,
  };
}

/**
 * Candidate keys.
 *
 * A record only ever gets compared against records sharing at least one of
 * these. The name key is postal-scoped — comparing every "Smith Roofing" in
 * the country against every other is exactly the fan-out this exists to stop.
 */
function blockKeys(k: Keyed): string[] {
  const keys: string[] = [];
  if (k.parcelId) keys.push(`parcel:${k.parcelId}`);
  if (k.placeId) keys.push(`place:${k.placeId}`);
  if (k.phone) keys.push(`phone:${k.phone}`);
  if (k.email) keys.push(`email:${k.email}`);
  if (k.domain) keys.push(`domain:${k.domain}`);
  if (k.address) keys.push(`addr:${k.address.key}`);
  if (k.name && k.address?.postal) keys.push(`name:${k.name}|${k.address.postal}`);
  return keys;
}

// ---------------------------------------------------------------------------
// Pairwise matching
// ---------------------------------------------------------------------------

export interface MatchEvidence {
  field: string;
  weight: number;
  detail?: string;
}

export interface MatchResult {
  confidence: number;
  evidence: MatchEvidence[];
  conflicts: MatchEvidence[];
  decision: 'merge' | 'review' | 'no-match';
}

/** Auto-merge at or above this. */
export const MERGE_THRESHOLD = 0.8;
/** Below merge but above this goes to a human queue rather than being dropped. */
export const REVIEW_THRESHOLD = 0.55;

/**
 * Score a pair.
 *
 * Positive evidence combines as a noisy-OR — two independent 0.6 signals give
 * 0.84, not 1.2 — so it saturates instead of overflowing and no single field
 * can carry a match on its own unless it deserves to. Conflicts subtract after,
 * because a parcel mismatch has to be able to veto everything above it.
 */
export function matchRecords(a: SourceRecord, b: SourceRecord): MatchResult {
  const ka = keyOf(a);
  const kb = keyOf(b);
  const evidence: MatchEvidence[] = [];
  const conflicts: MatchEvidence[] = [];

  const both = <T>(x?: T, y?: T): boolean => x !== undefined && y !== undefined;

  if (both(ka.parcelId, kb.parcelId)) {
    if (ka.parcelId === kb.parcelId) evidence.push({ field: 'parcelId', weight: 0.97, detail: ka.parcelId });
    // Two different parcels are two different properties. Nothing outranks this.
    else conflicts.push({ field: 'parcelId', weight: 0.9, detail: `${ka.parcelId} vs ${kb.parcelId}` });
  }
  if (both(ka.placeId, kb.placeId) && ka.placeId === kb.placeId) {
    evidence.push({ field: 'placeId', weight: 0.95 });
  }
  if (both(ka.email, kb.email)) {
    if (ka.email === kb.email) evidence.push({ field: 'email', weight: 0.8, detail: ka.email });
    else conflicts.push({ field: 'email', weight: 0.1 });
  }
  if (both(ka.phone, kb.phone)) {
    if (ka.phone === kb.phone) evidence.push({ field: 'phone', weight: 0.62, detail: ka.phone });
    // Businesses run several lines. Mild.
    else conflicts.push({ field: 'phone', weight: 0.15 });
  }
  if (both(ka.address, kb.address)) {
    if (ka.address!.key === kb.address!.key) {
      evidence.push({ field: 'address', weight: 0.55, detail: ka.address!.line });
      const ua = ka.address!.unit;
      const ub = kb.address!.unit;
      if (both(ua, ub) && ua !== ub) {
        conflicts.push({ field: 'unit', weight: 0.35, detail: `${ua} vs ${ub}` });
      }
    } else {
      conflicts.push({ field: 'address', weight: 0.25 });
    }
  }
  if (both(ka.domain, kb.domain) && ka.domain === kb.domain) {
    evidence.push({ field: 'domain', weight: 0.35, detail: ka.domain });
  }

  const sim = nameSimilarity(a.entityName ?? a.name, b.entityName ?? b.name);
  if (sim === 1) evidence.push({ field: 'name', weight: 0.35, detail: ka.name });
  else if (sim >= 0.8) evidence.push({ field: 'name~', weight: 0.2, detail: `${Math.round(sim * 100)}% token overlap` });
  else if (sim > 0 && sim < 0.3) conflicts.push({ field: 'name', weight: 0.1 });

  const positive = 1 - evidence.reduce((acc, e) => acc * (1 - e.weight), 1);
  const negative = conflicts.reduce((acc, c) => acc + c.weight, 0);
  const confidence = Math.max(0, Math.min(1, positive - negative));

  return {
    confidence: round3(confidence),
    evidence,
    conflicts,
    decision:
      confidence >= MERGE_THRESHOLD ? 'merge' : confidence >= REVIEW_THRESHOLD ? 'review' : 'no-match',
  };
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

export interface FieldValue<T = string> {
  value: T;
  source: string;
  trust: number;
  /** Values from lower-trust sources. Kept, not discarded — they are often the
   *  newer number, and a human reviewing a bad merge needs to see them. */
  alternates: { value: T; source: string }[];
}

export interface ResolvedProfile {
  id: string;
  recordIds: string[];
  sources: string[];
  /** Lowest pairwise confidence holding the cluster together. */
  confidence: number;
  fields: Record<string, FieldValue>;
  /** Pairs that scored between the two thresholds. Surfaced, never auto-applied. */
  review: { a: string; b: string; confidence: number; evidence: MatchEvidence[] }[];
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    const p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const MERGEABLE_FIELDS = [
  'name', 'entityName', 'ownerName', 'registeredAgent',
  'phone', 'email', 'website', 'address', 'city', 'state', 'postal',
  'parcelId', 'placeId',
] as const;

/**
 * Resolve a batch of source records into profiles.
 *
 * Blocking first, so the comparison count stays proportional to how much the
 * records actually overlap rather than to the square of how many there are.
 */
export function resolveIdentities(records: SourceRecord[]): ResolvedProfile[] {
  const keyed = new Map(records.map((r) => [r.id, keyOf(r)]));
  const blocks = new Map<string, string[]>();

  for (const r of records) {
    for (const key of blockKeys(keyed.get(r.id)!)) {
      const bucket = blocks.get(key);
      if (bucket) bucket.push(r.id);
      else blocks.set(key, [r.id]);
    }
  }

  const uf = new UnionFind();
  for (const r of records) uf.find(r.id);

  const seen = new Set<string>();
  const strength = new Map<string, number>();
  const review: ResolvedProfile['review'] = [];
  const byId = new Map(records.map((r) => [r.id, r]));

  for (const ids of blocks.values()) {
    // A block this wide is a hub — a shared switchboard, a registered agent
    // service, a mall address. Comparing it pairwise is both quadratic and
    // wrong, since none of those pairs are the same entity.
    if (ids.length > 50) continue;

    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const pair = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
        if (seen.has(pair)) continue;
        seen.add(pair);

        const result = matchRecords(byId.get(ids[i])!, byId.get(ids[j])!);
        if (result.decision === 'merge') {
          uf.union(ids[i], ids[j]);
          strength.set(pair, result.confidence);
        } else if (result.decision === 'review') {
          review.push({ a: ids[i], b: ids[j], confidence: result.confidence, evidence: result.evidence });
        }
      }
    }
  }

  const clusters = new Map<string, string[]>();
  for (const r of records) {
    const root = uf.find(r.id);
    const bucket = clusters.get(root);
    if (bucket) bucket.push(r.id);
    else clusters.set(root, [r.id]);
  }

  return [...clusters.entries()].map(([root, memberIds]) => {
    const members = memberIds.map((id) => byId.get(id)!);
    const fields: Record<string, FieldValue> = {};

    for (const field of MERGEABLE_FIELDS) {
      const candidates = members
        .filter((m) => typeof m[field] === 'string' && (m[field] as string).trim() !== '')
        .map((m) => ({ value: (m[field] as string).trim(), source: m.source, trust: trustOf(m.source) }))
        .sort((a, b) => b.trust - a.trust);
      if (!candidates.length) continue;

      const [winner, ...rest] = candidates;
      fields[field] = {
        value: winner.value,
        source: winner.source,
        trust: winner.trust,
        alternates: rest
          .filter((c) => c.value.toLowerCase() !== winner.value.toLowerCase())
          .map((c) => ({ value: c.value, source: c.source })),
      };
    }

    const internal = [...strength.entries()]
      .filter(([pair]) => pair.split('|').every((id) => memberIds.includes(id)))
      .map(([, c]) => c);

    return {
      id: `profile:${root}`,
      recordIds: memberIds,
      sources: [...new Set(members.map((m) => m.source))],
      // A singleton is certain by construction. Otherwise the cluster is only
      // as good as its weakest link, which is what a reviewer needs to see.
      confidence: internal.length ? round3(Math.min(...internal)) : 1,
      fields,
      review: review.filter((r) => memberIds.includes(r.a) || memberIds.includes(r.b)),
    };
  });
}

// ---------------------------------------------------------------------------
// Spiderweb expansion
// ---------------------------------------------------------------------------

export type EdgeKind =
  | 'parcel' | 'email' | 'phone' | 'address' | 'ownerName' | 'domain' | 'registeredAgent';

/**
 * Base strength per link type, before inverse-frequency scaling.
 *
 * These are weaker than the merge weights on purpose. Expansion is asking a
 * different question: not "is this the same entity" but "is this connected
 * enough to be worth showing". A shared address is a weak identity claim and a
 * strong co-location claim.
 */
const EDGE_STRENGTH: Record<EdgeKind, number> = {
  parcel: 0.95,
  email: 0.85,
  phone: 0.75,
  ownerName: 0.7,
  address: 0.65,
  domain: 0.6,
  // A commercial agent fronts thousands of LLCs. Weak on its own, and
  // inverse-frequency weighting usually kills it outright.
  registeredAgent: 0.45,
};

export interface SpiderwebOptions {
  /** Hops from the seed. Plan-gated: Starter 0, Pro 1, Elite 2, Enterprise 3. */
  maxDepth?: number;
  minConfidence?: number;
  /** Per-hop decay, so distant relatives rank below near ones. */
  hopDecay?: number;
  /** Identifiers appearing on more records than this are hubs and are ignored. */
  maxFanOut?: number;
  kinds?: EdgeKind[];
}

export interface SpiderwebNode {
  recordId: string;
  depth: number;
  confidence: number;
  /** How this record was reached, hop by hop. The audit trail. */
  path: { via: EdgeKind; value: string; fromRecordId: string }[];
}

export interface SpiderwebResult {
  seedId: string;
  nodes: SpiderwebNode[];
  /** Identifiers skipped for being hubs, with their record counts. */
  suppressedHubs: { kind: EdgeKind; value: string; count: number }[];
}

function edgeValues(k: Keyed, kinds: EdgeKind[]): { kind: EdgeKind; value: string }[] {
  const out: { kind: EdgeKind; value: string }[] = [];
  const push = (kind: EdgeKind, value?: string) => {
    if (value && kinds.includes(kind)) out.push({ kind, value });
  };
  push('parcel', k.parcelId);
  push('email', k.email);
  push('phone', k.phone);
  push('address', k.address?.key);
  push('domain', k.domain);
  // Owner and agent share one namespace on purpose: for a small LLC they are
  // usually the same person, and the whole reason to walk this edge is to get
  // from the filing to the properties that person holds. Traversal strength
  // still differs by which side you leave from — an agent is a weaker claim —
  // and inverse-frequency weighting handles the commercial agent services that
  // front thousands of companies.
  push('ownerName', normPersonName(k.record.ownerName));
  push('registeredAgent', normPersonName(k.record.registeredAgent));
  return out;
}

/** Owner and agent resolve to one index key; the kind only sets the weight. */
const edgeKey = (kind: EdgeKind, value: string): string =>
  kind === 'ownerName' || kind === 'registeredAgent' ? `person:${value}` : `${kind}:${value}`;

/**
 * Walk outward from a seed record through shared identifiers.
 *
 * This is how one storefront becomes the LLC behind it, the four other
 * properties that LLC owns, and the second trading name on two of them. Each
 * hop multiplies confidence by the edge strength, its inverse-frequency
 * weight, and the decay — so the ranking falls off with distance on its own
 * and the caller can cut wherever they like.
 */
export function spiderweb(
  seedId: string,
  records: SourceRecord[],
  options: SpiderwebOptions = {}
): SpiderwebResult {
  const {
    maxDepth = 2,
    minConfidence = 0.25,
    hopDecay = 0.75,
    maxFanOut = 40,
    kinds = Object.keys(EDGE_STRENGTH) as EdgeKind[],
  } = options;

  const keyed = new Map(records.map((r) => [r.id, keyOf(r)]));
  if (!keyed.has(seedId)) return { seedId, nodes: [], suppressedHubs: [] };

  // Identifier -> records carrying it. Also the frequency table for IDF.
  const index = new Map<string, string[]>();
  for (const r of records) {
    for (const { kind, value } of edgeValues(keyed.get(r.id)!, kinds)) {
      const key = edgeKey(kind, value);
      const bucket = index.get(key);
      if (bucket) bucket.push(r.id);
      else index.set(key, [r.id]);
    }
  }

  /**
   * Rarity weight, on an absolute scale rather than a corpus-relative one.
   *
   * A phone number on thirty records is a switchboard whether the corpus holds
   * a hundred rows or a hundred million — so the denominator is `maxFanOut`,
   * the point at which an identifier stops being an identifier, not the corpus
   * size. The corpus-relative version of this looks more principled and
   * behaves badly: it makes the same shared address decisive in a large batch
   * and worthless in a small one, so the graph a customer sees depends on how
   * many rows happened to be in the pull.
   */
  const logFanOut = Math.log(Math.max(2, maxFanOut));
  const idf = (df: number): number =>
    df <= 1 ? 1 : Math.max(0.05, Math.min(1, 1 - Math.log(df) / logFanOut));

  const best = new Map<string, SpiderwebNode>();
  best.set(seedId, { recordId: seedId, depth: 0, confidence: 1, path: [] });

  const suppressed = new Map<string, { kind: EdgeKind; value: string; count: number }>();
  let frontier: SpiderwebNode[] = [best.get(seedId)!];

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const next: SpiderwebNode[] = [];

    for (const node of frontier) {
      for (const { kind, value } of edgeValues(keyed.get(node.recordId)!, kinds)) {
        const key = edgeKey(kind, value);
        const neighbours = index.get(key) ?? [];

        if (neighbours.length > maxFanOut) {
          suppressed.set(key, { kind, value, count: neighbours.length });
          continue;
        }

        const weight = EDGE_STRENGTH[kind] * idf(neighbours.length);
        const confidence = round3(node.confidence * weight * hopDecay);
        if (confidence < minConfidence) continue;

        for (const neighbourId of neighbours) {
          if (neighbourId === node.recordId) continue;
          const existing = best.get(neighbourId);
          // Keep the strongest route to each record, not the first one found.
          if (existing && existing.confidence >= confidence) continue;

          const found: SpiderwebNode = {
            recordId: neighbourId,
            depth,
            confidence,
            path: [...node.path, { via: kind, value, fromRecordId: node.recordId }],
          };
          best.set(neighbourId, found);
          next.push(found);
        }
      }
    }

    if (!next.length) break;
    frontier = next;
  }

  return {
    seedId,
    nodes: [...best.values()].sort((a, b) => a.depth - b.depth || b.confidence - a.confidence),
    suppressedHubs: [...suppressed.values()].sort((a, b) => b.count - a.count),
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
