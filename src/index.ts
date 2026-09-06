/**
 * Marshall0 — AI Lead Finder.
 *
 * Data files that define the commercial and scoring model, and the engines that
 * read them. No runtime dependencies and no framework, so this drops into an
 * API, a Next app or a worker unchanged.
 *
 *   plans.ts            entitlements, quota, overage, lead packs, upsell
 *   scoring.ts          per-industry explainable lead scoring
 *   identity-graph.ts   entity resolution and spiderweb expansion
 *   compliance.ts       DNC, CAN-SPAM, quiet hours, FCRA boundary
 *   sources/            source adapters — NOAA storm, assessor, permits
 *   pipeline/           per-vertical wiring, records in and leads out
 *
 * Everything commercial lives in data/, not in code. Adding an industry or
 * repricing a tier is a JSON edit that `npm run check` validates, which is the
 * difference between shipping a vertical in an afternoon and shipping it in a
 * sprint.
 */

export * from './plans';
export * from './scoring';
export * from './identity-graph';
export * from './compliance';
export * from './sources/noaa-storm';
export * from './sources/property';
export * from './pipeline/roofing';

export { default as plansData } from '../data/plans.json';
export { default as industriesData } from '../data/industries.json';
export { default as sourcesData } from '../data/sources.json';
export { default as platformData } from '../data/platform.json';
