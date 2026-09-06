# Marshall0

**AI Lead Finder.** Find the properties and businesses that need your service
this month — not a list of everyone in the county.

JSON that defines the commercial and scoring model, and TypeScript engines that
read it. No runtime dependencies and no framework, so this drops into an API, a
Next app or a worker unchanged.

```
data/plans.json        4 tiers, overage, lead packs, trial, referral
data/industries.json   8 industry modules — 52 weighted signals
data/sources.json      24 data sources with access mode, trust and retention
data/platform.json     capability stack, integrations, compliance, templates
src/plans.ts           entitlements, quota, overage, packs, upsell
src/scoring.ts         explainable per-industry lead scoring
src/identity-graph.ts  entity resolution and spiderweb expansion
src/compliance.ts      DNC, CAN-SPAM, quiet hours, FCRA boundary
check.mjs              invariant validator
demo.ts                runnable end-to-end walkthrough / smoke test
```

```bash
npm install
npm run check   # typecheck + validate the commercial model
npm run demo    # run the whole pipeline on sample data, 15 assertions
npm test        # both
```

Both run in CI on every push, because the model lives in JSON and a repricing
edit can break an invariant without breaking a build.

---

## Pricing

| | Starter | Pro | Elite | Enterprise |
|---|---|---|---|---|
| **Monthly** | $9 | $29 | $79 | $199 |
| **Annual** | $90 | $290 | $790 | $1,990 |
| Leads/month | 50 | 300 | 1,000 | Unlimited¹ |
| Industries | 1 | 3 | All | All + custom |
| Effective/lead | $0.180 | $0.097 | $0.079 | — |
| Overage/lead | $0.25 | $0.15 | $0.10 | — |
| Seats | 1 | 3 | 10 | Unlimited |
| Expansion depth | 0 | 1 | 2 | 3 |
| Data refresh | weekly | 72h | daily | 6-hourly |
| Scoring | basic | full | full | full |

¹ 25,000/month fair use, published rather than sprung on them at renewal.

**Free trial** — 3 days, 25 leads, card required. Three days rather than
fourteen: a $9 product cannot fund two weeks of API spend per tyre-kicker, and
people forget a fourteen-day trial exists. Card on file roughly triples
trial-to-paid.

**Pay per lead** — $0.50 down to $0.10 by volume, for the real slice of
contractors who will never take a subscription.

**Referral** — 100 leads per referral, paid on the referee's *first payment*.
Paying in leads costs marginal compute rather than margin, and it is only
spendable inside the product.

**Industry unlocks** — $7/month each on Starter and Pro.

### Four mechanics that make the ladder hold

Every one of these is enforced by `check.mjs`, because the model lives in JSON
and a one-character edit can quietly break any of them.

**1. Overage always costs more than upgrading — and the upgrade lands somewhere
real.** A Starter account pulling 300 leads pays $9 + 250 × $0.25 = $71.50. Pro
serves the same month for $29. The validator computes the crossover volume for
each adjacent pair and fails the build if it exceeds the higher tier's included
quota — otherwise the engine would recommend an upgrade that starts in overage
on day one, which is the worst possible first impression of a plan someone just
paid more for.

| | crossover | next tier includes |
|---|---|---|
| Starter → Pro | 130 leads | 300 ✓ |
| Pro → Elite | 634 leads | 1,000 ✓ |
| Elite → Enterprise | 2,200 leads | unlimited ✓ |

**2. No bracket cliffs.** 99 leads at the sticker rate is $49.50; 100 costs
$35.00. `quoteLeadPack` returns the cheaper of the two with the extra lead free
and says it did — a customer who finds that cliff on their own has found a bug,
because it is one.

**3. No dead tier.** The validator sweeps 440 usage profiles and fails if any
plan is never the cheapest feasible option. A tier nobody should ever buy still
costs conversions on the tiers that work.

**4. The upsell is honest or it does not fire.** `recommendPlan` prices every
plan against real usage and returns whichever wins — including *stay put*, and
including *downgrade*. An Elite account pulling 40 leads a month gets told to
move to Starter. That costs $70/month in revenue and buys an account that does
not cancel the first time they do the arithmetic themselves, because they will.

---

## Industry modules

A module is a scoring model, not a category label. A generic scraper returns
everyone in the county; a module ranks them by whether they need the work right
now. Weights within a module sum to exactly 1.0, so scores are comparable
across industries.

| Module | Min plan | The thesis |
|---|---|---|
| 🏠 Roofing | Starter | A roof old enough to fail, that took hail recently enough to claim, owned by someone who can authorise the work. |
| 🌿 Lawn & Landscape | Starter | Route density beats lead count. Twenty jobs on one street beat sixty across a county. |
| 🌞 Solar | Pro | Payback maths. A perfect roof in a cheap-power state loses to a mediocre roof where power costs 28¢. |
| 🧰 HVAC | Pro | Bought in a panic. Find the fifteen-year-old system the week before a heat dome. |
| 🏢 Commercial | Pro | Fails on the wrong contact, not the wrong building. Owner vs tenant beats every physical signal combined. |
| 🚗 Auto Repair | Pro | Block-group only. Target neighbourhoods whose fleet has aged out of warranty. |
| 🛠 General Contractor | Pro | Renovation is funded from equity. An open permit is the highest-intent public signal that exists. |
| 🛡 Insurance | Elite | Nobody shops insurance because they were asked. They shop it because something changed. |

Signals normalise three ways. `numeric` scales linearly across a range.
`categorical` maps values to scores with a mandatory `unknown` fallback — an
unmapped value must not read as zero, or a lead gets punished for carrying a
category nobody has seen before. `band` is piecewise, for relationships that
are not monotonic: a 5-year-old roof and a 45-year-old roof are both bad
roofing leads, for opposite reasons, and no linear model can say that.

### Scoring is explainable, and admits what it does not know

The number is not the product; the breakdown is. A rep who sees *roof is 24
years (26 pts), owner-occupied (12), 1.75" hail in May (11)* makes the call. A
rep handed *80* does not, because they have been sold padded lists before.

Two properties matter more than the ranking:

**Missing signals are not redistributed.** The obvious implementation
renormalises around whatever data arrived, which says a lead with two of seven
signals — both perfect — is a 100. It is not; it is two good facts and five
open questions. Unmeasured weight is held at a neutral 0.5 instead, so the
same lead scores 69 and cannot reach an A until the model actually runs.

**Below 25% coverage, no score is issued at all.** The row goes back to
enrichment rather than landing mid-list where someone burns a phone call on it.

```
score 80/100  grade A  confidence 1.0
    26 pts  Roof age                 24              [county-permits, county-assessor]
    12 pts  Owner-occupied           true            [county-assessor]
    11 pts  Hail events, 3 years     3               [noaa-storm-events]
    10 pts  Roof material            asphalt-3tab    [county-assessor, aerial-imagery]
    10 pts  Property value           284000          [county-assessor]
   9.4 pts  Claim likelihood         0.78            [noaa-storm-events, county-permits]
     2 pts  High-wind events         2               [noaa-storm-events]
```

Starter's `basic` tier runs the four heaviest signals of the *same* model
rather than a different one — so an upgrade re-ranks leads in a way that makes
sense instead of scrambling them, which would read as the first set having been
fake.

---

## Sources

24 sources across discovery, property, environmental, demographic, regulatory,
enrichment and suppression. Each carries an access mode, a `trust` score that
decides conflict resolution, and a contractual `retentionDays` ceiling.

**Retention shapes the architecture.** Google Places permits `place_id`
indefinitely but most other fields for 30 days; Yelp is 24 hours. So the system
caches identifiers, stores its own derived scores, and re-fetches vendor content
on read. Building a permanent copy of either would breach the terms and get the
key pulled — which takes the product down for every customer at once.

**Nothing is scraped where an API or a public record exists.** BBB and
YellowPages sit in the registry marked `partner-required` / `not-ingested`,
and the validator fails the build if either is ever flipped on without an
agreement. Scrapers break weekly and carry legal risk that a $9 product cannot
absorb; the county assessor's bulk file does neither.

The under-used sources are where the edge is:

- **Secretary of State filings** — highest trust in the registry (0.95) and the
  bridge from a storefront to a legal person who can sign. Makes new-business
  leads possible at all.
- **Building permits** — the highest-intent public signal anywhere, and a free
  competitor feed: `contractorName` tells you who is winning work in your ZIP
  and at what ticket size.
- **NOAA storm events** — free, public domain, authoritative. Storm-chasing
  roofers pay four figures a month for repackaged versions of this exact feed.
- **State insurance rate filings** — a carrier filing a 14% increase is a churn
  event with a date on it. Nobody in this market uses it.

---

## Identity resolution and the spiderweb

The part that is hard to copy. Anyone can pull a directory; the value is
deciding that `M&J ROOFING LLC` on a state filing, `M and J Roofing Co` on
Yelp, and the owner name on a parcel record are one business — then walking
outward to the other properties that owner holds.

**Matching.** Records are blocked on candidate keys (phone, email, standardised
address, parcel, domain, postal-scoped name) so only plausible pairs are ever
compared — the naive version is 500 billion comparisons at a million records
and simply does not run. Pairs score by noisy-OR over field agreements, so two
independent 0.6 signals give 0.84 rather than 1.2 and no single field carries a
match alone. Conflicts subtract afterwards, so a parcel mismatch can veto
everything above it. ≥0.80 merges, 0.55–0.80 goes to a review queue rather than
being silently dropped.

Addresses normalise with the unit held *separate* from the join key, because
two records at the same street address in different suites are a co-location,
not a match. Person names sort their tokens — an assessor roll writes `HALE
MARCUS J` and the state writes `MARCUS J HALE` — while business names never do,
since "Anderson Windows" and "Windows Anderson" are different companies.

**Expansion.** From a seed record, walk shared identifiers outward, multiplying
confidence by edge strength, rarity and per-hop decay, recording the path at
every step:

```
hop 0  1.000  M & J Roofing              [google-places]
hop 1  0.395  M&J ROOFING LLC            [sos-business-filings]   via phone
hop 1  0.275  HALE MARCUS J              [county-assessor]        via address
hop 2  0.090  HALE MARCUS J              [county-permits]         via address → ownerName
```

Rarity weighting is on an **absolute** scale, not corpus-relative: a phone
number on thirty records is a switchboard whether the corpus holds a hundred
rows or a hundred million. The corpus-relative version looks more principled
and behaves badly — the same shared address becomes decisive in a large batch
and worthless in a small one, so the graph a customer sees would depend on how
many rows happened to be in the pull. Identifiers past `maxFanOut` are dropped
entirely and reported, which is what keeps commercial registered agents from
collapsing a county into one blob.

Depth is the plan gate: Starter 0, Pro 1, Elite 2, Enterprise 3.

---

## Compliance

Runs whether or not the customer remembers it exists, and is not configurable
from the UI. A contractor buying a $9 lead list has not read the TCPA and should
not have to.

**Gates fail closed.** A number that has never been scrubbed is withheld from
calling, not flagged — an unscrubbed number is indistinguishable from a listed
one until checked, and guessing costs $500–$1,500 per call. Scrubs older than
31 days (the safe-harbour interval) count as unscrubbed.

**Decisions are per channel, not per record.** A DNC listing stops calls and
texts and says nothing about direct mail. Withholding the whole record would
throw away a mailable lead the customer paid for.

**Templates refuse to render rather than degrade.** Every other system in this
category renders a missing `{{unsubscribeUrl}}` as an empty string and sends
anyway — a strict-liability CAN-SPAM violation at $53,088 per message, and a
silent one. `renderOutreach` throws a `ComplianceError` naming the missing
field, and `check.mjs` fails the build if any email template omits a required
token.

**Cold SMS requires recorded prior express written consent.** Not a grey area —
the most litigated provision in the statute.

**The FCRA boundary is explicit.** Income brackets, equity estimates and
churn-risk scores are modelled from public and aggregate data. Shown to a
contractor choosing who to mail, that is marketing. Used to decide who gets a
policy, a loan, a job or a lease, the same numbers make the output a consumer
report and the seller a consumer reporting agency. Signals flagged `restricted`
are withheld until the account records a timestamped attestation.

Census-derived fields describe a neighbourhood, never a person, and are labelled
as area estimates everywhere they appear. Vehicle data is block-group aggregate
only — the federal DPPA restricts personal registration records to enumerated
purposes and marketing is not among them.

---

## Status

**In this repo** — the commercial model, all eight scoring modules, entity
resolution, spiderweb expansion, the compliance gates, the outreach renderer,
and 15 end-to-end assertions in `demo.ts`.

**Not yet** — the ingest workers that populate `SourceRecord[]`, the Stripe
wiring, the dashboard, and the LLM call behind outreach generation. The engines
define the interfaces those plug into; `demo.ts` shows the shapes.

Ingest is the long pole and it is not evenly distributed: roughly 3,100 county
assessor and permit systems, each with its own format and cadence. That work is
also most of the defensibility — the APIs are a weekend, the counties are the
moat.

**Before launch, in order:** DNC subscription (the product cannot ship without
it), USPS CASS licence (cross-source matching does not work without
standardised addresses), Google Places billing with cache-against-`place_id`
enforced, then one county's assessor and permit feed end to end before adding
a second.
