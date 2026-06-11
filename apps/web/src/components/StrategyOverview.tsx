import { createElement, type CSSProperties, type ReactNode } from 'react'

import {
  buffettMungerStrategy,
  creditedGrowth,
  discountRate,
  marginOfSafetyForMoat,
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

import { RouteHeader, OwlValuationChip } from './designSystem'

// ── Live contract values (rendered, never hard-coded) ───────────────────────
const strategy = buffettMungerStrategy
const DISCOUNT = discountRate(strategy)
const MULTIPLE_CEILING = strategy.valuation.valuation_multiple_ceiling
const MIN_INVESTABLE_MOAT = strategy.valuation.min_investable_moat
const MOS_WIDE = marginOfSafetyForMoat(strategy, 'wide')
const MOS_MONOPOLY = marginOfSafetyForMoat(strategy, 'monopoly')
const TERMINAL_G_WIDE = terminalGrowthForMoat(strategy, 'wide')
const TERMINAL_G_MONOPOLY = terminalGrowthForMoat(strategy, 'monopoly')
const MAX_GROWTH = strategy.valuation.max_growth
const GROWTH_ELIGIBILITY_INC_ROIC = strategy.valuation.growth_eligibility_incremental_roic
const BANDS = strategy.valuation.growth_band_ceilings

// Worked example — a monopoly compounder, computed from the live contract so the prose tracks params.
const EX_OE = 14
const EX_RUNWAY = 'proven' as const
const EX_INC_ROIC = 0.2
const EX_REINV = 0.4
const EX_G = creditedGrowth(strategy, {
  reinvestment_rate: EX_REINV,
  incremental_roic: EX_INC_ROIC,
  runway: EX_RUNWAY,
  moat_class: 'monopoly',
})
const EX_FV = twoStageFairValuePerShare({
  oe_ps: EX_OE,
  g: EX_G,
  terminal_g: TERMINAL_G_MONOPOLY,
  discount: DISCOUNT,
  ceiling_multiple: MULTIPLE_CEILING,
})
const EX_BUY = Math.round(EX_FV * (1 - MOS_MONOPOLY) * 100) / 100
const EX_IMPLIED = EX_FV / EX_OE
const TARGET_WIDE = strategy.portfolio.target_weight_by_moat.wide
const TARGET_MONOPOLY = strategy.portfolio.target_weight_by_moat.monopoly
const TRANCHES = strategy.portfolio.entry_tranches
const MAX_POSITION_WEIGHT = strategy.portfolio.max_position_weight
const MAX_POSITIONS = strategy.portfolio.max_positions

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
    assesses: 'The owner-earnings bridge, ROIC and reinvestment inputs the harness needs; the deterministic harness then computes fair value and buy price.',
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
        'Buy a small number of understandable businesses with durable economic moats and honest, capable management, only when the price offers a margin of safety against a conservative estimate of intrinsic value — then hold. ',
        createElement('span', { style: goldText }, 'Agents propose; the harness computes; you decide.'),
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

    // 5. Valuation method (two-stage DCF)
    Section({
      eyebrow: 'Value',
      title: 'Valuation — two-stage discounted owner earnings',
      lead: createElement(
        'span',
        null,
        'Pay for current owner earnings plus modest, evidence-backed reinvestment value — never pay upfront for all future compounding. Owner earnings are discounted in two stages: ten years at a credited growth rate, then a fade to a small terminal rate. The discount is a flat ',
        createElement('span', { style: monoFigure }, pct(DISCOUNT)),
        ' — no WACC, no beta, ever. The certainty difference between moat classes lives in the margin of safety, not the discount rate.',
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
          createElement('div', null, 'OE   = NI + D&A − maintenance capex (20/50/80% proxy) − SBC − ΔNWC'),
          createElement('div', null, `g    = reinvestment × incremental ROIC, banded by runway — credited only when inc-ROIC > ${pct(GROWTH_ELIGIBILITY_INC_ROIC)}, ${pct(MAX_GROWTH)} max`),
          createElement('div', null, `gₜ   = terminal fade: monopoly ${pct(TERMINAL_G_MONOPOLY)} / wide ${pct(TERMINAL_G_WIDE)}`),
          createElement('div', null, `fair = Σ OE(1+g)ᵗ/(1+${pct(DISCOUNT)})ᵗ  [t=1..10]  +  OE(1+g)¹⁰(1+gₜ)/(${pct(DISCOUNT)}−gₜ) / (1+${pct(DISCOUNT)})¹⁰`),
          createElement('div', null, `fair = min( fair,  ${MULTIPLE_CEILING}× OE )    — a genuine independent brake`),
          createElement('div', null, 'buy  = fair × (1 − margin of safety)'),
        ),

        // Growth bands — runway is the binding axis; moat tier only sets the ceiling.
        createElement('p', { style: microLabel }, 'Credited growth — runway sets the value, moat tier the ceiling'),
        Table({
          headings: ['Runway × moat', 'Band ceiling'],
          rows: [
            [createElement('span', { style: goldText }, 'limited / none — any tier'), createElement('span', { style: monoFigure }, pct(BANDS.limited_or_none))],
            [createElement('span', { style: goldText }, 'wide + proven'), createElement('span', { style: monoFigure }, `${pct(BANDS.wide_proven)} (${pct(BANDS.wide_proven_exceptional)} exceptional)`)],
            [createElement('span', { style: goldText }, 'monopoly + proven'), createElement('span', { style: monoFigure }, `${pct(BANDS.monopoly_proven)} (${pct(BANDS.monopoly_proven_exceptional)} exceptional)`)],
          ],
        }),

        // MoS table
        createElement('p', { style: microLabel }, 'Moat-tiered margin of safety'),
        Table({
          headings: ['Moat class', 'Discount rate', 'Terminal g', 'Margin of safety'],
          rows: [
            [createElement('span', { style: goldText }, 'wide'), createElement('span', { style: monoFigure }, pct(DISCOUNT)), createElement('span', { style: monoFigure }, pct(TERMINAL_G_WIDE)), createElement('span', { style: monoFigure }, pct(MOS_WIDE))],
            [createElement('span', { style: goldText }, 'monopoly'), createElement('span', { style: monoFigure }, pct(DISCOUNT)), createElement('span', { style: monoFigure }, pct(TERMINAL_G_MONOPOLY)), createElement('span', { style: monoFigure }, pct(MOS_MONOPOLY))],
          ],
        }),

        // Worked example — computed from the live contract.
        createElement(
          'div',
          { style: { ...bodyStyle, background: 'var(--owl-color-panel)', border: '1px solid var(--owl-color-border)', borderRadius: 'var(--owl-radius-card)', padding: '0.85rem 1rem' } },
          createElement('p', { style: { ...microLabel, marginBottom: '0.4rem' } }, 'Worked example — a monopoly compounder'),
          createElement(
            'p',
            { style: { margin: 0 } },
            'Owner earnings of ',
            createElement('span', { style: monoFigure }, `$${EX_OE}`),
            ' per share, a proven reinvestment runway, and incremental ROIC of ',
            createElement('span', { style: monoFigure }, pct(EX_INC_ROIC)),
            ' on a ',
            createElement('span', { style: monoFigure }, pct(EX_REINV)),
            ' reinvestment rate credit growth of ',
            createElement('span', { style: monoFigure }, pct(EX_G)),
            ` (raw ${pct(EX_REINV * EX_INC_ROIC, 1)} clamped to the monopoly+proven band). Discounting ten years of that growth and fading to a `,
            createElement('span', { style: monoFigure }, pct(TERMINAL_G_MONOPOLY)),
            ' terminal rate gives a fair value of ',
            createElement('span', { style: monoFigure }, `$${EX_FV.toFixed(0)}`),
            ` (${EX_IMPLIED.toFixed(1)}× owner earnings, under the ${MULTIPLE_CEILING}× cap). A monopoly carries a `,
            createElement('span', { style: monoFigure }, pct(MOS_MONOPOLY)),
            ' margin of safety, so the buy price is ',
            createElement('span', { style: monoFigure }, `$${EX_FV.toFixed(0)} × (1 − ${pct(MOS_MONOPOLY)}) = $${EX_BUY.toFixed(0)}`),
            '. A wide-moat business would fade to a ',
            createElement('span', { style: monoFigure }, pct(TERMINAL_G_WIDE)),
            ' terminal and demand a ',
            createElement('span', { style: monoFigure }, pct(MOS_WIDE)),
            ' buffer instead.',
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
        createElement('li', null, createElement('span', { style: goldText }, 'Growth eligibility'), ` — growth is credited only when incremental ROIC exceeds ${pct(GROWTH_ELIGIBILITY_INC_ROIC)}, banded by reinvestment runway, ${pct(MAX_GROWTH)} maximum.`),
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
