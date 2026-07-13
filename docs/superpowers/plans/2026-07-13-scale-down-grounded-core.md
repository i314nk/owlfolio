# Scale-down: the grounded research-and-decision core (owner-locked 2026-07-13)

## The decision

Owlfolio scales down to what its architecture can actually stand behind: **a grounded
research-and-decision system**. The accounting/bookkeeping half is removed because it structurally
violates the system's core invariant — every number traces to a verified source or fails closed —
and its ground truth (the user's actual trades, balances, dividends) is unverifiable by the harness
by design (no broker sync). Confidently-formatted unverifiable data is worse than no data, most of
all in purification, where being wrong matters religiously.

**KEEP (the grounded core):** discovery → four-pillar research → zones/price checks → watchlist →
held names tracked as THESES (check-ins vs new filings, sell advisories, thesis-break triggers).
**REMOVE (the input-dependent books):** accounting projections/monthly snapshots, the purification
obligation/payment ledger, performance, the passive contribution tracker, investable capital and
the whole dollar/sizing layer.

## Owner-locked boundaries (2026-07-13)

1. **Passive** becomes an INFORMATIVE page: recommends keeping market exposure via ETFs and names
   Shariah-compliant candidates (e.g. the SPUS/HLAL/ISDU/SPSK class), clearly labeled as
   educational content, not advice, not tracked. Contribution tracking is removed (user-input
   accounting). The passive *strategy* (rules 1–3) survives as pedagogy on the page + Learn.
2. **Held names keep ONE manual field: the entry price.** Required so the model can flag a sell on
   extreme overvaluation / thesis break with a "vs your basis" anchor (rules 10–13), and so the
   pullback review rungs work. Everything downstream of it that pretends to be books goes: cost
   basis math, weights, returns, valuations, the performance page.
3. **Sizing/capital is removed entirely** (subsumes the 2026-07-13 sizing-removal plan): investable
   capital is itself user-input accounting. Zones tell you when; the size is yours.
4. **Shariah splits in two:** the SCREENING stays whole — the front gate, AAOIFI ratios,
   CONDITIONAL status, and the purification RATE on the dossier ("purify ~X% of dividends") — all
   computed from filings, fully grounded. The obligation/payment LEDGER goes.

## Ledger discipline (unchanged, non-negotiable)

Append-only history is never rewritten. All removed domains' events stay **readable**: projections
that back removed pages are deleted only when nothing else consumes them; events still render in
the audit timeline. The system stops PRODUCING new events for removed domains. No event contracts
are deleted — rows get a RETIRED note.

## Inventory (surveyed 2026-07-13)

### Pages/nav to remove
- `/accounting` (+ nav 'Accounting'), `/performance` (+ nav), `/purification` (+ nav)
- `/passive` → REPLACED by the informative ETF page (nav label stays 'Passive')
- `/settings` capital/savings panels: investable capital, savings sleeve (the deployment-hurdle
  savings anchor dies with sizing; the Shariah-compliant savings PEDAGOGY can ride the passive page)
- `/portfolio` → REWORKED: the thesis view (held names: ticker, entry price, entry date, linked
  dossier, check-in status, sell advisories). No values/weights/returns.
- `/calibration` — already-dead route? verify and sweep if orphaned.

### Engines/projections to remove (audit each import graph first; keep if a KEEP consumer exists)
- `accountingProjection`, `purificationProjection`, `purificationStatement`, `zakatModule`
- `investableCapitalProjection`, `passiveSleeveProjection`
- `positionPostMortemProjection` (predicted-vs-realized needs sell values — audit; likely goes)
- sizing layer (from the prior plan): `positionPlan`, `sizingAssessment`, `convictionFactor`,
  `sizingParams` PRUNED (keep concentration/ladder params ONLY if a surviving consumer remains —
  the concentration alert dies with position values, so likely fully removable), `downsideFloor`,
  `permanentLossCap`, `correlatedClusters` (audit each)
- `performance.ts` helpers in apps/web

### Worker tasks
- REMOVE: `portfolio_valuation_refresh`, `purification_projection` (+ their schedules/tests)
- KEEP: `review_reminder`, `re_review_check`, `re_underwrite`, `shariah_rescreen`,
  `holdings_monitor` (RESCOPED: pullback rungs off entry price stay; the concentration alert dies
  with position values), `holding_review_draft`, `forecast_resolution`, `falsifier_check`
- AUDIT: any passive contribution reminder wiring

### Sell/holding surfaces (KEEP, rescoped)
- Sell assessment stays: rules 10–13 keyed to thesis break / valuation inversion vs the CASE's IV +
  the entry-price anchor. Remove any cost-basis/return math inside it.
- Holding open/close remain explicit user-authored transitions (ticker, entry price, date — no
  amounts/shares beyond what the thesis view needs; decide: share count optional for pullback
  arithmetic? Entry price alone suffices — rungs are price-relative. DROP share counts.)

### Docs/config
- CLAUDE.md: product boundaries + verification notes rewrite (accounting/purification no longer
  first-class DOMAINS; Shariah screening remains first-class)
- README, ARCHITECTURE, STRATEGY_GUIDE, strategy doc, Learn/Strategy pages, onboarding copy
  (capital step removed), domainEventContracts RETIRED rows

## Slices (gates green per slice; one commit each)

- **S1 — Sizing/capital layer out** (the already-planned removal, now simpler): plan card, sizing
  request/panel/route, engines, investable-capital settings + projection consumers in displays.
- **S2 — Performance + accounting out**: pages, nav, projections (import-graph audited), worker
  `portfolio_valuation_refresh`, performance helpers.
- **S3 — Purification ledger out, screening stays**: page + nav + obligation/payment machinery +
  worker task; the dossier's Shariah panel keeps gate/AAOIFI/purification-rate guidance; zakat
  module goes with it (bookkeeping class).
- **S4 — Passive rework**: tracker out (page, contributions API, projection producer, plan panels);
  the new informative ETF page in (market-exposure rationale, rules 1–3 pedagogy, named
  Shariah-compliant ETFs with the educational-not-advice label).
- **S5 — Portfolio → thesis view**: holdings render as theses (entry price anchor, check-ins, sell
  advisories); holdings_monitor rescoped (pullback rungs stay, concentration alert retired); share
  counts/values dropped from open-holding input.
- **S6 — Docs/boundary rewrite + onboarding**: CLAUDE.md, README, guides, Learn/Strategy copy,
  contracts RETIRED rows, onboarding capital step removed.
- **S7 — Verification**: full gates + e2e sweep + a live dossier render check (legacy cases with
  accounting/sizing/purification events render without crashes; the audit timeline still shows
  their events) + one worker `--once --dry-run`.

## Honest costs, accepted

- The concentration alert (15% cap on real positions) dies with position values — the last
  enforcement surface of the money layer. The cap survives as pedagogy only.
- Predicted-vs-realized post-mortems lose their realized leg (needs sell values) — audit S2.
- Deleting working code: git history is the archive; a smaller true thing beats a larger half-true
  thing.
