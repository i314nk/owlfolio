import { createElement, type ReactNode } from 'react'

import type {
  ResearchCaseSellBiasCaveatProjection,
  ResearchCaseSellWorstCaseProjection,
} from '@owlfolio/ledger/projections/researchCaseProjection'
import { buffettMungerStrategy, discountRate } from '@owlfolio/strategies/buffettMunger'
import { ENGINE_VERSION } from '@owlfolio/strategies/engineVersion'
import { isDeepDiveComplete } from '@owlfolio/workflow/admitAssessment'

import { resolveAdmissionThesisDraft, resolveBusinessFindings } from '../lib/checklistEvidence'

import type { PositionPlan, PositionTranche } from '../lib/positionPlan'

import { AdmitRecommendationRequest } from './AdmitRecommendationRequest'
import { SellDecisionRequest } from './SellDecisionRequest'
import { SizingRecommendationRequest } from './SizingRecommendationRequest'
import { SourceChip } from './designSystem'
import { StatusBadge } from './StatusBadge'
import { WatchlistPromotionForm } from './WatchlistPromotionForm'
import type { AppResearchCase, AppSourceEvidence, WorkflowMode } from '../lib/workflow'

// Live default discount when an event predates a stored discount_rate: the savings-anchored default
// (compliant savings rate + equity premium), computed from the versioned strategy contract — never a
// hard-coded "10%". Mirrors how StrategyOverview/LearnTabs render the live discount.
const DEFAULT_DISCOUNT_LABEL = `${Math.round(discountRate(buffettMungerStrategy) * 100)}%`

export type MarketQuote = {
  price_per_share: number
  currency: string
  as_of: string
  source: string
}

export type ResearchCasePanelProps = {
  researchCase: AppResearchCase
  mode?: WorkflowMode
  /**
   * The provider the user has CONFIGURED (mode + provider.provider_id come from the app-config store via
   * the page). Used only for the defense-in-depth honesty banner: a personal-local dossier authored by
   * the built-in mock provider while a real provider is configured is flagged as a placeholder run.
   */
  configuredProviderId?: string
  marketQuote?: MarketQuote
  positionPlan?: PositionPlan
  promptForCapital?: boolean
}

// ── Shared style tokens ───────────────────────────────────────────────────────

const cardStyle = {
  background: 'var(--owl-color-panel)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-panel)',
  boxShadow: 'var(--owl-shadow-panel)',
  padding: '1.25rem 1.4rem',
}

const labelStyle = {
  color: 'var(--owl-color-accent-bright)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-xs)',
  fontWeight: 800,
  letterSpacing: '0.1em',
  margin: '0 0 0.5rem',
  textTransform: 'uppercase' as const,
}

const collapsibleSummaryStyle = {
  color: 'var(--owl-color-gold-bright)',
  cursor: 'pointer',
  fontSize: 'var(--owl-text-base)',
  fontWeight: 900,
  padding: '0.15rem 0',
  userSelect: 'none' as const,
}

const collapsibleDetailsStyle = {
  background: 'var(--owl-color-panel-deep)',
  border: '1px solid rgba(148, 163, 184, 0.12)',
  borderRadius: '0.95rem',
  padding: '1rem',
}

// ── Masonry / flow packing (Priority 1) ───────────────────────────────────────
//
// Rigid equal-height multi-column grids leave dead voids when a short card sits beside a long one
// (e.g. three short evidence cards beside the long Risks card; a short lane beside a tall one). CSS
// multi-column flow packs each card to its own content height and reflows to fill vertical space — the
// lowest-risk no-JS approach that mirrors the file's existing inline-style idiom. Each child carries
// `masonryItemStyle` (break-inside: avoid + inline-block full-width) so cards never split across columns
// and pack with no equal-height gap. Tagged with a stable data attribute for the structural flow test.
const masonryContainerStyle = {
  columnGap: '0.9rem',
  columns: '220px',
} as const

const masonryItemStyle = {
  breakInside: 'avoid' as const,
  display: 'inline-block',
  marginBottom: '0.9rem',
  width: '100%',
}

/**
 * A masonry/flow container: CSS multi-column packing so variable-height cards reflow to content height
 * with no equal-height voids. Children are expected to carry `masonryItemStyle`. `data-owl-flow` is the
 * stable structural hook the layout test asserts (short + long cards coexist in one flow container).
 */
function createMasonryFlow(testId: string, children: ReactNode[]) {
  return createElement(
    'div',
    { 'data-owl-flow': 'masonry', 'data-testid': testId, style: masonryContainerStyle },
    ...children,
  )
}

// ── Compact citation marker (Priority 5) ──────────────────────────────────────
//
// The verbose inline `[cited: sec_edgar_10k_<id>]` after every claim clutters the reading line. Replace
// it with a COMPACT superscript marker (a small mono index + source glyph) — full traceability preserved:
// the complete id stays discoverable via the `title` hover AND in the Evidence-and-sources section below.
// A marker that did NOT verify is rendered in the risk tone and reads "✕" so an unverified cite is never
// quietly hidden. Native owl-* tokens only.
function createCitationMarker(citation: string, grounded: boolean | undefined, index: number) {
  const verified = grounded !== false
  return createElement(
    'sup',
    {
      key: `cite-${index}-${citation}`,
      'data-testid': 'citation-marker',
      title: verified ? `Source: ${citation}` : `Citation did not verify: ${citation}`,
      style: {
        color: verified ? 'var(--owl-color-gold)' : 'var(--owl-color-risk-bright)',
        cursor: 'help',
        fontFamily: 'var(--owl-font-mono)',
        fontSize: 'var(--owl-text-2xs)',
        fontWeight: 800,
        marginLeft: '0.2rem',
        whiteSpace: 'nowrap' as const,
      },
    },
    verified ? `[${index}]` : `[${index}✕]`,
  )
}

// ── Gated-state detection ─────────────────────────────────────────────────────

/**
 * A case is "gated" (rejected at quick screen) when:
 * - stage is 'rejected' (screening_result === 'reject') — Shariah/hard fail
 * - stage is 'pass' with moat_passes_gate === false — below wide-moat gate
 */
function isGatedCase(researchCase: AppResearchCase): boolean {
  if (researchCase.stage === 'rejected') return true
  if (researchCase.stage === 'pass' && researchCase.valuation?.moat_passes_gate === false) return true
  return false
}

function gatedReason(researchCase: AppResearchCase): { title: string; reason: string; failingGate: string } {
  if (researchCase.stage === 'rejected') {
    const shariahFail = researchCase.shariah_status === 'NON_COMPLIANT'
    if (shariahFail) {
      return {
        title: 'Rejected at quick screen · deep dive skipped',
        reason: 'Shariah screen failed — core business activity is non-compliant (prohibited sector). The quick screen stops here by design: no deep-dive swarm was run, so no provider cost was spent.',
        failingGate: 'Shariah pre-check — NON_COMPLIANT (prohibited business activity)',
      }
    }
    const redFlags = researchCase.red_flags ?? []
    return {
      title: 'Rejected at quick screen · deep dive skipped',
      reason: `Quick screen rejected this candidate. ${redFlags.length > 0 ? redFlags.join('; ') : 'See gate checklist for details.'}`,
      failingGate: redFlags[0] ?? 'Quick screen gate failed',
    }
  }
  // pass + moat below gate
  const moatClass = researchCase.valuation?.moat_class ?? 'unknown'
  return {
    title: 'Below the wide-moat gate · deep dive skipped',
    reason: `Moat classification is ${moatClass}, which does not pass the ≥ wide gate required by the Buffett-Munger strategy. No deep-dive swarm was run.`,
    failingGate: `Moat gate — ${moatClass} does not pass ≥ wide`,
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export function ResearchCasePanel({ researchCase, mode = 'demo', configuredProviderId, marketQuote, positionPlan, promptForCapital = false }: ResearchCasePanelProps) {
  // Defense-in-depth UI honesty: warn when a personal-local case was authored by the built-in mock
  // provider instead of the configured provider — a placeholder/mock run can never masquerade as a real
  // grounded dossier. In demo mode (mock is the legitimate, expected provider) the banner never shows.
  const mockWarningBanner = (
    researchCase.authored_by_provider_id === 'mock-provider'
    && mode === 'personal-local'
    && configuredProviderId !== undefined
    && configuredProviderId !== 'mock-provider'
  ) ? createMockProviderWarning(configuredProviderId) : null

  const canPromoteToWatchlist = mode === 'personal-local'
    && researchCase.stage === 'decision_drafted'
    && researchCase.decision !== undefined
    && researchCase.decision_id !== undefined

  // Admit recommendation (Task 4.3-panel): show the on-demand request control + the persisted
  // recommendation for a deep-dive-complete, gate-passing admission candidate (personal-local only),
  // or whenever a recommendation has already been recorded.
  const hasAdmitRecommendation = researchCase.admit_recommendation !== undefined
  const isAdmissionCandidate = isDeepDiveComplete(researchCase.stage)
    && researchCase.valuation?.moat_passes_gate === true
  const showAdmitPanel = mode === 'personal-local' && (hasAdmitRecommendation || isAdmissionCandidate)

  // Sizing panel (Phase 5 S7): show the on-demand sizing request + the persisted recommendation once a
  // name is an admittable candidate that carries the admit recommendation (the downside floor + risk
  // levels sizing reads), or whenever a sizing recommendation has already been recorded.
  const hasSizingRecommendation = researchCase.sizing_recommendation !== undefined
  const showSizingPanel = mode === 'personal-local'
    && (hasSizingRecommendation || (isAdmissionCandidate && hasAdmitRecommendation))

  // Sell decision panel (Phase 6 S8b): show the on-demand sell-decision request + the persisted advisory
  // recommendation once a name is HELD, or whenever a sell decision has already been recorded. The CLOSE
  // stays human-authored — this panel never offers an auto-sell.
  const hasSellRecommendation = researchCase.sell_recommendation !== undefined
  const isHeld = researchCase.stage === 'holding'
  const showSellPanel = mode === 'personal-local' && (hasSellRecommendation || isHeld)

  const gated = isGatedCase(researchCase)

  if (gated) {
    return createElement(
      'section',
      { style: { display: 'grid', gap: '1rem' } },
      mockWarningBanner,
      createGatedDossier(researchCase),
    )
  }

  if (researchCase.stage === 'awaiting_deep_dive_approval') {
    return createElement(
      'section',
      { style: { display: 'grid', gap: '1rem' } },
      mockWarningBanner,
      createAwaitingDeepDiveDossier(researchCase),
    )
  }

  return createElement(
    'section',
    { style: { display: 'grid', gap: '1rem' } },
    // ── 0. Mock-provider honesty banner (personal-local, mock-authored, real provider configured) ──
    mockWarningBanner,
    // ── 1. Verdict hero ─────────────────────────────────────────────────────
    createVerdictHero(researchCase),
    // ── 1·circle. Circle-of-competence judgment (the grounded gate that admits/sets-aside the spend) ──
    createCircleCompetencePanel(researchCase),
    // ── 1b. What changed since last case (re-analysis diff) ──────────────────
    createReAnalysisDiffPanel(researchCase),
    // ── 1c. Exit post-mortem (predicted vs realized) ─────────────────────────
    createPostMortemPanel(researchCase),
    // ── 1d. Decision panel (R1): the model's verdict/valuation_status, the key-figures strip (model
    //        buy-below + live price + buy-zone + reference FV + price-implied assumptions), and the
    //        flag-only sanity-check. The decision centerpiece. ──
    createDecisionPanel(researchCase, marketQuote),
    // ── 1e. Margin-of-safety audit — LEADS the decision region (Priority 3): the synthesis-owned JOINT
    //        judgment (price margin + moat durability, side by side), the human's central audit surface.
    //        Promoted above the valuation reasoning so it is not blended into the decision/valuation prose. ──
    createMarginOfSafetyAuditBlock(researchCase),
    // ── 2. Valuation panel — the model thesis + cited reasoning (owner-earnings basis, judged growth +
    //       rationale, discount), the reverse-DCF read (market-implied vs judged sustainable growth), the
    //       two hidden assumptions the price bakes in (implied growth + implied exit multiple), the
    //       reference FV cross-check, and the independent bear case (red-team). ──
    createValuationPanel(researchCase, marketQuote),
    // ── 2b. Position plan (advisory) ─────────────────────────────────────────
    createPositionPlanPanel(positionPlan, promptForCapital),
    // ── 3. Four summary cards (always visible) ───────────────────────────────
    createDecisionEvidence(researchCase),
    // ── 4. Visible specialist lanes ──────────────────────────────────────────
    createSpecialistLanesGrid(researchCase),
    // ── 4b. Falsifiable forecasts (calibration scaffold) ─────────────────────
    createForecastsPanel(researchCase),
    // ── 4c. Admit recommendation (advisory) + on-demand request (personal-local) ──
    showAdmitPanel ? createAdmitRecommendationPanel(researchCase) : null,
    // ── 4d. Sizing recommendation (advisory, worst-case-first) + on-demand request (personal-local) ──
    showSizingPanel ? createSizingRecommendationPanel(researchCase) : null,
    // ── 4e. Sell decision (advisory, worst-case-first; HELD context) + on-demand request (personal-local) ──
    showSellPanel ? createSellDecisionPanel(researchCase) : null,
    // ── 5. Watchlist promotion (personal-local only) ─────────────────────────
    canPromoteToWatchlist ? createWatchlistPromotionAction(researchCase) : null,
    // ── 6. Actions row ──────────────────────────────────────────────────────
    createActionsRow(),
    // ── 7. Evidence and audit details (collapsed, e2e anchor) ────────────────
    createEvidenceAndAuditDetails(researchCase),
  )
}

// ── Mock-provider honesty banner ──────────────────────────────────────────────
//
// Defense-in-depth: a personal-local dossier authored by the built-in mock provider while the user has a
// real provider configured is a PLACEHOLDER run, not a grounded one. Prominent but non-alarming (a risk
// StatusBadge + a short line), so a mock run can never quietly masquerade as a real grounded dossier.

function createMockProviderWarning(configuredProviderId: string) {
  return createElement(
    'div',
    {
      'data-testid': 'mock-provider-warning',
      style: {
        ...cardStyle,
        borderLeft: '3px solid var(--owl-color-gold)',
        background: 'rgba(214, 178, 94, 0.08)',
        display: 'grid',
        gap: '0.5rem',
      },
    },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
      createElement(StatusBadge, { tone: 'warning' }, 'Placeholder run'),
      createElement(
        'span',
        { style: { color: 'var(--owl-color-gold-bright)', fontSize: 'var(--owl-text-md)', fontWeight: 800 } },
        'Generated by the built-in mock provider',
      ),
    ),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } },
      `This dossier was generated by the built-in mock provider, not your configured provider (${configuredProviderId}). It is not a real grounded research run. Re-run research to get a real dossier.`,
    ),
  )
}

// ── Module 10: re-analysis diff / post-mortem / forecasts ─────────────────────

function formatDiffValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return String(value)
  return value
}

/** "What changed since last case" — the re-analysis diff vs the prior superseded version. */
function createReAnalysisDiffPanel(researchCase: AppResearchCase) {
  const diff = researchCase.reanalysis_diff
  if (diff === undefined || !diff.has_changes) {
    return null
  }
  return createElement(
    'details',
    { 'aria-label': 'What changed since last case', style: { ...collapsibleDetailsStyle }, open: true },
    createElement('summary', { style: collapsibleSummaryStyle }, 'What changed since last case'),
    createElement('p', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: '0.5rem 0' } }, `Re-analysis supersedes ${diff.prior_research_case_id}. The harness records the field-level diff.`),
    createElement(
      'ul',
      { style: { display: 'grid', gap: '0.35rem', margin: 0, paddingLeft: '1.1rem' } },
      ...diff.changes.map((change) => createElement(
        'li',
        { key: change.field, style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)' } },
        createElement('strong', null, `${change.field}: `),
        `${formatDiffValue(change.from)} → ${formatDiffValue(change.to)}`,
        change.note === undefined ? null : createElement('span', { style: { color: 'var(--owl-color-muted)' } }, ` (${change.note})`),
      )),
    ),
  )
}

/** Exit post-mortem summary (predicted vs realized) for an exited position. */
function createPostMortemPanel(researchCase: AppResearchCase) {
  const pm = researchCase.post_mortem
  if (pm === undefined) return null

  const mos = pm.mos_protection
  const mosText = mos.held === undefined
    ? 'Not computable'
    : `${mos.held ? 'Held' : 'Failed'}${mos.entry_discount_to_fv === undefined ? '' : ` — entry discount ${(mos.entry_discount_to_fv * 100).toFixed(1)}% vs required ${mos.required_mos === undefined ? '—' : `${(mos.required_mos * 100).toFixed(0)}%`}`}`

  const g = pm.credited_g_vs_actual
  const gText = g.computable
    ? `predicted ${g.predicted_g === undefined ? '—' : `${(g.predicted_g * 100).toFixed(1)}%`} vs actual ${g.actual_g === undefined ? '—' : `${(g.actual_g * 100).toFixed(1)}%`}`
    : (g.reason ?? 'Not computable')

  const laneText = pm.most_wrong_lane.lane !== undefined
    ? `${pm.most_wrong_lane.lane}${pm.most_wrong_lane.brier === undefined ? '' : ` (Brier ${pm.most_wrong_lane.brier.toFixed(2)})`}`
    : 'Pending forecast resolutions'

  const row = (label: string, value: string) => createElement(
    'div',
    { key: label, style: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap' } },
    createElement('span', { style: { color: 'var(--owl-color-muted)', fontWeight: 700, minWidth: '12rem' } }, label),
    createElement('span', { style: { color: 'var(--owl-color-text)' } }, value),
  )

  return createElement(
    'section',
    { 'aria-label': 'Exit post-mortem', style: { ...cardStyle, borderLeft: '3px solid var(--owl-color-accent-bright)' } },
    createElement('p', { style: labelStyle }, 'Exit post-mortem'),
    createElement('p', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: '0 0 0.7rem' } }, 'Predicted vs realized — the arithmetic is the harness’s; a human may annotate. The system learns through its parameters, not loosened judgment.'),
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.4rem' } },
      row('MOS protection', mosText),
      row('Judged growth vs actual', gText),
      row('Which lane was most wrong', laneText),
      pm.holding_period_days === undefined ? null : row('Holding period', `${pm.holding_period_days} days`),
      pm.total_realized_pl === undefined ? null : row('Total realized P&L', `$${pm.total_realized_pl.toLocaleString('en-US')}`),
    ),
  )
}

/**
 * Circle-of-competence judgment panel — the GROUNDED MODEL JUDGMENT that gated the deep-dive spend. Shows
 * the cited cashflow drivers, the cited predictability-breakers (the deeper test), and the in/outside
 * outcome with reasoning. When outside-competence, the case was SET ASIDE (verdict PASS) before the 7-lane
 * deep dive ran. Legacy-tolerant: renders nothing when the case predates the circle gate.
 */
function createCircleCompetencePanel(researchCase: AppResearchCase) {
  const circle = researchCase.circle_competence
  if (circle === undefined) return null

  // Bug B: prefer the predictability ENUM; legacy-tolerant — old events carry only the in_competence boolean
  // (map true → durably_predictable-equivalent). The gate proceeds only on durably_predictable + grounded.
  const predictability = circle.cashflow_predictability
    ?? (circle.in_competence === true ? 'durably_predictable' : undefined)
  const inCompetence = circle.in_competence === true && predictability === 'durably_predictable'
  const accent = inCompetence ? 'var(--owl-color-accent-bright)' : 'var(--owl-color-risk)'
  const heading = inCompetence
    ? 'Cashflows durably predictable — in competence'
    : predictability === 'not_predictable'
      ? 'Outside competence — set aside (cashflows not durably predictable)'
      : predictability === 'uncertain'
        ? 'Outside competence — set aside (cashflow predictability uncertain)'
        : 'Outside competence — set aside'

  // Compact citation markers (Priority 5): each claim's cite collapses to a superscript marker — full id
  // on hover (title) and in the Evidence-and-sources section. Markers are numbered across the panel.
  let citeIndex = 0
  const claimRow = (text: string, citation: string | undefined, grounded: boolean | undefined) =>
    createElement(
      'li',
      { key: `${text}:${citation ?? ''}`, style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)', lineHeight: 1.5, marginBottom: '0.3rem' } },
      createElement('span', null, text),
      citation === undefined ? null : createCitationMarker(citation, grounded, ++citeIndex),
    )

  const drivers = circle.cashflow_drivers ?? []
  const breakers = circle.predictability_breakers ?? []

  return createElement(
    'section',
    { 'data-testid': 'circle-competence', 'aria-label': 'Circle of competence', style: { ...cardStyle, borderLeft: `3px solid ${accent}` } },
    createElement('p', { style: labelStyle }, heading),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: '0 0 0.7rem' } },
      inCompetence
        ? 'The model demonstrated it understands this business well enough to assess its cashflow predictability — both clauses cite verified filings. The deep dive proceeded.'
        : 'The model could not demonstrate (from cited filings) that it understands this business well enough to assess its cashflow predictability. Ungrounded competence is outside competence — a valid, common, correct Buffett output. Set aside before the deep dive; no expensive spend.',
    ),
    createElement('p', { style: { color: 'var(--owl-color-muted)', fontWeight: 700, fontSize: 'var(--owl-text-sm)', margin: '0.4rem 0 0.2rem' } }, 'Cashflow drivers (cited)'),
    drivers.length === 0
      ? createElement('p', { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)' } }, 'None recorded')
      : createElement('ul', { style: { margin: '0 0 0.5rem', paddingLeft: '1.1rem' } }, ...drivers.map((d) => claimRow(d.driver ?? '', d.citation, d.grounded))),
    createElement('p', { style: { color: 'var(--owl-color-muted)', fontWeight: 700, fontSize: 'var(--owl-text-sm)', margin: '0.4rem 0 0.2rem' } }, 'Predictability breakers (cited — the deeper test)'),
    breakers.length === 0
      ? createElement('p', { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)' } }, 'None recorded')
      : createElement('ul', { style: { margin: '0 0 0.5rem', paddingLeft: '1.1rem' } }, ...breakers.map((b) => claimRow(b.breaker ?? '', b.citation, b.grounded))),
    circle.competence_reasoning === undefined
      ? null
      : createElement('p', { style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: '0.4rem 0 0' } }, circle.competence_reasoning),
    inCompetence || circle.reason === undefined
      ? null
      : createElement('p', { style: { color: '#fca5a5', fontSize: 'var(--owl-text-sm)', margin: '0.4rem 0 0' } }, circle.reason),
  )
}

/** Falsifiable forecasts attached to the case (calibration scaffold, accrues from day one). */
function createForecastsPanel(researchCase: AppResearchCase) {
  const forecasts = researchCase.forecasts
  if (forecasts === undefined || forecasts.length === 0) {
    return null
  }
  return createElement(
    'details',
    { 'aria-label': 'Falsifiable forecasts', style: { ...collapsibleDetailsStyle } },
    createElement('summary', { style: collapsibleSummaryStyle }, `Falsifiable forecasts (${forecasts.length})`),
    createElement('p', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: '0.5rem 0' } }, 'Resolvable claims with probabilities; they resolve on annual reports and accrue a per-lane calibration (Brier) score over time.'),
    createElement(
      'ul',
      { style: { display: 'grid', gap: '0.4rem', margin: 0, paddingLeft: '1.1rem' } },
      ...forecasts.map((forecast) => createElement(
        'li',
        { key: forecast.forecast_id, style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)' } },
        createElement('span', { style: { color: 'var(--owl-color-accent-bright)', fontFamily: 'var(--owl-font-mono)', fontWeight: 800 } }, `${forecast.lane ?? 'LANE'} · p=${forecast.p === undefined ? '—' : forecast.p.toFixed(2)} `),
        forecast.claim ?? 'forecast',
        createElement('span', { style: { color: 'var(--owl-color-muted)' } }, ` — resolves ${forecast.resolves_on ?? 'on next annual report'}`),
        forecast.resolved
          ? createElement('span', { style: { color: forecast.outcome ? 'var(--owl-color-emerald, #34d399)' : 'var(--owl-color-risk, #f87171)', fontWeight: 700 } }, ` · resolved ${forecast.outcome ? 'TRUE' : 'FALSE'}${forecast.brier_score === undefined ? '' : ` (Brier ${forecast.brier_score.toFixed(2)})`}`)
          : createElement('span', { style: { color: 'var(--owl-color-muted)' } }, ' · pending'),
      )),
    ),
  )
}

// ── Gated / rejected state ────────────────────────────────────────────────────

function createGatedDossier(researchCase: AppResearchCase) {
  const displayName = researchCase.ticker ?? researchCase.company_id ?? researchCase.research_case_id
  const { title, reason, failingGate } = gatedReason(researchCase)

  return createElement(
    'section',
    { style: { display: 'grid', gap: '1rem' } },
    createElement(
      'div',
      {
        style: {
          ...cardStyle,
          borderLeft: '3px solid var(--owl-color-risk)',
          background: 'rgba(239, 68, 68, 0.07)',
        },
      },
      // kicker label (keeps "Research dossier" visible for e2e)
      createElement('p', { style: labelStyle }, 'Research dossier'),
      createElement(
        'h1',
        { className: 'owl-page-title', style: { letterSpacing: '-0.02em', lineHeight: 1, margin: '0.1rem 0 0.15rem' } },
        displayName,
      ),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-base)', margin: '0 0 1rem' } },
        `${researchCase.company_id ?? 'Unknown company'} · quick screen gate`,
      ),
      // reject header row
      createElement(
        'div',
        { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.7rem', marginBottom: '0.5rem' } },
        createElement(
          'span',
          {
            style: {
              background: 'rgba(148, 163, 184, 0.12)',
              border: '1px solid var(--owl-color-border)',
              borderRadius: '0.6rem',
              color: 'var(--owl-color-muted)',
              fontFamily: 'var(--owl-font-mono)',
              fontSize: 'var(--owl-text-md)',
              fontWeight: 800,
              letterSpacing: '0.06em',
              padding: '0.3rem 0.8rem',
            },
          },
          researchCase.investment_verdict ?? researchCase.decision ?? 'PASS',
        ),
        createElement(
          'span',
          {
            style: {
              background: 'rgba(239, 68, 68, 0.13)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '999px',
              color: '#fca5a5',
              fontSize: 'var(--owl-text-sm)',
              fontWeight: 700,
              padding: '0.28rem 0.7rem',
            },
          },
          'Rejected at quick screen',
        ),
        createElement(
          'span',
          {
            style: {
              background: 'rgba(148, 163, 184, 0.1)',
              border: '1px solid var(--owl-color-border)',
              borderRadius: '999px',
              color: 'var(--owl-color-muted)',
              fontSize: 'var(--owl-text-sm)',
              fontWeight: 700,
              padding: '0.28rem 0.7rem',
            },
          },
          'Deep dive skipped',
        ),
      ),
      // Verdict summary label (keeps "Verdict summary" visible for e2e)
      createElement('p', { style: labelStyle }, 'Verdict summary'),
      createElement(
        'h2',
        { style: { color: '#fecaca', fontSize: 'var(--owl-text-md)', margin: '0 0 0.4rem' } },
        title,
      ),
      createElement(
        'p',
        { style: { color: '#f3d7d7', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: '0 0 1rem' } },
        createElement('strong', null, 'Reason: '),
        reason,
      ),
      // Gate failure steps
      createElement(
        'div',
        { style: { display: 'grid', gap: '0.5rem', marginBottom: '0.75rem' } },
        createElement(
          'div',
          { style: { alignItems: 'center', display: 'flex', gap: '0.6rem', fontSize: 'var(--owl-text-base)', color: 'var(--owl-color-muted)' } },
          createElement('span', { style: { color: 'var(--owl-color-risk)', fontWeight: 800 } }, '✕'),
          createElement('strong', null, failingGate),
        ),
        createElement(
          'div',
          { style: { alignItems: 'center', display: 'flex', gap: '0.6rem', fontSize: 'var(--owl-text-base)', color: 'var(--owl-color-quiet)' } },
          createElement('span', null, '—'),
          createElement('span', { style: { color: 'var(--owl-color-quiet)' } }, 'Business-quality check — skipped (gated)'),
        ),
        createElement(
          'div',
          { style: { alignItems: 'center', display: 'flex', gap: '0.6rem', fontSize: 'var(--owl-text-base)', color: 'var(--owl-color-quiet)' } },
          createElement('span', null, '—'),
          createElement('span', { style: { color: 'var(--owl-color-quiet)' } }, 'Deep-dive swarm (7 lanes) — skipped'),
        ),
      ),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)', margin: '0 0 1rem' } },
        'Evidence and the quick-screen assessment are recorded in the audit trail.',
      ),
    ),
    // Still render evidence for audit trail visibility
    createEvidenceAndAuditDetails(researchCase),
  )
}

// ── Awaiting deep-dive approval state ────────────────────────────────────────

function createAwaitingDeepDiveDossier(researchCase: AppResearchCase) {
  const displayName = researchCase.ticker ?? researchCase.company_id ?? researchCase.research_case_id

  return createElement(
    'section',
    { style: { display: 'grid', gap: '1rem' } },
    createElement(
      'div',
      {
        style: {
          ...cardStyle,
          borderLeft: '3px solid var(--owl-color-gold)',
          background: 'rgba(214, 178, 94, 0.07)',
        },
      },
      // kicker label
      createElement('p', { style: labelStyle }, 'Research dossier'),
      createElement(
        'h1',
        { className: 'owl-page-title', style: { letterSpacing: '-0.02em', lineHeight: 1, margin: '0.1rem 0 0.15rem' } },
        displayName,
      ),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-base)', margin: '0 0 1rem' } },
        `${researchCase.company_id ?? 'Unknown company'} · awaiting deep-dive approval`,
      ),
      // Status row
      createElement(
        'div',
        { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.7rem', marginBottom: '0.75rem' } },
        createElement(
          'span',
          {
            style: {
              background: 'rgba(214, 178, 94, 0.18)',
              border: '1px solid rgba(214, 178, 94, 0.5)',
              borderRadius: '999px',
              color: 'var(--owl-color-gold-bright)',
              fontSize: 'var(--owl-text-sm)',
              fontWeight: 700,
              padding: '0.28rem 0.7rem',
            },
          },
          'Quick screen passed',
        ),
        createElement(
          'span',
          {
            style: {
              background: 'rgba(148, 163, 184, 0.1)',
              border: '1px solid var(--owl-color-border)',
              borderRadius: '999px',
              color: 'var(--owl-color-muted)',
              fontSize: 'var(--owl-text-sm)',
              fontWeight: 700,
              padding: '0.28rem 0.7rem',
            },
          },
          'Deep dive pending approval',
        ),
      ),
      // Verdict summary label
      createElement('p', { style: labelStyle }, 'Verdict summary'),
      createElement(
        'h2',
        { style: { color: 'var(--owl-color-gold-bright)', fontSize: 'var(--owl-text-md)', margin: '0 0 0.4rem' } },
        'Quick screen passed — review and run the deep dive when ready',
      ),
      createElement(
        'p',
        { style: { color: '#dbe3ef', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: '0 0 1rem' } },
        'The quick screen found this company worth investigating. No deep-dive swarm has run yet — click "Run deep dive" to start the expensive swarm analysis.',
      ),
      // Quick-screen summary if available
      researchCase.screening_result !== undefined ? createElement(
        'div',
        { style: { display: 'grid', gap: '0.5rem', marginBottom: '0.75rem' } },
        researchCase.moat !== undefined ? createElement(
          'div',
          { style: { alignItems: 'center', display: 'flex', gap: '0.6rem', fontSize: 'var(--owl-text-base)', color: 'var(--owl-color-muted)' } },
          createElement('span', { style: { color: '#34d399', fontWeight: 800 } }, '✓'),
          createElement('span', null, `Quick screen result: ${researchCase.screening_result ?? 'deep_dive_candidate'}`),
        ) : null,
        researchCase.shariah_status !== undefined ? createElement(
          'div',
          { style: { alignItems: 'center', display: 'flex', gap: '0.6rem', fontSize: 'var(--owl-text-base)', color: 'var(--owl-color-muted)' } },
          createElement('span', { style: { color: '#34d399', fontWeight: 800 } }, '✓'),
          createElement('span', null, `Shariah: ${researchCase.shariah_status}`),
        ) : null,
        createElement(
          'div',
          { style: { alignItems: 'center', display: 'flex', gap: '0.6rem', fontSize: 'var(--owl-text-base)', color: 'var(--owl-color-quiet)' } },
          createElement('span', null, '—'),
          createElement('span', { style: { color: 'var(--owl-color-quiet)' } }, 'Deep-dive swarm (7 lanes) — not yet started'),
        ),
      ) : null,
      // Run deep dive action
      createElement(
        'div',
        { style: { marginTop: '0.5rem' } },
        createElement(
          'form',
          { action: `/api/research/${researchCase.research_case_id}/deep-dive`, method: 'post' },
          createElement(
            'button',
            {
              type: 'submit',
              style: {
                background: 'var(--owl-color-accent)',
                border: 0,
                borderRadius: '999px',
                color: '#ffffff',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 'var(--owl-text-base)',
                fontWeight: 900,
                padding: '0.75rem 1.2rem',
              },
            },
            'Run deep dive',
          ),
        ),
      ),
    ),
    // Still render evidence for audit trail visibility
    createEvidenceAndAuditDetails(researchCase),
  )
}

// ── Shared not-yet-available fallback (honest absent-field rendering) ──────────

const NOT_YET = createElement('span', { style: { color: 'var(--owl-color-quiet)' } }, 'Not yet available')

// ── Verdict hero ──────────────────────────────────────────────────────────────

function createVerdictHero(researchCase: AppResearchCase) {
  const displayName = researchCase.ticker ?? researchCase.company_id ?? researchCase.research_case_id
  const verdict = researchCase.investment_verdict ?? researchCase.decision ?? 'Research pending'
  const verdictColors = resolveVerdictColors(verdict)
  const nextAction = researchCase.next_required_action ?? 'Continue the review workflow'
  const valuation = researchCase.valuation
  const moatClass = valuation?.moat_class
  const moatPassesGate = valuation?.moat_passes_gate
  const versionBadge = buildVersionBadge(researchCase)

  return createElement(
    'header',
    {
      className: 'owl-section-card',
      style: {
        gap: '0.7rem',
      },
    },
    // kicker + version row
    createElement(
      'div',
      { style: { alignItems: 'baseline', display: 'flex', gap: '0.75rem', justifyContent: 'space-between', flexWrap: 'wrap' } },
      createElement('p', { className: 'owl-section-accent' }, 'Research dossier'),
      // version badge stacked above the engine-version marker (the reasoning-vintage stamp).
      createElement(
        'div',
        { style: { alignItems: 'flex-end', display: 'flex', flexDirection: 'column', gap: '0.2rem', textAlign: 'right' } },
        versionBadge === null ? null : createElement(
          'span',
          {
            style: {
              color: 'var(--owl-color-quiet)',
              fontFamily: 'var(--owl-font-mono)',
              fontSize: 'var(--owl-text-xs)',
            },
          },
          versionBadge,
        ),
        buildEngineVersionMarker(researchCase),
      ),
    ),
    // Ticker (serif page title — the briefing's subject)
    createElement(
      'h1',
      { className: 'owl-page-title', style: { lineHeight: 1, margin: 0 } },
      displayName,
    ),
    // Company
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-base)', margin: 0 } },
      researchCase.company_id ?? 'Unknown company',
    ),
    // Verdict + valuation chip row
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
      // Verdict badge
      createElement(
        'span',
        {
          style: {
            background: verdictColors.bg,
            border: `1px solid ${verdictColors.border}`,
            borderRadius: '0.6rem',
            color: verdictColors.text,
            fontFamily: 'var(--owl-font-mono)',
            fontSize: 'var(--owl-text-md)',
            fontWeight: 800,
            letterSpacing: '0.06em',
            padding: '0.3rem 0.8rem',
          },
        },
        verdict,
      ),
      // Valuation chip
      researchCase.valuation_status === undefined ? null : createPill(
        `Valuation: ${researchCase.valuation_status}`,
        resolveValuationChipColor(researchCase.valuation_status),
      ),
      // WATCH-FAIR verdict-band chip (valuation-recalibration-spec §2): the "wonderful at fair"
      // human-discretion zone. A distinct gold chip so the human sees the quality-at-fair opportunity.
      valuation?.verdict_state?.state === 'WATCH-FAIR' ? createPill(
        'WATCH-FAIR',
        { bg: 'rgba(214, 178, 94, 0.18)', border: 'rgba(214, 178, 94, 0.5)', text: 'var(--owl-color-gold-bright)' },
      ) : null,
    ),
    // Status chips
    createElement(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: '0.45rem' } },
      // Moat chip
      moatClass === undefined ? null : createPill(
        moatPassesGate === true
          ? `Moat: ${moatClass} ✓ passes ≥ wide`
          : `Moat: ${moatClass}`,
        { bg: 'rgba(34, 197, 94, 0.14)', border: 'rgba(134, 239, 172, 0.38)', text: '#bbf7d0' },
      ),
      // Shariah chip
      createStatusChip('Shariah', researchCase.shariah_status ?? 'Pending', resolveShariahChipColor(researchCase.shariah_status)),
      // Strategy chip
      createStatusChip('Strategy', researchCase.strategy_compliance ?? 'Pending', resolveComplianceChipColor(researchCase.strategy_compliance)),
    ),
    // Verdict summary section
    createElement('hr', { className: 'owl-rule', style: { marginTop: '0.15rem' } }),
    createElement(
      'section',
      { style: { display: 'grid', gap: '0.5rem' } },
      createElement('p', { className: 'owl-section-accent' }, 'Verdict summary'),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-md)', lineHeight: 1.6, margin: 0 } },
        createVerdictSummaryText(researchCase),
      ),
      // Next action
      createElement(
        'p',
        { style: { borderTop: '1px solid var(--owl-color-border)', color: '#d7e2d7', fontSize: 'var(--owl-text-base)', lineHeight: 1.5, margin: 0, paddingTop: '0.8rem' } },
        createElement('strong', { style: { color: 'var(--owl-color-sand)' } }, 'Next action: '),
        nextAction,
      ),
    ),
  )
}

function buildVersionBadge(researchCase: AppResearchCase): string | null {
  if (researchCase.version === undefined || researchCase.version <= 1) return null
  if (researchCase.superseded) return `v${researchCase.version} · superseded`
  if (researchCase.supersedes_research_case_id !== undefined) return `v${researchCase.version} · superseded v${researchCase.version - 1}`
  return `v${researchCase.version}`
}

// Engine-version marker — the at-a-glance reasoning-vintage stamp (the POOL episode). Three states:
//   - present + EQUALS the current ENGINE_VERSION → calm/muted "Engine {v} · generated {date}".
//   - present + DIFFERS from current → same marker PLUS a subtle amber "may use older methodology" caution.
//   - ABSENT → "Engine version unknown · pre-versioning" (muted — must NOT imply current).
// Optional "· commit {short}" appended when engine_commit was stamped. Mirrors the dossier's existing mono/
// muted provenance idioms (owl-font-mono, owl-text-2xs, owl-color-quiet/muted, gold-bright caution tone).
function buildEngineVersionMarker(researchCase: AppResearchCase): ReactNode {
  const engineVersion = researchCase.valuation?.judgment?.engine_version
  const engineCommit = researchCase.valuation?.judgment?.engine_commit
  const generatedDate = researchCase.updated_at === undefined
    ? undefined
    : new Date(researchCase.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const commitSuffix = engineCommit === undefined ? '' : ` · commit ${engineCommit.slice(0, 7)}`

  const baseStyle = {
    color: 'var(--owl-color-quiet)',
    fontFamily: 'var(--owl-font-mono)',
    fontSize: 'var(--owl-text-2xs)',
  } as const

  if (engineVersion === undefined) {
    return createElement(
      'span',
      { 'data-testid': 'engine-version-marker', style: baseStyle },
      `Engine version unknown · pre-versioning${commitSuffix}`,
    )
  }

  const isCurrent = engineVersion === ENGINE_VERSION
  const generatedSuffix = generatedDate === undefined ? '' : ` · generated ${generatedDate}`
  const marker = createElement(
    'span',
    { 'data-testid': 'engine-version-marker', style: baseStyle },
    `Engine ${engineVersion}${generatedSuffix}${commitSuffix}`,
  )
  if (isCurrent) return marker

  // Older engine: same calm marker PLUS a subtle amber caution in the dossier's existing risk tone.
  return createElement(
    'span',
    { style: { alignItems: 'baseline', display: 'inline-flex', flexWrap: 'wrap', gap: '0.35rem' } },
    marker,
    createElement(
      'span',
      {
        'data-testid': 'engine-version-older',
        style: {
          color: 'var(--owl-color-gold-bright)',
          fontFamily: 'var(--owl-font-mono)',
          fontSize: 'var(--owl-text-2xs)',
        },
      },
      '· may use older methodology',
    ),
  )
}

function resolveVerdictColors(verdict: string): { bg: string; border: string; text: string } {
  const v = verdict.toUpperCase()
  if (v === 'BUY' || v === 'STRONG_BUY') return { bg: 'rgba(34, 197, 94, 0.14)', border: 'rgba(52, 211, 153, 0.4)', text: '#bbf7d0' }
  if (v === 'WATCH') return { bg: 'rgba(214, 178, 94, 0.15)', border: 'rgba(214, 178, 94, 0.4)', text: '#f0d999' }
  if (v === 'AVOID' || v === 'SELL') return { bg: 'rgba(239, 68, 68, 0.14)', border: 'rgba(239, 68, 68, 0.4)', text: '#fca5a5' }
  return { bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.28)', text: 'var(--owl-color-muted)' }
}

function createVerdictSummaryText(researchCase: AppResearchCase): string {
  const verdict = researchCase.investment_verdict ?? researchCase.decision
  const valuation = researchCase.valuation_status
  const shariah = researchCase.shariah_status
  const strategy = researchCase.strategy_compliance

  const fullThesis = firstNonEmpty([
    researchCase.thesis_summary,
    researchCase.evidence_summary,
    researchCase.reason,
  ])

  if (verdict !== undefined) {
    const qualityContext = [
      strategy === undefined ? undefined : `strategy ${strategy}`,
      shariah === undefined ? undefined : `Shariah ${shariah}`,
    ].filter((gate): gate is string => gate !== undefined)
    const qualitySentence = qualityContext.length === 0
      ? 'Review the dossier evidence before any user-authored transition.'
      : `Quality/compliance context: ${qualityContext.join(', ')}.`
    const valuationSentence = valuation === undefined
      ? 'Owner-earnings valuation should be handled in the deep-dive workstream when available.'
      : `Valuation status ${valuation} is tracked inside the deep-dive valuation workstream, not treated as a Quick Screen pass/fail gate.`
    const statusText = `Verdict is a drafted strategy decision: ${verdict}. ${qualitySentence} ${valuationSentence}`
    if (fullThesis !== undefined) {
      const subject = researchCase.ticker ?? researchCase.company_id
      const concise = createConciseDossierSummary(fullThesis, subject)
      return `${concise} — ${statusText}`
    }
    return statusText
  }

  return fullThesis ?? 'This dossier is waiting for a source-backed investment reason.'
}

// ── Decision panel (R1) ───────────────────────────────────────────────────────

/**
 * RELIGHTENED DECISION (R1) — the dossier LEADS with what the human needs to decide:
 *   - the model's investment verdict + valuation_status,
 *   - the MODEL-proposed buy-below vs the live price, with the arithmetic in-buy-zone read,
 *   - the deterministic flag-only sanity-check (`sanity_flags`) as advisory amber annotations.
 * The sanity-check FLAGS internal absurdity; it NEVER blocks the verdict. The reasoning to audit
 * (cited valuation_reasoning, the reference FV cross-check, market-implied growth, the bear case) lives
 * in the valuation panel beneath. Native owl-*; no band/gap axis.
 */
function createDecisionPanel(researchCase: AppResearchCase, marketQuote?: MarketQuote) {
  const valuation = researchCase.valuation
  if (valuation === undefined) return null

  const buyBelow = valuation.proposed_buy_below ?? valuation.buy_price_per_share
  const sanityFlags = valuation.sanity_flags ?? []
  // Nothing decision-relevant to lead with → let the valuation panel carry it.
  if (buyBelow === undefined && sanityFlags.length === 0 && valuation.in_buy_zone === undefined) {
    return null
  }

  const verdict = researchCase.investment_verdict ?? researchCase.decision
  const valuationStatus = researchCase.valuation_status
  const livePrice = marketQuote?.price_per_share
  // The in-buy-zone read is pure arithmetic (current_price <= buy_below). Prefer the recorded flag, else
  // derive it from the live quote vs the model buy-below when both are present.
  const inBuyZone = valuation.in_buy_zone
    ?? (livePrice !== undefined && buyBelow !== undefined ? livePrice <= buyBelow : undefined)

  // Key-figures strip (Priority 2): the full decision-critical figure set LEADS as stat blocks, not buried
  // in prose. Beyond buy-below / live price / buy-zone, surface the reference fair value (the cross-check,
  // explicitly NOT the decision) and the two hidden assumptions the price bakes in — market-implied growth
  // and the implied exit multiple — together. Prose reasoning stays below in the valuation panel.
  const referenceFairValue = valuation.reference_fair_value ?? valuation.fair_value_per_share
  const marketImpliedGrowth = valuation.market_implied_growth
  const impliedExitMultiple = valuation.implied_exit_multiple

  return createElement(
    'section',
    {
      'data-testid': 'decision-summary',
      className: 'owl-section-card',
      style: { gap: '0.7rem' },
    },
    // Header + the model verdict / valuation-status pills (decision-relevant, leads).
    createElement('p', { className: 'owl-section-accent' }, 'The decision'),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
      'The model proposes the verdict, the valuation, and the buy-below with cited reasoning. A light deterministic sanity-check flags internal absurdity — it does not block the verdict. You audit the reasoning beneath and decide.',
    ),
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
      verdict === undefined ? null : createPill(
        `Model verdict: ${verdict}`,
        resolveVerdictColors(verdict),
      ),
      valuationStatus === undefined ? null : createPill(
        `Valuation: ${valuationStatus}`,
        resolveValuationChipColor(valuationStatus),
      ),
    ),
    // Key figures — the decision-critical numbers lead as stat blocks (Priority 2). The model buy-below
    // vs live price + the in-buy-zone arithmetic; the reference fair value cross-check; and the two hidden
    // price-implied assumptions surfaced together.
    createElement('p', { className: 'owl-section-accent', style: { marginTop: '0.2rem' } }, 'Key figures'),
    createElement(
      'div',
      { 'data-testid': 'decision-key-figures', className: 'owl-ledger-line' },
      createValuationLedgerStat(
        'Model buy-below',
        buyBelow !== undefined ? `$${buyBelow.toFixed(2)}` : 'Pending',
        'owl-ledger-figure-money',
      ),
      createValuationLedgerStat(
        'Live price',
        livePrice !== undefined ? `$${livePrice.toFixed(2)}` : 'No live quote',
        'owl-ledger-figure-money',
      ),
      createValuationLedgerStat(
        'Buy-zone',
        inBuyZone === undefined
          ? 'Not computable'
          : inBuyZone ? 'In the buy zone' : 'Not in the buy zone',
        inBuyZone === true ? 'owl-ledger-figure-emerald' : '',
      ),
      createValuationLedgerStat(
        'Reference fair value · cross-check, not the decision',
        referenceFairValue !== undefined ? `$${referenceFairValue.toFixed(2)}` : 'Not yet available',
        'owl-ledger-figure-money',
      ),
      createValuationLedgerStat(
        'Market-implied growth',
        marketImpliedGrowth !== undefined ? `${(marketImpliedGrowth * 100).toFixed(1)}%` : 'Not yet available',
        '',
      ),
      createValuationLedgerStat(
        'Implied exit multiple',
        impliedExitMultiple !== undefined ? `${impliedExitMultiple.toFixed(1)}× OE` : 'Not yet available',
        '',
      ),
    ),
    livePrice !== undefined && buyBelow !== undefined ? createElement(
      'p',
      { style: { color: inBuyZone ? '#bbf7d0' : 'var(--owl-color-muted)', fontSize: 'var(--owl-text-base)', lineHeight: 1.5, margin: 0 } },
      inBuyZone
        ? `Live price $${livePrice.toFixed(2)} is at or below the model buy-below $${buyBelow.toFixed(2)} — in the buy zone if the reasoning holds.`
        : `Live price $${livePrice.toFixed(2)} is above the model buy-below $${buyBelow.toFixed(2)} — not in the buy zone yet.`,
    ) : null,
    // The deterministic sanity-check flags — advisory amber annotations, never blocks.
    sanityFlags.length > 0 ? createSanityFlags(sanityFlags) : null,
  )
}

/**
 * MARGIN-OF-SAFETY AUDIT — the synthesis-owned risk surface, re-homed from the retired verdict-format block
 * into the decision region (directly beneath the decision panel). It surfaces, in order:
 *   1. the JOINT margin-of-safety judgment — the HEADLINE. The margin rests on TWO substitutable sources
 *      shown SIDE BY SIDE: the PRICE margin (price vs the model's judged value) and the MOAT-DURABILITY
 *      thesis (the grounded, cite-verified moat thesis). Neither is buried; adequacy + which source(s) it
 *      rests on are explicit. A moat-sourced margin is flagged higher-stakes; an ungrounded-moat source is
 *      flagged incoherent (Guard 2).
 *   2. the model's key_wrong_assumption (the one assumption that, if wrong, breaks the thesis).
 *   3. the thesis_break_triggers (observable events that would invalidate the thesis).
 * These are the model's forward-looking risk reasoning for the human to audit — NOT cite-gated. Absent
 * (legacy / not produced) → honest "Not yet available" fallback (no crash). Native owl-* tokens only.
 */
function createMarginOfSafetyAuditBlock(researchCase: AppResearchCase) {
  // Only render once a deep-dive valuation exists (gated/awaiting states have their own dossiers).
  if (researchCase.valuation === undefined) return null

  const mosJudgment = researchCase.margin_of_safety_judgment
  const mosMoatUngrounded = researchCase.margin_of_safety_moat_ungrounded === true

  // The joint margin-of-safety judgment — surface the PRICE margin and the MOAT-DURABILITY thesis SIDE BY
  // SIDE so neither is buried; show adequacy + which source(s) the margin rests on.
  const jointJudgment = mosJudgment === undefined
    ? NOT_YET
    : (() => {
        const restsOnMoat = mosJudgment.sources.includes('moat')
        const restsOnPrice = mosJudgment.sources.includes('price')
        const sourcesLabel = mosJudgment.sources.map((s) => (s === 'moat' ? 'moat durability' : 'price gap')).join(' + ')
        const adequacyColor = mosJudgment.adequacy === 'adequate'
          ? 'var(--owl-color-positive, #4ade80)'
          : mosJudgment.adequacy === 'thin'
            ? '#fbbf24'
            : '#fca5a5'

        // The two substitutable MoS sources, shown SIDE BY SIDE (a two-column grid): the PRICE margin and
        // the grounded MOAT-DURABILITY thesis. Each column states whether the margin rests on that source.
        const sourceColumn = (
          title: string,
          rests: boolean,
          reasoning: string | undefined,
          highStakesBadge: ReactNode,
        ) => createElement(
          'div',
          {
            key: title,
            style: {
              background: rests ? 'rgba(214, 178, 94, 0.06)' : 'var(--owl-color-panel-deep)',
              border: `1px solid ${rests ? 'rgba(214, 178, 94, 0.3)' : 'var(--owl-color-border)'}`,
              borderRadius: '0.6rem',
              display: 'flex',
              flexDirection: 'column' as const,
              gap: '0.3rem',
              padding: '0.6rem 0.75rem',
            },
          },
          createElement(
            'div',
            { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap' as const, gap: '0.4rem' } },
            createElement('span', { style: { color: 'var(--owl-color-accent-bright)', fontSize: 'var(--owl-text-xs)', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' as const } }, title),
            createElement(
              'span',
              { style: { color: rests ? 'var(--owl-color-text)' : 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-xs)', fontWeight: 700 } },
              rests ? 'margin rests here' : 'not a source',
            ),
            highStakesBadge,
          ),
          reasoning !== undefined
            ? createElement('p', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } }, reasoning)
            : createElement('p', { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)', margin: 0 } }, rests ? 'No reasoning recorded.' : '—'),
        )

        const moatBadge = restsOnMoat
          ? createElement(
              'span',
              { 'data-testid': 'mos-moat-sourced', style: { fontSize: 'var(--owl-text-2xs)', fontWeight: 700, color: '#fbbf24', border: '1px solid rgba(251,191,36,0.5)', borderRadius: '0.4rem', padding: '0.05rem 0.4rem' } },
              'MOAT-SOURCED — scrutinize moat durability',
            )
          : null

        return createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' } },
          createElement(
            'div',
            { style: { color: adequacyColor, fontWeight: 700 } },
            `Rests on: ${sourcesLabel} · adequacy (audit-only, not a gate): ${mosJudgment.adequacy}`,
          ),
          createElement(
            'div',
            { style: { display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' } },
            sourceColumn('Price margin', restsOnPrice, mosJudgment.price_gap_reasoning, null),
            sourceColumn('Moat durability', restsOnMoat, mosJudgment.moat_durability_reasoning, moatBadge),
          ),
          createElement('p', { style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } }, mosJudgment.reasoning),
          mosMoatUngrounded
            ? createElement(
                'p',
                { 'data-testid': 'mos-moat-ungrounded', style: { color: '#fca5a5', fontWeight: 700, margin: 0 } },
                'Incoherent: margin claims a moat source but the moat is not grounded / did not pass the moat gate.',
              )
            : null,
        )
      })()

  const keyWrongAssumption = researchCase.key_wrong_assumption
  const keyWrongAssumptionLine = keyWrongAssumption === undefined || keyWrongAssumption.trim().length === 0
    ? NOT_YET
    : createElement('span', null, keyWrongAssumption)

  const thesisBreakTriggers = researchCase.thesis_break_triggers
  const thesisBreakTriggersLine = thesisBreakTriggers === undefined || thesisBreakTriggers.length === 0
    ? NOT_YET
    : createElement(
        'ul',
        { style: { margin: 0, paddingLeft: '1.1rem' } },
        ...thesisBreakTriggers.map((trigger, i) => createElement('li', { key: `tbt-${i}`, style: { color: 'var(--owl-color-text)', lineHeight: 1.5 } }, trigger)),
      )

  const auditRow = (label: string, value: ReactNode) => createElement(
    'div',
    { key: label, style: { display: 'grid', gap: '0.3rem', borderTop: '1px solid var(--owl-color-border)', paddingTop: '0.6rem' } },
    createElement('p', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', fontWeight: 700, margin: 0 } }, label),
    createElement('div', { style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)', lineHeight: 1.55 } }, value),
  )

  return createElement(
    'section',
    {
      'data-testid': 'margin-of-safety-audit',
      className: 'owl-section-card',
      // Prominent gold accent (Priority 3): the joint MoS judgment is the human's central audit surface and
      // LEADS the decision region — a clear accent rail + heading so it is not blended into the prose.
      style: { gap: '0.6rem', borderLeft: '3px solid var(--owl-color-gold)' },
    },
    createElement('p', { className: 'owl-section-accent' }, 'Margin of safety (joint)'),
    createElement(
      'h2',
      { style: { color: 'var(--owl-color-gold-bright)', fontFamily: 'var(--owl-font-display)', fontSize: 'var(--owl-text-lg)', letterSpacing: '-0.01em', margin: 0 } },
      'The central audit: where the margin of safety rests',
    ),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
      'The margin of safety rests on two substitutable sources — the price-vs-value gap and moat durability — shown side by side. Below them, the one assumption that breaks the thesis and the observable triggers that would invalidate it. The model\'s forward-looking risk reasoning for you to audit.',
    ),
    jointJudgment,
    auditRow('Key-wrong assumption', keyWrongAssumptionLine),
    auditRow('Thesis-break triggers', thesisBreakTriggersLine),
  )
}

/**
 * The flag-only sanity-check (R1): deterministic, symmetric (over-optimistic + over-pessimistic + absurdity)
 * advisory messages. Rendered as clear amber/risk annotations — flags, NOT blocks. The verdict is the
 * model's; these only surface "this implies X, which is implausible because Y"-style catches for the human.
 */
function createSanityFlags(flags: string[]) {
  return createElement(
    'div',
    {
      'data-testid': 'sanity-flags',
      style: {
        background: 'rgba(214, 178, 94, 0.08)',
        border: '1px solid rgba(214, 178, 94, 0.4)',
        borderRadius: '0.7rem',
        display: 'grid',
        gap: '0.4rem',
        marginTop: '0.2rem',
        padding: '0.7rem 0.9rem',
      },
    },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' } },
      createElement(StatusBadge, { tone: 'warning' }, `Sanity-check · ${flags.length} flag${flags.length === 1 ? '' : 's'}`),
      createElement(
        'span',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)' } },
        'Advisory only — flags internal absurdity; does not block the verdict.',
      ),
    ),
    createElement(
      'ul',
      { style: { display: 'grid', gap: '0.35rem', margin: 0, paddingLeft: '1.1rem' } },
      ...flags.map((flag, index) => createElement(
        'li',
        { key: `sanity-${index}`, style: { color: '#f0d999', fontSize: 'var(--owl-text-base)', lineHeight: 1.5 } },
        createElement('span', { style: { marginRight: '0.35rem' } }, '⚠'),
        flag,
      )),
    ),
  )
}

function createValuationPanel(researchCase: AppResearchCase, marketQuote?: MarketQuote) {
  const valuation = researchCase.valuation
  if (valuation === undefined) return null

  const pctPts = (frac: number) => `${(frac * 100).toFixed(1)}%`

  // RELIGHTENED DECISION (R1): the MODEL's cited reasoning is the substance to audit. The reference fair
  // value is a deterministic CROSS-CHECK only (not the decision); market-implied growth is the richness read.
  const referenceFairValue = valuation.reference_fair_value ?? valuation.fair_value_per_share
  const marketImpliedGrowth = valuation.market_implied_growth
  const reasoning = valuation.valuation_reasoning
  const discountRateVal = valuation.discount_rate
  const moatClass = valuation.moat_class ?? 'unknown'
  const roic = valuation.roic
  const incrementalRoic = valuation.incremental_roic
  const growthRate = valuation.growth_rate
  const terminalGrowthRate = valuation.terminal_growth_rate
  const reinvestmentRate = valuation.reinvestment_rate
  const runway = valuation.runway
  const impliedMultiple = valuation.implied_multiple
  // §2 flag-only sanity output: the name-specific implied EXIT P/OE the live price requires (current price ÷
  // owner earnings grown to the horizon at the model's growth). Advisory; the directional over-high flag (if
  // it fired) already renders in the sanity-flags annotation. Absent → shown honestly as Pending.
  const impliedExitMultiple = valuation.implied_exit_multiple
  // Judgment-objectivity layer (Mechanisms 1+2): mechanical anchor vs the lane's proposed tier vs the
  // harness-resolved tier. Surfaced so the dossier shows where judgment moved the tier (and by how much).
  const moatJudgment = valuation.judgment?.moat
  // B6: the moat is the grounded cited thesis; the quant CORROBORATES. Show proposed → resolved + the
  // grounded driver count + the quant corroboration tier (n/a when the EDGAR anchor was not computable).
  const moatAnchorLabel = moatJudgment !== undefined
    ? `${(moatJudgment.proposed_tier ?? '?').toUpperCase()} proposed → ${(moatJudgment.resolved_tier ?? '?').toUpperCase()} resolved`
      + ` · ${moatJudgment.grounded_driver_count ?? 0} grounded driver(s)`
      + ` · quant ${moatJudgment.anchor_computable === false ? 'n/a' : (moatJudgment.anchor_tier ?? '?').toUpperCase()}`
    : undefined
  // Runway reframe: the runway is the grounded cited thesis; the incremental-ROIC quant CORROBORATES. Show
  // proposed → resolved + the grounded driver count + the quant corroboration tier (n/a when not computable).
  const runwayJudgment = valuation.judgment?.runway
  const runwayAnchorLabel = runwayJudgment !== undefined
    ? `${(runwayJudgment.proposed_tier ?? '?').toUpperCase()} proposed → ${(runwayJudgment.resolved_tier ?? '?').toUpperCase()} resolved`
      + ` · ${runwayJudgment.grounded_driver_count ?? 0} grounded driver(s)`
      + ` · quant ${runwayJudgment.anchor_computable === false ? 'n/a' : (runwayJudgment.anchor_tier ?? '?').toUpperCase()}`
    : undefined

  // Mechanism 3 (Base-Rate Constraints): claims that beat a base rate (monopoly, credited g 4-5%, >20%
  // ROIC, margin expansion) lacking a STRUCTURAL exceptionality justification are flagged
  // base_rate_burden_unmet — surfaced here so the human sees the unmet structural burden, never hidden.
  const baseRateBurden = valuation.base_rate_burden
  const unmetBaseRateFlags = (baseRateBurden?.flags ?? []).filter((f) => f.status === 'unmet')

  // Mechanism 6 (Source Discipline): lane-proposed sources the per-lane whitelist excluded (sell-side,
  // media, blogs, unknown). Surfaced as a count + reasons so a lane starved of primary docs is visible.
  const sourceDiscipline = researchCase.source_discipline
  const rejectedSourceCount = sourceDiscipline?.rejected_count ?? 0

  // Mechanism 5 (Red-Team Pass) — the INDEPENDENT BEAR CASE. The adversarial pre-synthesis run + the
  // synthesis obligation. We surface the strongest objection + the synthesis response (answered-with-
  // evidence vs accepted→downgraded), and the deterministic flags: objection_unaddressed (synthesis was
  // silent — never dropped) and red_team_incomplete (the case was not adversarially tested).
  const redTeam = researchCase.red_team
  const redTeamIncomplete = redTeam?.status === 'red_team_incomplete'
  const redTeamObjection = redTeam?.strongest_objection
  const redTeamResponse = redTeam?.synthesis_response
  const redTeamUnaddressed = redTeam?.objection_unaddressed === true

  const discountLabel = discountRateVal !== undefined ? `${Math.round(discountRateVal * 100)}%` : DEFAULT_DISCOUNT_LABEL
  const moatLabel = `${moatClass.toUpperCase()} MOAT · ${discountLabel} DISCOUNT`

  // Judged-growth label: the model's judged sustainable g (early years) fading to terminal g_t. growth_rate
  // is now the MODEL's cite-verified assumed/judged growth; the capped demonstrated CAGR is the
  // demonstrated-history reference (demonstrated_growth_reference), not shown here. ROIC is context only.
  const eligRoic = incrementalRoic ?? roic
  const fadeLabel = terminalGrowthRate !== undefined ? ` → terminal ${(terminalGrowthRate * 100).toFixed(0)}%` : ''
  const runwayLabel = runway !== undefined ? ` · ${runway} runway` : ''
  const roicGateLabel = growthRate !== undefined
    ? growthRate > 0
      ? `judged g=${(growthRate * 100).toFixed(0)}%${fadeLabel}${eligRoic !== undefined ? ` · incremental ROIC ${(eligRoic * 100).toFixed(0)}% > 10%` : ''}${runwayLabel}`
      : `judged g=0%${fadeLabel}${eligRoic !== undefined ? ` · incremental ROIC ${(eligRoic * 100).toFixed(0)}% ≤ 10% (no growth credit)` : ' (no growth credit)'}${runwayLabel}`
    : undefined

  // The assumed growth the model used (its number, cited). growth_rate is now this same headline value;
  // the fallback is retained for legacy events that predate the headline-growth inversion.
  const assumedGrowth = reasoning?.assumed_growth ?? growthRate

  // Owner-earnings bridge summary for collapsible
  const bridge = valuation.owner_earnings_bridge
  const hasBridge = bridge !== undefined
    && bridge.net_income !== undefined
    && bridge.depreciation_amortization !== undefined
    && bridge.maintenance_capex !== undefined
    && bridge.stock_based_comp !== undefined
    && bridge.normalized_working_capital_change !== undefined

  return createElement(
    'div',
    {
      className: 'owl-section-card',
      style: {
        gap: '0.5rem',
      },
    },
    // Header row
    createElement(
      'div',
      { style: { alignItems: 'baseline', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' } },
      createElement('p', { className: 'owl-section-accent' }, 'Valuation'),
      createElement(
        'span',
        {
          style: {
            color: 'var(--owl-color-accent-bright)',
            fontFamily: 'var(--owl-font-mono)',
            fontSize: 'var(--owl-text-xs)',
            fontWeight: 800,
            letterSpacing: '0.06em',
          },
        },
        moatLabel,
      ),
    ),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
      'The reasoning to audit. The model proposed the verdict and the buy-below above; here it shows its work. The deterministic fair value is a cross-check only — it is not the decision.',
    ),
    // The MODEL's cited valuation reasoning — it shows its work (owner-earnings basis, the growth it
    // assumed + WHY, the discount rationale). The substance the human audits.
    reasoning !== undefined ? createElement(
      'div',
      {
        'data-testid': 'valuation-reasoning',
        style: { display: 'grid', gap: '0.45rem', marginTop: '0.4rem' },
      },
      createElement('p', { className: 'owl-section-accent' }, 'Model valuation reasoning (cited)'),
      reasoning.owner_earnings_basis !== undefined ? createElement(
        'p',
        { style: { color: '#dbe3ef', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } },
        createElement('strong', { style: { color: 'var(--owl-color-sand)' } }, 'Owner-earnings basis: '),
        reasoning.owner_earnings_basis,
      ) : null,
      assumedGrowth !== undefined ? createElement(
        'p',
        { style: { color: '#dbe3ef', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } },
        createElement('strong', { style: { color: 'var(--owl-color-sand)' } }, 'Assumed growth: '),
        `the model assumes ${pctPts(assumedGrowth)} near-term growth`,
        reasoning.assumed_growth_rationale !== undefined ? ` — ${reasoning.assumed_growth_rationale}` : '',
      ) : null,
      reasoning.discount_rationale !== undefined ? createElement(
        'p',
        { style: { color: '#dbe3ef', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } },
        createElement('strong', { style: { color: 'var(--owl-color-sand)' } }, 'Discount: '),
        reasoning.discount_rationale,
      ) : null,
    ) : null,
    // Reverse-DCF read (the primary lens): the market-implied growth vs the model's judged sustainable
    // growth. The richness signal — what today's price requires the business to grow vs what the model judges.
    marketImpliedGrowth !== undefined ? createElement(
      'p',
      { 'data-testid': 'market-implied-growth', style: { color: '#d7e2d7', fontSize: 'var(--owl-text-base)', lineHeight: 1.5, margin: '0.4rem 0 0' } },
      createElement('strong', { style: { color: 'var(--owl-color-accent-bright)' } }, `The market implies ${pctPts(marketImpliedGrowth)} growth`),
      assumedGrowth !== undefined ? ` — the model judges ${pctPts(assumedGrowth)} sustainable.` : '.',
    ) : null,
    // The two hidden assumptions baked into today's price, surfaced together and briefly explained (not two
    // bare adjacent stats): the implied growth the price requires, and the implied EXIT multiple it must hold.
    (marketImpliedGrowth !== undefined || impliedExitMultiple !== undefined) ? createElement(
      'p',
      { 'data-testid': 'price-implied-assumptions', style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: '0.3rem 0 0' } },
      'Today\'s price bakes in two assumptions: ',
      marketImpliedGrowth !== undefined
        ? createElement('span', null, createElement('strong', { style: { color: 'var(--owl-color-sand)' } }, `${pctPts(marketImpliedGrowth)} implied growth`), ' (the rate the business must compound at to justify the price)')
        : createElement('span', null, 'an implied growth (not computable without a live price)'),
      ', and ',
      impliedExitMultiple !== undefined
        ? createElement('span', null, createElement('strong', { style: { color: 'var(--owl-color-sand)' } }, `a ${impliedExitMultiple.toFixed(1)}× implied exit multiple`), ' (the owner-earnings multiple the price must still command at the horizon).')
        : createElement('span', null, 'an implied exit multiple (not yet computed).'),
    ) : null,
    // ROIC gate / growth note
    roicGateLabel !== undefined ? createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.4, margin: '0.2rem 0 0' } },
      roicGateLabel,
    ) : null,
    // Market quote context (when a live quote is available) — reference only.
    marketQuote !== undefined ? createElement(
      'p',
      { style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', margin: '0.2rem 0 0' } },
      `Market $${marketQuote.price_per_share.toFixed(2)} (${marketQuote.currency}) · Yahoo Finance, as of ${new Date(marketQuote.as_of).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    ) : null,
    // Key figures — the ledger-line of the valuation. The reference fair value is the deterministic
    // CROSS-CHECK (clearly labeled NOT the decision); the model's buy-below + verdict drive the decision.
    createElement(
      'div',
      { className: 'owl-ledger-line', style: { marginTop: '1rem' } },
      createValuationLedgerStat(
        'Reference fair value · cross-check (not the decision)',
        referenceFairValue !== undefined ? `$${referenceFairValue.toFixed(2)}` : 'Pending',
        'owl-ledger-figure-money',
      ),
      createValuationLedgerStat(
        'Market-implied growth',
        marketImpliedGrowth !== undefined ? pctPts(marketImpliedGrowth) : 'Pending',
        '',
      ),
      createValuationLedgerStat('Implied multiple', impliedMultiple !== undefined ? `${impliedMultiple.toFixed(1)}× OE` : 'Pending', ''),
      createValuationLedgerStat('Implied exit multiple', impliedExitMultiple !== undefined ? `${impliedExitMultiple.toFixed(1)}× OE` : 'Pending', ''),
      createValuationLedgerStat('Owner earnings / sh', valuation.normalized_owner_earnings_per_share !== undefined ? `$${valuation.normalized_owner_earnings_per_share.toFixed(2)}` : 'Pending', 'owl-ledger-figure-money'),
      createValuationLedgerStat('Terminal g', terminalGrowthRate !== undefined ? `${(terminalGrowthRate * 100).toFixed(0)}%` : 'Pending', ''),
      createValuationLedgerStat('Runway', runway ?? 'Pending', ''),
      ...(moatAnchorLabel !== undefined ? [createValuationLedgerStat('Moat anchor', moatAnchorLabel, '')] : []),
      ...(runwayAnchorLabel !== undefined ? [createValuationLedgerStat('Runway anchor', runwayAnchorLabel, '')] : []),
      createValuationLedgerStat('Discount', discountLabel, ''),
    ),
    // Mechanism 3: base-rate burden — exceptional claims lacking structural evidence (surfaced, never passed).
    unmetBaseRateFlags.length > 0 ? createElement(
      'div',
      {
        style: {
          background: 'rgba(248, 113, 113, 0.08)',
          border: '1px solid rgba(248, 113, 113, 0.3)',
          borderRadius: '0.7rem',
          marginTop: '0.6rem',
          padding: '0.6rem 0.9rem',
        },
      },
      createElement('p', { style: { color: '#f87171', fontWeight: 800, fontSize: 'var(--owl-text-sm)', margin: '0 0 0.3rem' } },
        `Base-rate burden unmet (${unmetBaseRateFlags.length})`,
      ),
      ...unmetBaseRateFlags.map((f) => createElement('p', {
        key: f.base_rate_id ?? f.claim,
        style: { color: '#fca5a5', fontSize: 'var(--owl-text-xs)', fontFamily: 'var(--owl-font-mono)', margin: '0 0 0.2rem' },
      },
        `${f.claim ?? f.base_rate_id} — ${f.structural_evidence_count ?? 0}/${f.required_structural_evidence ?? 0} structural items. Beats a base rate without structural evidence; treat as narrative until evidenced.`,
      )),
    ) : null,
    // Mechanism 6: source-discipline note — lane-proposed sources the per-lane whitelist excluded.
    rejectedSourceCount > 0 ? createElement(
      'p',
      {
        style: {
          color: 'var(--owl-color-muted)',
          fontFamily: 'var(--owl-font-mono)',
          fontSize: 'var(--owl-text-xs)',
          margin: '0.5rem 0 0',
        },
      },
      `Source discipline: ${rejectedSourceCount} lane source${rejectedSourceCount === 1 ? '' : 's'} excluded by lane policy `
      + `(${[...new Set((sourceDiscipline?.rejections ?? []).map((r) => r.reason).filter((r): r is string => r !== undefined))].join(', ')}). `
      + `Classification lanes reason from primary documents only.`,
    ) : null,
    // Mechanism 5: red-team section — strongest objection + the synthesis response (or the incomplete /
    // unaddressed flags). The border colour flags an unaddressed objection or an untested case in red.
    redTeam !== undefined ? createElement(
      'div',
      {
        style: {
          background: (redTeamUnaddressed || redTeamIncomplete) ? 'rgba(248, 113, 113, 0.08)' : 'rgba(148, 163, 184, 0.06)',
          border: `1px solid ${(redTeamUnaddressed || redTeamIncomplete) ? 'rgba(248, 113, 113, 0.3)' : 'rgba(148, 163, 184, 0.18)'}`,
          borderRadius: '0.7rem',
          marginTop: '0.6rem',
          padding: '0.6rem 0.9rem',
        },
      },
      createElement('p', {
        style: {
          color: (redTeamUnaddressed || redTeamIncomplete) ? '#f87171' : 'var(--owl-color-gold-bright)',
          fontWeight: 800, fontSize: 'var(--owl-text-sm)', margin: '0 0 0.3rem',
        },
      }, 'Independent bear case (red-team)'),
      redTeamIncomplete ? createElement('p', {
        style: { color: '#fca5a5', fontSize: 'var(--owl-text-xs)', fontFamily: 'var(--owl-font-mono)', margin: 0 },
      }, `red_team_incomplete — the adversarial pass did not complete${redTeam.reason !== undefined ? ` (${redTeam.reason})` : ''}. The case was NOT adversarially tested; re-run before relying on the verdict.`)
        : createElement(
          'div',
          null,
          redTeamObjection?.claim !== undefined ? createElement('p', {
            style: { color: '#dbe3ef', fontSize: 'var(--owl-text-sm)', margin: '0 0 0.3rem' },
          }, `Strongest objection${redTeamObjection.severity !== undefined ? ` (${redTeamObjection.severity})` : ''}: ${redTeamObjection.claim}`) : null,
          redTeamUnaddressed ? createElement('p', {
            style: { color: '#fca5a5', fontSize: 'var(--owl-text-xs)', fontFamily: 'var(--owl-font-mono)', margin: 0 },
          }, 'red_team_objection_unaddressed — synthesis neither answered with evidence nor downgraded. Silence is not an option; surfaced in open questions.')
            : redTeamResponse !== undefined ? createElement('p', {
              style: { color: '#bbf7d0', fontSize: 'var(--owl-text-xs)', margin: 0 },
            }, redTeamResponse.mode === 'accepted_downgraded'
              ? `Synthesis response: accepted → downgraded${redTeamResponse.downgrade !== undefined ? ` ${redTeamResponse.downgrade.dimension} (${redTeamResponse.downgrade.from} → ${redTeamResponse.downgrade.to})` : ''}. ${redTeamResponse.text ?? ''}`
              : `Synthesis response: answered with evidence. ${redTeamResponse.text ?? ''}`)
              : null,
        ),
    ) : null,
    // Collapsible owner-earnings bridge
    hasBridge && bridge !== undefined ? createElement(
      'details',
      { style: { marginTop: '0.5rem' } },
      createElement(
        'summary',
        { style: { color: 'var(--owl-color-gold-bright)', cursor: 'pointer', fontSize: 'var(--owl-text-base)', fontWeight: 800 } },
        'Owner-earnings bridge',
      ),
      createElement(
        'div',
        {
          style: {
            background: 'var(--owl-color-panel-deep)',
            border: '1px solid rgba(148, 163, 184, 0.12)',
            borderRadius: '0.7rem',
            fontFamily: 'var(--owl-font-mono)',
            fontSize: 'var(--owl-text-sm)',
            marginTop: '0.5rem',
            padding: '0.75rem 1rem',
          },
        },
        createElement('p', { style: { color: '#dbe3ef', margin: '0 0 0.4rem' } },
          `NI $${bridge.net_income}M + D&A $${bridge.depreciation_amortization}M − maint capex $${bridge.maintenance_capex}M − SBC $${bridge.stock_based_comp}M − ΔWC ${bridge.normalized_working_capital_change !== undefined ? (bridge.normalized_working_capital_change < 0 ? `($${Math.abs(bridge.normalized_working_capital_change)}M)` : `$${bridge.normalized_working_capital_change}M`) : '?'}`,
        ),
        bridge.shares_outstanding !== undefined ? createElement('p', { style: { color: '#9aa4b7', margin: '0 0 0.4rem' } },
          `÷ ${bridge.shares_outstanding}M diluted shares`,
        ) : null,
        createElement('p', { style: { color: '#bbf7d0', fontWeight: 800, margin: 0 } },
          `= OE $${valuation.normalized_owner_earnings_per_share?.toFixed(2) ?? '?'}/sh`,
        ),
        reinvestmentRate !== undefined && roic !== undefined ? createElement('p', { style: { color: '#9aa4b7', margin: '0.4rem 0 0' } },
          `ROIC ${(roic * 100).toFixed(0)}%${incrementalRoic !== undefined ? ` · incremental ROIC ${(incrementalRoic * 100).toFixed(0)}%` : ''} · reinvestment rate ${(reinvestmentRate * 100).toFixed(0)}%`,
        ) : null,
        bridge.maintenance_capex_proxy_tier !== undefined ? createElement('p', { style: { color: '#9aa4b7', fontSize: 'var(--owl-text-xs)', margin: '0.25rem 0 0' } },
          `Maint. capex proxy tier: ${bridge.maintenance_capex_proxy_tier}th percentile of D&A`,
        ) : null,
        createOwnerEarningsProvenanceLine(valuation),
      ),
    ) : null,
  )
}

/**
 * Provenance line inside the owner-earnings bridge: 'Owner earnings computed from SEC 10-K FY{year}'
 * with an EDGAR source chip when bridge_basis === 'sec_edgar', else a model-estimated note.
 */
function createOwnerEarningsProvenanceLine(
  valuation: NonNullable<AppResearchCase['valuation']>,
): ReturnType<typeof createElement> | null {
  const basis = valuation.bridge_basis
  if (basis === undefined) return null
  if (basis === 'sec_edgar') {
    const fy = valuation.bridge_fiscal_year
    return createElement(
      'p',
      { 'data-testid': 'oe-bridge-provenance', style: { alignItems: 'center', color: '#bbf7d0', display: 'flex', flexWrap: 'wrap', fontSize: 'var(--owl-text-xs)', gap: '0.4rem', margin: '0.4rem 0 0' } },
      createElement('span', null, fy !== undefined ? `Owner earnings computed from SEC 10-K FY${fy}` : 'Owner earnings computed from SEC 10-K'),
      createElement(
        'span',
        { style: { background: 'rgba(52, 211, 153, 0.14)', borderRadius: '0.4rem', color: 'var(--owl-color-emerald, #34d399)', fontWeight: 800, padding: '0.05rem 0.4rem' } },
        'SEC EDGAR',
      ),
    )
  }
  return createElement(
    'p',
    { 'data-testid': 'oe-bridge-provenance', style: { color: '#9aa4b7', fontSize: 'var(--owl-text-xs)', margin: '0.4rem 0 0' } },
    'Owner earnings are model-estimated (no SEC primary filing available).',
  )
}

// ── Position plan (advisory) ──────────────────────────────────────────────────

function formatPlanMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `$${Math.round(value)}`
  }
}

/**
 * Renders the advisory position plan near the valuation panel.
 * - When a plan exists: target weight + target value, the T1/T2/T3 tranches as rows
 *   (T2/T3 carry a "thesis re-check" badge), and the advisory notes.
 * - When capital is unset (but the case is otherwise sizeable): a prompt to set capital.
 * - Otherwise (no plan, no prompt): nothing — consistent with the gated dossier.
 */
function createPositionPlanPanel(plan: PositionPlan | undefined, promptForCapital: boolean) {
  if (plan === undefined) {
    if (!promptForCapital) return null
    return createElement(
      'div',
      { style: { ...cardStyle, borderLeft: '3px solid var(--owl-color-gold)', display: 'grid', gap: '0.5rem' } },
      createElement('p', { style: labelStyle }, 'Position plan · advisory'),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-base)', margin: 0 } },
        'Set your investable capital on the Portfolio page to see position sizing.',
      ),
    )
  }

  if (!plan.investable) return null

  const currency = 'USD'

  return createElement(
    'div',
    { style: { ...cardStyle, borderLeft: '3px solid var(--owl-color-gold)', display: 'grid', gap: '0.75rem' } },
    // Header
    createElement(
      'div',
      { style: { alignItems: 'baseline', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' } },
      createElement('p', { style: labelStyle }, 'Position plan · advisory'),
      createElement(
        'span',
        {
          style: {
            color: 'var(--owl-color-gold-bright)',
            fontFamily: 'var(--owl-font-mono)',
            fontSize: 'var(--owl-text-xs)',
            fontWeight: 800,
            letterSpacing: '0.06em',
          },
        },
        `${plan.moat_class.toUpperCase()} MOAT · ENTRY CAP`,
      ),
    ),
    // Target weight + target value
    createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem' } },
      createPlanMetric('Target weight', `${(plan.target_weight * 100).toFixed(0)}%`),
      createPlanMetric('Target value', formatPlanMoney(plan.target_value, currency)),
    ),
    // Tranche rows
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.5rem' } },
      ...plan.tranches.map((tranche) => createTrancheRow(tranche, currency)),
    ),
    // Advisory notes
    createElement(
      'ul',
      {
        style: {
          color: 'var(--owl-color-muted)',
          display: 'flex',
          flexDirection: 'column',
          fontSize: 'var(--owl-text-sm)',
          gap: '0.3rem',
          lineHeight: 1.45,
          margin: 0,
          paddingLeft: '1.1rem',
        },
      },
      ...plan.notes.map((note, index) => createElement('li', { key: `plan-note-${index}` }, note)),
    ),
  )
}

function createPlanMetric(label: string, value: string) {
  return createElement(
    'div',
    {
      key: label,
      style: {
        background: 'var(--owl-color-panel-elevated)',
        border: '1px solid var(--owl-color-border)',
        borderRadius: '0.7rem',
        padding: '0.7rem 0.8rem',
      },
    },
    createElement(
      'div',
      {
        style: {
          color: 'var(--owl-color-quiet)',
          fontFamily: 'var(--owl-font-mono)',
          fontSize: 'var(--owl-text-2xs)',
          letterSpacing: '0.05em',
          textTransform: 'uppercase' as const,
        },
      },
      label,
    ),
    createElement(
      'div',
      { style: { color: 'var(--owl-color-gold-bright)', fontSize: 'var(--owl-text-md)', fontWeight: 800, marginTop: '0.15rem' } },
      value,
    ),
  )
}

function createTrancheRow(tranche: PositionTranche, currency: string) {
  return createElement(
    'div',
    {
      key: tranche.id,
      style: {
        alignItems: 'center',
        background: 'var(--owl-color-panel-deep)',
        border: '1px solid var(--owl-color-border)',
        borderRadius: '0.7rem',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem 0.9rem',
        justifyContent: 'space-between',
        padding: '0.6rem 0.8rem',
      },
    },
    // Tranche id + trigger
    createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' } },
      createElement(
        'span',
        { style: { color: 'var(--owl-color-gold-bright)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-base)', fontWeight: 800 } },
        tranche.id,
      ),
      createElement(
        'span',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-base)' } },
        `${tranche.trigger_label} · $${tranche.trigger_price_per_share}`,
      ),
      tranche.thesis_gate ? createElement(
        'span',
        {
          style: {
            background: 'rgba(214, 178, 94, 0.15)',
            border: '1px solid rgba(214, 178, 94, 0.4)',
            borderRadius: '0.5rem',
            color: '#f0d999',
            fontFamily: 'var(--owl-font-mono)',
            fontSize: 'var(--owl-text-2xs)',
            fontWeight: 800,
            letterSpacing: '0.04em',
            padding: '0.15rem 0.5rem',
            whiteSpace: 'nowrap' as const,
          },
        },
        'thesis re-check',
      ) : null,
    ),
    // Value + shares
    createElement(
      'div',
      { style: { color: 'var(--owl-color-text)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-base)', textAlign: 'right' as const } },
      `${formatPlanMoney(tranche.target_value, currency)} · ~${tranche.approx_shares} sh`,
    ),
  )
}

/**
 * One figure in the valuation ledger-line: a mono uppercase label over a
 * tabular mono figure. `figureClass` carries the money/emerald/risk modifiers.
 */
function createValuationLedgerStat(label: string, value: string, figureClass: string) {
  return createElement(
    'article',
    { key: label, className: 'owl-ledger-stat' },
    createElement('p', { className: 'owl-ledger-label' }, label),
    createElement('p', { className: `owl-ledger-figure ${figureClass}`.trim() }, value),
  )
}

// ── Decision evidence (4 summary cards) ──────────────────────────────────────

function createDecisionEvidence(researchCase: AppResearchCase) {
  const fullThesis = firstNonEmpty([
    researchCase.thesis_summary,
    researchCase.reason,
    researchCase.evidence_summary,
  ]) ?? 'No investment thesis has been drafted yet.'

  const thesis = createConciseDossierSummary(fullThesis, researchCase.ticker ?? researchCase.company_id)

  const valuationText = researchCase.valuation_rationale?.trim().length
    ? researchCase.valuation_rationale
    : createFallbackValuationText(researchCase)

  const shariahText = researchCase.shariah_rationale?.trim().length
    ? researchCase.shariah_rationale
    : `Needs structured Shariah detail. Current compliance gate: ${researchCase.shariah_status ?? 'Pending'}.`

  const risks = researchCase.risks !== undefined && researchCase.risks.length > 0
    ? researchCase.risks
    : researchCase.caveats !== undefined && researchCase.caveats.length > 0
      ? researchCase.caveats
      : ['No separately structured risks are recorded yet; review the thesis and source evidence before action.']
  const openQuestions = researchCase.open_questions !== undefined && researchCase.open_questions.length > 0
    ? researchCase.open_questions
    : [researchCase.next_required_action ?? 'Continue source-backed review before any user-authored transition.']

  return createElement(
    'section',
    {
      className: 'owl-workflow-card owl-section-card',
      style: {
        gap: '0.75rem',
      },
    },
    createElement('p', { className: 'owl-section-accent' }, 'Decision evidence'),
    // Masonry/flow packing (Priority 1): the three short cards no longer leave a dead void beside the
    // long Risks card — each packs to content height and reflows.
    createMasonryFlow('decision-evidence-flow', [
      createDossierCard('Thesis', thesis, undefined, { note: 'Full thesis available in the disclosure below.' }),
      createDossierCard('Valuation', valuationText, researchCase.valuation_status, { note: valuationProvenanceNote(researchCase) }),
      createDossierCard('Shariah / compliance', shariahText, researchCase.shariah_status, { extra: createShariahRatioLedger(researchCase) }),
      createDossierCard('Risks / open questions', [...risks, ...openQuestions]),
    ]),
    createFullThesisDisclosure(fullThesis, thesis),
  )
}

/**
 * OE-bridge provenance note for the Valuation card: when the bridge was anchored to the SEC 10-K we
 * say so (with the fiscal year); otherwise it is model-estimated. Returns undefined when no bridge
 * basis was recorded (legacy cases) so the note element is omitted.
 */
function valuationProvenanceNote(researchCase: AppResearchCase): string | undefined {
  const basis = researchCase.valuation?.bridge_basis
  if (basis === 'sec_edgar') {
    const fy = researchCase.valuation?.bridge_fiscal_year
    return fy !== undefined
      ? `Owner earnings computed from SEC 10-K FY${fy}.`
      : 'Owner earnings computed from SEC 10-K.'
  }
  if (basis === 'model_proposed') {
    return 'Owner earnings are model-estimated (no SEC primary filing available).'
  }
  return undefined
}

function createFallbackValuationText(researchCase: AppResearchCase): string {
  const valuation = researchCase.valuation
  if (valuation?.buy_price_per_share !== undefined) {
    const discount = valuation.discount_rate !== undefined ? `${Math.round(valuation.discount_rate * 100)}%` : DEFAULT_DISCOUNT_LABEL
    // Buy-below is the model-proposed price-to-buy-below carried with its cited reasoning (not a derived haircut).
    const fair = valuation.fair_value_per_share !== undefined ? `fair value $${valuation.fair_value_per_share.toFixed(2)} → ` : ''
    return `${fair}buy below $${valuation.buy_price_per_share}/sh · ${discount} savings-anchored discount. Quality is not in question; price is.`
  }
  if (researchCase.owner_earnings_valuation !== undefined) {
    return researchCase.owner_earnings_valuation.summary
      ?? 'Owner-earnings valuation details are available in the deep-dive valuation lane below.'
  }
  const valuationStatus = researchCase.valuation_status ?? 'Pending'
  return `Legacy dossier lacks structured owner-earnings assumptions; treat ${valuationStatus} as a deep-dive valuation status, not a Quick Screen gate.`
}

function createDossierCard(
  label: string,
  content: string | string[],
  status?: string,
  options?: { note?: string | undefined; extra?: ReturnType<typeof createElement> | null | undefined },
) {
  const contentItems = Array.isArray(content) ? content : [content]

  return createElement(
    'article',
    {
      'data-testid': `research-dossier-card-${slugifyDossierLabel(label)}`,
      style: {
        ...masonryItemStyle,
        background: 'var(--owl-color-panel-deep)',
        border: '1px solid rgba(148, 163, 184, 0.14)',
        borderRadius: '0.85rem',
        padding: '0.85rem',
      },
    },
    // Inner grid preserves vertical rhythm — the article itself is inline-block (masonry item).
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.5rem' } },
      createElement(
        'div',
        { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.45rem', justifyContent: 'space-between' } },
        createElement('h3', { style: { color: '#f7f8ff', fontSize: 'var(--owl-text-base)', margin: 0 } }, label),
        status === undefined ? null : createElement('span', { style: { color: 'var(--owl-color-gold-bright)', fontSize: 'var(--owl-text-sm)', fontWeight: 900 } }, status),
      ),
      contentItems.length === 1
        ? createElement('p', { style: { color: '#dbe3ef', fontSize: 'var(--owl-text-base)', lineHeight: 1.5, margin: 0 } }, contentItems[0])
        : createElement(
          'ul',
          { style: { color: '#dbe3ef', display: 'grid', fontSize: 'var(--owl-text-base)', gap: '0.35rem', lineHeight: 1.4, margin: 0, paddingLeft: '1rem' } },
          ...contentItems.map((item) => createElement('li', { key: item }, item)),
        ),
      options?.extra ?? null,
      options?.note === undefined
        ? null
        : createElement('p', { style: { color: '#9aa4b7', fontSize: 'var(--owl-text-sm)', fontWeight: 750, lineHeight: 1.4, margin: 0 } }, options.note),
    ),
  )
}

/** Format a fraction as a percentage with one decimal (0.0134 → "1.3%"). */
function formatRatioPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

/**
 * Mini ledger-line of the three AAOIFI financial ratios (harness-computed from SEC primary data +
 * market cap, re-verifying the LLM), the harness verdict, and the purification %. Emerald when within
 * threshold, risk colour when breached. Returns null when no harness ratios were computed.
 */
function createShariahRatioLedger(researchCase: AppResearchCase): ReturnType<typeof createElement> | null {
  const sf = researchCase.shariah_financial
  if (sf === undefined) return null
  const EMERALD = 'var(--owl-color-emerald, #34d399)'
  const RISK = 'var(--owl-color-risk)'

  const row = (label: string, ratio: number | undefined, thresholdLabel: string, max: number) => {
    if (ratio === undefined) return null
    const within = ratio < max
    return createElement(
      'div',
      { key: label, style: { alignItems: 'baseline', color: '#dbe3ef', display: 'flex', fontSize: 'var(--owl-text-sm)', gap: '0.4rem', justifyContent: 'space-between' } },
      createElement('span', null, label),
      createElement(
        'span',
        { style: { color: within ? EMERALD : RISK, fontWeight: 800 } },
        `${formatRatioPct(ratio)} (${thresholdLabel} ${within ? '✓' : '✗'})`,
      ),
    )
  }

  const verdict = sf.verdict ?? 'Pending'
  const verdictColor = verdict === 'FAIL' ? RISK : verdict === 'PASS' ? EMERALD : 'var(--owl-color-gold-bright)'
  const purification = sf.purification_pct !== undefined ? formatRatioPct(sf.purification_pct) : '0.0%'

  return createElement(
    'div',
    {
      'data-testid': 'shariah-aaoifi-ledger',
      style: { borderTop: '1px solid rgba(148, 163, 184, 0.14)', display: 'grid', gap: '0.3rem', marginTop: '0.2rem', paddingTop: '0.45rem' },
    },
    createElement('p', { style: { color: '#9aa4b7', fontSize: 'var(--owl-text-sm)', fontWeight: 800, margin: 0 } }, 'AAOIFI financial ratios (harness-computed)'),
    row('Debt / market cap', sf.debt_ratio, '< 30%', 0.3),
    row('Cash + securities / market cap', sf.cash_securities_ratio, '< 30%', 0.3),
    row('Impermissible income / revenue', sf.impermissible_income_pct, '< 5%', 0.05),
    createElement(
      'div',
      { style: { alignItems: 'baseline', color: '#dbe3ef', display: 'flex', fontSize: 'var(--owl-text-sm)', gap: '0.4rem', justifyContent: 'space-between', marginTop: '0.15rem' } },
      createElement('span', { style: { fontWeight: 800 } }, `Verdict: ${verdict}`),
      createElement('span', { style: { color: verdictColor, fontWeight: 800 } }, `Purification: ${purification}`),
    ),
  )
}

function createFullThesisDisclosure(fullThesis: string, conciseThesis: string) {
  if (fullThesis === conciseThesis) return null

  return createElement(
    'details',
    {
      style: {
        background: 'var(--owl-color-panel-deep)',
        border: '1px solid rgba(148, 163, 184, 0.12)',
        borderRadius: '0.85rem',
        padding: '0.85rem',
      },
    },
    createElement(
      'summary',
      {
        style: {
          color: 'var(--owl-color-gold-bright)',
          cursor: 'pointer',
          fontSize: 'var(--owl-text-base)',
          fontWeight: 900,
        },
      },
      'Full thesis',
    ),
    createElement(
      'p',
      { style: { color: '#dbe3ef', lineHeight: 1.6, margin: '0.75rem 0 0' } },
      fullThesis,
    ),
  )
}

// ── Visible specialist lanes grid (NEW — owner wants to see these) ────────────

function createSpecialistLanesGrid(researchCase: AppResearchCase) {
  const legacyDossier = isLegacyDecisionDossier(researchCase)
  const findings = researchCase.specialist_findings ?? []
  const displayFindings = findings.length === 0 && legacyDossier
    ? createLegacyDeepDiveFindings(researchCase)
    : findings

  if (displayFindings.length === 0) return null

  const orderedLanes = ['business_quality', 'moat', 'management', 'financial_quality', 'shariah', 'risks', 'valuation']
  const orderedFindings = orderedLanes
    .map((lane) => displayFindings.find((f) => f.specialist_lane === lane))
    .filter((f): f is NonNullable<typeof f> => f !== undefined)
  const remainder = displayFindings.filter((f) => !orderedLanes.includes(f.specialist_lane ?? ''))
  const allFindings = [...orderedFindings, ...remainder]

  return createElement(
    'section',
    {
      className: 'owl-section-card',
      style: {
        gap: '0.7rem',
      },
    },
    createElement(
      'div',
      { style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'space-between' } },
      createElement('p', { className: 'owl-section-accent' }, 'Deep-dive specialist lanes'),
      createElement(
        'span',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)' } },
        `${allFindings.length} lane${allFindings.length !== 1 ? 's' : ''} · source-backed`,
      ),
    ),
    // Masonry/flow packing (Priority 1): a short lane card no longer gaps beside a tall one — each lane
    // packs to its own content height and reflows.
    createMasonryFlow('specialist-lanes-flow', allFindings.map((finding) => createSpecialistLaneCard(finding))),
  )
}

type ResearchFindingCard = NonNullable<AppResearchCase['specialist_findings']>[number]

/**
 * Split a lane finding into its CONCLUSION (the bottom line — first sentence) and the supporting DETAIL
 * (the remainder). Density treatment (Priority 4): the reader sees the verdict at a glance; the supporting
 * reasoning is secondary, behind a disclosure. When the finding is a single short sentence there is no
 * detail to defer.
 */
function splitLaneFinding(summary: string): { conclusion: string; detail: string | undefined } {
  const compact = summary.trim().replace(/\s+/g, ' ')
  if (compact.length <= 160) return { conclusion: compact, detail: undefined }
  // Prefer a clean sentence boundary for the conclusion (the bottom line). Reject a first "sentence" that is
  // itself a wall of text (>220 chars) — a run-on still needs the density treatment, so fall through.
  const match = compact.match(/^(.+?[.!?])\s+(.*)$/s)
  if (
    match !== null && match[1] !== undefined && match[2] !== undefined &&
    match[2].trim().length > 0 && match[1].trim().length <= 220
  ) {
    return { conclusion: match[1].trim(), detail: match[2].trim() }
  }
  // Run-on finding (no internal sentence break, or an over-long first sentence): split at the nearest word
  // boundary so the disclosure still fires. conclusion (minus the ellipsis) + ' ' + detail === the original.
  const space = compact.lastIndexOf(' ', 160)
  const boundary = space > 80 ? space : 160
  const detail = compact.slice(boundary).trim()
  if (detail.length === 0) return { conclusion: compact, detail: undefined }
  return { conclusion: `${compact.slice(0, boundary).trim()}…`, detail }
}

function createSpecialistLaneCard(finding: ResearchFindingCard) {
  const laneLabel = deepDiveLaneShortLabel(finding.specialist_lane)
  const sourceIds = finding.source_ids ?? []
  const isRiskyLane = finding.specialist_lane === 'risks' || finding.specialist_lane === 'risk'
  const confidenceClass = finding.confidence?.toLowerCase().includes('high') ? 'high' : 'normal'
  const { conclusion, detail } = splitLaneFinding(finding.finding_summary ?? 'No lane summary recorded.')

  return createElement(
    'article',
    {
      key: finding.finding_id,
      style: {
        ...masonryItemStyle,
        background: 'var(--owl-color-panel-elevated)',
        border: `1px solid ${isRiskyLane ? 'var(--owl-color-fiduciary)' : 'var(--owl-color-border)'}`,
        borderLeft: isRiskyLane ? '3px solid var(--owl-color-fiduciary)' : undefined,
        borderRadius: '0.7rem',
        padding: '0.75rem 0.85rem',
      },
    },
    // Inner grid preserves vertical rhythm — the article itself is inline-block (masonry item).
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.4rem' } },
      // Lane name + confidence (the lane verdict at a glance — KEEP: confidence chip + source count)
      createElement(
        'div',
        { style: { alignItems: 'center', display: 'flex', justifyContent: 'space-between' } },
        createElement(
          'span',
          {
            style: {
              color: 'var(--owl-color-sand)',
              fontFamily: 'var(--owl-font-mono)',
              fontSize: 'var(--owl-text-xs)',
              fontWeight: 800,
              letterSpacing: '0.05em',
              textTransform: 'uppercase' as const,
            },
          },
          laneLabel,
        ),
        finding.confidence === undefined ? null : createElement(
          'span',
          {
            style: {
              border: `1px solid ${confidenceClass === 'high' ? 'rgba(52, 211, 153, 0.34)' : 'var(--owl-color-border)'}`,
              borderRadius: '999px',
              color: confidenceClass === 'high' ? '#bbf7d0' : 'var(--owl-color-muted)',
              fontSize: 'var(--owl-text-2xs)',
              padding: '0.12rem 0.45rem',
            },
          },
          finding.confidence,
        ),
      ),
      // Lane CONCLUSION — the bottom line, the reader sees it immediately (Priority 4).
      createElement(
        'p',
        { style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-sm)', fontWeight: 600, lineHeight: 1.45, margin: 0 } },
        conclusion,
      ),
      // Supporting DETAIL — secondary, behind a disclosure so the card stays scannable.
      detail === undefined ? null : createElement(
        'details',
        { style: { margin: 0 } },
        createElement(
          'summary',
          { style: { color: 'var(--owl-color-gold-bright)', cursor: 'pointer', fontSize: 'var(--owl-text-2xs)', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' as const } },
          'Reasoning',
        ),
        createElement(
          'p',
          { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: '0.4rem 0 0' } },
          detail,
        ),
      ),
      // Source count (KEEP)
      sourceIds.length > 0 ? createElement(
        'span',
        {
          style: {
            color: 'var(--owl-color-quiet)',
            fontFamily: 'var(--owl-font-mono)',
            fontSize: 'var(--owl-text-2xs)',
            marginTop: '0.2rem',
          },
        },
        `${sourceIds.length} source${sourceIds.length !== 1 ? 's' : ''}`,
      ) : null,
    ),
  )
}

// ── Evidence and audit details (collapsed, e2e anchor) ────────────────────────

function createEvidenceAndAuditDetails(researchCase: AppResearchCase) {
  return createElement(
    'details',
    {
      style: {
        ...cardStyle,
        display: 'grid',
        gap: '1rem',
      },
    },
    createElement(
      'summary',
      {
        style: {
          color: '#f7f8ff',
          cursor: 'pointer',
          fontSize: 'var(--owl-text-md)',
          fontWeight: 900,
        },
      },
      'Evidence and audit details',
    ),
    createElement(
      'div',
      { style: { display: 'grid', gap: '1rem', marginTop: '1rem' } },
      createEvidenceAndSourcesPanel(researchCase),
      createGateChecklistPanel(researchCase),
      createLedgerTimelinePanel(researchCase),
      // Quick screen and deep-dive panels preserved for unit-test assertions
      createQuickScreenCollapsible(researchCase),
      createDeepDiveCollapsible(researchCase),
    ),
  )
}

function createEvidenceAndSourcesPanel(researchCase: AppResearchCase) {
  const recordedEvidence = researchCase.source_evidence ?? []
  const sourceEvidence = recordedEvidence.length === 0
    ? researchCase.source_ids.map((sourceId) => ({
      source_id: sourceId,
      title: humanizeAuditSourceId(sourceId),
      excerpt: 'No source excerpt was recorded for this legacy event; keep the audit source ID for ledger traceability.',
    }))
    : recordedEvidence

  return createElement(
    'section',
    { style: cardStyle },
    createElement('h2', { style: { fontSize: 'var(--owl-text-lg)', margin: '0 0 0.35rem' } }, 'Evidence and sources'),
    createElement(
      'p',
      { style: { color: '#9aa4b7', fontSize: 'var(--owl-text-base)', margin: '0 0 1rem' } },
      'Human-readable source context appears first; raw audit source IDs remain available for ledger traceability.',
    ),
    sourceEvidence.length === 0
      ? createElement('p', { style: { color: '#cbd5e1', margin: 0 } }, 'No source evidence has been recorded yet.')
      : createElement(
        'div',
        { style: { display: 'grid', gap: '0.85rem' } },
        ...sourceEvidence.map((source) => createEvidenceCard(source)),
      ),
  )
}

function createGateChecklistPanel(researchCase: AppResearchCase) {
  return createElement(
    'section',
    { style: cardStyle },
    createElement('h2', { style: { fontSize: 'var(--owl-text-lg)', margin: '0 0 1rem' } }, 'Gate checklist'),
    createElement(
      'ul',
      { style: { display: 'grid', gap: '0.75rem', listStyle: 'none', margin: 0, padding: 0 } },
      ...researchCase.gate_checklist.map((gate) =>
        createElement(
          'li',
          {
            key: gate.label,
            style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' },
          },
          createElement(StatusBadge, { tone: gate.tone }, gate.status),
          createElement(
            'span',
            { style: { display: 'grid', gap: '0.25rem' } },
            createElement('span', { style: { fontWeight: 700 } }, gate.label),
            createElement('span', { style: { color: '#9aa4b7', fontSize: 'var(--owl-text-base)' } }, `Evidence source context: ${describeGateEvidence(gate.label, researchCase.source_ids)}`),
          ),
        ),
      ),
    ),
  )
}

function createLedgerTimelinePanel(researchCase: AppResearchCase) {
  return createElement(
    'section',
    { style: cardStyle },
    createElement('h2', { style: { fontSize: 'var(--owl-text-lg)', margin: '0 0 0.35rem' } }, 'Ledger Timeline'),
    createElement(
      'p',
      { style: { color: '#9aa4b7', fontSize: 'var(--owl-text-base)', margin: '0 0 1rem' } },
      'How did this state come to exist?',
    ),
    createElement(
      'ol',
      { style: { color: '#cbd5e1', display: 'grid', gap: '0.85rem', margin: 0, paddingLeft: '1.25rem' } },
      ...researchCase.ledger_timeline.map((entry) =>
        createElement(
          'li',
          { key: entry.event_id },
          createElement('p', { style: { fontWeight: 900, margin: 0 } }, entry.event_type),
          createElement('p', { style: { margin: '0.2rem 0 0' } }, entry.summary),
          createElement(
            'p',
            { style: { color: '#9aa4b7', fontSize: 'var(--owl-text-base)', margin: '0.2rem 0 0' } },
            `${entry.actor_label} • ${entry.created_at}`,
          ),
        ),
      ),
    ),
  )
}

function createEvidenceCard(source: AppSourceEvidence) {
  return createElement(
    'article',
    {
      key: source.source_id,
      style: {
        background: 'var(--owl-color-panel-deep)',
        border: '1px solid rgba(148, 163, 184, 0.14)',
        borderRadius: '0.9rem',
        display: 'grid',
        gap: '0.45rem',
        padding: '0.95rem',
      },
    },
    createElement('h3', { style: { color: '#f7f8ff', fontSize: 'var(--owl-text-md)', margin: 0 } }, source.title),
    createElement('p', { style: { color: '#cbd5e1', lineHeight: 1.55, margin: 0 } }, source.excerpt),
    source.url === undefined
      ? null
      : createElement('a', { href: source.url, rel: 'noreferrer', style: { color: 'var(--owl-color-gold-bright)', fontSize: 'var(--owl-text-base)', fontWeight: 800 } }, 'Open source URL'),
    source.citation_locator === undefined
      ? null
      : createElement('p', { style: { color: '#9aa4b7', fontSize: 'var(--owl-text-base)', margin: 0 } }, `Citation: ${source.citation_locator}`),
    createElement(SourceChip, { id: source.source_id, label: 'Audit source id' }),
  )
}

// ── Quick screen collapsible (preserved for unit-test assertions, lives inside audit details) ──

function createQuickScreenCollapsible(researchCase: AppResearchCase) {
  const inner = createQuickScreenPanel(researchCase)
  if (inner === null) return null

  return createElement(
    'details',
    { style: collapsibleDetailsStyle },
    createElement('summary', { style: collapsibleSummaryStyle }, 'Quick screen details'),
    createElement('div', { style: { marginTop: '0.85rem' } }, inner),
  )
}

function createQuickScreenPanel(researchCase: AppResearchCase) {
  const legacyDossier = isLegacyDecisionDossier(researchCase)
  if (researchCase.quick_screen_id === undefined && researchCase.screening_result === undefined && !legacyDossier) {
    return null
  }

  const strategyLabel = researchCase.strategy_version === undefined
    ? researchCase.strategy_id ?? 'Unknown strategy'
    : `${researchCase.strategy_id ?? 'unknown'}@${researchCase.strategy_version}`
  const redFlags = researchCase.red_flags === undefined || researchCase.red_flags.length === 0
    ? legacyDossier
      ? legacyQuickScreenRedFlags(researchCase)
      : ['No red flags recorded']
    : researchCase.red_flags
  const caveats = researchCase.caveats === undefined || researchCase.caveats.length === 0
    ? legacyDossier
      ? ['Legacy dossier only; no standalone Quick Screen caveats were recorded.']
      : ['No caveats recorded']
    : researchCase.caveats
  const intro = legacyDossier
    ? 'Legacy decision has no standalone Quick Screen event; use this as a business-quality digest of the existing dossier before spending more analysis budget.'
    : 'Quick Screen is a selected-strategy first pass for business quality, moat, management, financial quality, red flags, and Shariah/data availability. Valuation belongs in deep dive and this card never mutates watchlist or holding state without explicit approval.'

  return createElement(
    'section',
    { className: 'owl-workflow-card', style: cardStyle },
    createElement('p', { style: labelStyle }, 'Quick screen'),
    createElement(
      'h2',
      { style: { fontSize: 'var(--owl-text-lg)', margin: '0.35rem 0 0.6rem' } },
      'Single-agent business-quality gate',
    ),
    createElement(
      'p',
      { style: { color: '#9aa4b7', margin: '0 0 1rem' } },
      intro,
    ),
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' } },
      createDetail('Selected strategy', strategyLabel),
      createDetail('Deep-dive recommendation', researchCase.screening_result ?? (legacyDossier ? 'Review existing decision draft' : 'Pending')),
      createDetail('Business quality', researchCase.business_quality ?? legacyBusinessQualityDigest(researchCase)),
      createDetail('Moat', researchCase.moat ?? legacyMoatDigest(researchCase)),
      createDetail('Management / capital allocation', researchCase.management_capital_allocation ?? legacyManagementDigest()),
      createDetail('Financial quality', researchCase.financial_quality ?? legacyFinancialQualityDigest(researchCase)),
      createDetail('Shariah / data availability', researchCase.shariah_status ?? 'Pending'),
      createDetail('Red flags', redFlags.join('; ')),
      createDetail('Uncertainty / caveats', `${researchCase.confidence ?? 'Pending'} — ${caveats.join('; ')}`),
      createDetail('Valuation belongs in deep dive', researchCase.valuation_sanity ?? 'Owner-earnings valuation runs in deep dive.'),
      createDetail('Source ids', researchCase.source_ids.length === 0 ? 'No source IDs recorded' : researchCase.source_ids.join(', ')),
    ),
  )
}

// ── Deep dive collapsible (preserved for unit-test assertions, lives inside audit details) ──

function createDeepDiveCollapsible(researchCase: AppResearchCase) {
  const inner = createDeepDivePanel(researchCase)
  if (inner === null) return null

  return createElement(
    'details',
    { style: collapsibleDetailsStyle },
    createElement('summary', { style: collapsibleSummaryStyle }, 'Deep-dive lane findings'),
    createElement('div', { style: { marginTop: '0.85rem' } }, inner),
  )
}

function createDeepDivePanel(researchCase: AppResearchCase) {
  const legacyDossier = isLegacyDecisionDossier(researchCase)
  const findings = researchCase.specialist_findings ?? []
  const displayFindings = findings.length === 0 && legacyDossier
    ? createLegacyDeepDiveFindings(researchCase)
    : findings
  const ownerValuation = researchCase.owner_earnings_valuation
    ?? findings.find((finding) => finding.specialist_lane === 'valuation')?.owner_earnings_valuation
    ?? (legacyDossier ? createLegacyOwnerEarningsValuation(researchCase) : undefined)

  if (displayFindings.length === 0 && ownerValuation === undefined && researchCase.deep_dive_id === undefined) {
    return null
  }

  const orderedLanes = ['business_quality', 'moat', 'management', 'financial_quality', 'shariah', 'risks', 'valuation']
  const cards = orderedLanes
    .map((lane) => displayFindings.find((finding) => finding.specialist_lane === lane))
    .filter((finding): finding is NonNullable<typeof finding> => finding !== undefined)

  return createElement(
    'section',
    { className: 'owl-workflow-card', style: { ...cardStyle, display: 'grid', gap: '1rem' } },
    createElement('p', { style: labelStyle }, 'Deep dive dossier'),
    createElement(
      'h2',
      { style: { fontSize: 'var(--owl-text-lg)', margin: 0 } },
      'Swarm lane findings',
    ),
    createElement(
      'p',
      { style: { color: '#9aa4b7', margin: 0 } },
      'Deep dive separates business quality from valuation. The valuation lane is the owner-earnings buy-price workstream and should carry assumptions, sources, confidence, and caveats when available.',
    ),
    cards.length === 0
      ? createElement('p', { style: { color: '#cbd5e1', margin: 0 } }, 'No lane findings have been recorded yet.')
      : createElement(
        'div',
        { style: { display: 'grid', gap: '0.85rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' } },
        ...cards.map((finding) => createDeepDiveFindingCard(finding)),
      ),
    ownerValuation === undefined ? null : createOwnerEarningsValuationCard(ownerValuation),
  )
}

function createDeepDiveFindingCard(finding: ResearchFindingCard) {
  const laneLabel = deepDiveLaneLabel(finding.specialist_lane)
  const caveats = finding.caveats ?? []
  const sourceIds = finding.source_ids ?? []

  return createElement(
    'article',
    {
      key: finding.finding_id,
      style: {
        background: 'var(--owl-color-panel-deep)',
        border: '1px solid rgba(148, 163, 184, 0.14)',
        borderRadius: '0.95rem',
        display: 'grid',
        gap: '0.65rem',
        padding: '1rem',
      },
    },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.55rem', justifyContent: 'space-between' } },
      createElement('h3', { style: { color: '#f7f8ff', fontSize: 'var(--owl-text-md)', margin: 0 } }, laneLabel),
      finding.confidence === undefined ? null : createElement('span', { style: { color: 'var(--owl-color-gold-bright)', fontSize: 'var(--owl-text-sm)', fontWeight: 900 } }, finding.confidence),
    ),
    createElement('p', { style: { color: '#dbe3ef', lineHeight: 1.55, margin: 0 } }, finding.finding_summary ?? 'No lane summary recorded.'),
    caveats.length === 0
      ? null
      : createElement(
        'ul',
        { style: { color: '#9aa4b7', display: 'grid', gap: '0.35rem', lineHeight: 1.45, margin: 0, paddingLeft: '1.1rem' } },
        ...caveats.map((caveat) => createElement('li', { key: caveat }, caveat)),
      ),
    sourceIds.length === 0 ? null : createDetail('Source ids', sourceIds.join(', ')),
  )
}

function createOwnerEarningsValuationCard(ownerValuation: NonNullable<AppResearchCase['owner_earnings_valuation']>) {
  const assumptions = ownerValuation.assumptions ?? []
  const caveats = ownerValuation.caveats ?? []
  const sources = ownerValuation.sources ?? []

  return createElement(
    'article',
    {
      style: {
        background: 'rgba(22, 163, 74, 0.08)',
        border: '1px solid var(--owl-color-border-strong)',
        borderRadius: '1rem',
        display: 'grid',
        gap: '0.75rem',
        padding: '1rem',
      },
    },
    createElement('p', { style: labelStyle }, 'Owner-earnings valuation lane'),
    ownerValuation.summary === undefined
      ? null
      : createElement('p', { style: { color: '#dbe3ef', lineHeight: 1.55, margin: 0 } }, ownerValuation.summary),
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.65rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' } },
      createDetail('Normalized owner earnings', ownerValuation.normalized_owner_earnings ?? 'Pending'),
      createDetail('Fair value range', ownerValuation.fair_value_range ?? 'Pending'),
      createDetail('Buy-price range', ownerValuation.buy_price_range ?? 'Pending'),
      createDetail('Margin of safety', ownerValuation.margin_of_safety ?? 'Pending'),
      createDetail('Confidence', ownerValuation.confidence ?? 'Pending'),
      createDetail('Sources', sources.length === 0 ? 'No source IDs recorded' : sources.join(', ')),
    ),
    assumptions.length === 0
      ? null
      : createElement(
        'section',
        { style: { display: 'grid', gap: '0.45rem' } },
        createElement('h3', { style: { color: '#f7f8ff', fontSize: 'var(--owl-text-md)', margin: 0 } }, 'Assumptions'),
        createElement(
          'ul',
          { style: { color: '#dbe3ef', display: 'grid', gap: '0.35rem', lineHeight: 1.45, margin: 0, paddingLeft: '1.1rem' } },
          ...assumptions.map((assumption) => createElement('li', { key: assumption }, assumption)),
        ),
      ),
    caveats.length === 0
      ? null
      : createElement(
        'section',
        { style: { display: 'grid', gap: '0.45rem' } },
        createElement('h3', { style: { color: '#f7f8ff', fontSize: 'var(--owl-text-md)', margin: 0 } }, 'Caveats'),
        createElement(
          'ul',
          { style: { color: '#dbe3ef', display: 'grid', gap: '0.35rem', lineHeight: 1.45, margin: 0, paddingLeft: '1.1rem' } },
          ...caveats.map((caveat) => createElement('li', { key: caveat }, caveat)),
        ),
      ),
  )
}

// ── Watchlist promotion & actions ─────────────────────────────────────────────

// ── Admit recommendation (Task 4.3-panel) ─────────────────────────────────────
//
// Read-only render of the PERSISTED `admit_recommendation` projection (NOT recomputed here) plus the
// on-demand request control. The crux: `uncertainty` and `permanent_loss_risk` are rendered as SEPARATE,
// clearly-distinct fields — they must NEVER be blurred into a single "value trap" line, because the
// opportunity is precisely high uncertainty + LOW permanent-loss. The impairment_call / admittable are
// shown as an ADVISORY recommendation; the human still admits via the signed-thesis control below.

function riskLevelColor(level: string | undefined): string {
  const l = (level ?? '').toLowerCase()
  if (l === 'low') return '#bbf7d0'
  if (l === 'medium') return '#f0d999'
  if (l === 'high') return '#fca5a5'
  return 'var(--owl-color-muted)'
}

function createAdmitRiskField(
  testId: string,
  title: string,
  subtitle: string,
  field: { level?: string; argument?: string; citations?: string[] } | undefined,
) {
  const level = field?.level
  return createElement(
    'div',
    {
      'data-testid': testId,
      style: {
        background: 'var(--owl-color-panel-deep)',
        border: '1px solid rgba(148, 163, 184, 0.16)',
        borderRadius: '0.85rem',
        display: 'grid',
        gap: '0.4rem',
        padding: '0.9rem 1rem',
      },
    },
    createElement(
      'div',
      { style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', justifyContent: 'space-between' } },
      createElement('p', { style: { ...labelStyle, margin: 0 } }, title),
      createElement(
        'span',
        {
          style: {
            background: 'rgba(148, 163, 184, 0.12)',
            border: '1px solid var(--owl-color-border)',
            borderRadius: '999px',
            color: riskLevelColor(level),
            fontFamily: 'var(--owl-font-mono)',
            fontSize: 'var(--owl-text-sm)',
            fontWeight: 800,
            letterSpacing: '0.06em',
            padding: '0.2rem 0.7rem',
            textTransform: 'uppercase' as const,
          },
        },
        level === undefined ? 'NOT RATED' : level.toUpperCase(),
      ),
    ),
    createElement('p', { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-xs)', margin: 0 } }, subtitle),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)', lineHeight: 1.5, margin: 0 } },
      field?.argument ?? 'No argument recorded.',
    ),
    (field?.citations ?? []).length === 0 ? null : createElement(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.1rem' } },
      ...(field?.citations ?? []).map((citation) => createElement(SourceChip, { key: citation, id: citation, label: 'Cited source id' })),
    ),
  )
}

function createAdmitRecommendationPanel(researchCase: AppResearchCase) {
  const rec = researchCase.admit_recommendation

  // No recommendation yet — show ONLY the on-demand request control (no fabricated recommendation).
  if (rec === undefined) {
    return createElement(AdmitRecommendationRequest, { researchCaseId: researchCase.research_case_id })
  }

  const admittable = rec.admittable === true
  const callLabel = rec.impairment_call ?? 'unresolved'
  const cheapness = rec.cheapness
  const oeYield = cheapness?.owner_earnings_yield
  const ev = cheapness?.ev
  const uncitedRefs = rec.uncited_refs ?? []

  return createElement(
    'section',
    { 'data-testid': 'admit-recommendation', 'aria-label': 'Admit recommendation', style: { ...cardStyle, display: 'grid', gap: '0.85rem' } },
    createElement('p', { style: labelStyle }, 'Admit recommendation'),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
      'Advisory — recomputed on-demand and recorded as an observation, NOT an admission. The human still admits via the signed thesis below.',
    ),
    // Uncertainty and permanent-loss risk as SEPARATE, clearly-distinct fields (never merged).
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.6rem' } },
      createAdmitRiskField(
        'admit-uncertainty',
        'Uncertainty',
        'How unknowable the outcome is. High uncertainty is the opportunity, not a blocker.',
        rec.uncertainty,
      ),
      createAdmitRiskField(
        'admit-permanent-loss-risk',
        'Permanent-loss risk',
        'Risk of permanent capital impairment. A separate axis from uncertainty — this is what blocks admission.',
        rec.permanent_loss_risk,
      ),
    ),
    // Independent impairment bear case.
    rec.impairment_bear_case === undefined ? null : createElement(
      'div',
      {
        'data-testid': 'admit-bear-case',
        style: {
          background: 'rgba(239, 68, 68, 0.07)',
          border: '1px solid rgba(239, 68, 68, 0.28)',
          borderRadius: '0.85rem',
          display: 'grid',
          gap: '0.35rem',
          padding: '0.9rem 1rem',
        },
      },
      createElement('p', { style: { ...labelStyle, color: '#fca5a5', margin: 0 } }, 'Impairment bear case'),
      createElement(
        'p',
        { style: { color: '#f3d7d7', fontSize: 'var(--owl-text-base)', lineHeight: 1.5, margin: 0 } },
        rec.impairment_bear_case,
      ),
    ),
    // Advisory impairment call + admittable flag (the human decides).
    createElement(
      'div',
      {
        'data-testid': 'admit-advisory-call',
        style: {
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.6rem',
        },
      },
      createPill(
        `Impairment call: ${callLabel}`,
        callLabel === 'permanent_impairment'
          ? { bg: 'rgba(239, 68, 68, 0.14)', border: 'rgba(252, 165, 165, 0.36)', text: '#fecaca' }
          : callLabel === 'fixable_temporary'
            ? { bg: 'rgba(34, 197, 94, 0.14)', border: 'rgba(134, 239, 172, 0.38)', text: '#bbf7d0' }
            : { bg: 'rgba(214, 178, 94, 0.14)', border: 'rgba(243, 223, 177, 0.36)', text: '#f0d999' },
      ),
      createPill(
        admittable ? 'Advisory: admittable' : 'Advisory: not admittable',
        admittable
          ? { bg: 'rgba(34, 197, 94, 0.14)', border: 'rgba(134, 239, 172, 0.38)', text: '#bbf7d0' }
          : { bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.28)', text: 'var(--owl-color-muted)' },
      ),
    ),
    rec.reason === undefined ? null : createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-base)', lineHeight: 1.5, margin: 0 } },
      createElement('strong', { style: { color: 'var(--owl-color-sand)' } }, 'Reason: '),
      rec.reason,
    ),
    // Cheapness summary (owner-earnings yield / EV).
    (oeYield === undefined && ev === undefined) ? null : createElement(
      'div',
      {
        'data-testid': 'admit-cheapness',
        style: { borderTop: '1px solid var(--owl-color-border)', display: 'grid', gap: '0.3rem', paddingTop: '0.7rem' },
      },
      createElement('p', { style: { ...labelStyle, margin: 0 } }, 'Cheapness'),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-text)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-base)', margin: 0 } },
        oeYield === undefined ? 'Owner-earnings yield not computed' : `Owner-earnings yield ${(oeYield * 100).toFixed(1)}%`,
        ev === undefined ? '' : ` · EV ≈ $${Math.round(ev).toLocaleString('en-US')}M`,
        rec.buy_below === undefined ? '' : ` · buy below $${rec.buy_below}`,
      ),
      cheapness?.reason === undefined ? null : createElement(
        'p',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.4, margin: 0 } },
        cheapness.reason,
      ),
    ),
    // Uncited references surfaced as a caveat (never hidden).
    uncitedRefs.length === 0 ? null : createElement(
      'div',
      {
        'data-testid': 'admit-uncited-refs',
        style: {
          background: 'rgba(214, 178, 94, 0.08)',
          border: '1px solid rgba(214, 178, 94, 0.4)',
          borderRadius: '0.7rem',
          display: 'grid',
          gap: '0.3rem',
          padding: '0.7rem 0.85rem',
        },
      },
      createElement('p', { style: { ...labelStyle, color: 'var(--owl-color-gold-bright)', margin: 0 } }, 'Uncited references caveat'),
      createElement(
        'p',
        { style: { color: '#f0d999', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
        `The judgment referenced ${uncitedRefs.length} source${uncitedRefs.length === 1 ? '' : 's'} not in the verified case corpus: ${uncitedRefs.join(', ')}. Treat these as unverified.`,
      ),
    ),
    // On-demand re-run control (the recommendation is recomputed fresh; newest wins in the projection).
    createElement(AdmitRecommendationRequest, { researchCaseId: researchCase.research_case_id, hasRecommendation: true }),
  )
}

// ── Sizing recommendation panel (Phase 5 S7 — worst-case-first, cash-is-correct) ──────────────────────
//
// LEADS WITH THE WORST CASE (the concrete downside floor + its basis net-cash-vs-stressed-book + the
// aggregate cluster downside) BEFORE the target weight, surfaces the binding_constraint, and renders the
// `hold_in_savings` state as the CORRECT fat-pitch posture (a POSITIVE emerald block, NEVER a yellow/red
// warning). A request control computes it on-demand; the human-signed buy stays the holding-open form.

const SIZING_FLOOR_BASIS_LABEL: Record<string, string> = {
  net_cash: 'net cash (hardest — cash less total debt per share)',
  stressed_book: 'stressed book value (softer — haircut book equity per share)',
}

function formatSizingMoney(value: number | undefined): string {
  if (value === undefined) return '—'
  return `$${Math.round(value).toLocaleString('en-US')}`
}

function createSizingRecommendationPanel(researchCase: AppResearchCase) {
  const rec = researchCase.sizing_recommendation

  // No recommendation yet — show ONLY the on-demand request control (no fabricated size).
  if (rec === undefined) {
    return createElement(SizingRecommendationRequest, { researchCaseId: researchCase.research_case_id })
  }

  // hold_in_savings — the CORRECT posture (NOT a warning). Rendered as a POSITIVE emerald block: capital
  // parked in the savings sleeve earning the EXPECTED rate is fat-pitch discipline, not under-deployment.
  if (rec.status === 'hold_in_savings') {
    const expected = rec.expected_savings_return
    return createElement(
      'section',
      {
        'data-testid': 'sizing-recommendation',
        'data-sizing-status': 'hold_in_savings',
        'aria-label': 'Sizing recommendation',
        style: {
          ...cardStyle,
          // POSITIVE posture: emerald, NOT the gold caveat / red warning palette.
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(52, 211, 153, 0.4)',
          borderLeft: '3px solid #34d399',
          display: 'grid',
          gap: '0.7rem',
        },
      },
      createElement('p', { style: { ...labelStyle, color: '#6ee7b7' } }, 'Position sizing · hold in savings'),
      createElement(
        'p',
        { 'data-testid': 'sizing-hold-correct-posture', style: { color: '#bbf7d0', fontSize: 'var(--owl-text-md)', fontWeight: 800, lineHeight: 1.5, margin: 0 } },
        'Correct posture: park the capital in the savings sleeve',
        expected === undefined ? '.' : ` earning ~${(expected * 100).toFixed(1)}% expected.`,
      ),
      createElement(
        'p',
        { style: { color: '#d1fae5', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } },
        'Nothing here clears the deployment hurdle, so idle capital stays in the Shariah-compliant savings sleeve. This is fat-pitch discipline — waiting for the pitch, not under-deployment. Cash is a first-class position.',
      ),
      rec.reason === undefined ? null : createElement(
        'p',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
        createElement('strong', { style: { color: '#a7f3d0' } }, 'Why: '),
        rec.reason,
      ),
      createElement(SizingRecommendationRequest, { researchCaseId: researchCase.research_case_id, hasRecommendation: true }),
    )
  }

  // cannot_size — fail-closed (no floor / non-investable / bad inputs). Surfaced honestly, never a size.
  if (rec.status === 'cannot_size') {
    return createElement(
      'section',
      {
        'data-testid': 'sizing-recommendation',
        'data-sizing-status': 'cannot_size',
        'aria-label': 'Sizing recommendation',
        style: { ...cardStyle, borderLeft: '3px solid var(--owl-color-border)', display: 'grid', gap: '0.6rem' },
      },
      createElement('p', { style: labelStyle }, 'Position sizing · cannot size'),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } },
        'Cannot produce a size — fail-closed, never a fabricated number.',
      ),
      rec.reason === undefined ? null : createElement(
        'p',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
        createElement('strong', { style: { color: 'var(--owl-color-sand)' } }, 'Reason: '),
        rec.reason,
      ),
      createElement(SizingRecommendationRequest, { researchCaseId: researchCase.research_case_id, hasRecommendation: true }),
    )
  }

  // sizeable — LEAD WITH THE WORST CASE, then the target, then the ladder.
  const worst = rec.worst_case
  const floorBasis = worst?.downside_floor_basis
  const basisLabel = floorBasis === undefined ? undefined : (SIZING_FLOOR_BASIS_LABEL[floorBasis] ?? floorBasis)
  const clusterFraction = worst?.aggregate_cluster_downside_fraction
  const bindingLabel = humanizeToken(rec.binding_constraint ?? 'conviction')

  return createElement(
    'section',
    {
      'data-testid': 'sizing-recommendation',
      'data-sizing-status': 'sizeable',
      'aria-label': 'Sizing recommendation',
      style: { ...cardStyle, display: 'grid', gap: '0.85rem' },
    },
    createElement('p', { style: labelStyle }, 'Position sizing'),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
      'Advisory — recomputed on-demand and recorded as an observation, NOT a buy. The worst case comes first; the human still authors and signs the buy below.',
    ),
    // ── WORST CASE FIRST (the concrete floor + its basis + the aggregate cluster downside) ──
    createElement(
      'div',
      {
        'data-testid': 'sizing-worst-case',
        style: {
          background: 'rgba(239, 68, 68, 0.07)',
          border: '1px solid rgba(239, 68, 68, 0.28)',
          borderRadius: '0.85rem',
          display: 'grid',
          gap: '0.4rem',
          padding: '0.9rem 1rem',
        },
      },
      createElement('p', { style: { ...labelStyle, color: '#fca5a5', margin: 0 } }, 'Worst case first'),
      createElement(
        'p',
        { style: { color: '#f3d7d7', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } },
        worst?.downside_floor_per_share === undefined
          ? 'Downside floor not recorded.'
          : `Concrete downside floor $${worst.downside_floor_per_share.toFixed(2)}/share`,
        worst?.realistic_downside_per_share === undefined
          ? ''
          : ` · realistic downside $${worst.realistic_downside_per_share.toFixed(2)}/share from entry`,
        '.',
      ),
      basisLabel === undefined ? null : createElement(
        'p',
        { 'data-testid': 'sizing-floor-basis', style: { color: '#f3d7d7', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
        createElement('strong', null, 'Floor basis: '),
        basisLabel,
      ),
      clusterFraction === undefined ? null : createElement(
        'p',
        { 'data-testid': 'sizing-cluster-downside', style: { color: '#f3d7d7', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
        createElement('strong', null, 'Aggregate cluster downside: '),
        `${(clusterFraction * 100).toFixed(1)}% of book NAV if the correlated cluster impairs together.`,
      ),
    ),
    // ── Then the target weight + sizeable value + the BINDING constraint ──
    createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem' } },
      createPlanMetric('Target weight', rec.target_weight === undefined ? '—' : `${(rec.target_weight * 100).toFixed(1)}%`),
      createPlanMetric('Sizeable value', formatSizingMoney(rec.sizeable_value)),
      createPlanMetric('Conviction factor', rec.conviction_factor === undefined ? '—' : `${rec.conviction_factor.toFixed(2)}×`),
    ),
    createElement(
      'p',
      { 'data-testid': 'sizing-binding-constraint', style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)', lineHeight: 1.5, margin: 0 } },
      createElement('strong', { style: { color: 'var(--owl-color-accent-bright)' } }, 'Binding constraint: '),
      `${bindingLabel} — the smallest of the conviction target, the deployment cap, the permanent-loss cap, and the cluster cap.`,
    ),
    // ── Caveats (never hidden) ──
    (rec.caveats ?? []).length === 0 ? null : createElement(
      'ul',
      {
        style: {
          color: 'var(--owl-color-muted)', display: 'flex', flexDirection: 'column',
          fontSize: 'var(--owl-text-sm)', gap: '0.3rem', lineHeight: 1.45, margin: 0, paddingLeft: '1.1rem',
        },
      },
      ...(rec.caveats ?? []).map((caveat, index) => createElement('li', { key: `sizing-caveat-${index}` }, caveat)),
    ),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
      'Target weight is an entry cap — let winners run; the buy is human-signed, never auto-traded.',
    ),
    createElement(SizingRecommendationRequest, { researchCaseId: researchCase.research_case_id, hasRecommendation: true }),
  )
}

// ── Sell decision panel (Phase 6 S8b) ─────────────────────────────────────────
// Read-only render of the PERSISTED `sell_recommendation` projection (advisory; NOT recomputed here) plus
// the on-demand request control. It is WORST-CASE-FIRST (the concrete floor + its basis + the realistic
// downside) THEN the decision. The four decision_status states are distinct:
//   - `hold`           → the guard HELD (a fixable problem inside the hold window). This is the disposition
//                        brake working AS DESIGNED — rendered as the CORRECT posture (a POSITIVE emerald
//                        block), NEVER a yellow/red warning. Mirrors sizing's hold_in_savings exactly.
//   - `escalate_review`→ the unresolved / incoherent path — a distinct "needs your judgment" state
//                        (neutral / attention, not an error).
//   - `sell_review`    → surfaces the reason_code, prominently flags requires_human_signoff, and states that
//                        the CLOSE is human-authored (there is NO auto-sell button anywhere here).
//   - `cannot_assess`  → fail-closed neutral message (mirrors sizing's cannot_size).
// The bias_caveats (disposition / anchoring) render as advisory notes. The close is ALWAYS human-authored.

const SELL_REASON_CODE_LABEL: Record<string, string> = {
  thesis_broken: 'thesis broke — the durable advantage or the bet no longer holds',
  permanent_impairment: 'permanent impairment — the loss is not recoverable inside the thesis',
  valuation_inverted: 'valuation inverted — price reached / exceeded the frozen intrinsic value',
  better_opportunity: 'better opportunity — a materially higher net OE yield clears the switching hurdle',
  original_mistake: 'original mistake — the underwriting was wrong from the start',
  minimum_hold_released: 'minimum-hold guard released the review',
  minimum_hold_active: 'minimum-hold guard is holding (fixable problem inside the window)',
  escalate_human_review: 'unresolved / incoherent — escalated for your judgment',
}

function createSellWorstCaseBlock(worst: ResearchCaseSellWorstCaseProjection | undefined) {
  const floorBasis = worst?.downside_floor_basis
  const basisLabel = floorBasis === undefined ? undefined : (SIZING_FLOOR_BASIS_LABEL[floorBasis] ?? floorBasis)
  const reliability = worst?.downside_floor_reliability
  return createElement(
    'div',
    {
      'data-testid': 'sell-worst-case',
      style: {
        background: 'rgba(239, 68, 68, 0.07)',
        border: '1px solid rgba(239, 68, 68, 0.28)',
        borderRadius: '0.85rem',
        display: 'grid',
        gap: '0.4rem',
        padding: '0.9rem 1rem',
      },
    },
    createElement('p', { style: { ...labelStyle, color: '#fca5a5', margin: 0 } }, 'Worst case first'),
    createElement(
      'p',
      { style: { color: '#f3d7d7', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } },
      worst?.downside_floor_per_share === undefined
        ? 'Downside floor not recorded.'
        : `Concrete downside floor $${worst.downside_floor_per_share.toFixed(2)}/share`,
      worst?.realistic_downside === undefined
        ? ''
        : ` · realistic downside $${worst.realistic_downside.toFixed(2)}/share from entry`,
      '.',
    ),
    basisLabel === undefined ? null : createElement(
      'p',
      { 'data-testid': 'sell-floor-basis', style: { color: '#f3d7d7', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
      createElement('strong', null, 'Floor basis: '),
      basisLabel,
      reliability === undefined ? null : ` (reliability: ${reliability})`,
    ),
  )
}

function createSellBiasCaveats(caveats: ResearchCaseSellBiasCaveatProjection[] | undefined) {
  if ((caveats ?? []).length === 0) return null
  return createElement(
    'div',
    {
      'data-testid': 'sell-bias-caveats',
      style: {
        background: 'var(--owl-color-panel-deep)',
        border: '1px solid rgba(148, 163, 184, 0.16)',
        borderRadius: '0.85rem',
        display: 'grid',
        gap: '0.35rem',
        padding: '0.8rem 1rem',
      },
    },
    createElement('p', { style: { ...labelStyle, margin: 0 } }, 'Bias guards (advisory)'),
    createElement(
      'ul',
      {
        style: {
          color: 'var(--owl-color-muted)', display: 'flex', flexDirection: 'column',
          fontSize: 'var(--owl-text-sm)', gap: '0.3rem', lineHeight: 1.45, margin: 0, paddingLeft: '1.1rem',
        },
      },
      ...(caveats ?? []).map((caveat, index) =>
        createElement(
          'li',
          { key: `sell-bias-${index}` },
          caveat.kind === undefined ? null : createElement('strong', { style: { color: 'var(--owl-color-sand)' } }, `${humanizeToken(caveat.kind)}: `),
          caveat.message ?? '',
        ),
      ),
    ),
  )
}

function createSellDecisionPanel(researchCase: AppResearchCase) {
  const rec = researchCase.sell_recommendation

  // No decision yet — show ONLY the on-demand request control (no fabricated verdict).
  if (rec === undefined) {
    return createElement(SellDecisionRequest, { researchCaseId: researchCase.research_case_id })
  }

  const worstCase = createSellWorstCaseBlock(rec.worst_case)
  const biasCaveats = createSellBiasCaveats(rec.bias_caveats)
  const triggerLabel = rec.trigger === undefined ? undefined : humanizeToken(rec.trigger)
  const impairmentLabel = rec.impairment_call === undefined ? undefined : humanizeToken(rec.impairment_call)
  const guardLabel = rec.minimum_hold_decision === undefined ? undefined : humanizeToken(rec.minimum_hold_decision)

  // Shared trigger / impairment / guard facts row (always shown alongside the decision).
  const factsRow = createElement(
    'div',
    { 'data-testid': 'sell-decision-facts', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem' } },
    createPlanMetric('Trigger', triggerLabel ?? '—'),
    createPlanMetric('Impairment call', impairmentLabel ?? '—'),
    createPlanMetric('Minimum-hold guard', guardLabel ?? '—'),
  )

  // hold — the guard HELD: a fixable problem inside the hold window. The CORRECT posture (NOT a warning).
  // Rendered as a POSITIVE emerald block, mirroring sizing's hold_in_savings exactly.
  if (rec.decision_status === 'hold') {
    return createElement(
      'section',
      {
        'data-testid': 'sell-decision',
        'data-sell-status': 'hold',
        'aria-label': 'Sell decision',
        style: {
          ...cardStyle,
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(52, 211, 153, 0.4)',
          borderLeft: '3px solid #34d399',
          display: 'grid',
          gap: '0.7rem',
        },
      },
      createElement('p', { style: { ...labelStyle, color: '#6ee7b7' } }, 'Sell decision · hold'),
      worstCase,
      createElement(
        'p',
        { 'data-testid': 'sell-hold-correct-posture', style: { color: '#bbf7d0', fontSize: 'var(--owl-text-md)', fontWeight: 800, lineHeight: 1.5, margin: 0 } },
        'Correct posture: hold — the problem is fixable inside the hold window.',
      ),
      createElement(
        'p',
        { style: { color: '#d1fae5', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } },
        'The minimum-hold guard held the sale: the fixable-vs-permanent judgment says this is a temporary, recoverable problem inside the minimum-hold window. This is the disposition brake working as designed — not a warning. Let the thesis play out.',
      ),
      factsRow,
      biasCaveats,
      createElement(SellDecisionRequest, { researchCaseId: researchCase.research_case_id, hasRecommendation: true }),
    )
  }

  // escalate_review — the unresolved / incoherent path. A distinct "needs your judgment" state
  // (neutral / attention, never an error).
  if (rec.decision_status === 'escalate_review') {
    return createElement(
      'section',
      {
        'data-testid': 'sell-decision',
        'data-sell-status': 'escalate_review',
        'aria-label': 'Sell decision',
        style: {
          ...cardStyle,
          background: 'rgba(234, 179, 8, 0.06)',
          border: '1px solid rgba(234, 179, 8, 0.32)',
          borderLeft: '3px solid var(--owl-color-gold)',
          display: 'grid',
          gap: '0.7rem',
        },
      },
      createElement('p', { style: { ...labelStyle, color: 'var(--owl-color-gold-bright)' } }, 'Sell decision · needs your judgment'),
      worstCase,
      createElement(
        'p',
        { 'data-testid': 'sell-escalate-message', style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-md)', fontWeight: 800, lineHeight: 1.5, margin: 0 } },
        'Escalated for your judgment — the signal is unresolved or incoherent.',
      ),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } },
        'The harness could not resolve this into a clean hold or sell-review (e.g. the impairment judgment is unresolved). It surfaces the conflict rather than defaulting either way — you decide. The close, if any, is human-authored.',
      ),
      factsRow,
      biasCaveats,
      createElement(SellDecisionRequest, { researchCaseId: researchCase.research_case_id, hasRecommendation: true }),
    )
  }

  // cannot_assess — fail-closed (missing inputs / no frozen IV / missing yields). Surfaced honestly.
  if (rec.decision_status === 'cannot_assess') {
    return createElement(
      'section',
      {
        'data-testid': 'sell-decision',
        'data-sell-status': 'cannot_assess',
        'aria-label': 'Sell decision',
        style: { ...cardStyle, borderLeft: '3px solid var(--owl-color-border)', display: 'grid', gap: '0.6rem' },
      },
      createElement('p', { style: labelStyle }, 'Sell decision · cannot assess'),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } },
        'Cannot assess the sell trigger — fail-closed, never a fabricated verdict. The close stays human-authored.',
      ),
      factsRow,
      createElement(SellDecisionRequest, { researchCaseId: researchCase.research_case_id, hasRecommendation: true }),
    )
  }

  // sell_review — the guard released a review. Surface the reason_code + the human sign-off + the explicit
  // statement that the CLOSE is human-authored (there is NO auto-sell button).
  const reasonCode = rec.reason_code
  const reasonLabel = reasonCode === undefined ? undefined : (SELL_REASON_CODE_LABEL[reasonCode] ?? humanizeToken(reasonCode))
  return createElement(
    'section',
    {
      'data-testid': 'sell-decision',
      'data-sell-status': 'sell_review',
      'aria-label': 'Sell decision',
      style: { ...cardStyle, borderLeft: '3px solid #fca5a5', display: 'grid', gap: '0.85rem' },
    },
    createElement('p', { style: { ...labelStyle, color: '#fca5a5' } }, 'Sell decision · sell review'),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
      'Advisory — recomputed on-demand and recorded as an observation, NOT a sale. The worst case comes first; the human still authors and signs the close below.',
    ),
    worstCase,
    reasonLabel === undefined ? null : createElement(
      'p',
      { 'data-testid': 'sell-reason-code', style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } },
      createElement('strong', { style: { color: '#fca5a5' } }, 'Reason: '),
      reasonLabel,
    ),
    factsRow,
    // Prominent human sign-off + the explicit "close is human-authored, no auto-sell" statement.
    createElement(
      'div',
      {
        'data-testid': 'sell-human-signoff',
        style: {
          background: 'var(--owl-color-panel-deep)',
          border: '1px solid rgba(252, 165, 165, 0.35)',
          borderRadius: '0.85rem',
          display: 'grid',
          gap: '0.35rem',
          padding: '0.9rem 1rem',
        },
      },
      createElement(
        'p',
        { style: { color: '#fecaca', fontSize: 'var(--owl-text-md)', fontWeight: 800, lineHeight: 1.5, margin: 0 } },
        rec.requires_human_signoff === false
          ? 'You author the close.'
          : 'Requires your sign-off.',
      ),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } },
        'This is an advisory review, not an instruction to sell. The close is human-authored — you author and sign the exit yourself. There is no auto-sell; the harness never closes a holding.',
      ),
    ),
    biasCaveats,
    createElement(SellDecisionRequest, { researchCaseId: researchCase.research_case_id, hasRecommendation: true }),
  )
}

function createWatchlistPromotionAction(researchCase: AppResearchCase) {
  // Audit-and-decide admit control: the HARNESS marshals the analysis and the human AUDITS it. The
  // signed-thesis textarea is PRE-FILLED with the agent draft (affirm-or-amend), and the 11 business
  // findings render read-only — both are PURE reads of this case's persisted projection (no engine call).
  // The server re-derives the SAME draft + findings at sign-off, so the client can neither author a
  // finding nor spoof the draft.
  const thesisDraft = resolveAdmissionThesisDraft(researchCase)
  const businessFindings = resolveBusinessFindings(researchCase)
  return createElement(WatchlistPromotionForm, {
    researchCaseId: researchCase.research_case_id,
    thesisDraft,
    businessFindings,
  })
}

function createActionsRow() {
  return null
}

// ── Chip helpers ──────────────────────────────────────────────────────────────

type ChipColors = { bg: string; border: string; text: string }

function createPill(label: string, colors: ChipColors) {
  return createElement(
    'span',
    {
      style: {
        alignItems: 'center',
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: '999px',
        color: colors.text,
        display: 'inline-flex',
        fontSize: 'var(--owl-text-xs)',
        fontWeight: 700,
        gap: '0.4rem',
        padding: '0.28rem 0.7rem',
      },
    },
    label,
  )
}

function resolveShariahChipColor(status?: string): ChipColors {
  if (status === 'COMPLIANT') return { bg: 'rgba(34, 197, 94, 0.14)', border: 'rgba(134, 239, 172, 0.38)', text: '#bbf7d0' }
  if (status === 'CONDITIONAL') return { bg: 'rgba(20, 184, 166, 0.12)', border: 'rgba(94, 234, 212, 0.28)', text: '#99f6e4' }
  if (status === 'NON_COMPLIANT') return { bg: 'rgba(239, 68, 68, 0.14)', border: 'rgba(252, 165, 165, 0.36)', text: '#fecaca' }
  return { bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.28)', text: 'var(--owl-color-muted)' }
}

function resolveComplianceChipColor(status?: string): ChipColors {
  if (status === 'COMPLIANT' || status === 'PASS') return { bg: 'rgba(34, 197, 94, 0.14)', border: 'rgba(134, 239, 172, 0.38)', text: '#bbf7d0' }
  if (status === 'CONDITIONAL') return { bg: 'rgba(214, 178, 94, 0.14)', border: 'rgba(243, 223, 177, 0.36)', text: '#f3dfb1' }
  if (status === 'FAIL') return { bg: 'rgba(239, 68, 68, 0.14)', border: 'rgba(252, 165, 165, 0.36)', text: '#fecaca' }
  return { bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.28)', text: 'var(--owl-color-muted)' }
}

function resolveValuationChipColor(status?: string): ChipColors {
  if (status === 'FAIR' || status === 'UNDERVALUED') return { bg: 'rgba(34, 197, 94, 0.14)', border: 'rgba(134, 239, 172, 0.38)', text: '#bbf7d0' }
  if (status === 'EXPENSIVE') return { bg: 'rgba(214, 178, 94, 0.14)', border: 'rgba(243, 223, 177, 0.36)', text: '#f0d999' }
  if (status === 'OVERVALUED') return { bg: 'rgba(239, 68, 68, 0.14)', border: 'rgba(252, 165, 165, 0.36)', text: '#fecaca' }
  return { bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.28)', text: 'var(--owl-color-muted)' }
}

function createStatusChip(label: string, value: string, colors: ChipColors) {
  return createElement(
    'span',
    {
      key: label,
      style: {
        alignItems: 'baseline',
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: '999px',
        color: colors.text,
        display: 'inline-flex',
        fontSize: 'var(--owl-text-sm)',
        fontWeight: 700,
        gap: '0.32rem',
        padding: '0.3rem 0.65rem',
      },
    },
    createElement('span', { style: { color: '#9aa4b7', fontWeight: 600 } }, `${label}:`),
    value,
  )
}

// ── Lane labels (full, with " lane" suffix, used in deep-dive section) ────────

function deepDiveLaneLabel(lane?: string): string {
  if (lane === 'business_quality') return 'Business quality lane'
  if (lane === 'moat') return 'Moat lane'
  if (lane === 'management') return 'Management lane'
  if (lane === 'financial_quality') return 'Financial quality lane'
  if (lane === 'shariah') return 'Shariah lane'
  if (lane === 'risks' || lane === 'risk') return 'Risk lane'
  if (lane === 'valuation') return 'Owner earnings buy-price lane'
  return `${humanizeToken(lane ?? 'unknown')} lane`
}

// Short labels for the visible specialist grid (no " lane" suffix)
function deepDiveLaneShortLabel(lane?: string): string {
  if (lane === 'business_quality') return 'Business quality'
  if (lane === 'moat') return 'Moat'
  if (lane === 'management') return 'Management'
  if (lane === 'financial_quality') return 'Financial quality'
  if (lane === 'shariah') return 'Shariah'
  if (lane === 'risks' || lane === 'risk') return 'Risks'
  if (lane === 'valuation') return 'Valuation'
  return humanizeToken(lane ?? 'unknown')
}

// ── Legacy dossier helpers ────────────────────────────────────────────────────

function isLegacyDecisionDossier(researchCase: AppResearchCase): boolean {
  const hasStandaloneResearchPipeline = researchCase.quick_screen_id !== undefined
    || researchCase.screening_result !== undefined
    || researchCase.deep_dive_id !== undefined
    || researchCase.specialist_findings !== undefined
    || researchCase.owner_earnings_valuation !== undefined

  return !hasStandaloneResearchPipeline
    && ['analysis_drafted', 'decision_pending', 'decision_drafted'].includes(researchCase.stage)
    && (researchCase.investment_verdict !== undefined || researchCase.decision !== undefined || researchCase.reason !== undefined)
}

function legacyBusinessQualityDigest(researchCase: AppResearchCase): string {
  const source = firstNonEmpty([researchCase.thesis_summary, researchCase.evidence_summary, researchCase.reason])
  return source === undefined
    ? 'No standalone business-quality lane was recorded; inspect source evidence before continuing.'
    : `Legacy digest from dossier thesis: ${createConciseDossierSummary(source, researchCase.ticker ?? researchCase.company_id)}`
}

function legacyMoatDigest(researchCase: AppResearchCase): string {
  return firstNonEmpty([researchCase.evidence_summary, researchCase.reason]) === undefined
    ? 'No standalone moat lane was recorded.'
    : 'Review the thesis and source evidence for durable moat signals; no standalone moat lane was recorded.'
}

function legacyManagementDigest(): string {
  return 'No standalone management/capital-allocation lane was recorded; require source-backed follow-up before action.'
}

function legacyFinancialQualityDigest(researchCase: AppResearchCase): string {
  return researchCase.evidence_summary?.trim().length
    ? researchCase.evidence_summary
    : 'No standalone financial-quality lane was recorded; require updated financial evidence before action.'
}

function legacyQuickScreenRedFlags(researchCase: AppResearchCase): string[] {
  return [
    ...(researchCase.risks ?? []),
    ...(researchCase.open_questions ?? []),
    researchCase.valuation_status === undefined
      ? 'Owner-earnings valuation is missing from this legacy dossier'
      : `Valuation status ${researchCase.valuation_status} must stay in deep dive, not Quick Screen`,
  ]
}

function createLegacyDeepDiveFindings(researchCase: AppResearchCase): ResearchFindingCard[] {
  const sourceIds = researchCase.source_ids
  return [
    {
      finding_id: `${researchCase.research_case_id}:legacy-business-quality`,
      specialist_lane: 'business_quality',
      finding_summary: legacyBusinessQualityDigest(researchCase),
      confidence: 'legacy fallback',
      caveats: ['No standalone swarm lane was recorded for this older dossier.'],
      source_ids: sourceIds,
    },
    {
      finding_id: `${researchCase.research_case_id}:legacy-moat`,
      specialist_lane: 'moat',
      finding_summary: legacyMoatDigest(researchCase),
      confidence: 'legacy fallback',
      caveats: ['Convert this to a source-backed specialist lane on rerun.'],
      source_ids: sourceIds,
    },
    {
      finding_id: `${researchCase.research_case_id}:legacy-management`,
      specialist_lane: 'management',
      finding_summary: legacyManagementDigest(),
      confidence: 'legacy fallback',
      caveats: ['No management/capital-allocation specialist output recorded.'],
      source_ids: sourceIds,
    },
    {
      finding_id: `${researchCase.research_case_id}:legacy-financial-quality`,
      specialist_lane: 'financial_quality',
      finding_summary: legacyFinancialQualityDigest(researchCase),
      confidence: 'legacy fallback',
      caveats: ['No normalized financial-quality specialist lane recorded.'],
      source_ids: sourceIds,
    },
    {
      finding_id: `${researchCase.research_case_id}:legacy-shariah`,
      specialist_lane: 'shariah',
      finding_summary: researchCase.shariah_rationale ?? `Shariah status: ${researchCase.shariah_status ?? 'Pending'}.`,
      confidence: 'legacy fallback',
      caveats: ['Needs source-backed Shariah ratio evidence if not already attached.'],
      source_ids: sourceIds,
    },
    {
      finding_id: `${researchCase.research_case_id}:legacy-risks`,
      specialist_lane: 'risks',
      finding_summary: (researchCase.risks ?? researchCase.open_questions ?? researchCase.caveats)?.join('; ')
        ?? 'No separately structured risks are recorded yet; review the thesis and source evidence before action.',
      confidence: 'legacy fallback',
      caveats: ['Legacy risk/open-question data may be incomplete.'],
      source_ids: sourceIds,
    },
    {
      finding_id: `${researchCase.research_case_id}:legacy-valuation`,
      specialist_lane: 'valuation',
      finding_summary: `Legacy dossier has valuation status ${researchCase.valuation_status ?? 'Pending'} but no owner-earnings buy-price range recorded.`,
      confidence: 'legacy fallback',
      caveats: ['Missing owner-earnings assumptions are a deep-dive gap, not a Quick Screen failure.'],
      source_ids: sourceIds,
    },
  ]
}

function createLegacyOwnerEarningsValuation(researchCase: AppResearchCase): NonNullable<AppResearchCase['owner_earnings_valuation']> {
  return {
    summary: `Legacy dossier has valuation status ${researchCase.valuation_status ?? 'Pending'} but no owner-earnings buy-price range recorded.`,
    assumptions: ['No owner-earnings assumptions were recorded for this legacy dossier.'],
    fair_value_range: 'Not recorded',
    buy_price_range: 'Not recorded',
    margin_of_safety: 'Not recorded',
    sources: researchCase.source_ids,
    confidence: 'legacy fallback',
    caveats: ['Missing owner-earnings assumptions are a deep-dive gap, not a Quick Screen failure.'],
  }
}

// ── Utility functions ─────────────────────────────────────────────────────────

function createConciseDossierSummary(thesis: string, subject?: string): string {
  const compact = thesis.trim().replace(/\s+/g, ' ')
  if (compact.length <= 110) return compact

  const withoutSubject = removeSubjectLeadIn(compact, subject)
  const firstContrast = withoutSubject.split(/,\s+but\s+/i)[0]?.trim()
  const firstSentence = withoutSubject.split(/\.\s+/)[0]?.trim()
  const summaryCandidate = firstContrast !== undefined && firstContrast.length >= 24
    ? firstContrast
    : firstSentence !== undefined && firstSentence.length >= 24
      ? firstSentence
      : withoutSubject

  if (summaryCandidate.length <= 110) return ensureTerminalPunctuation(capitalizeSentence(summaryCandidate))

  const clipped = summaryCandidate.slice(0, 105).replace(/\s+\S*$/, '').trim()
  return `${capitalizeSentence(clipped)}…`
}

function removeSubjectLeadIn(value: string, subject?: string): string {
  if (subject === undefined || subject.trim().length === 0) return value

  const pattern = new RegExp(`^${escapeRegExp(subject.trim())}\\s+(remains|is|appears|looks)\\s+(an?|the)?\\s*`, 'i')
  const withoutKnownSubject = value.replace(pattern, '')
  if (withoutKnownSubject !== value) return withoutKnownSubject

  return value.replace(/^[A-Z][\w.&-]*(?:\s+[A-Z][\w.&-]*){0,3}\s+(remains|is|appears|looks)\s+(an?|the)?\s*/i, '')
}

function capitalizeSentence(value: string): string {
  const trimmed = value.trim()
  return trimmed.length === 0 ? trimmed : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
}

function ensureTerminalPunctuation(value: string): string {
  return /[.!?…]$/.test(value) ? value : `${value}.`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function slugifyDossierLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0)
}

function humanizeToken(value: string): string {
  const words = value.split('_').filter((part) => part.length > 0).map((part) => part.toLowerCase())
  const firstWord = words.at(0)
  if (firstWord === undefined) return value
  return [`${firstWord.charAt(0).toUpperCase()}${firstWord.slice(1)}`, ...words.slice(1)].join(' ')
}

function humanizeAuditSourceId(sourceId: string): string {
  const tokens = sourceId
    .replace(/^src_/, '')
    .split(/[_\s-]+/)
    .filter((token) => token.length > 0)

  if (tokens.length === 0) return 'Audit source recorded'

  return tokens.map((token, index) => {
    if (/^(?:fy\d+|q\d+|\d+k|\d{4})$/i.test(token)) return token.toUpperCase()
    const nextToken = tokens[index + 1]
    const looksLikeTickerPrefix = index === 0 && /^(?:fy\d+|q\d+|\d+k|proxy|market)$/i.test(nextToken ?? '')
    if (looksLikeTickerPrefix) return token.toUpperCase()
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
  }).join(' ')
}

function describeGateEvidence(label: string, sourceIds: string[]) {
  if (sourceIds.length === 0) return `${label} is awaiting source-backed evidence.`
  return `${label} is tied to ${sourceIds.join(', ')}.`
}

function createDetail(label: string, value: string) {
  return createElement(
    'p',
    { style: { color: '#cbd5e1', margin: '0.55rem 0 0' } },
    createElement('strong', null, `${label}: `),
    value,
  )
}
