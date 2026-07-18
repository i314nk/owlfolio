'use client'

import { createElement, useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'

import {
  buffettMungerStrategy,
} from '@owlfolio/strategies/buffettMunger'
import { SELL_PARAMS } from '@owlfolio/strategies/sellParams'
import {
  AAOIFI_DEBT_RATIO_MAX,
  AAOIFI_CASH_SECURITIES_RATIO_MAX,
  AAOIFI_IMPERMISSIBLE_INCOME_MAX,
} from '@owlfolio/strategies/shariahFinancialRatios'
import { buffettMungerDeepDiveLanes } from '@owlfolio/workflow/strategyResearchPipeline'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import { curatedRealTierModelsForProvider } from '@owlfolio/providers/modelCatalog'

// ── Live contract values (rendered, never hard-coded) ───────────────────────
const strategy = buffettMungerStrategy
const MIN_INVESTABLE_MOAT = strategy.valuation.min_investable_moat
// RELIGHTENED DECISION (R1): the deterministic required_growth_gap / band engine is RETIRED. The MODEL now
// proposes the verdict and valuation with cited reasoning; the deterministic side emits
// a flag-only sanity-check. No band/gap display constant remains. Terminal g + horizon stay uniform.
const SINGLE_GROWTH_CAP = strategy.valuation.single_growth_cap
const GDP_GROWTH_THRESHOLD = strategy.valuation.gdp_growth_threshold
const STAGE1_HORIZON = strategy.valuation.stage1_horizon
const LANE_COUNT = buffettMungerDeepDiveLanes.length
// Phase 6 sell parameters (rendered live from the versioned config, never hard-coded).
const MIN_HOLD_MONTHS = SELL_PARAMS.minimum_hold_months
const SELL_IV_FRACTION = SELL_PARAMS.sell_iv_fraction
const BETTER_OPP_MIN_MARGIN = SELL_PARAMS.better_opportunity_min_margin

function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits).replace(/\.0+$/, '')}%`
}

// ── Editorial primitives (match StrategyOverview / the Fiduciary Briefing) ────
const microLabel: CSSProperties = {
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--owl-color-gold)',
  margin: 0,
}
const bodyStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-base)',
  lineHeight: 1.55,
  margin: 0,
}
const leadStyle: CSSProperties = { ...bodyStyle, maxWidth: '52rem' }
const monoFigure: CSSProperties = {
  fontFamily: 'var(--owl-font-mono)',
  color: 'var(--owl-color-gold-vivid)',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
}
const goldText: CSSProperties = { color: 'var(--owl-color-gold-bright)', fontWeight: 700 }
const cardStyle: CSSProperties = {
  background: 'var(--owl-color-panel)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-card)',
  padding: '0.85rem 1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
}

function gold(text: ReactNode): ReactNode {
  return createElement('span', { style: goldText }, text)
}
function mono(text: ReactNode): ReactNode {
  return createElement('span', { style: monoFigure }, text)
}

type Point = { key: string; eyebrow: string; title?: string; body: ReactNode }

// A captioned card: gold mono eyebrow, optional sans heading, then a body line.
function pointCard({ key, eyebrow, title, body }: Point): ReactNode {
  return createElement(
    'article',
    { key, style: cardStyle },
    createElement('p', { style: microLabel }, eyebrow),
    title === undefined
      ? null
      : createElement('h3', { style: { fontSize: 'var(--owl-text-base)', fontWeight: 750, color: 'var(--owl-color-gold-bright)', margin: 0 } }, title),
    createElement('p', { style: bodyStyle }, body),
  )
}

function cardGrid(points: Point[], min = '240px'): ReactNode {
  return createElement(
    'div',
    { style: { display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}, 1fr))`, gap: '0.75rem' } },
    ...points.map((point) => pointCard(point)),
  )
}

// A sub-section inside a tab panel: gold mono eyebrow + sans heading + lead + content.
function PanelSection({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead?: ReactNode; children?: ReactNode }): ReactNode {
  return createElement(
    'section',
    { className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent' }, eyebrow),
    createElement('h2', { className: 'owl-section-title' }, title),
    lead === undefined ? null : createElement('p', { style: leadStyle }, lead),
    children,
  )
}

function bullets(items: ReactNode[]): ReactNode {
  return createElement(
    'ul',
    { style: { ...bodyStyle, margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' } },
    ...items.map((item, index) => createElement('li', { key: index }, item)),
  )
}

function caveat(text: ReactNode): ReactNode {
  return createElement(
    'p',
    {
      style: {
        ...bodyStyle,
        fontSize: 'var(--owl-text-sm)',
        color: 'var(--owl-color-quiet)',
        borderLeft: '2px solid var(--owl-color-border)',
        paddingLeft: '0.85rem',
        margin: 0,
      },
    },
    text,
  )
}

// ── Tab definitions ──────────────────────────────────────────────────────────
export type LearnTab = { id: string; label: string; render: () => ReactNode }

// 1 — Strategy & Valuation
function StrategyTab(): ReactNode {
  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-4)' } },
    PanelSection({
      eyebrow: 'The strategy',
      title: 'Buffett 4-Pillar — the default method',
      lead: 'Four questions, asked in order, each grounded in primary filings. The first three are quality gates — a business must pass them before its price is ever considered. The fourth computes what it is worth. The dossier renders a case pillar by pillar in exactly this frame.',
      children: cardGrid([
        { key: 'p1', eyebrow: 'Pillar 1 — Understand the business', body: 'Can we explain how it actually makes money? The understand lane grounds the model, unit economics, and accounting quality — and the circle-of-competence gate sets a case aside honestly when durable predictability cannot be argued from evidence.' },
        { key: 'p2', eyebrow: 'Pillar 2 — Moat', body: 'What stops a funded rival? The moat lane grounds which moat types hold and their direction; a below-wide moat ends the case at the moat gate before any further spend.' },
        { key: 'p3', eyebrow: 'Pillar 3 — Management', body: 'Integrity and talent, from the DEF 14A and the capital-allocation record. A grounded worst-tier judgment vetoes an unattended BUY.' },
        { key: 'p4', eyebrow: 'Pillar 4 — Value the business', body: 'A dedicated valuation pass judges growth and the exit comps; the harness computes intrinsic value and both zone thresholds deterministically. Price is the LAST question, never the first.' },
      ], '230px'),
    }),
    PanelSection({
      eyebrow: 'Buffett 4-Pillar discipline',
      title: 'Quality compounders, bought when the model’s buy-below is met and its reasoning holds',
      lead: createElement(
        'span',
        null,
        'The harness invests in a small number of understandable businesses with durable economic moats and honest management. The harness computes the intrinsic value deterministically from the filing’s free cash flow; the model contributes two cited judgments — the growth and the industry exit multiple; the human audits and decides. A candidate is investable only when its moat class is at least ',
        gold(MIN_INVESTABLE_MOAT),
        ' — narrow and moderate moats are forced to PASS before price is ever considered.',
      ),
      children: cardGrid([
        { key: 'fcf', eyebrow: 'Free cash flow', body: createElement('span', null, 'FCF = ', mono('CFO − capex'), ' — tagged XBRL facts, no maintenance-capex proxy, no assumptions. No tagged CFO → honestly unpriced (fail-closed).') },
        { key: 'gate', eyebrow: 'Wide-moat gate', body: 'Synthesis reconciles lane conflicts conservatively — lower tier, lower growth, or PASS, never an average.' },
      ]),
    }),
    PanelSection({
      eyebrow: 'Value',
      title: 'The valuation model — FCF forward ten years, an exit multiple, a margin of safety',
      lead: createElement(
        'span',
        null,
        'Intrinsic value is ',
        gold('computed, not judged'),
        ': project the filing’s free cash flow forward ',
        mono(`${STAGE1_HORIZON} years`),
        ' at the model’s cited growth, add a terminal sale at the model’s comps-anchored exit multiple (median of its own ',
        mono('named comparables'),
        ', tilted conservative), adjust for net cash, and discount everything at the flat ',
        mono(pct(VALUATION_PARAMS.required_return_default)),
        ' required return — “anything less, buy the index.” The buy threshold is ',
        gold(`IV less a ${pct(VALUATION_PARAMS.required_margin_of_safety)} margin of safety`),
        '; a ',
        gold(`${pct(VALUATION_PARAMS.load_up_margin)} discount marks the load-up zone`),
        '. Deterministic sanity rails police absurdity internally but never block. The live parameters below are read from the versioned valuation config, not hard-coded here.',
      ),
      children: createElement(
        'div',
        { style: { display: 'grid', gap: '0.75rem' } },
        // Formula block
        createElement(
          'div',
          {
            style: {
              background: 'var(--owl-color-panel-deep)',
              border: '1px solid var(--owl-color-border)',
              borderRadius: 'var(--owl-radius-card)',
              padding: '0.9rem 1rem',
              fontFamily: 'var(--owl-font-mono)',
              fontSize: 'var(--owl-text-sm)',
              color: 'var(--owl-color-gold-vivid)',
              lineHeight: 1.9,
              overflowX: 'auto',
            },
          },
          createElement('div', null, 'FCF  = cash from operations − capital expenditures   (tagged XBRL facts, T0)'),
          createElement('div', null, `g    = the model’s judged FCF growth, cited; sanity-flagged above ${pct(SINGLE_GROWTH_CAP)} (or ${pct(GDP_GROWTH_THRESHOLD)} → a moat-durability claim)`),
          createElement('div', null, `exit = the median P/FCF of the model’s NAMED comparables at year ${STAGE1_HORIZON}, tilted conservative; fallback ${VALUATION_PARAMS.exit_multiple_fallback}× when absent/absurd`),
          createElement('div', null, `IV   = Σ FCF(1+g)ᵗ/(1+r)ᵗ  +  FCF(1+g)^${STAGE1_HORIZON} × exit / (1+r)^${STAGE1_HORIZON}  +  cash − debt,  per share`),
          createElement('div', null, `buy  = IV × ${(1 - VALUATION_PARAMS.required_margin_of_safety).toFixed(2)}   ·   load-up = IV × ${(1 - VALUATION_PARAMS.load_up_margin).toFixed(2)}`),
        ),
        cardGrid([
          { key: 'r', eyebrow: 'Required return', body: createElement('span', null, 'the flat ', mono(pct(VALUATION_PARAMS.required_return_default)), ' hurdle for every business (user-settable) — no beta, no quality knob. It doubles as the active-vs-passive bar.') },
          { key: 'g', eyebrow: 'Judged growth', body: createElement('span', null, 'The model’s cited FCF growth; a sanity-check flags an unsupportable rate (above ', mono(pct(SINGLE_GROWTH_CAP)), ', or above GDP → a moat-durability claim) — it never sets the number.') },
          { key: 'exit', eyebrow: 'Exit multiple', body: createElement('span', null, 'Anchored to NAMED comparables (each industry carries its own multiples — no fixed band): the harness checks the choice against the comps’ median and falls back to a conservative ', mono(`${VALUATION_PARAMS.exit_multiple_fallback}×`), ' only when absent or absurd.') },
          { key: 'buy', eyebrow: 'Computed thresholds', body: createElement('span', null, 'Buy below = IV less the ', mono(pct(VALUATION_PARAMS.required_margin_of_safety)), ' margin; load up below the ', mono(pct(VALUATION_PARAMS.load_up_margin)), ' line. The thresholds are arithmetic — the model judges growth and the exit comps, never the price.') },
        ], '200px'),
      ),
    }),
    PanelSection({
      eyebrow: 'Admission',
      title: 'Discovery is the admission operation',
      lead: createElement(
        'span',
        null,
        'Discovery decides which businesses are even allowed into deep research — it is not a ranking screener. Two human-set boundaries bound it, and the final admit is a human decision with a written thesis.',
      ),
      children: createElement(
        'div',
        { style: { display: 'grid', gap: '0.75rem' } },
        bullets([
          createElement('span', { key: 1 }, gold('Circle of competence'), ' — the model’s grounded judgment (durable predictability), argued from fetched, content-hashed sources in the deep dive, never agent-inferred from thin air. The config screen does NOT determine competence; it sets owner-policy exclusions the harness CHECKS mechanically (a sector boundary via the EDGAR SIC code, the same discipline as the discount anchor) that only narrow the universe. It ships ', gold('permissive by default'), ' — no boundary until you narrow it.'),
          createElement('span', { key: 3 }, gold('Cheapness counts only on an already-wonderful business'), ' — price is never the entry reason. Cheapness is considered only after a business passes the quality gate; a cheap business that fails the gate is still a PASS.'),
          createElement('span', { key: 4 }, gold('Uncertainty vs permanent-loss risk'), ' — the admit judgment splits the two. An opportunity is high uncertainty + ', gold('low permanent-loss risk'), '; an independent bear case tests that the downside is uncertainty, not impairment.'),
          createElement('span', { key: 5 }, gold('Admit is human-decided'), ' — the human authors the watchlist entry with a ', gold('signed thesis in their own words'), ' (never pre-filled from the agent draft) and the frozen ', gold('computed buy-below'), ' at admit. A future re-underwrite re-anchors that buy-below visibly, never moving it silently.'),
          createElement('span', { key: 6 }, gold('The Superinvestors page feeds this funnel'), ' — /discovery monitors seven concentrated value investors\u2019 quarterly SEC 13F filings (Buffett, Pabrai, Burry, Li Lu, Klarman, Ackman, Spier): their latest portfolios, buys, and sells. Filings arrive up to 45 days late, cover long US equities only, and give no reasons — every figure is stamped with its report and filing dates, dormant filers are labeled, and a signal is an ', gold('idea to research, never a copy trade'), '.'),
        ]),
        caveat('Honest scope: the circle is permissive by default until you narrow it, the buy threshold is computed (IV × 0.70 — the human still signs off), and admit is human-decided with your own signed thesis.'),
      ),
    }),
    PanelSection({
      eyebrow: 'The verdict',
      title: 'BUY, WATCH, or PASS',
      lead: 'The model proposes the draft verdict with cited reasoning — a BUY-WINDOW draft when the price has met the computed buy threshold, WATCH while the price sits above it, and a failed quality gate forces PASS. The deterministic sanity-check flags internal absurdity (an implied growth the history cannot support, terminal-value dominance, a multiple out of bounds) but never blocks the verdict — the human audits the reasoning and decides.',
      children: caveat('Every output here is a draft. Nothing becomes a watchlist entry or a holding without an explicit, user-authored ledger transition. See the full method on the Strategy page.'),
    }),
  )
}

// 2 — The Research Swarm
function SwarmTab(): ReactNode {
  // S8 (Phase 3): the lanes ARE Buffett's pillars. Financial-quality numerics are owned by the
  // valuation stage + harness T0 blocks; the adversarial risks duty lives in the inversion pass.
  const laneDetails: Record<string, string> = {
    understand: 'Pillar 1 — how the business actually makes money: the model, unit economics, revenue/cost drivers, plus accounting quality (revenue recognition, one-offs, accruals).',
    moat: 'Pillar 2 — the moat as PROTECTION: WHICH moat types ground (each passing the replication test — what stops a funded rival from copying this?), the direction (a grounded narrowing derates a BUY), and the standout peer read. The three named tests (capital efficiency, two-engine, standout) are computed by the harness.',
    management: 'Pillar 3 — integrity (communication candor + how executives are paid, from the DEF 14A) and talent (capital allocation reconciled against harness ROIC/payout/debt observations and the retained-earnings test). A grounded worst-tier judgment vetoes an unattended BUY.',
  }
  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-4)' } },
    PanelSection({
      eyebrow: 'Division of labour',
      title: 'Agents propose, the harness computes, the human decides',
      lead: 'One principle holds the system together. LLM agents gather evidence and classify. Deterministic code does the valuation math, ratio checks, and gates. A human authors every irreversible transition. These three roles are never mixed.',
      children: caveat(
        createElement(
          'span',
          null,
          gold('The grounding invariant: '),
          'every claim a lane makes is cited to a source the harness itself fetched and content-hashed, so a verdict can be replayed against the exact documents that produced it. A citation the harness cannot find in its fetched corpus is rejected mechanically — this is the hallucination firewall. Provider readiness is not certification; lanes run only on providers configured in this local install.',
        ),
      ),
    }),
    PanelSection({
      eyebrow: 'The pipeline',
      title: 'Shariah gate → circle gate → understand + moat → MOAT GATE → management → valuation → synthesis → decision',
      lead: 'Two cheap grounded gates kill most candidates before the expensive swarm runs. Survivors run Pillars 1–2 first; the moat gate then ends a below-gate case BEFORE Pillars 3–4 spend anything (a user override can run them anyway — the verdict still gates). Synthesis reconciles the pillars; the result is a BUY / WATCH / PASS draft for a human.',
      children: bullets([
        createElement('span', { key: 1 }, gold('Front gates'), ' — the grounded Shariah sector judgment (plus the deterministic AAOIFI ratios when computable) runs first, on the harness-verified annual filing; then the circle-of-competence judgment — durable predictability, cite-verified — decides whether the deep dive is worth spending on.'),
        createElement('span', { key: 2 }, gold('Pillar lanes'), ` — ${LANE_COUNT} specialist lanes (Buffett's pillars: understand, moat, management) ground their own claims; understand + moat run first and the MOAT GATE ends a below-gate case before management/valuation spend.`),
        createElement('span', { key: 3 }, gold('Valuation judgment'), ' — a dedicated grounded stage owns the owner-earnings bridge, assumed growth, and buy-below (cite-checked); the harness computes the margin-of-safety GRADE arithmetically against a uniform required margin — the model never grades its own margin.'),
        createElement('span', { key: 5 }, gold('Synthesis'), ' — conflicts reconciled conservatively, hard gates applied, base-rate burden enforced, and the cite-checked case against the thesis weighed before any verdict.'),
        createElement('span', { key: 4 }, gold('Decision'), ' — a drafted verdict; the human authors the watchlist entry or closes the case.'),
      ]),
    }),
    PanelSection({
      eyebrow: 'The specialists',
      title: `${LANE_COUNT} grounded lanes`,
      lead: 'Each dimension runs as its own focused, grounded agent in parallel — holding the whole framework in one model call degrades quality. The lane list is read live from the workflow contract.',
      children: createElement(
        'div',
        { style: { display: 'grid', gap: '0.75rem' } },
        cardGrid(
          buffettMungerDeepDiveLanes.map((lane) => ({
            key: lane,
            eyebrow: lane,
            body: laneDetails[lane] ?? '',
          })),
        ),
        createElement(
          'p',
          { style: { ...bodyStyle, fontSize: 'var(--owl-text-sm)', color: 'var(--owl-color-quiet)' } },
          'Valuation (Pillar 4) and Shariah compliance are not parallel lanes — each runs as a dedicated focused pass: valuation judges the durable FCF growth and the comps-anchored exit multiple (the harness computes the intrinsic value and both book thresholds from them), and the Shariah pass produces the grounded compliance overlay (the harness recomputes the AAOIFI ratios from filings). The retired business_quality / financial_quality / risks lanes live on in historical dossiers; their duties moved to the understand lane, the harness T0 blocks, and the inversion pass.',
        ),
      ),
    }),
  )
}

// 3 — Sources & Grounding (the document set + the grounding architecture)
function SourcesTab(): ReactNode {
  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-4)' } },

    PanelSection({
      eyebrow: 'What the engine reads',
      title: 'The grounded document set — SEC EDGAR primary filings',
      lead: createElement('span', null,
        'Every research run stands on primary documents the harness itself fetched from SEC EDGAR — never on what a model remembers. The governing rule for every addition: ',
        createElement('span', { style: goldText }, 'Ground the text; quarantine the numbers'),
        ' — narrative documents are readable evidence; only audited ANNUAL figures ever enter the recomputed valuation.',
      ),
      children: cardGrid([
        { key: 'annual', eyebrow: 'Annual report', title: '10-K / 20-F / 40-F', body: createElement('span', null, 'The primary annual filing (foreign filers included — a 20-F grounds like a 10-K). Its XBRL numbers (~11 years) anchor the owner-earnings bridge, ROIC, and the Shariah ratios; its text is readable by Item — ', mono('read_source(id, section="1A")'), ' for Risk Factors, Item 1 Business, Item 7 MD&A.') },
        { key: 'interim', eyebrow: 'Interim recency', title: '8-K / 10-Q / 6-K narrative', body: 'Material events and quarterly narrative filed SINCE the latest annual report — where thesis-breaks first surface (impairments, guidance cuts, executive departures, M&A, litigation). Read as text by the qualitative lanes; interim NUMBERS never enter the valuation recompute.' },
        { key: 'proxy', eyebrow: 'Incentives & governance', title: 'DEF 14A proxy statement', body: 'The definitive annual proxy — executive compensation structure, incentive alignment, insider ownership, board independence, dual-class/entrenchment provisions. Read by the management and moat lanes; supplements and third-party solicitations are excluded.' },
        { key: 'market', eyebrow: 'Market data', title: 'Price & market cap', body: 'Current price and the trailing 36-month average market cap come from live market data — the only non-EDGAR inputs. Used for the reverse-DCF lens and the Shariah balance-sheet ratios; EDGAR remains the source of truth for every fundamental.' },
      ]),
    }),

    PanelSection({
      eyebrow: 'How a source becomes citable',
      title: 'The model may propose; only the harness verifies',
      lead: 'Retrieval never happens inside the model. Whether a source is harness-discovered (the filing index) or model-proposed (a URL in its output), the same pipeline decides whether it can ever be cited.',
      children: bullets([
        createElement('span', null, createElement('span', { style: goldText }, 'Fetch + guard'), ' — the harness performs the HTTP fetch itself behind an SSRF guard (public hosts only, re-checked on every redirect hop).'),
        createElement('span', null, createElement('span', { style: goldText }, 'Hash + ledger'), ' — the fetched bytes are SHA-256 content-hashed and recorded in the source ledger; the hash is what a citation is later checked against, so a claim can only cite bytes the harness actually captured.'),
        createElement('span', null, createElement('span', { style: goldText }, 'Lane whitelist'), ' — each lane admits only its allowed source categories (the classification lanes: primary documents only; management adds proxies and insider data; the Shariah pass adds screening providers). A rejected source is recorded, never silently dropped.'),
        createElement('span', null, createElement('span', { style: goldText }, 'Verified reads'), ' — ', mono('read_source'), ' returns a document section only after re-verifying its content hash; a mismatch makes the source uncitable rather than serving stale or wrong bytes.'),
        createElement('span', null, createElement('span', { style: goldText }, 'Fail closed'), ' — anything that cannot be fetched, hashed, or verified is simply absent: the lane runs on what grounded and flags the gap. Missing evidence is a visible hole, never a fabricated citation.'),
      ]),
    }),

    PanelSection({
      eyebrow: 'Durable memory',
      title: 'Auditable forever — pointers and hashes, re-verified on demand',
      lead: 'The source ledger persists what each decision stood on: for every source, its URL, content hash, filing form, and filed date — never the document text.',
      children: bullets([
        createElement('span', null, 'EDGAR Archives URLs are ', createElement('span', { style: goldText }, 'immutable'), ' — a filing at its accession URL never changes. So any future reader (or a re-review) can ', createElement('span', { style: goldText }, 're-fetch'), ' the URL, hash-match against the ledger, and read exactly what the original decision was grounded on.'),
        'A tampered or drifted document fails the hash check and becomes uncitable — the audit trail cannot be silently rewritten.',
        'Comparing freshly-discovered filings against the persisted ledger yields the "what is new since the decision" delta — the substrate for thesis re-reviews.',
      ]),
    }),
  )
}

// 4 — Judgment Objectivity
function JudgmentTab(): ReactNode {
  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-4)' } },
    PanelSection({
      eyebrow: 'Grounded judgment, not a scoring machine',
      title: 'The model judges; grounding and an adversarial pass keep it honest',
      lead: 'The frontier model makes the judgments — circle, moat, runway, growth, the verdict. What makes a judgment trustworthy is not a rubric that scores it into a tier; it is that every claim is grounded in a fetched, content-hashed source and survives an adversarial bear case. The model abstains and flags rather than fabricating. Determinism corroborates and sanity-checks; it never sets or bounds the judgment.',
      children: cardGrid([
        { key: 'thesis', eyebrow: 'Cite-verified theses', title: 'Claims, not scores', body: 'Circle, moat, and runway are grounded, cite-verified theses — each claim cited to a source the harness fetched and content-hashed. There is no per-row rubric, no M1–M6, no total-score-to-tier map.' },
        { key: 'anchor', eyebrow: 'Quant corroborates', title: 'The numbers only confirm', body: 'A quant anchor read straight from the filings (ROIC, reinvestment, leverage) corroborates the thesis — but it does not set the tier or bound it. The model’s grounded argument is the judgment; the numbers either back it up or expose a contradiction.' },
        { key: 'baserate', eyebrow: 'Base rates', title: 'The outside view', body: 'Any claim that beats a base rate must carry a structural exceptionality argument cited to evidence — inside-view narrative like "strong execution" does not meet the burden. An unmet burden is flagged on the verdict for the human, never silently passed.' },
        { key: 'inversion', eyebrow: 'Inversion pass', title: 'Invert, always invert', body: 'Before synthesis, one adversarial agent — ideally on a different model — argues the case against itself. The strongest cite-checked objection (and the consensus read) is weighed by the synthesis and rendered on the dossier as the case against.' },
        { key: 'failclosed', eyebrow: 'Fail closed', title: 'Abstain, never fabricate', body: 'A claim the harness cannot tie to a fetched source is rejected mechanically — the lane abstains and flags the gap rather than inventing support. Missing evidence becomes a visible hole, never a confident guess.' },
        { key: 'sources', eyebrow: 'Source discipline', title: 'Primary documents only', body: 'Judgment-heavy lanes read primary documents only — filings and regulatory data. Sell-side research and financial media are excluded so the model cannot return the consensus dressed as analysis.' },
        { key: 'ksample', eyebrow: 'Agreement sampling', title: 'One judgment never decides the spend', body: 'The circle-of-competence gate is sampled multiple times per run and the deep dive is entered only on a unanimous in-competence vote, with each sample required to meet a grounded evidence floor (minimum cite-verified cashflow drivers and predictability breakers). A single flipped judgment sets the case aside — recorded, never silent. Sample count and floors are tunable in Settings.' },
      ]),
    }),
    caveat(
      'This layer makes judgment grounded, adversarially tested, and honest about what it cannot support — it does not manufacture a contrarian edge. A judgment that merely restates the consensus earns roughly market returns; grounding and the bear-case pass are simply how you find out whether the model’s view genuinely diverged from the market and was right.',
    ),
  )
}

// 4 — Lifecycle
function LifecycleTab(): ReactNode {
  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-4)' } },
    PanelSection({
      eyebrow: 'One list, one lifecycle',
      title: 'Candidate → watched → held → exited',
      lead: createElement(
        'span',
        null,
        'There is ONE list of names, and every name sits in exactly one lifecycle state: ',
        gold('CANDIDATE'),
        ' → ',
        gold('WATCHED'),
        ' → ',
        gold('HELD'),
        ' → ',
        gold('EXITED'),
        '. A name becomes a candidate from discovery + research, advances to watched on a user-confirmed watchlist entry, becomes held on an explicit open-holding entry, and is exited when no live entity remains. Every transition is append-only and timestamped, and ',
        gold('every irreversible transition is human-authored'),
        ' — the agent never trades and never moves a name between states. Research, watchlist, and portfolio each render their slice of this one list.',
      ),
      children: bullets([
        createElement('span', { key: 1 }, gold('Candidate'), ' — discovery (screen sweeps, spin-offs, user tickers, 13F / owner-operator cloning) plus the front gates; the Shariah sector exclusion is applied before a candidate even enters the ledger, and most names die cheaply here.'),
        createElement('span', { key: 2 }, gold('Watched & held'), ' — entered only by an explicit human ledger entry; a holding records an already-executed trade. Position sizing is deliberately out of scope by the scale-down: the size is yours, and your entry price is the one manual field the system keeps.'),
        createElement('span', { key: 3 }, gold('Exited — two opposite meanings'), ' — an exit is either SOLD (a closed holding) or SCREENED OUT (research rejected / pass). The Lifecycle page shows which, because they mean opposite things; a name that comes back live keeps its prior-exit history.'),
      ]),
    }),
    PanelSection({
      eyebrow: 'One cadence engine',
      title: 'One falsifier check + re-underwrite — detection is state-independent, the action branches on state',
      lead: createElement(
        'span',
        null,
        'There are not separate watchlist and holdings monitors. ',
        gold('One cadence engine'),
        ' runs the same falsifier check and re-underwrite across the whole list — the detection logic does not depend on which state a name is in. What differs is the ',
        gold('action'),
        ' the engine can take, which branches on state. The worker is dry-run and mock-safe for this alpha: it observes and drafts, it never executes.',
      ),
      children: createElement(
        'div',
        { style: { display: 'grid', gap: 'var(--owl-space-3)' } },
        cardGrid([
          { key: 'buy', eyebrow: 'Buy-window (watched)', body: 'A BUY-WINDOW observation is valid only on a fresh, gate-clean case. Stale cheapness is suppressed and forces a re-run first.' },
          { key: 'tranche', eyebrow: 'Pullback review (held)', body: 'A price 10% or 20% below your entry triggers a thesis re-check first, then an alert (the worker\u2019s own review rungs) — never mechanical averaging-down.' },
          { key: 'conc', eyebrow: 'Concentration (held)', body: 'A held position that APPRECIATES past the concentration-review threshold raises a review-on-appreciation alert. Winners run — an alert is never an auto-trim, and nothing here executes or blocks a buy (the harness never trades).' },
          { key: 'shariah', eyebrow: 'Shariah grace (any live state)', body: 'A ratio breach opens a grace period (default 90 days); if unresolved, the harness drafts a DIVEST-REQUIRED — the human authors the exit.' },
          { key: 'rereview', eyebrow: 'Check-in (any decided name; quarterly rhythm)', body: 'The filings that appeared SINCE a decision (weighted by 8-K item code — impairments and executive departures are strong signals, routine earnings announcements are not) are grounded and compared against the recorded thesis and its break triggers. The output is a DIFF, never a fresh verdict: INTACT, WEAKENED, BROKEN — or honestly INCONCLUSIVE / UNVERIFIED when the evidence cannot support a call. A BROKEN thesis on a held name escalates a full re-run DRAFT; you launch it from the dossier, watchlist, or portfolio, or via a worker tick.' },
        ]),
        caveat(
          createElement(
            'span',
            null,
            gold('The action is yours: '),
            'when the falsifier trips on a WATCHED name, the engine flags it as deteriorating — and stops there. The watchlist row carries the human-authored ',
            gold('Remove from watchlist'),
            ' (a recorded prune, with your reason); the engine itself never prunes a name. A deteriorating watched name never looks healthy, and it never disappears without your signature.',
          ),
        ),
      ),
    }),
    PanelSection({
      eyebrow: 'Sell discipline',
      title: 'A sell needs a reason — price is an input, never a cause',
      lead: createElement(
        'span',
        null,
        'A HELD name gets an advisory ',
        gold('sell decision'),
        ' on-demand — worst-case first, then a verdict. It is bounded by the recommendation and never trades: ',
        gold('the close is human-authored'),
        ', and there is no auto-sell. A sale needs one of four real reasons; a falling price alone is never one of them.',
      ),
      children: createElement(
        'div',
        { style: { display: 'grid', gap: 'var(--owl-space-3)' } },
        cardGrid([
          { key: 'thesis', eyebrow: 'Thesis broke', body: 'The durable advantage or the original bet no longer holds — the reason you bought is gone.' },
          { key: 'inverted', eyebrow: 'Valuation inverted', body: createElement('span', null, 'Price reached the frozen intrinsic value. The Pabrai recant: do NOT sell winners at 90–95% of IV — this fires only at/above ', mono(pct(SELL_IV_FRACTION)), ' of the sign-off-frozen IV (a hard threshold, biased to hold below it).') },
          { key: 'better', eyebrow: 'Better opportunity', body: createElement('span', null, 'A materially higher net owner-earnings yield — at least ', mono(pct(BETTER_OPP_MIN_MARGIN, 1)), ' after switching friction — and it ALSO always needs human sign-off.') },
          { key: 'mistake', eyebrow: 'Original mistake', body: 'The underwriting was wrong from the start — admit it and exit, rather than anchor to the entry price.' },
        ], '220px'),
        bullets([
          createElement('span', { key: 1 }, gold('No stop-loss'), ' — price is an INPUT to "are we at a loss?", never the CAUSE of a sale. The harness never sells just because a quote fell.'),
          createElement('span', { key: 2 }, gold('The minimum-hold guard consumes the fixable-vs-permanent judgment'), ' — it is NOT a clock. A trigger inside the ~', mono(`${MIN_HOLD_MONTHS}-month`), ' window is held only when the problem is judged ', gold('fixable / temporary'), '; a ', gold('permanent impairment'), ' releases a sell review even inside the window. When the judgment is ', gold('unresolved'), ', the decision escalates to ', gold('human review'), ' rather than defaulting either way.'),
          createElement('span', { key: 3 }, gold('Guard-held is the correct posture'), ' — when the guard holds a fixable problem, that is the disposition brake working as designed, surfaced as a positive state, not a warning.'),
          createElement('span', { key: 4 }, gold('Bias guards (advisory)'), ' — disposition (holding to avoid realizing a loss) and anchoring (fixating on the entry price) are surfaced as advisory caveats; they never block or change the decision.'),
        ]),
        caveat('Honest scope: the sell decision is advisory and bounded by the recommendation — it leads with the concrete worst case (downside floor + its basis = a reliability signal), runs the four triggers + the minimum-hold guard + the bias guards, and stops there. The exit itself is always authored and signed by you; the harness never closes a holding.'),
      ),
    }),
    PanelSection({
      eyebrow: 'Learning loop',
      title: 'Post-mortems and calibration',
      lead: 'Every exited position gets a post-mortem — thesis versus outcome, which lane was most wrong, whether the gates and the model’s buy-below reasoning held. Those live in the append-only ledger. The system learns through its parameters, never through loosened judgment.',
    }),
  )
}

// 5 — Shariah by Design
function ShariahTab(): ReactNode {
  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-4)' } },
    PanelSection({
      eyebrow: 'Enforced along the pipeline',
      title: 'Shariah is a property, not a single lane',
      lead: 'Shariah compliance is enforced across discovery exclusion, the front Shariah gate, the deep-dive reasoning pass, holdings ratio monitoring, and exit rules. A FAIL stops the case outright and is never price-overridable. The dossier states the purification RATE as guidance; Owner’s Manual keeps no payment books.',
      children: cardGrid([
        { key: 'sector', eyebrow: 'Sector screen', body: createElement('span', null, 'Segment-level revenue check; more than ', mono('5%'), ' impermissible core revenue screens the name out before any valuation is attempted.') },
        { key: 'debt', eyebrow: 'Debt ratio', body: createElement('span', null, 'Interest-bearing debt / market cap (36-mo avg) below ', mono(pct(AAOIFI_DEBT_RATIO_MAX)), ', computed by the harness from primary filings.') },
        { key: 'cash', eyebrow: 'Cash ratio', body: createElement('span', null, 'Cash + interest-bearing securities / market cap below ', mono(pct(AAOIFI_CASH_SECURITIES_RATIO_MAX)), '.') },
        { key: 'income', eyebrow: 'Impermissible income', body: createElement('span', null, 'Impermissible income / revenue below ', mono(pct(AAOIFI_IMPERMISSIBLE_INCOME_MAX)), '; the remainder sets the purification percentage.') },
      ]),
    }),
    PanelSection({
      eyebrow: 'The screening toggle',
      title: 'Opt-out, never silent — OFF is fail-visible',
      lead: createElement(
        'span',
        null,
        'Screening is an opt-out (',
        gold('Settings → Shariah screening'),
        ', default ON). Turning it OFF is never a fake pass: gates record explicit ',
        gold('DISABLED'),
        ' decisions in the ledger, boards show ',
        gold('GATE OFF'),
        ' chips, Shariah provider spend and the quarterly re-screen stop, and the purification surfaces hide. Turn it back ON and the next runs screen again — the OFF period stays honestly visible in the record.',
      ),
    }),
    PanelSection({
      eyebrow: 'Purification guidance',
      title: 'The rate is computed; the books are yours',
      lead: 'SCALE-DOWN (2026-07): Owner’s Manual computes the purification RATE from grounded filings and states it on the dossier — it deliberately keeps no obligation/payment books, because their inputs (your actual dividends and payments) are unverifiable by design.',
      children: bullets([
        createElement('span', { key: 1 }, gold('The rate'), ' — purification due = dividend × the computed purification % (from the harness-recomputed AAOIFI impermissible-income read). Stated on every CONDITIONAL dossier.'),
        createElement('span', { key: 2 }, gold('The discipline'), ' — track and pay it yourself (a spreadsheet does this honestly); confidently wrong purification amounts from stale inputs are worse than none.'),
      ]),
    }),
    caveat(
      'These screens and the purification rate are a local screening aid — not a fatwa, not a professional Shariah ruling, and not tax advice. Material ambiguity should be taken to a qualified Shariah adviser.',
    ),
  )
}

// Recommended models per tier, rendered LIVE from the curated OpenRouter catalog (never hard-coded here) so
// the Learn copy stays in sync as the owner curates the shortlist. Grouped T1 → T2 → T3.
const TIER_HEADINGS: Record<'T1' | 'T2' | 'T3', string> = {
  T1: 'T1 — Frontier (synthesis, moat/Shariah)',
  T2: 'T2 — Mid (inversion)',
  T3: 'T3 — Cheap / high-volume (monitors, entity resolution)',
}

function recommendedModelsByTier(): ReactNode {
  const curated = curatedRealTierModelsForProvider('openrouter')
  return cardGrid((['T1', 'T2', 'T3'] as const).map((tier) => {
    const models = curated.filter((model) => model.tier_suitability.includes(tier))
    return {
      key: tier,
      eyebrow: TIER_HEADINGS[tier],
      body: createElement(
        'span',
        null,
        ...models.flatMap((model, index) => [
          index === 0 ? null : createElement('br', { key: `br-${model.model_id}` }),
          mono(model.model_id),
        ]),
      ),
    }
  }), '260px')
}

// 6 — Model Tiering & Trust
function TieringTab(): ReactNode {
  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-4)' } },
    PanelSection({
      eyebrow: 'Models are config, not code',
      title: 'Four tiers — and one rule above all',
      lead: createElement(
        'span',
        null,
        'The harness must invest the same way regardless of which model is plugged in, so quality is verified by the harness, not assumed from the provider. The one rule above all: ',
        gold('if it can be computed, compute it.'),
      ),
      children: cardGrid([
        { key: 't1', eyebrow: 'T1 — Frontier', body: 'Synthesis and the highest-stakes lanes (moat, Shariah). Long-context reasoning and disciplined citation; errors here poison verdicts.' },
        { key: 't2', eyebrow: 'T2 — Mid', body: 'The Munger inversion pass and verdict-draft writing. Its output is always reconciled by a T1 synthesis.' },
        { key: 't3', eyebrow: 'T3 — Cheap / local', body: 'High-volume, low-judgment work: news and filing scans, trigger detection, entity resolution. Near-zero marginal cost.' },
        { key: 't0', eyebrow: 'T0 — No model, ever', body: 'Valuation math, Shariah ratios, the purification rate, 13F/EDGAR parsing. Deterministic by constitution.' },
      ]),
    }),
    PanelSection({
      eyebrow: 'Choosing a model',
      title: 'Pick a reasoning model the harness can drive — the choice is yours',
      lead: createElement(
        'span',
        null,
        'The OpenRouter picker searches the ',
        gold('full live catalog'),
        ', filtered to ',
        gold('reasoning models the harness can actually drive'),
        ' — reasoning plus function tool-calling (for the grounded loop) plus structured JSON output (for synthesis). Non-reasoning models, and models missing tools or structured output, are filtered out because they would only ever fail a run. Beyond that hard floor, ',
        gold('the responsibility is yours'),
        ': certification is a deeper, optional audit (it proves a specific model honors grounding + the security invariants), not a prerequisite for use — you can point the harness at any capable reasoning model and it runs experimental until you decide it fits the job. Weaker models degrade into visible retries and failed runs, never silent verdict poisoning.',
      ),
      children: createElement(
        'div',
        { style: { display: 'grid', gap: 'var(--owl-space-3)' } },
        createElement('p', { style: microLabel }, 'Recommended for the job (curated, by tier)'),
        recommendedModelsByTier(),
        caveat('These are hand-picked reasoning models that clear the harness floor and suit each tier — read live from the curated catalog, so they stay current. They are recommendations, not a lock: any reasoning model in the picker is selectable, and the T3 tier can run a cheaper/local model to keep high-volume scanning near-free.'),
      ),
    }),
    PanelSection({
      eyebrow: 'Trust defenses',
      title: 'What makes the harness model-agnostic',
      lead: 'These run on every lane output regardless of which model produced it, so a weaker model degrades into visible retries and failed runs — never silent verdict poisoning.',
      children: bullets([
        createElement('span', { key: 1 }, gold('Model registry'), ' — every model is one line of config; pipeline logic never hard-codes a model name.'),
        createElement('span', { key: 2 }, gold('Schema validation + retry'), ' — output is validated against the lane schema; two failures mark the run FAILED rather than passing it through.'),
        createElement('span', { key: 3 }, gold('Citation verification'), ' — every claim must cite a harness-fetched, content-hashed source.'),
        createElement('span', { key: 4 }, gold('Range / sanity checks'), ' — code rejects impossible numbers (inc-ROIC over 100%, maintenance capex above revenue).'),
        createElement('span', { key: 5 }, gold('Certification scenarios'), ' — an optional deeper audit: a target-specific certification report records what a model proved (grounding + the security invariants). Until one exists the model runs experimental and the choice is yours — verified when audited, never assumed.'),
        createElement('span', { key: 6 }, gold('Dual-model cross-check'), ' — for moat class and Shariah status only, the lane runs twice on two models; disagreement escalates to a human and the conservative answer holds.'),
      ]),
    }),
    caveat(
      'Specific model names live in the registry and will go stale; the registry plus the qualification eval are what stay true. Provider support in this local alpha is bounded by the certification reports — readiness is not certification, and no provider is described as live or certified beyond what a target-specific report records.',
    ),
    caveat(
      'Honest status: the tiered setup itself has not been exercised end-to-end yet — live testing so far ran through OpenRouter with a single routed model, and the other providers remain experimental and largely unexercised. Treat tier routing as design intent, not proven behavior, until a multi-tier run is recorded.',
    ),
  )
}

// A terminal command block: monospace, deep panel, gold text — matches the valuation formula block styling.
function commandBlock(lines: ReactNode[]): ReactNode {
  return createElement(
    'div',
    {
      style: {
        background: 'var(--owl-color-panel-deep)',
        border: '1px solid var(--owl-color-border)',
        borderRadius: 'var(--owl-radius-card)',
        padding: '0.9rem 1rem',
        fontFamily: 'var(--owl-font-mono)',
        fontSize: 'var(--owl-text-sm)',
        color: 'var(--owl-color-gold-vivid)',
        lineHeight: 1.9,
        overflowX: 'auto',
      },
    },
    ...lines.map((line, index) => createElement('div', { key: index }, line)),
  )
}

// 7 — The CLI
function CliTab(): ReactNode {
  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-4)' } },
    PanelSection({
      eyebrow: 'Developer & admin operations',
      title: 'The CLI — onboarding, status, and diagnostics from the terminal',
      lead: createElement(
        'span',
        null,
        'The web app is the primary product surface; the CLI is for ',
        gold('developer and admin operations'),
        ' against the ',
        gold('same local config, env file, and ledger'),
        '. It launches the app, reports readiness, and diagnoses setup — it ',
        gold('never trades, never authors a decision, and never moves a name between lifecycle states'),
        '. Those remain web + human-authored.',
      ),
      children: createElement(
        'div',
        { style: { display: 'grid', gap: 'var(--owl-space-3)' } },
        createElement('p', { style: microLabel }, 'Run it — owners-manual (owlfolio remains a compat alias)'),
        commandBlock([
          createElement('span', null, 'owners-manual ', gold('<command>'), '     # e.g.  owners-manual doctor'),
          createElement('span', null, './owners-manual ', gold('<command>'), '   # from the repo root, no setup'),
          createElement('span', null, 'owlfolio ', gold('<command>'), '          # the compat alias — same CLI'),
          createElement('span', null, 'corepack pnpm owlfolio ', gold('<command>'), '  # zero-setup alternative'),
        ]),
        createElement('p', { style: { ...bodyStyle, fontSize: 'var(--owl-text-sm)' } }, createElement(
          'span',
          null,
          'To call ',
          mono('owners-manual'),
          ' from anywhere, put the repo-root launcher on your PATH once — symlink it (',
          mono('ln -s "$PWD/owners-manual" ~/.local/bin/owners-manual'),
          '), add a shell alias, or run ',
          mono('corepack pnpm link --global'),
          ' from the repo root.',
        )),
      ),
    }),
    PanelSection({
      eyebrow: 'Commands',
      title: 'Three commands — launch, inspect, diagnose',
      lead: createElement(
        'span',
        null,
        'The CLI is deliberately small. Onboarding — mode, provider, API keys, model — all lives in the ',
        gold('browser'),
        ' (it is the same shared surface, so nothing can drift), so the CLI keeps only what the browser cannot do from a terminal.',
      ),
      children: cardGrid([
        { key: 'start', eyebrow: 'start', body: createElement('span', null, 'Launch the web app and open the browser to ', mono('127.0.0.1:3000'), ' — the single entrypoint. All setup happens there.') },
        { key: 'status', eyebrow: 'status', body: 'Read-only: the current mode, provider/model, readiness, and the onboarding gate. Headless-safe — never prompts.' },
        { key: 'doctor', eyebrow: 'doctor', body: 'Diagnose config, the credential file (+ 0600 permissions), the ledger, and certification state — the first thing to run when something looks off.' },
      ], '240px'),
    }),
    PanelSection({
      eyebrow: 'Runtime overrides',
      title: 'Point the CLI at a specific workspace',
      lead: 'The CLI honors the same environment overrides as the web app and worker, so you can run it against an isolated project directory (a sandbox) instead of the default.',
      children: createElement(
        'div',
        { style: { display: 'grid', gap: 'var(--owl-space-3)' } },
        commandBlock([
          createElement('span', null, gold('OWLFOLIO_PROJECT_DIR'), '        # workspace root (config, env file, ledger live under it)'),
          createElement('span', null, gold('OWLFOLIO_APP_CONFIG_PATH'), '     # explicit app-config.json path'),
          createElement('span', null, gold('OWLFOLIO_ENV_FILE'), '            # the local key store (never committed)'),
          createElement('span', null, gold('OWLFOLIO_PERSONAL_LEDGER_PATH'), ' # the personal-local SQLite ledger'),
        ]),
        caveat('The CLI is read-and-diagnose by constitution: it launches the app, reports readiness, and inspects config, credential presence, and the ledger — it writes nothing and never executes an investment action, confirms a watchlist entry, or opens a holding. Every irreversible transition is authored by a human in the web workflow.'),
      ),
    }),
  )
}

export const LEARN_TABS: LearnTab[] = [
  { id: 'strategy', label: 'Strategy & Valuation', render: StrategyTab },
  { id: 'swarm', label: 'The Research Swarm', render: SwarmTab },
  { id: 'sources', label: 'Sources & Grounding', render: SourcesTab },
  { id: 'judgment', label: 'Judgment Objectivity', render: JudgmentTab },
  { id: 'lifecycle', label: 'Lifecycle', render: LifecycleTab },
  { id: 'shariah', label: 'Shariah by Design', render: ShariahTab },
  { id: 'tiering', label: 'Model Tiering & Trust', render: TieringTab },
  { id: 'cli', label: 'The CLI', render: CliTab },
]

/** Pure keyboard-nav helper: returns the next active index for a roving tablist. */
export function nextTabIndex(current: number, key: string, count: number): number {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return current
  }
}

export type LearnTabsProps = { initialTabId?: string }

export function LearnTabs({ initialTabId }: LearnTabsProps): ReactNode {
  const startIndex = Math.max(
    0,
    LEARN_TABS.findIndex((tab) => tab.id === initialTabId),
  )
  const [active, setActive] = useState(startIndex)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const next = nextTabIndex(index, event.key, LEARN_TABS.length)
      if (next !== index || event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        setActive(next)
        tabRefs.current[next]?.focus()
      }
    },
    [],
  )

  return createElement(
    'div',
    { className: 'owl-learn-tabs', style: { display: 'grid', gap: 'var(--owl-space-4)' } },
    createElement(
      'div',
      { role: 'tablist', 'aria-label': 'Investment research harness specifications', className: 'owl-learn-tablist' },
      ...LEARN_TABS.map((tab, index) => {
        const selected = index === active
        return createElement(
          'button',
          {
            key: tab.id,
            type: 'button',
            role: 'tab',
            id: `learn-tab-${tab.id}`,
            'aria-selected': selected ? 'true' : 'false',
            'aria-controls': `learn-panel-${tab.id}`,
            tabIndex: selected ? 0 : -1,
            className: `owl-learn-tab owl-focusable${selected ? ' owl-learn-tab-active' : ''}`,
            ref: (node: HTMLButtonElement | null) => {
              tabRefs.current[index] = node
            },
            onClick: () => setActive(index),
            onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => onKeyDown(event, index),
          },
          tab.label,
        )
      }),
    ),
    ...LEARN_TABS.map((tab, index) =>
      createElement(
        'div',
        {
          key: tab.id,
          role: 'tabpanel',
          id: `learn-panel-${tab.id}`,
          'aria-labelledby': `learn-tab-${tab.id}`,
          tabIndex: 0,
          hidden: index !== active,
          className: 'owl-learn-panel owl-focusable',
        },
        index === active ? tab.render() : null,
      ),
    ),
  )
}
