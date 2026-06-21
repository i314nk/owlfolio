import { createElement, type CSSProperties, type ReactNode } from 'react'

import {
  buffettMungerStrategy,
  creditedGrowth,
  discountRate,
  terminalGrowthForMoat,
  twoStageFairValuePerShare,
} from '@owlfolio/strategies/buffettMunger'
import { buffettMungerDeepDiveLanes } from '@owlfolio/workflow/strategyResearchPipeline'
import {
  SIZING_PARAMS,
  TRANCHE_TRIGGER_MULTIPLIER,
  type LadderId,
  type TrancheTrigger,
} from '@owlfolio/strategies/sizingParams'
import { SELL_PARAMS } from '@owlfolio/strategies/sellParams'
import { CHECKLIST_PARAMS, type ChecklistCategory } from '@owlfolio/strategies/checklistParams'

import { DEFAULT_SAVINGS_EXPECTED_PROFIT_RATE, DEFAULT_EQUITY_RISK_MARGIN } from '@owlfolio/shared'

import { RouteHeader, OwlValuationChip } from './designSystem'

// ── Live contract values (rendered, never hard-coded) ───────────────────────
const strategy = buffettMungerStrategy
const DISCOUNT = discountRate(strategy)
const MULTIPLE_CEILING = strategy.valuation.valuation_multiple_ceiling
const MIN_INVESTABLE_MOAT = strategy.valuation.min_investable_moat
// RELIGHTENED DECISION (R1): the deterministic required_growth_gap / band engine is RETIRED. The MODEL now
// proposes the verdict, the valuation, and the buy-below with cited reasoning; the deterministic side emits
// a flag-only sanity-check. No band/gap display constant remains.
const TERMINAL_G_WIDE = terminalGrowthForMoat(strategy, 'wide')
const SINGLE_GROWTH_CAP = strategy.valuation.single_growth_cap
const GDP_GROWTH_THRESHOLD = strategy.valuation.gdp_growth_threshold

// Worked example — an investable compounder, computed from the live contract so the prose tracks params.
// The DECISION lens is the reverse-DCF (market-implied vs the model's judged sustainable growth); the
// forward two-stage number below is computed only as the LABELED REFERENCE cross-check that corroborates
// the model's reasoning, never as the decision. Here a 12% sustainable rate the model judges and cites is
// under the deterministic sanity cap but above GDP, so a sanity-check flags it for the human to weigh.
const EX_OE = 14
const EX_JUDGED_G = 0.12
const EX_GROWTH = creditedGrowth(strategy, { demonstrated_growth: EX_JUDGED_G })
const EX_G = EX_GROWTH.growth
const EX_FV = twoStageFairValuePerShare({
  oe_ps: EX_OE,
  g: EX_G,
  terminal_g: TERMINAL_G_WIDE,
  discount: DISCOUNT,
  ceiling_multiple: MULTIPLE_CEILING,
})
const EX_IMPLIED = EX_FV / EX_OE
const TARGET_WIDE = strategy.portfolio.target_weight_by_moat.wide
const TARGET_MONOPOLY = strategy.portfolio.target_weight_by_moat.monopoly
const TRANCHES = strategy.portfolio.entry_tranches
const MAX_POSITION_WEIGHT = strategy.portfolio.max_position_weight
const MAX_POSITIONS = strategy.portfolio.max_positions
// Phase 5 conviction-sizing constants (rendered from the live sizing config / savings defaults).
const BASE_TARGET_WEIGHT = SIZING_PARAMS.base_target_weight
const PER_NAME_CAP = SIZING_PARAMS.per_name_cap
const CONCENTRATION_REVIEW_THRESHOLD = SIZING_PARAMS.concentration_review_threshold
const DEPLOYMENT_HURDLE = DEFAULT_SAVINGS_EXPECTED_PROFIT_RATE + DEFAULT_EQUITY_RISK_MARGIN
// Phase 6 sell parameters (rendered live from the versioned config, never hard-coded).
const MIN_HOLD_MONTHS = SELL_PARAMS.minimum_hold_months
const SELL_IV_FRACTION = SELL_PARAMS.sell_iv_fraction
const BETTER_OPP_MIN_MARGIN = SELL_PARAMS.better_opportunity_min_margin

function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits).replace(/\.0+$/, '')}%`
}

// ── Editorial figure treatment — mono, tabular, gold-vivid for key numbers ───
const monoFigure: CSSProperties = {
  fontFamily: 'var(--owl-font-mono)',
  color: 'var(--owl-color-gold-vivid)',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
}
const goldText: CSSProperties = { color: 'var(--owl-color-gold-bright)', fontWeight: 700 }
const rejected: CSSProperties = { color: 'var(--owl-color-risk-bright)' }

// Mono uppercase micro-label used for table headers and sub-figure captions.
const microLabel: CSSProperties = {
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--owl-color-gold)',
  margin: 0,
}

const leadStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-base)',
  lineHeight: 1.55,
  margin: 0,
  maxWidth: '52rem',
}

const bodyStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-base)',
  lineHeight: 1.55,
  margin: 0,
}

/**
 * One editorial section of the methodology brief: a gold mono eyebrow
 * (owl-section-accent), a sans heading (owl-section-title), an optional lead
 * paragraph, then the figure/table content. The owl-section-card supplies the
 * panel chrome and vertical rhythm; the route frame gaps sections apart and
 * inherits the staggered reveal.
 */
function Section({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string
  title: string
  lead?: ReactNode
  children: ReactNode
}): ReactNode {
  return createElement(
    'section',
    { className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent' }, eyebrow),
    createElement('h2', { className: 'owl-section-title' }, title),
    lead === undefined ? null : createElement('p', { style: leadStyle }, lead),
    children,
  )
}

// ── 2. Pipeline flow ─────────────────────────────────────────────────────────
const PIPELINE_STEPS: { key: string; label: string; detail: string }[] = [
  { key: 'discovery', label: 'Discovery', detail: 'Candidate enters research' },
  { key: 'quick_screen', label: 'Quick screen', detail: 'Shariah gate + worth-it read' },
  { key: 'gate', label: 'Automatic | Review', detail: 'Run now, or pause for approval' },
  { key: 'deep_dive', label: 'Deep-dive swarm', detail: `${buffettMungerDeepDiveLanes.length} grounded lanes, parallel` },
  { key: 'synthesis', label: 'Synthesis', detail: 'Reconcile + ≥wide moat gate' },
  { key: 'decision', label: 'Decision', detail: 'BUY / WATCH / PASS draft' },
  { key: 'watchlist', label: 'Watchlist', detail: 'User-confirmed entry' },
  { key: 'holding', label: 'Holding', detail: 'Explicit open transition' },
  { key: 'review', label: 'Reviews / reanalysis', detail: 'Re-run supersedes prior case' },
]

function PipelineFlow(): ReactNode {
  const nodes: ReactNode[] = []
  PIPELINE_STEPS.forEach((step, index) => {
    nodes.push(
      createElement(
        'div',
        {
          key: step.key,
          style: {
            flex: '1 1 130px',
            minWidth: '130px',
            background: 'var(--owl-color-panel)',
            border: '1px solid var(--owl-color-border)',
            borderRadius: 'var(--owl-radius-card)',
            padding: '0.65rem 0.75rem',
          },
        },
        createElement('div', { style: { ...microLabel, color: 'var(--owl-color-muted)', letterSpacing: '0.08em' } }, step.label),
        createElement('div', { style: { fontSize: 'var(--owl-text-xs)', color: 'var(--owl-color-quiet)', marginTop: '0.25rem', lineHeight: 1.4 } }, step.detail),
      ),
    )
    if (index < PIPELINE_STEPS.length - 1) {
      nodes.push(
        createElement(
          'div',
          { key: `arrow-${step.key}`, 'aria-hidden': 'true', style: { alignSelf: 'center', color: 'var(--owl-color-quiet)' } },
          '→',
        ),
      )
    }
  })
  return createElement(
    'div',
    { style: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'stretch' } },
    ...nodes,
  )
}

// ── 3. Specialist swarm lanes (real lanes + what each assesses) ──────────────
type LaneCard = { lane: string; name: string; assesses: string }

const LANE_DETAILS: Record<string, { name: string; assesses: string }> = {
  business_quality: {
    name: 'Business quality',
    assesses: 'How the business actually makes money, its economics, and whether the franchise is understandable and durable.',
  },
  moat: {
    name: 'Moat',
    assesses: 'Durable competitive advantage, reinvestment runway, pricing power, and the evidence behind the moat class it assigns.',
  },
  management: {
    name: 'Management',
    assesses: 'Capital allocation, incentives, candor, insider alignment, and the stewardship track record of the people running it.',
  },
  financial_quality: {
    name: 'Financial quality',
    assesses: 'Owner-earnings normalization (NI + D&A − maintenance capex − SBC − ΔNWC), ROIC, reinvestment, cash conversion, and accounting quality.',
  },
  shariah: {
    name: 'Shariah',
    assesses: 'Whether the core business and financial ratios are permissible — a local screening aid, not a professional Shariah ruling.',
  },
  risks: {
    name: 'Risks',
    assesses: 'Permanent-capital-loss risks, leverage fragility, disruption, regulation, and the specific events that would break the thesis.',
  },
  valuation: {
    name: 'Valuation',
    assesses: 'The reverse-DCF read — the growth today’s price implies — against the model’s judged sustainable growth, plus the owner-earnings bridge, ROIC and reinvestment inputs behind it; the model proposes the buy-below with cited reasoning, deterministically sanity-checked against a forward-DCF reference.',
  },
}

const LANE_CARDS: LaneCard[] = buffettMungerDeepDiveLanes.map((lane) => {
  const detail = LANE_DETAILS[lane]
  return {
    lane,
    name: detail?.name ?? lane,
    assesses: detail?.assesses ?? '',
  }
})

function LaneGrid(): ReactNode {
  return createElement(
    'div',
    {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: '0.75rem',
      },
    },
    ...LANE_CARDS.map((card) =>
      createElement(
        'article',
        {
          key: card.lane,
          'data-lane': card.lane,
          style: {
            background: 'var(--owl-color-panel)',
            border: '1px solid var(--owl-color-border)',
            borderRadius: 'var(--owl-radius-card)',
            padding: '0.85rem 0.95rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
          },
        },
        createElement('p', { style: { ...microLabel } }, card.lane),
        createElement('h3', { style: { fontSize: 'var(--owl-text-base)', fontWeight: 750, color: 'var(--owl-color-gold-bright)', margin: 0 } }, card.name),
        createElement('p', { style: { ...bodyStyle } }, card.assesses),
      ),
    ),
  )
}

// ── Small table helper — mono tabular figures, hairline rules ────────────────
function Table({ headings, rows }: { headings: string[]; rows: ReactNode[][] }): ReactNode {
  const thStyle: CSSProperties = {
    ...microLabel,
    textAlign: 'left',
    padding: '0.5rem 0.7rem',
    borderBottom: '1px solid var(--owl-color-border)',
  }
  const tdStyle: CSSProperties = {
    padding: '0.55rem 0.7rem',
    borderBottom: '1px solid var(--owl-color-border)',
    color: 'var(--owl-color-muted)',
    fontSize: 'var(--owl-text-base)',
    fontVariantNumeric: 'tabular-nums',
  }
  return createElement(
    'table',
    { style: { width: '100%', borderCollapse: 'collapse' } },
    createElement(
      'thead',
      null,
      createElement('tr', null, ...headings.map((h) => createElement('th', { key: h, style: thStyle }, h))),
    ),
    createElement(
      'tbody',
      null,
      ...rows.map((row, ri) =>
        createElement(
          'tr',
          { key: `row-${ri}` },
          ...row.map((cell, ci) => createElement('td', { key: `cell-${ri}-${ci}`, style: tdStyle }, cell)),
        ),
      ),
    ),
  )
}

function trancheTriggerLabel(tranche: (typeof TRANCHES)[number]): string {
  if (tranche.trigger === 'at_buy_price') {
    return 'At buy price'
  }
  return `${pct(tranche.pct)} below buy price`
}

// ── Tranche ladders (position-sizing-spec §2–§4) — read from SIZING_PARAMS ────
const TIME_COMPLETION_MONTHS = SIZING_PARAMS.time_completion_months
const REGIME_THRESHOLD = SIZING_PARAMS.regime_temperature_threshold

const LADDER_META: Record<LadderId, { name: string; regime: string }> = {
  cold: { name: 'Cold-regime ladder', regime: `dislocation · temperature ≥ ${REGIME_THRESHOLD + 1}` },
  normal: { name: 'Normal / warm-regime ladder', regime: `temperature ≤ ${REGIME_THRESHOLD} · the default` },
}

/** Human label for a tranche price trigger, derived from the config multiplier (never hardcoded). */
function ladderTriggerLabel(trigger: TrancheTrigger): string {
  const mult = TRANCHE_TRIGGER_MULTIPLIER[trigger]
  if (mult >= 1) {
    return 'price ≤ buy price'
  }
  const drop = Math.round((1 - mult) * 100)
  return `price ≤ buy × ${mult.toFixed(2)} (−${drop}%) or time-completion`
}

/** One ladder rendered as a fraction/trigger/gate table, sourced from SIZING_PARAMS. */
function LadderTable(ladderId: LadderId): ReactNode {
  const def = SIZING_PARAMS.ladders[ladderId]
  const meta = LADDER_META[ladderId]
  return createElement(
    'div',
    { key: ladderId, 'data-ladder': ladderId, style: { display: 'flex', flexDirection: 'column', gap: '0.4rem' } },
    createElement('p', { style: microLabel }, `${meta.name} · ${meta.regime}`),
    Table({
      headings: ['Tranche', 'Fraction', 'Trigger', 'Gate'],
      rows: def.rungs.map((rung) => [
        createElement('span', { style: goldText }, rung.id),
        createElement('span', { style: monoFigure }, pct(rung.fraction)),
        ladderTriggerLabel(rung.trigger),
        rung.trigger === 'buy' ? 'Entry (fresh, gate-clean case)' : createElement('span', { style: goldText }, 'Thesis re-check'),
      ]),
    }),
  )
}

// ── Component ────────────────────────────────────────────────────────────────
// The hygiene-checklist prompts, rendered LIVE from CHECKLIST_PARAMS — never a hardcoded copy of the
// prompts — so the copy stays in sync as the owner extends the list. This LISTS the prompts; it never
// renders a count/progress/score (a count is a score in disguise).
function ChecklistPromptColumn({ category, heading }: { category: ChecklistCategory; heading: string }): ReactNode {
  const items = CHECKLIST_PARAMS.items.filter((item) => item.category === category)
  return createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
    createElement('p', { style: { ...microLabel } }, heading),
    createElement(
      'ul',
      { style: { ...bodyStyle, margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' } },
      ...items.map((item) => createElement('li', { key: item.id }, item.prompt)),
    ),
  )
}

export function StrategyOverview(): ReactNode {
  return createElement(
    'main',
    { className: 'owl-route-frame owl-route-frame-wide' },
    createElement(
      'p',
      { className: 'owl-route-back-row' },
      createElement('a', { className: 'owl-back-link owl-focusable', href: '/' }, '← Back to command center'),
    ),

    // 1. Letterhead — serif title + gold mono kicker + hairline rule
    createElement(RouteHeader, {
      kicker: `${strategy.name} · v${strategy.version}`,
      title: 'The strategy',
      description:
        'The method your agent follows, end to end: a concentrated, quality-value, Shariah-aware discipline in the Buffett-Munger tradition. One principle holds it together — a strict division of labour. Grounded specialist agents propose evidence, deterministic projections compute the numbers, and a human makes every irreversible decision.',
    }),
    createElement('hr', { className: 'owl-rule' }),

    // Thesis — the opening statement of method
    createElement(
      'section',
      { className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' } },
      createElement('p', { className: 'owl-section-accent' }, 'Thesis'),
      createElement(
        'p',
        { style: { ...bodyStyle, fontSize: 'var(--owl-text-md)', lineHeight: 1.6, maxWidth: '54rem' } },
        'Buy a small number of understandable businesses with durable economic moats and honest, capable management, only when the model proposes a buy-below the price has met and its cited reasoning holds — then hold. ',
        createElement('span', { style: goldText }, 'The model proposes the verdict and valuation with cited reasoning; a deterministic sanity-check flags absurdity; you audit and decide.'),
        ' Nothing the swarm produces becomes a watchlist entry or a holding without an explicit, user-authored ledger transition.',
      ),
    ),

    // 2. Pipeline
    Section({
      eyebrow: 'How a case moves',
      title: 'The pipeline',
      lead: 'Each candidate flows through a fixed sequence. The quick screen is a lightweight Shariah-first gate; the expensive multi-agent deep dive only runs for cases worth it.',
      children: PipelineFlow(),
    }),

    // 2b. Admission — the operation discovery actually performs, and how a name is admitted
    Section({
      eyebrow: 'Admission',
      title: 'Discovery is the admission operation',
      lead:
        'Discovery is not a stock screener that ranks names — it is the operation that decides which businesses are even allowed into deep research. Two human-set boundaries bound it before any model runs, and the final admit is a human decision with a written thesis.',
      children: createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '0.9rem' } },
        createElement(
          'ul',
          { style: { ...bodyStyle, margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
          createElement(
            'li',
            null,
            createElement('span', { style: goldText }, 'Circle of competence — the model’s grounded judgment; the config screen sets owner-policy exclusions only.'),
            ' Whether a business is inside the circle — durable, predictable enough to underwrite — is the model’s grounded judgment in the deep dive, never agent-inferred from thin air: it is argued from fetched, content-hashed sources. The config screen does NOT determine competence; it sets owner-policy exclusions the harness CHECKS mechanically (a sector boundary via the EDGAR SIC code, the same discipline as the discount anchor), which only narrow the universe. It ships ',
            createElement('span', { style: goldText }, 'permissive by default'),
            ' (no boundary enabled), so the common path is unchanged until you narrow it.',
          ),
          createElement(
            'li',
            null,
            createElement('span', { style: goldText }, 'Size — the Pabrai Principle 5 axis, deferred.'),
            ' A size boundary (favouring the small, under-followed names where mispricing concentrates) is part of the model but ',
            createElement('span', { style: goldText }, 'shipped permissive / deferred'),
            ' — it does not yet constrain admission.',
          ),
          createElement(
            'li',
            null,
            createElement('span', { style: goldText }, 'Cheapness counts only on an already-wonderful business.'),
            ' Price is never the entry reason. Cheapness is considered only after a business has passed the quality gate (≥ wide moat, honest growth, safe balance sheet, Shariah-clean) — a cheap business that fails the gate is still a PASS.',
          ),
          createElement(
            'li',
            null,
            createElement('span', { style: goldText }, 'The admit judgment splits uncertainty from permanent-loss risk.'),
            ' An opportunity is a business with ',
            createElement('span', { style: goldText }, 'high uncertainty but low permanent-loss risk'),
            ' — the market overpays for certainty, so durable businesses whose near-term outcome is merely unknowable (not impaired) are where the edge lives. A separate, independent bear case is built to test that the downside really is uncertainty and not permanent impairment.',
          ),
          createElement(
            'li',
            null,
            createElement('span', { style: goldText }, 'Admit is human-decided.'),
            ' Nothing is admitted automatically. The human authors the watchlist entry with a ',
            createElement('span', { style: goldText }, 'signed thesis written in their own words'),
            ' (never pre-filled from the agent draft) and the frozen ',
            createElement('span', { style: goldText }, 'model-proposed buy-below'),
            ' at admit — the price the reasoning says is cheap enough. A future re-underwrite re-anchors that buy-below visibly and logged, rather than moving the number silently.',
          ),
        ),
        createElement(
          'p',
          { style: { ...bodyStyle, fontSize: 'var(--owl-text-sm)', color: 'var(--owl-color-quiet)', borderLeft: '2px solid var(--owl-color-border)', paddingLeft: '0.85rem', margin: 0 } },
          'Honest scope: the circle is permissive by default, the size axis is deferred, the model-proposed buy-below is provisional (the human signs it off), and admit is human-decided. The harness does not yet present an admit-recommendation panel (uncertainty / permanent-loss / bear-case scoring) — that is a later slice once the recommendation is persisted.',
        ),
      ),
    }),

    // 3. Specialist swarm — the centerpiece
    Section({
      eyebrow: 'The deep-dive swarm',
      title: `The specialist swarm — ${buffettMungerDeepDiveLanes.length} grounded lanes`,
      lead:
        'The deep dive is swarm-only by design: holding the whole framework in one model call degrades quality, so each dimension runs as its own focused, grounded agent in parallel. Every lane gathers its own sources, and every cited source is fetched and content-hashed by the harness — not trusted from the model. Each lane runs as its own grounded agent — every claim cited to a harness-captured source.',
      children: LaneGrid(),
    }),

    // 4. Moat taxonomy & gate
    Section({
      eyebrow: 'Quality gate',
      title: 'Moat taxonomy & the wide-moat gate',
      lead: createElement(
        'span',
        null,
        'A candidate is investable only when its moat class is at least ',
        createElement('span', { style: monoFigure }, MIN_INVESTABLE_MOAT),
        '. Narrow and moderate moats are rejected and the verdict is forced to PASS before sizing is ever considered.',
      ),
      children: Table({
        headings: ['Moat class', 'Meaning', 'Investable?'],
        rows: [
          ['narrow', 'Weak or short-duration advantage', createElement('span', { style: rejected }, 'No — rejected')],
          ['moderate', 'Meaningful but not durable enough', createElement('span', { style: rejected }, 'No — rejected')],
          [createElement('span', { style: goldText }, 'wide'), 'Durable multi-year advantage, pricing power', createElement(OwlValuationChip, { kind: 'approved', label: 'Yes — minimum' })],
          [createElement('span', { style: goldText }, 'monopoly'), 'Near-exclusive position or platform lock-in', createElement(OwlValuationChip, { kind: 'approved', label: 'Yes' })],
        ],
      }),
    }),

    // 5. Valuation method — reverse-DCF primary, forward two-stage as a labeled reference
    Section({
      eyebrow: 'Value',
      title: 'Valuation — reverse-DCF first, the market’s implied growth as the lens',
      lead: createElement(
        'span',
        null,
        'The primary lens is the ',
        createElement('span', { style: goldText }, 'reverse-DCF'),
        ': extract the growth the live price already implies, then compare it to the ',
        createElement('span', { style: goldText }, 'sustainable growth the model judges and cites'),
        '. If the price demands more than the business can durably deliver, it is expensive; if it demands less, there is room. That comparison — not a single computed number — is how cheapness is read. The ',
        createElement('span', { style: goldText }, 'forward two-stage discounted owner-earnings fair value is a LABELED REFERENCE cross-check'),
        ', NOT the decision engine: a ten-year explicit window whose growth holds the judged rate for the early years then fades LINEARLY down to a small terminal rate over the trailing years, plus a perpetual terminal rate beyond it, all at the same savings-anchored discount (the compliant savings rate + a uniform equity premium, ',
        createElement('span', { style: monoFigure }, pct(DISCOUNT)),
        ' today) — no WACC, no beta, ever. The model proposes the valuation — the owner earnings, the sustainable growth it judges and WHY, the discount — with cited reasoning, and proposes the buy-below. A light deterministic sanity-check flags internal absurdity (an implied growth the history cannot support, terminal-value dominance, a multiple out of bounds); it never blocks the verdict. You audit the reasoning and decide.',
      ),
      children: createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '0.9rem' } },

        // Formula block — stays mono
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
          createElement('div', null, 'OE   = NI + D&A − maintenance capex (Greenwald vs D&A floor, conservative) − SBC − ΔNWC'),
          createElement('div', null, 'PRIMARY (reverse-DCF):  market_implied_g = the growth today’s price already demands  →  compare to g'),
          createElement('div', null, `g    = the model’s judged sustainable owner-earnings/share growth, cited; a deterministic sanity-check flags an unsupportable rate (above ${pct(SINGLE_GROWTH_CAP)}, or above ${pct(GDP_GROWTH_THRESHOLD)} → a moat-durability claim to weigh) — the flag is not the value source`),
          createElement('div', null, `gₜ   = terminal fade: ${pct(TERMINAL_G_WIDE)} for every investable moat (uniform)`),
          createElement('div', null, `fair = Σ OE(1+g)ᵗ/(1+${pct(DISCOUNT)})ᵗ  [t=1..10]  +  OE(1+g)¹⁰(1+gₜ)/(${pct(DISCOUNT)}−gₜ) / (1+${pct(DISCOUNT)})¹⁰`),
          createElement('div', null, `fair > ${MULTIPLE_CEILING}× OE → surfaced cap_exceeded sanity flag (not a silent truncation)`),
          createElement('div', null, 'ref  = forward-DCF cross-check fair value at the model’s assumed growth  (a sanity reference, NOT the decision)'),
          createElement('div', null, 'buy  = the MODEL’s proposed buy-below (cited reasoning) ; in_buy_zone = current_price ≤ buy-below'),
        ),

        // Growth is the model's judged sustainable rate (cited); the cap + above-GDP threshold are sanity FLAGS.
        createElement('p', { style: microLabel }, 'Growth — the model’s judged sustainable rate, sanity-flagged'),
        Table({
          headings: ['Growth control', 'Value'],
          rows: [
            [createElement('span', { style: goldText }, 'Source'), createElement('span', { style: monoFigure }, 'model-judged sustainable rate (cited)')],
            [createElement('span', { style: goldText }, 'Sanity flag — unsupportable rate'), createElement('span', { style: monoFigure }, `> ${pct(SINGLE_GROWTH_CAP)}`)],
            [createElement('span', { style: goldText }, 'Sanity flag — above-GDP durability claim'), createElement('span', { style: monoFigure }, `> ${pct(GDP_GROWTH_THRESHOLD)}`)],
          ],
        }),

        // Valuation params — UNIFORM across investable moats (F.13). A monopoly is a durability signal that
        // earns higher terminal value through the moat-durability input, NOT a license to lower the safety
        // margin, extend the horizon, or raise terminal growth. Those are uniform for wide and monopoly alike.
        createElement('p', { style: microLabel }, 'Valuation parameters — uniform across investable moats'),
        Table({
          headings: ['Parameter', 'Value (wide & monopoly)'],
          rows: [
            [createElement('span', { style: goldText }, 'Discount rate'), createElement('span', { style: monoFigure }, pct(DISCOUNT))],
            [createElement('span', { style: goldText }, 'Terminal g'), createElement('span', { style: monoFigure }, pct(TERMINAL_G_WIDE))],
            [createElement('span', { style: goldText }, 'Buy-below'), createElement('span', { style: monoFigure }, 'model-proposed (cited)')],
          ],
        }),
        createElement('p', { style: { ...bodyStyle, margin: '0.2rem 0 0' } }, 'A monopoly is a durability signal — more confidence the cash flows persist, which earns higher terminal value through the moat-durability input — not a license to stretch the horizon or raise the terminal rate. The buy decision is the model’s proposed buy-below with cited reasoning, sanity-checked but never overridden by determinism.'),

        // Worked example — computed from the live contract.
        createElement(
          'div',
          { style: { ...bodyStyle, background: 'var(--owl-color-panel)', border: '1px solid var(--owl-color-border)', borderRadius: 'var(--owl-radius-card)', padding: '0.85rem 1rem' } },
          createElement('p', { style: { ...microLabel, marginBottom: '0.4rem' } }, 'Worked example — an investable compounder'),
          createElement(
            'p',
            { style: { margin: 0 } },
            'Start with the reverse-DCF lens: read the growth the live price already demands, and set it beside the ',
            createElement('span', { style: monoFigure }, pct(EX_G)),
            ' sustainable growth the model judges and cites for owner earnings of ',
            createElement('span', { style: monoFigure }, `$${EX_OE}`),
            ` per share. If the price implies more than that, it is expensive; if less, there is room — and because ${pct(EX_G)} sits above GDP, a deterministic sanity-check flags it a moat-durability claim for the human to weigh. The forward two-stage number is only the LABELED REFERENCE: holding that rate for the early years, then fading it LINEARLY down to a `,
            createElement('span', { style: monoFigure }, pct(TERMINAL_G_WIDE)),
            ' terminal rate over the trailing years of the ten-year window, gives a forward-DCF cross-check fair value of ',
            createElement('span', { style: monoFigure }, `$${EX_FV.toFixed(0)}`),
            ` (${EX_IMPLIED.toFixed(1)}× owner earnings; a value above ${MULTIPLE_CEILING}× would raise a cap_exceeded sanity flag, not be truncated). That forward number is a sanity reference, NOT the decision: the model proposes the verdict and the buy-below with cited reasoning — the owner earnings it valued, the sustainable growth it judged and why, the discount — and the deterministic side only flags internal absurdity (e.g. an implied growth the history cannot support). You buy when the price has met the model’s proposed buy-below and the cited reasoning holds. A monopoly raises no terminal rate and shortens nothing — its extra durability is argued through the moat-durability input, where the human weights it.`,
          ),
        ),
      ),
    }),

    // 6. Hard gates / overrides
    Section({
      eyebrow: 'Non-negotiable',
      title: 'Hard gates & overrides',
      lead: 'These conditions are applied regardless of how attractive the price looks. A failure on any blocking gate stops the case.',
      children: createElement(
        'ul',
        { style: { ...bodyStyle, margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' } },
        createElement('li', null, createElement('span', { style: goldText }, 'Moat ≥ wide'), ' — narrow/moderate are rejected and forced to PASS.'),
        createElement('li', null, createElement('span', { style: goldText }, 'Honest growth path'), ` — growth is the model’s judged sustainable owner-earnings/share rate with cited reasoning; a deterministic sanity-check flags an unsupportable rate (above ${pct(SINGLE_GROWTH_CAP)}, or above ${pct(GDP_GROWTH_THRESHOLD)} → a moat-durability claim) rather than setting the number.`),
        createElement('li', null, createElement('span', { style: goldText }, 'Positive owner earnings'), ' — normalized owner earnings must be positive.'),
        createElement('li', null, createElement('span', { style: goldText }, 'Safe balance sheet'), ' — leverage must not create unacceptable fragility.'),
        createElement('li', null, createElement('span', { style: goldText }, 'Shariah compliant or conditional'), ' — non-compliant cases stop at the quick screen.'),
      ),
    }),

    // 7. Position sizing
    Section({
      eyebrow: 'Sizing',
      title: 'Position sizing',
      lead: createElement(
        'span',
        null,
        'Diversified, conviction-tiered target weights scale with moat class (wide ',
        createElement('span', { style: goldText }, pct(TARGET_WIDE)),
        ' / monopoly ',
        createElement('span', { style: goldText }, pct(TARGET_MONOPOLY)),
        `, each ≤ the ${pct(MAX_POSITION_WEIGHT)} max, across ~${MAX_POSITIONS} names), and entry is laddered across three price tranches. `,
        createElement('span', { style: goldText }, 'Sizing is capital-driven and advisory: it uses the investable capital you set, and you author the buys — the worker never trades.'),
        ' The target weight is an entry cap — winners run, never force-trimmed. T2/T3 are thesis-gated: deploy only if the thesis still holds (tied to the thesis-review escalation), never mechanical averaging-down. ',
        createElement('span', { style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-xs)' } }, `Example: on a $10,000 target position at the T1 buy price, T1 = $${Math.round(TRANCHES[0]?.fraction !== undefined ? 10000 * TRANCHES[0].fraction : 3333)} · T2 = $${Math.round(TRANCHES[1]?.fraction !== undefined ? 10000 * TRANCHES[1].fraction : 3333)} · T3 = $${Math.round(TRANCHES[2]?.fraction !== undefined ? 10000 * TRANCHES[2].fraction : 3334)}.`),
      ),
      children: createElement(
        'div',
        { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.9rem' } },
        Table({
          headings: ['Moat class', 'Target weight'],
          rows: [
            [createElement('span', { style: goldText }, 'wide'), createElement('span', { style: monoFigure }, pct(TARGET_WIDE))],
            [createElement('span', { style: goldText }, 'monopoly'), createElement('span', { style: monoFigure }, pct(TARGET_MONOPOLY))],
          ],
        }),
        Table({
          headings: ['Tranche', 'Fraction', 'Trigger', 'Gate'],
          rows: TRANCHES.map((t) => [
            createElement('span', { style: goldText }, t.id),
            createElement('span', { style: monoFigure }, pct(t.fraction)),
            trancheTriggerLabel(t),
            t.id === 'T1' ? 'Entry' : createElement('span', { style: goldText }, 'Thesis re-check'),
          ]),
        }),
      ),
    }),

    // 7a. Conviction sizing discipline (Phase 5 S1–S7) — no Kelly, the two caps, savings first-class.
    Section({
      eyebrow: 'Sizing discipline',
      title: 'How the size is set — worst case first, no Kelly',
      lead: createElement(
        'span',
        null,
        'The target is ',
        createElement('span', { style: goldText }, `conviction × ${pct(BASE_TARGET_WEIGHT)}`),
        ` base weight — conviction (moat, permanent-loss, uncertainty) only scales it DOWN from ${pct(BASE_TARGET_WEIGHT)}, never up. `,
        createElement('span', { style: goldText }, 'This is deliberately NOT Kelly: there is no win-probability, no odds, no edge term.'),
        ' A probability-weighted bet size would size up on a "good bet"; we refuse that — the downside is taken down to the concrete floor (a number), and the only quality input is a one-directional down-weight. The sizing recommendation is computed on-demand at the watched→held step, recorded as an observation, and leads with the worst case (the concrete downside floor + its net-cash-vs-stressed-book basis + the aggregate correlated-cluster downside) BEFORE the target weight. The buy is human-signed; nothing auto-trades.',
      ),
      children: createElement(
        'div',
        { style: { display: 'grid', gap: '0.9rem' } },
        Table({
          headings: ['Guardrail', 'Threshold', 'What it does'],
          rows: [
            [
              createElement('span', { style: goldText }, 'Deployment cap'),
              createElement('span', { style: monoFigure }, pct(PER_NAME_CAP)),
              `Per-name ceiling on NEW buys/adds at execution time — caps how much capital deploys into one name.`,
            ],
            [
              createElement('span', { style: goldText }, 'Appreciation review'),
              createElement('span', { style: monoFigure }, `~${pct(CONCENTRATION_REVIEW_THRESHOLD)}`),
              `A HELD winner whose PRICE appreciates past this raises a human REVIEW — never an auto-trim, never a sale.`,
            ],
            [
              createElement('span', { style: goldText }, 'Deployment hurdle'),
              createElement('span', { style: monoFigure }, `~${pct(DEPLOYMENT_HURDLE, 1)}`),
              `A candidate's owner-earnings yield must clear savings (~${pct(DEFAULT_SAVINGS_EXPECTED_PROFIT_RATE, 1)}) + an equity-risk margin (~${pct(DEFAULT_EQUITY_RISK_MARGIN, 1)}) to deploy out of savings.`,
            ],
          ],
        }),
        createElement(
          'p',
          { style: { ...bodyStyle, margin: 0 } },
          'The two caps are distinct and BOTH review-only: the ',
          createElement('span', { style: goldText }, `${pct(PER_NAME_CAP)} deployment cap`),
          ' limits new capital going IN, while the ',
          createElement('span', { style: goldText }, `~${pct(CONCENTRATION_REVIEW_THRESHOLD)} appreciation-review threshold`),
          ' only flags a held winner whose price ran up for a human look. A winner appreciating between the two raises nothing — ',
          createElement('span', { style: goldText }, 'winners run; the target weight is an entry cap, not a rebalancing ceiling, and a compounder is never force-trimmed.'),
        ),
        createElement(
          'p',
          { style: { ...bodyStyle, margin: 0 } },
          createElement('span', { style: goldText }, 'Cash is a first-class position. '),
          `When nothing clears the deployment hurdle, idle capital stays in the Shariah-compliant Mudarabah savings sleeve — the CORRECT fat-pitch posture (waiting for the pitch), never under-deployment. The one savings rate does triple duty: the EXPECTED (not guaranteed) return on idle capital, the deployment-hurdle floor, and the discount's risk-free anchor.`,
        ),
        // ANCHOR-SWAP-F2 (SHIPPED): discount anchors on the compliant savings rate + equity_premium; Treasury retired. The savings rate IS the discount's risk-free anchor today (see discountRate() in @owlfolio/strategies). Keep this token in CODE only, never in rendered text.
        createElement(
          'p',
          { style: { ...microLabel, color: 'var(--owl-color-muted)', margin: 0 } },
          'Advisory only — the sizing recommendation is an observation recomputed on-demand; you author and sign every buy. The discount already anchors on this savings rate (the compliant savings rate + the equity premium); the interest-bearing Treasury anchor is retired.',
        ),
      ),
    }),

    // 7b. Tranche ladders (position-sizing-spec §2–§4) — both ladders + re-anchoring + time-completion
    Section({
      eyebrow: 'Tranche ladders',
      title: 'How a position is laddered in',
      lead: createElement(
        'span',
        null,
        'Tranches buy information, not just price. Entry is laddered across rungs, each beyond T1 gated by a thesis re-check. The harness suggests a ladder from the regime temperature at T1 (temperature ≤ ',
        createElement('span', { style: monoFigure }, String(REGIME_THRESHOLD)),
        ' → normal; ≥ ',
        createElement('span', { style: monoFigure }, String(REGIME_THRESHOLD + 1)),
        ' → cold); you confirm it in the T1 ledger entry and it is fixed for that position thereafter. Fractions and triggers below are read from the live sizing config.',
      ),
      children: createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '1.1rem' } },
        createElement(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.9rem' } },
          LadderTable('normal'),
          LadderTable('cold'),
        ),
        // Re-anchoring + time-completion rules (spec §3, §4)
        createElement(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.9rem' } },
          createElement(
            'div',
            { style: { ...bodyStyle, background: 'var(--owl-color-panel)', border: '1px solid var(--owl-color-border)', borderRadius: 'var(--owl-radius-card)', padding: '0.85rem 1rem' } },
            createElement('p', { style: { ...microLabel, marginBottom: '0.4rem' } }, 'Re-anchoring — tranches are value events'),
            createElement(
              'p',
              { style: { margin: 0 } },
              'Every thesis re-check recomputes fair value and buy price from current data. ',
              createElement('span', { style: goldText }, 'All untriggered tranche levels re-anchor to the recomputed buy price immediately'),
              ' — the old price path is irrelevant. A −10% "discount" off a stale buy price is no discount against deteriorated fundamentals. The ledger records each tranche alert with the buy-price version it was computed against.',
            ),
          ),
          createElement(
            'div',
            { style: { ...bodyStyle, background: 'var(--owl-color-panel)', border: '1px solid var(--owl-color-border)', borderRadius: 'var(--owl-radius-card)', padding: '0.85rem 1rem' } },
            createElement('p', { style: { ...microLabel, marginBottom: '0.4rem' } }, 'Time-completion — cheaper or confirmed'),
            createElement(
              'p',
              { style: { margin: 0 } },
              'If price has stayed at or below the re-anchored buy price for ',
              createElement('span', { style: monoFigure }, `${TIME_COMPLETION_MONTHS} months`),
              ' since the last fill and the latest re-check is clean, the next tranche fires at the prevailing price, flagged ',
              createElement('span', { style: { ...monoFigure, color: 'var(--owl-color-gold-bright)' } }, 'trigger: time_completion'),
              '. Time-completion substitutes only for the price trigger — never for the thesis re-check. The clock resets on every fill and every re-anchoring.',
            ),
          ),
        ),
        createElement(
          'p',
          { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)', margin: 0 } },
          'T2/T3 alerts are blocked while any thesis-break trigger is unresolved, regardless of price. Tranche alerts are drafts; you author every fill as a ledger event with lot-level tags (tranche_id, trigger_type, buy_price_version).',
        ),
      ),
    }),

    // 7c. The unified name lifecycle + the single cadence engine
    Section({
      eyebrow: 'The name lifecycle',
      title: 'One list of names, one cadence engine',
      lead: createElement(
        'span',
        null,
        'After a verdict, a name lives on a single unified list and moves through one lifecycle: ',
        createElement('span', { style: goldText }, 'candidate → watched → held → exited'),
        '. It becomes a candidate from discovery and research, advances to watched on a user-confirmed watchlist entry, becomes held on an explicit open-holding entry, and is exited only when no live entity remains. There are not separate watchlist and holdings monitors — ',
        createElement('span', { style: goldText }, 'one cadence engine'),
        ' runs the same falsifier check and re-underwrite across the whole list; its detection is state-independent and only the action it can take branches on the state. Every transition is human-authored and append-only; the worker observes and drafts, never trades.',
      ),
      children: createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '0.6rem' } },
        Table({
          headings: ['State', 'Means', 'Cadence action (state-branched)'],
          rows: [
            [createElement('span', { style: goldText }, 'candidate'), 'In research, not yet user-confirmed to the watchlist', 'Advance or screen out (research re-run)'],
            [createElement('span', { style: goldText }, 'watched'), 'User-confirmed, tracked for a buy window', createElement('span', null, 'Buy-window / staleness observation; a tripped falsifier flags it ', createElement('span', { style: rejected }, 'deteriorating'), ' (no prune action yet — later phase)')],
            [createElement('span', { style: goldText }, 'held'), 'An open holding (explicit user entry)', 'Tranche / concentration / Shariah-grace re-check'],
            [createElement('span', { style: goldText }, 'exited'), 'No live entity — sold, or screened out', 'Post-mortem; re-discovery keeps prior-exit history'],
          ],
        }),
        createElement(
          'p',
          { style: { ...bodyStyle, margin: 0 } },
          'Sold and screened-out are opposite kinds of exit and are kept distinct. Position sizing on the watched→held step and a prune action for deteriorating watched names are later phases — the lifecycle view shows those gaps rather than hiding them.',
        ),
      ),
    }),

    // 7d. Sell discipline (Phase 6) — the four triggers, no stop-loss, the minimum-hold guard, human close.
    Section({
      eyebrow: 'Sell discipline',
      title: 'A sell needs a reason — price is an input, never a cause',
      lead: createElement(
        'span',
        null,
        'A held name gets an advisory ',
        createElement('span', { style: goldText }, 'sell decision'),
        ' on-demand — worst case first, then a verdict. It is bounded by the recommendation and never trades: the ',
        createElement('span', { style: goldText }, 'close is human-authored'),
        ', and there is no auto-sell. A sale needs one of four real reasons; a falling price alone is never one of them.',
      ),
      children: createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '0.9rem' } },
        Table({
          headings: ['Trigger', 'What it means'],
          rows: [
            [createElement('span', { style: goldText }, 'thesis broke'), 'The durable advantage or the original bet no longer holds.'],
            [createElement('span', { style: goldText }, 'valuation inverted'), createElement('span', null, 'Price reached the frozen intrinsic value. Pabrai recant: do NOT sell winners at 90–95% of IV — fires only at/above ', createElement('span', { style: monoFigure }, pct(SELL_IV_FRACTION)), ' of the sign-off-frozen IV (a hard threshold; biased to hold below it).')],
            [createElement('span', { style: goldText }, 'better opportunity'), createElement('span', null, 'A materially higher net owner-earnings yield — at least ', createElement('span', { style: monoFigure }, pct(BETTER_OPP_MIN_MARGIN, 1)), ' after switching friction — and it ALSO always needs human sign-off.')],
            [createElement('span', { style: goldText }, 'original mistake'), 'The underwriting was wrong from the start — admit it and exit rather than anchor to the entry price.'],
          ],
        }),
        createElement(
          'div',
          { style: { ...bodyStyle, background: 'var(--owl-color-panel)', border: '1px solid var(--owl-color-border)', borderRadius: 'var(--owl-radius-card)', padding: '0.85rem 1rem' } },
          createElement('p', { style: { ...microLabel, marginBottom: '0.4rem' } }, 'No stop-loss · the minimum-hold guard consumes the fixable-vs-permanent judgment'),
          createElement(
            'p',
            { style: { margin: 0 } },
            createElement('span', { style: goldText }, 'There is no stop-loss'),
            ' — price is an input to "are we at a loss?", never the cause of a sale. The minimum-hold guard is ',
            createElement('span', { style: goldText }, 'not a clock'),
            ': a trigger inside the ~',
            createElement('span', { style: monoFigure }, `${MIN_HOLD_MONTHS}-month`),
            ' window is held only when the problem is judged ',
            createElement('span', { style: goldText }, 'fixable / temporary'),
            '; a permanent impairment releases a sell review even inside the window. When the judgment is ',
            createElement('span', { style: goldText }, 'unresolved'),
            ', the decision escalates to human review rather than defaulting either way. Guard-held is the disposition brake working as designed — surfaced as the correct posture, not a warning. Disposition and anchoring bias guards are advisory; they never block or change the decision.',
          ),
        ),
        createElement(
          'p',
          { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)', margin: 0 } },
          'The sell decision is advisory and bounded by the recommendation — it leads with the concrete worst case (the downside floor + its net-cash-vs-stressed-book basis = a reliability signal), runs the four triggers + the minimum-hold guard + the bias guards, and stops there. The exit is always authored and signed by you; the harness never closes a holding.',
        ),
      ),
    }),

    // 7e. Quality & bias hygiene checklists (Phase 7) — completion-block on both sign-offs, decision-neutral.
    Section({
      eyebrow: 'Quality & bias hygiene',
      title: 'Two checklists that force the question — they never score it',
      lead: createElement(
        'span',
        null,
        'Both the admission sign-off and the re-underwrite sign-off carry two hygiene checklists. They are a ',
        createElement('span', { style: goldText }, 'hygiene surface, not a gate'),
        ': each FORCES you to address a known failure mode, but ',
        createElement('span', { style: goldText }, 'never scores, tallies, or pass/fails'),
        ' your answers — there is no pass/fail count, and a "risk present" answer never auto-rejects. The ',
        createElement('span', { style: goldText }, 'business'),
        ' list (agent-marshaled evidence beside each item, which you still affirm) guards the investment; the ',
        createElement('span', { style: goldText }, 'cognitive'),
        ' list (human-only — the agent never pre-fills) guards your reasoning. Both are a ',
        createElement('span', { style: goldText }, 'completion-block'),
        ': every item must be addressed in your own words before either sign-off goes through. The checklist informs; you and the existing gates decide. The lists below are read live from the versioned checklist config and grow as the owner adds failure modes from experience.',
      ),
      children: createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '0.9rem' } },
        createElement(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.9rem' } },
          createElement(ChecklistPromptColumn, { category: 'business', heading: 'Business failure modes' }),
          createElement(ChecklistPromptColumn, { category: 'cognitive', heading: 'Cognitive biases' }),
        ),
        createElement(
          'p',
          { style: { ...bodyStyle, fontSize: 'var(--owl-text-sm)', color: 'var(--owl-color-quiet)', borderLeft: '2px solid var(--owl-color-border)', paddingLeft: '0.85rem', margin: 0 } },
          'Decision-neutral by construction: the checklist lists the questions to address and refuses to let a sign-off through with an unaddressed item — it does not auto-reject, score, or rank. The human plus the existing hard gates make the decision.',
        ),
      ),
    }),

    // 8. Boundaries
    Section({
      eyebrow: 'Honest boundaries',
      title: 'What this is — and is not',
      children: createElement(
        'p',
        { style: bodyStyle },
        'Automated output is a draft or observation — never a recommendation to act. Every irreversible transition is human-authored and recorded in the local ledger.',
      ),
    }),
  )
}
