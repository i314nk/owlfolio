'use client'

import { createElement, useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'

import {
  buffettMungerStrategy,
  discountRate,
  marginOfSafetyForMoat,
  terminalGrowthForMoat,
} from '@owlfolio/strategies/buffettMunger'
import { SELL_PARAMS } from '@owlfolio/strategies/sellParams'
import {
  AAOIFI_DEBT_RATIO_MAX,
  AAOIFI_CASH_SECURITIES_RATIO_MAX,
  AAOIFI_IMPERMISSIBLE_INCOME_MAX,
} from '@owlfolio/strategies/shariahFinancialRatios'
import { CHECKLIST_PARAMS, type ChecklistCategory } from '@owlfolio/strategies/checklistParams'
import { buffettMungerDeepDiveLanes } from '@owlfolio/workflow/strategyResearchPipeline'

// ── Live contract values (rendered, never hard-coded) ───────────────────────
const strategy = buffettMungerStrategy
const DISCOUNT = discountRate(strategy)
const MULTIPLE_CEILING = strategy.valuation.valuation_multiple_ceiling
const MIN_INVESTABLE_MOAT = strategy.valuation.min_investable_moat
// F.13 — base MoS, terminal g, and stage-1 horizon are UNIFORM across investable moats; one value each.
const MOS_WIDE = marginOfSafetyForMoat(strategy, 'wide')
const TERMINAL_G_WIDE = terminalGrowthForMoat(strategy, 'wide')
const SINGLE_GROWTH_CAP = strategy.valuation.single_growth_cap
const GDP_GROWTH_THRESHOLD = strategy.valuation.gdp_growth_threshold
const STAGE1_HORIZON = strategy.valuation.stage1_horizon
const GROWTH_FADE_YEARS = strategy.valuation.growth_fade_years
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
      eyebrow: 'Buffett-Munger discipline',
      title: 'Quality compounders, bought with a margin of safety',
      lead: createElement(
        'span',
        null,
        'The harness invests in a small number of understandable businesses with durable economic moats and honest management, and only when the price offers a buffer against a conservative estimate of intrinsic value. A candidate is investable only when its moat class is at least ',
        gold(MIN_INVESTABLE_MOAT),
        ' — narrow and moderate moats are forced to PASS before price is ever considered.',
      ),
      children: cardGrid([
        { key: 'oe', eyebrow: 'Owner earnings', body: createElement('span', null, 'OE = ', mono('NI + D&A − maintenance capex − SBC − ΔNWC'), '. SBC is a real expense; the harness never models dilution on top of it.') },
        { key: 'gate', eyebrow: 'Wide-moat gate', body: 'Synthesis reconciles lane conflicts conservatively — lower tier, lower growth, or PASS, never an average.' },
      ]),
    }),
    PanelSection({
      eyebrow: 'Value',
      title: 'The two-stage discounted owner-earnings model',
      lead: createElement(
        'span',
        null,
        'Owner earnings are discounted in two stages: a stage-1 horizon whose growth holds the credited rate for the early years then fades LINEARLY down to a small terminal rate over the trailing years (it does not compound flat — forecasting humility inside the explicit window), and a perpetual terminal rate beyond it. The discount is a flat ',
        mono(pct(DISCOUNT)),
        ' — no WACC, no beta, ever. Business quality is not a valuation-loosening lever: the discount, the base margin of safety, the horizon, and the terminal rate are all uniform across investable moats. A monopoly is a durability signal — it earns higher terminal value through the moat-durability input, not by lowering the safety margin or stretching the horizon. The live parameters below are read from the versioned valuation config, not hard-coded here.',
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
          createElement('div', null, `g    = honest demonstrated owner-earnings/share CAGR, capped at ${pct(SINGLE_GROWTH_CAP)} (named humility backstop); above ${pct(GDP_GROWTH_THRESHOLD)} → moat-durability flag`),
          createElement('div', null, `stage 1 = ${STAGE1_HORIZON} yrs; g holds, then fades LINEARLY to gₜ over the trailing ${GROWTH_FADE_YEARS} yrs (uniform for every investable moat)`),
          createElement('div', null, `gₜ   = terminal rate: ${pct(TERMINAL_G_WIDE)} (uniform; the fade lands here by year ${STAGE1_HORIZON})`),
          createElement('div', null, `fair > ${MULTIPLE_CEILING}× OE → surfaced cap_exceeded sanity flag (not a silent truncation)`),
          createElement('div', null, `buy  = fair × (1 − MOS)   ·  the ONE conservatism knob: ${pct(MOS_WIDE)} base for every investable moat (widens with documented uncertainty)`),
        ),
        cardGrid([
          { key: 'd', eyebrow: 'Flat discount', body: createElement('span', null, mono(pct(DISCOUNT)), ' hurdle, always — falling rates never lower it.') },
          { key: 'g', eyebrow: 'Honest growth', body: createElement('span', null, 'The demonstrated OE/share CAGR, ', mono(pct(SINGLE_GROWTH_CAP)), ' humility cap; above-GDP is a moat-durability claim.') },
          { key: 'cap', eyebrow: 'Sanity flag', body: createElement('span', null, mono(`${MULTIPLE_CEILING}×`), ' owner earnings raises a cap_exceeded flag — surfaced, never silently truncated.') },
          { key: 'mos', eyebrow: 'Margin of safety', body: createElement('span', null, mono(pct(MOS_WIDE)), ' base for every investable moat — uniform, then widens with documented uncertainty. A monopoly is a durability signal, not a smaller buffer.') },
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
          createElement('span', { key: 1 }, gold('Circle of competence'), ' — human-set config the harness CHECKS, never agent-inferred. You configure the sector boundary; the harness checks it mechanically (sector via the EDGAR SIC code), the same discipline as the discount anchor. It ships ', gold('permissive by default'), ' — no boundary until you narrow it.'),
          createElement('span', { key: 2 }, gold('Size'), ' — the Pabrai Principle 5 axis, ', gold('deferred'), '. A size boundary favouring small, under-followed names is part of the model but shipped permissive; it does not yet constrain admission.'),
          createElement('span', { key: 3 }, gold('Cheapness counts only on an already-wonderful business'), ' — price is never the entry reason. Cheapness is considered only after a business passes the quality gate; a cheap business that fails the gate is still a PASS.'),
          createElement('span', { key: 4 }, gold('Uncertainty vs permanent-loss risk'), ' — the admit judgment splits the two. An opportunity is high uncertainty + ', gold('low permanent-loss risk'), '; an independent bear case tests that the downside is uncertainty, not impairment.'),
          createElement('span', { key: 5 }, gold('Admit is human-decided'), ' — the human authors the watchlist entry with a ', gold('signed thesis in their own words'), ' (never pre-filled from the agent draft) and a locked buy-below frozen at admit. That buy-below is provisional-MoS-derived — a future MoS freeze will visibly re-price it, never move it silently.'),
        ]),
        caveat('Honest scope: the circle is permissive by default, the size axis is deferred, the buy-below MoS is provisional, and admit is human-decided. There is no admit-recommendation panel yet (uncertainty / permanent-loss / bear-case scoring) — that is a later slice once the recommendation is persisted.'),
      ),
    }),
    PanelSection({
      eyebrow: 'The verdict band',
      title: 'BUY, WATCH, or PASS',
      lead: 'Where the current price sits against the computed fair value and buy price decides the draft verdict — below the buy price is a BUY draft, between buy price and fair value is WATCH-FAIR, and a failed gate forces PASS.',
      children: caveat('Every output here is a draft. Nothing becomes a watchlist entry or a holding without an explicit, user-authored ledger transition. See the full method on the Strategy page.'),
    }),
  )
}

// 2 — The Research Swarm
function SwarmTab(): ReactNode {
  const laneDetails: Record<string, string> = {
    business_quality: 'How the business makes money, and whether 10-year owner earnings are predictable enough to value at all.',
    moat: 'Moat class and the reinvestment runway as separate axes, scored from a rubric of citeable sub-questions.',
    management: 'Capital allocation, candor, incentives, and the SBC trend — from filings and proxies, not media profiles.',
    financial_quality: 'Every raw harness input: the owner-earnings bridge, incremental ROIC, leverage, and accounting quality.',
    shariah: 'Sector status and the AAOIFI financial ratios, plus the purification percentage — a screening aid, not a ruling.',
    risks: 'The pre-mortem, the thesis-break triggers, and the single assumption that, if wrong, breaks the case.',
    valuation: 'The owner-earnings and reinvestment inputs the harness needs; the deterministic harness then computes fair value.',
  }
  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-4)' } },
    PanelSection({
      eyebrow: 'Division of labour',
      title: 'Agents propose, the harness computes, the human decides',
      lead: 'One principle holds the system together. LLM agents gather evidence and classify. Deterministic code does the valuation math, ratio checks, gates, and accounting. A human authors every irreversible transition. These three roles are never mixed.',
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
      title: 'Quick screen → deep dive → synthesis → decision',
      lead: 'A cheap funnel kills roughly 90% of candidates before the expensive swarm runs. Survivors get the full multi-agent deep dive; synthesis reconciles the lanes; the result is a BUY / WATCH / PASS draft for a human.',
      children: bullets([
        createElement('span', { key: 1 }, gold('Quick screen'), ' — Shariah sector gate, circle-of-competence check, and a worth-it read over the latest annual report.'),
        createElement('span', { key: 2 }, gold('Deep-dive swarm'), ` — ${LANE_COUNT} specialist lanes run blind to each other, each grounding its own claims.`),
        createElement('span', { key: 3 }, gold('Synthesis'), ' — conflicts reconciled conservatively, hard gates applied, base-rate burden enforced.'),
        createElement('span', { key: 4 }, gold('Decision'), ' — a drafted verdict; the human authors the watchlist entry or closes the case.'),
      ]),
    }),
    PanelSection({
      eyebrow: 'The specialists',
      title: `${LANE_COUNT} grounded lanes`,
      lead: 'Each dimension runs as its own focused, grounded agent in parallel — holding the whole framework in one model call degrades quality. The lane list is read live from the workflow contract.',
      children: cardGrid(
        buffettMungerDeepDiveLanes.map((lane) => ({
          key: lane,
          eyebrow: lane,
          body: laneDetails[lane] ?? '',
        })),
      ),
    }),
  )
}

// The hygiene-checklist prompts, rendered LIVE from CHECKLIST_PARAMS (never a hardcoded copy of the
// prompts) so the copy stays in sync as the owner extends the list. This is copy, not a live checklist —
// it LISTS the prompts; it never renders a count/progress/score (a count is a score in disguise).
function checklistPromptList(category: ChecklistCategory): ReactNode {
  const items = CHECKLIST_PARAMS.items.filter((item) => item.category === category)
  return bullets(items.map((item) => createElement('span', { key: item.id }, item.prompt)))
}

// 3 — Judgment Objectivity
function JudgmentTab(): ReactNode {
  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-4)' } },
    PanelSection({
      eyebrow: 'Judgment as a measured quantity',
      title: 'Move judgment into rubrics, priors, and scoring rules written in advance',
      lead: 'Judgment does not disappear — it is written once, deliberately, into versioned config. Lanes score evidence against falsifiable sub-questions; the harness maps the total score to a classification. Changing a rubric is a deliberate, logged act, never an in-flight accommodation for a name you like.',
      children: cardGrid([
        { key: 'rubric', eyebrow: 'Rubric decomposition', title: 'Scores, not vibes', body: 'Each judgment-heavy lane scores citeable sub-questions; the harness mechanically maps the total to a tier. An unscoreable item is 0, never interpolated.' },
        { key: 'anchor', eyebrow: 'Mechanical anchor', title: 'Bounded ±1 tier', body: 'The harness computes a prior from raw filing data alone. A lane may then adjust at most one tier, and only with cited evidence the numbers cannot see. Upward moves need 2× the evidence.' },
        { key: 'baserate', eyebrow: 'Base rates', title: 'The outside view', body: 'Any proposal that beats a base rate must carry a structural exceptionality justification. Synthesis rejects inside-view narrative like "strong execution" as insufficient.' },
        { key: 'redteam', eyebrow: 'Red-team pass', title: 'Break the case', body: 'Before synthesis, one adversarial agent — ideally on a different model — must build the strongest bear case. Synthesis must answer its strongest objection or downgrade.' },
        { key: 'forecast', eyebrow: 'Calibration', title: 'Falsifiable forecasts', body: 'Each case logs 2–3 resolvable forecasts with probabilities. The harness resolves them on annual reports and scores Brier calibration per lane — overconfident lanes get shaded mechanically.' },
        { key: 'sources', eyebrow: 'Source discipline', title: 'Per-lane whitelists', body: 'Classification lanes read primary documents only — filings, transcripts, regulatory data. Sell-side research and financial media are excluded so the model cannot return the consensus dressed as analysis.' },
      ]),
    }),
    PanelSection({
      eyebrow: 'Quality & bias hygiene',
      title: 'Two checklists that force the question — they never score it',
      lead: createElement(
        'span',
        null,
        'Two hygiene checklists sit on the admission and re-underwrite sign-offs. They are a ',
        gold('hygiene surface, not a gate'),
        ': each one FORCES you to address a known failure mode, but it ',
        gold('never scores, tallies, or pass/fails'),
        ' your answers, and a "risk present" answer never auto-rejects the case. The checklist informs; you and the existing gates decide. They are a ',
        gold('completion-block'),
        ' — every item must be addressed in your own words before either sign-off goes through, but completeness is the only thing checked, never a verdict. The lists below are read ',
        gold('live from the versioned checklist config'),
        ', so they stay in sync as the owner adds failure modes learned from experience.',
      ),
      children: createElement(
        'div',
        { style: { display: 'grid', gap: 'var(--owl-space-3)' } },
        cardGrid([
          {
            key: 'business',
            eyebrow: 'Business failure modes',
            title: 'Agent-marshaled, human-affirmed',
            body: 'Guards the investment. The harness marshals the named persisted evidence beside each item (read-only, never a score), and YOU still affirm each one in your own words.',
          },
          {
            key: 'cognitive',
            eyebrow: 'Cognitive biases',
            title: 'Human-only — the agent never pre-fills',
            body: 'Guards your reasoning. Introspective and human-only: the agent never pre-fills, suggests, or seeds a cognitive answer — these are yours alone.',
          },
        ], '260px'),
        createElement(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.9rem' } },
          createElement(
            'div',
            { style: { display: 'grid', gap: '0.5rem' } },
            createElement('p', { style: microLabel }, 'Business failure modes'),
            checklistPromptList('business'),
          ),
          createElement(
            'div',
            { style: { display: 'grid', gap: '0.5rem' } },
            createElement('p', { style: microLabel }, 'Cognitive biases'),
            checklistPromptList('cognitive'),
          ),
        ),
        caveat(
          'These checklists are decision-NEUTRAL by construction: they list the questions to address; they do not auto-reject, score, or rank. The human plus the existing hard gates make the decision — the checklist only refuses to let a sign-off through with an unaddressed item.',
        ),
      ),
    }),
    caveat(
      'This layer makes judgment consistent, anchored, and measured — it does not manufacture a contrarian edge. A perfectly calibrated consensus earns roughly market returns; the calibration data is simply how you find out whether your rubrics ever disagreed with the market and were right.',
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
        ' — the agent never trades and never moves a name between states. The Lifecycle page renders this one list grouped by state.',
      ),
      children: bullets([
        createElement('span', { key: 1 }, gold('Candidate'), ' — discovery (screen sweeps, spin-offs, user tickers, 13F / owner-operator cloning) plus the quick screen; the Shariah sector exclusion is applied before a candidate even enters the ledger, and ~90% die cheaply here.'),
        createElement('span', { key: 2 }, gold('Watched & held'), ' — entered only by an explicit human ledger entry; a holding records an already-executed trade. Position sizing on the watched→held step is a later phase.'),
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
          { key: 'tranche', eyebrow: 'Tranche triggers (held)', body: 'Price at T2 (−10%) or T3 (−20%) triggers a thesis re-check first, then a tranche alert — never mechanical averaging-down.' },
          { key: 'conc', eyebrow: 'Concentration (held)', body: 'The 15% deployment cap binds new buys; a held position that APPRECIATES past a higher concentration-review threshold (~22%) raises a review-on-appreciation alert. Winners run — an alert is never an auto-trim.' },
          { key: 'shariah', eyebrow: 'Shariah grace (any live state)', body: 'A ratio breach opens a grace period (default 90 days); if unresolved, the harness drafts a DIVEST-REQUIRED — the human authors the exit.' },
        ]),
        caveat(
          createElement(
            'span',
            null,
            gold('Honest gap: '),
            'when the falsifier trips on a WATCHED name, the engine flags it as deteriorating but there is ',
            gold('no prune action yet'),
            ' (a later phase). The Lifecycle page surfaces that gap on the name rather than hiding it — a deteriorating watched name never looks healthy.',
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
      lead: 'Every exited position gets a post-mortem — thesis versus outcome, which lane was most wrong, whether the gates and margin of safety behaved. Those feed the calibration file. The system learns through its parameters, never through loosened judgment.',
    }),
  )
}

// 5 — Shariah by Design
function ShariahTab(): ReactNode {
  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-4)' } },
    PanelSection({
      eyebrow: 'Enforced at six points',
      title: 'Shariah is a property, not a single lane',
      lead: 'Shariah compliance is enforced across discovery exclusion, the quick screen, the deep-dive lane, holdings ratio monitoring, the purification engine, and exit rules. A FAIL stops the case outright and is never price-overridable.',
      children: cardGrid([
        { key: 'sector', eyebrow: 'Sector screen', body: createElement('span', null, 'Segment-level revenue check; more than ', mono('5%'), ' impermissible core revenue screens the name out before any valuation is attempted.') },
        { key: 'debt', eyebrow: 'Debt ratio', body: createElement('span', null, 'Interest-bearing debt / market cap (36-mo avg) below ', mono(pct(AAOIFI_DEBT_RATIO_MAX)), ', computed by the harness from primary filings.') },
        { key: 'cash', eyebrow: 'Cash ratio', body: createElement('span', null, 'Cash + interest-bearing securities / market cap below ', mono(pct(AAOIFI_CASH_SECURITIES_RATIO_MAX)), '.') },
        { key: 'income', eyebrow: 'Impermissible income', body: createElement('span', null, 'Impermissible income / revenue below ', mono(pct(AAOIFI_IMPERMISSIBLE_INCOME_MAX)), '; the remainder sets the purification percentage.') },
      ]),
    }),
    PanelSection({
      eyebrow: 'Purification & zakat',
      title: 'Computed by code, disbursed by the human',
      lead: 'Obligations are arithmetic, not advice. The engine runs automatically; its output is a payable, never an instruction.',
      children: bullets([
        createElement('span', { key: 1 }, gold('On-dividend purification'), ' — on each dividend, purification due = dividend × purification %, posted to a separate purification ledger. Capital-gains purification is off by default (a stricter mode is user-selectable).'),
        createElement('span', { key: 2 }, gold('Zakat'), ' — an optional module; the methodology and base are a user-authored setting, not an agent judgment.'),
        createElement('span', { key: 3 }, gold('Human-authored disbursement'), ' — the ledger tracks accrued versus paid; a human authors the charitable disbursement entry.'),
      ]),
    }),
    caveat(
      'These screens and the purification arithmetic are a local screening aid and a local accounting aid — not a fatwa, not a professional Shariah ruling, and not tax advice. Material ambiguity should be taken to a qualified Shariah adviser.',
    ),
  )
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
        { key: 't2', eyebrow: 'T2 — Mid', body: 'Quick screen, worth-it read, verdict-draft writing. A wrong "continue" is cheap — it dies in the deep dive.' },
        { key: 't3', eyebrow: 'T3 — Cheap / local', body: 'High-volume, low-judgment work: news and filing scans, trigger detection, entity resolution. Near-zero marginal cost.' },
        { key: 't0', eyebrow: 'T0 — No model, ever', body: 'Valuation math, Shariah ratios, purification arithmetic, accounting, 13F/EDGAR parsing. Deterministic by constitution.' },
      ]),
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
        createElement('span', { key: 5 }, gold('Golden-set qualification'), ' — a model reaches production only after passing a frozen set of already-analyzed companies; quality is verified, not assumed.'),
        createElement('span', { key: 6 }, gold('Dual-model cross-check'), ' — for moat class and Shariah status only, the lane runs twice on two models; disagreement escalates to a human and the conservative answer holds.'),
      ]),
    }),
    caveat(
      'Specific model names live in the registry and will go stale; the registry plus the qualification eval are what stay true. Provider support in this local alpha is bounded by the certification reports — readiness is not certification, and no provider is described as live or certified beyond what a target-specific report records.',
    ),
  )
}

export const LEARN_TABS: LearnTab[] = [
  { id: 'strategy', label: 'Strategy & Valuation', render: StrategyTab },
  { id: 'swarm', label: 'The Research Swarm', render: SwarmTab },
  { id: 'judgment', label: 'Judgment Objectivity', render: JudgmentTab },
  { id: 'lifecycle', label: 'Lifecycle', render: LifecycleTab },
  { id: 'shariah', label: 'Shariah by Design', render: ShariahTab },
  { id: 'tiering', label: 'Model Tiering & Trust', render: TieringTab },
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
