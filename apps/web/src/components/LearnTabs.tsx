'use client'

import { createElement, useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'

import {
  buffettMungerStrategy,
  discountRate,
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
import { curatedRealTierModelsForProvider } from '@owlfolio/providers/modelCatalog'

// ── Live contract values (rendered, never hard-coded) ───────────────────────
const strategy = buffettMungerStrategy
const DISCOUNT = discountRate(strategy)
const MULTIPLE_CEILING = strategy.valuation.valuation_multiple_ceiling
const MIN_INVESTABLE_MOAT = strategy.valuation.min_investable_moat
// RELIGHTENED DECISION (R1): the deterministic required_growth_gap / band engine is RETIRED. The MODEL now
// proposes the verdict, the valuation, and the buy-below with cited reasoning; the deterministic side emits
// a flag-only sanity-check. No band/gap display constant remains. Terminal g + horizon stay uniform.
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
      title: 'Quality compounders, bought when the model’s buy-below is met and its reasoning holds',
      lead: createElement(
        'span',
        null,
        'The harness invests in a small number of understandable businesses with durable economic moats and honest management. The model proposes the valuation — the owner earnings, the growth it assumes and why, the discount — and a buy-below, all with cited reasoning; a light deterministic sanity-check flags internal absurdity, the human audits and decides. A candidate is investable only when its moat class is at least ',
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
      title: 'Reverse-DCF first — the market’s implied growth as the lens',
      lead: createElement(
        'span',
        null,
        'The primary lens is the ',
        gold('reverse-DCF'),
        ': read the growth today’s price already demands and compare it to the ',
        gold('sustainable growth the model judges and cites'),
        '. Cheapness is that comparison, not a single computed number. The ',
        gold('forward two-stage discounted owner-earnings fair value is a LABELED REFERENCE cross-check'),
        ', NOT the decision: a stage-1 horizon whose growth holds the judged rate for the early years then fades LINEARLY down to a small terminal rate over the trailing years, plus a perpetual terminal rate beyond it, all at the same savings-anchored discount (the compliant savings rate + a uniform equity premium, ',
        mono(pct(DISCOUNT)),
        ' today) — no WACC, no beta, ever. The model proposes the verdict and the buy-below with cited reasoning, and the deterministic side only flags internal absurdity (it never blocks the verdict). The discount, the horizon, and the terminal rate stay uniform across investable moats; a monopoly earns higher terminal value through the moat-durability input, not by stretching the horizon. The live parameters below are read from the versioned valuation config, not hard-coded here.',
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
          createElement('div', null, 'PRIMARY (reverse-DCF):  market_implied_g = the growth today’s price already demands  →  compare to g'),
          createElement('div', null, `g    = the model’s judged sustainable owner-earnings/share growth, cited; a deterministic sanity-check flags an unsupportable rate (above ${pct(SINGLE_GROWTH_CAP)}, or above ${pct(GDP_GROWTH_THRESHOLD)} → moat-durability claim) — the flag is not the value source`),
          createElement('div', null, `stage 1 = ${STAGE1_HORIZON} yrs; g holds, then fades LINEARLY to gₜ over the trailing ${GROWTH_FADE_YEARS} yrs (uniform for every investable moat)`),
          createElement('div', null, `gₜ   = terminal rate: ${pct(TERMINAL_G_WIDE)} (uniform; the fade lands here by year ${STAGE1_HORIZON})`),
          createElement('div', null, `fair > ${MULTIPLE_CEILING}× OE → surfaced cap_exceeded sanity flag (not a silent truncation)`),
          createElement('div', null, 'ref  = forward-DCF cross-check fair value at the model’s assumed growth  (a sanity reference, NOT the decision)'),
          createElement('div', null, 'buy  = the MODEL’s proposed buy-below (cited reasoning) ; in_buy_zone = current_price ≤ buy-below'),
        ),
        cardGrid([
          { key: 'd', eyebrow: 'Uniform discount', body: createElement('span', null, 'the same savings-anchored rate (', mono(pct(DISCOUNT)), ') for every business — no beta, no quality knob; a lower savings rate lowers it.') },
          { key: 'rdcf', eyebrow: 'Reverse-DCF lens', body: 'The primary read: the growth the price implies vs the model’s judged sustainable growth. Cheapness is that gap, not a single number.' },
          { key: 'g', eyebrow: 'Judged growth', body: createElement('span', null, 'The model’s judged sustainable rate, cited; a sanity-check flags an unsupportable rate (above ', mono(pct(SINGLE_GROWTH_CAP)), ', or above GDP → a moat-durability claim) — it never sets the number.') },
          { key: 'cap', eyebrow: 'Sanity flag', body: createElement('span', null, mono(`${MULTIPLE_CEILING}×`), ' owner earnings raises a cap_exceeded flag — surfaced, never silently truncated.') },
          { key: 'buy', eyebrow: 'Model buy-below', body: createElement('span', null, 'The model proposes the buy-below with cited reasoning; you buy when the price meets it and the reasoning holds. The deterministic sanity-check flags absurdity but never blocks the verdict.') },
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
          createElement('span', { key: 2 }, gold('Size'), ' — the Pabrai Principle 5 axis, ', gold('deferred'), '. A size boundary favouring small, under-followed names is part of the model but shipped permissive; it does not yet constrain admission.'),
          createElement('span', { key: 3 }, gold('Cheapness counts only on an already-wonderful business'), ' — price is never the entry reason. Cheapness is considered only after a business passes the quality gate; a cheap business that fails the gate is still a PASS.'),
          createElement('span', { key: 4 }, gold('Uncertainty vs permanent-loss risk'), ' — the admit judgment splits the two. An opportunity is high uncertainty + ', gold('low permanent-loss risk'), '; an independent bear case tests that the downside is uncertainty, not impairment.'),
          createElement('span', { key: 5 }, gold('Admit is human-decided'), ' — the human authors the watchlist entry with a ', gold('signed thesis in their own words'), ' (never pre-filled from the agent draft) and the frozen ', gold('model-proposed buy-below'), ' at admit. A future re-underwrite re-anchors that buy-below visibly, never moving it silently.'),
        ]),
        caveat('Honest scope: the circle is permissive by default, the size axis is deferred, the model-proposed buy-below is provisional (the human signs it off), and admit is human-decided. There is no admit-recommendation panel yet (uncertainty / permanent-loss / bear-case scoring) — that is a later slice once the recommendation is persisted.'),
      ),
    }),
    PanelSection({
      eyebrow: 'The verdict',
      title: 'BUY, WATCH, or PASS',
      lead: 'The model proposes the draft verdict with cited reasoning — a BUY-WINDOW draft when the price has met its proposed buy-below, WATCH while the price sits above it, and a failed quality gate forces PASS. The deterministic sanity-check flags internal absurdity (an implied growth the history cannot support, terminal-value dominance, a multiple out of bounds) but never blocks the verdict — the human audits the reasoning and decides.',
      children: caveat('Every output here is a draft. Nothing becomes a watchlist entry or a holding without an explicit, user-authored ledger transition. See the full method on the Strategy page.'),
    }),
  )
}

// 2 — The Research Swarm
function SwarmTab(): ReactNode {
  const laneDetails: Record<string, string> = {
    business_quality: 'How the business makes money, and whether 10-year owner earnings are predictable enough to value at all.',
    moat: 'The moat and its reinvestment runway as a grounded, cite-verified thesis — every claim cited to a fetched source; a quant anchor from filings only corroborates, it does not set a numeric score.',
    management: 'Capital allocation, candor, incentives, and the SBC trend — from filings and proxies, not media profiles.',
    financial_quality: 'Every raw harness input: the owner-earnings bridge, incremental ROIC, leverage, and accounting quality.',
    shariah: 'Sector status and the AAOIFI financial ratios, plus the purification percentage — a screening aid, not a ruling.',
    risks: 'The pre-mortem, the thesis-break triggers, and the single assumption that, if wrong, breaks the case.',
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
        createElement('span', { key: 1 }, gold('Quick screen'), ' — Shariah sector gate, the owner-policy exclusion check (the config-set universe boundary), and a worth-it read over the latest annual report. The circle-of-competence judgment itself — durable predictability — is the model’s, made in the deep dive.'),
        createElement('span', { key: 2 }, gold('Deep-dive swarm'), ` — ${LANE_COUNT} specialist lanes run blind to each other, each grounding its own claims.`),
        createElement('span', { key: 3 }, gold('Synthesis'), ' — conflicts reconciled conservatively, hard gates applied, base-rate burden enforced.'),
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
          'Valuation is not one of the six parallel lanes — a dedicated focused pass runs after the six lanes conclude and proposes the owner-earnings value and buy-below during synthesis.',
        ),
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
      eyebrow: 'Grounded judgment, not a scoring machine',
      title: 'The model judges; grounding and an adversarial pass keep it honest',
      lead: 'The frontier model makes the judgments — circle, moat, runway, growth, the verdict. What makes a judgment trustworthy is not a rubric that scores it into a tier; it is that every claim is grounded in a fetched, content-hashed source and survives an adversarial bear case. The model abstains and flags rather than fabricating. Determinism corroborates and sanity-checks; it never sets or bounds the judgment.',
      children: cardGrid([
        { key: 'thesis', eyebrow: 'Cite-verified theses', title: 'Claims, not scores', body: 'Circle, moat, and runway are grounded, cite-verified theses — each claim cited to a source the harness fetched and content-hashed. There is no per-row rubric, no M1–M6, no total-score-to-tier map.' },
        { key: 'anchor', eyebrow: 'Quant corroborates', title: 'The numbers only confirm', body: 'A quant anchor read straight from the filings (ROIC, reinvestment, leverage) corroborates the thesis — but it does not set the tier or bound it. The model’s grounded argument is the judgment; the numbers either back it up or expose a contradiction.' },
        { key: 'baserate', eyebrow: 'Base rates', title: 'The outside view', body: 'Any proposal that beats a base rate must carry a structural exceptionality argument cited to evidence. Synthesis rejects inside-view narrative like "strong execution" as insufficient.' },
        { key: 'redteam', eyebrow: 'Red-team pass', title: 'Break the case', body: 'Before synthesis, one adversarial agent — ideally on a different model — must build the strongest bear case. Synthesis must answer its strongest objection or downgrade.' },
        { key: 'failclosed', eyebrow: 'Fail closed', title: 'Abstain, never fabricate', body: 'A claim the harness cannot tie to a fetched source is rejected mechanically — the lane abstains and flags the gap rather than inventing support. Missing evidence becomes a visible hole, never a confident guess.' },
        { key: 'sources', eyebrow: 'Source discipline', title: 'Primary documents only', body: 'Judgment-heavy lanes read primary documents only — filings, transcripts, regulatory data. Sell-side research and financial media are excluded so the model cannot return the consensus dressed as analysis.' },
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
      lead: 'Every exited position gets a post-mortem — thesis versus outcome, which lane was most wrong, whether the gates and the model’s buy-below reasoning held. Those feed the calibration file. The system learns through its parameters, never through loosened judgment.',
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

// Recommended models per tier, rendered LIVE from the curated OpenRouter catalog (never hard-coded here) so
// the Learn copy stays in sync as the owner curates the shortlist. Grouped T1 → T2 → T3.
const TIER_HEADINGS: Record<'T1' | 'T2' | 'T3', string> = {
  T1: 'T1 — Frontier (synthesis, moat/Shariah)',
  T2: 'T2 — Mid (quick screen, red-team)',
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
        { key: 't2', eyebrow: 'T2 — Mid', body: 'Quick screen, worth-it read, verdict-draft writing. A wrong "continue" is cheap — it dies in the deep dive.' },
        { key: 't3', eyebrow: 'T3 — Cheap / local', body: 'High-volume, low-judgment work: news and filing scans, trigger detection, entity resolution. Near-zero marginal cost.' },
        { key: 't0', eyebrow: 'T0 — No model, ever', body: 'Valuation math, Shariah ratios, purification arithmetic, accounting, 13F/EDGAR parsing. Deterministic by constitution.' },
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
        createElement('span', { key: 5 }, gold('Golden-set qualification'), ' — a model reaches production only after passing a frozen set of already-analyzed companies; quality is verified, not assumed.'),
        createElement('span', { key: 6 }, gold('Dual-model cross-check'), ' — for moat class and Shariah status only, the lane runs twice on two models; disagreement escalates to a human and the conservative answer holds.'),
      ]),
    }),
    caveat(
      'Specific model names live in the registry and will go stale; the registry plus the qualification eval are what stay true. Provider support in this local alpha is bounded by the certification reports — readiness is not certification, and no provider is described as live or certified beyond what a target-specific report records.',
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
        createElement('p', { style: microLabel }, 'Run it — a short owlfolio command'),
        commandBlock([
          createElement('span', null, 'owlfolio ', gold('<command>'), '          # e.g.  owlfolio doctor'),
          createElement('span', null, './owlfolio ', gold('<command>'), '        # from the repo root, no setup'),
          createElement('span', null, 'corepack pnpm owlfolio ', gold('<command>'), '  # zero-setup alternative'),
        ]),
        createElement('p', { style: { ...bodyStyle, fontSize: 'var(--owl-text-sm)' } }, createElement(
          'span',
          null,
          'To call ',
          mono('owlfolio'),
          ' from anywhere, put the repo-root launcher on your PATH once — symlink it (',
          mono('ln -s "$PWD/owlfolio" ~/.local/bin/owlfolio'),
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
        'The CLI is deliberately small. Onboarding — mode, provider, API keys, model, capital — all lives in the ',
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
        caveat('The CLI is dry-run/admin by constitution: it reads and writes config, credentials, and onboarding state, but it never executes an investment action, confirms a watchlist entry, opens a holding, or authorizes a purification payment — every irreversible transition is authored by a human in the web workflow.'),
      ),
    }),
  )
}

export const LEARN_TABS: LearnTab[] = [
  { id: 'strategy', label: 'Strategy & Valuation', render: StrategyTab },
  { id: 'swarm', label: 'The Research Swarm', render: SwarmTab },
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
