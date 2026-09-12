/**
 * Deciding whether a property owner is a person or an organisation.
 *
 * Kept in its own module with no imports on purpose. The ingestion scripts run
 * it under Node's type stripping, which cannot follow a JSON import, and
 * identity-graph.ts pulls in the source registry. Splitting it keeps one
 * definition of the vocabulary rather than a copy in each place that needs it.
 */

/**
 * Legal-entity and institutional markers in an owner name.
 *
 * The distinction has to earn its place on a doorstep: a residential roofer
 * sent to a Kroger, a university campus or a school district has been handed a
 * lead they cannot sell, however high it scores on storm exposure.
 *
 * Deliberately excludes "trust" and "estate". Those are overwhelmingly family
 * holdings of an ordinary house — a living trust is how a homeowner avoids
 * probate, not a sign of a corporate landlord — and excluding them would drop a
 * large share of genuinely residential owners.
 */
const ORG_MARKER =
  /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|pllc|plc|holdings?|partners(hip)?|ventures?|properties|realty|management|enterprises?|investments?|associates|group|university|college|school|isd|church|ministries|hospital|authority|district|county|city\s+of|town\s+of|state\s+of|department|bank|bancorp|credit\s+union|foundation|association|assoc|cemetery|lodge|club|commission|government|center|centre|services|systems|industries|manufacturing|mfg|motors|automotive|collision|insurance|agency|clinic|medical|dental|storage|apartments|estates|lodge|museum|library|airport|utility|electric|telephone|railroad|cad|usa|u\.s\.a|united\s+states)\b/i;

/**
 * True when an owner name reads as an organisation rather than a person.
 *
 * A conservative test: it looks for explicit markers rather than guessing from
 * name shape, because the cost of misfiring is asymmetric. Wrongly excluding a
 * homeowner loses one lead silently; wrongly including a hospital wastes a
 * visit and makes the whole list look careless.
 */
/**
 * Appraisal districts and similar bodies appear as bare acronyms — HCAD,
 * WCAD, MISD — where the marker is fused into one token and a word-boundary
 * match cannot see it. These own real parcels and would otherwise sit at the
 * top of a storm-ranked list.
 */
const ORG_ACRONYM = /\b[A-Z]{1,5}(CAD|ISD|MUD|EDC|HOA)\b/;

export function looksLikeOrganization(owner?: string | null): boolean {
  if (!owner) return false;
  const cleaned = owner.replace(/[.,]/g, ' ');
  return ORG_MARKER.test(cleaned) || ORG_ACRONYM.test(cleaned.toUpperCase());
}

// Apostrophes are removed rather than treated as separators. Splitting on them
// turns O'ROURKE into two tokens that can never match the OROURKE the other
// record spells without punctuation, which is the very mismatch this is for.
const tokens = (s: string): string[] =>
  s
    .toUpperCase()
    .replace(/['’]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/**
 * Whether the tax bill goes somewhere other than the property.
 *
 * Not string equality. The two fields are written by different systems and
 * rarely agree literally: Marshall's situs record is "4426 JEFF DAVIS" while
 * the mailing record for the same house is "4426 JEFF DAVIS ST MARSHALL",
 * and Guilford writes OROURKE DR against O'ROURKE DR. Comparing directly marked
 * almost every owner absentee, which inverts the heaviest property signal —
 * owner-occupancy is the best predictor of who can say yes on a doorstep, so
 * getting it backwards buries the strongest leads.
 *
 * The test is containment: if every token of the property address appears in
 * the mailing address, the bill is going to the house. Extra tokens on the
 * mailing side are street type, city and state, not a different building.
 *
 * Returns null when there is no mailing address to compare, so a missing value
 * is scored as unknown rather than silently as owner-occupied.
 */
export function isAbsenteeOwner(
  siteAddress?: string | null,
  mailAddress?: string | null
): boolean | null {
  if (!siteAddress || !mailAddress) return null;
  const site = tokens(siteAddress);
  const mail = new Set(tokens(mailAddress));
  if (!site.length) return null;
  return !site.every((t) => mail.has(t));
}
