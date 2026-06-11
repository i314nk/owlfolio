import { createElement, type ReactNode } from 'react'

import type { PositionPlan, PositionTranche } from '@owlfolio/strategies/positionSizing'

import { SourceChip } from './designSystem'
import { StatusBadge } from './StatusBadge'
import type { AppResearchCase, AppSourceEvidence, WorkflowMode } from '../lib/workflow'

export type MarketQuote = {
  price_per_share: number
  currency: string
  as_of: string
  source: string
}

export type ResearchCasePanelProps = {
  researchCase: AppResearchCase
  mode?: WorkflowMode
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

export function ResearchCasePanel({ researchCase, mode = 'demo', marketQuote, positionPlan, promptForCapital = false }: ResearchCasePanelProps) {
  const canPromoteToWatchlist = mode === 'personal-local'
    && researchCase.stage === 'decision_drafted'
    && researchCase.decision !== undefined
    && researchCase.decision_id !== undefined

  const gated = isGatedCase(researchCase)

  if (gated) {
    return createGatedDossier(researchCase)
  }

  if (researchCase.stage === 'awaiting_deep_dive_approval') {
    return createAwaitingDeepDiveDossier(researchCase)
  }

  return createElement(
    'section',
    { style: { display: 'grid', gap: '1rem' } },
    // ── 1. Verdict hero ─────────────────────────────────────────────────────
    createVerdictHero(researchCase),
    // ── 1a. The full verdict format (organizes the spec's verdict fields) ────
    createVerdictFormatBlock(researchCase),
    // ── 1b. What changed since last case (re-analysis diff) ──────────────────
    createReAnalysisDiffPanel(researchCase),
    // ── 1c. Exit post-mortem (predicted vs realized) ─────────────────────────
    createPostMortemPanel(researchCase),
    // ── 2. Valuation panel ──────────────────────────────────────────────────
    createValuationPanel(researchCase, marketQuote),
    // ── 2b. Position plan (advisory) ─────────────────────────────────────────
    createPositionPlanPanel(positionPlan, promptForCapital),
    // ── 3. Four summary cards (always visible) ───────────────────────────────
    createDecisionEvidence(researchCase),
    // ── 4. Visible specialist lanes ──────────────────────────────────────────
    createSpecialistLanesGrid(researchCase),
    // ── 4b. Falsifiable forecasts (calibration scaffold) ─────────────────────
    createForecastsPanel(researchCase),
    // ── 5. Watchlist promotion (personal-local only) ─────────────────────────
    canPromoteToWatchlist ? createWatchlistPromotionAction(researchCase.research_case_id) : null,
    // ── 6. Actions row ──────────────────────────────────────────────────────
    createActionsRow(),
    // ── 7. Evidence and audit details (collapsed, e2e anchor) ────────────────
    createEvidenceAndAuditDetails(researchCase),
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
      row('Credited-g vs actual', gText),
      row('Which lane was most wrong', laneText),
      pm.holding_period_days === undefined ? null : row('Holding period', `${pm.holding_period_days} days`),
      pm.total_realized_pl === undefined ? null : row('Total realized P&L', `$${pm.total_realized_pl.toLocaleString('en-US')}`),
    ),
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

// ── The full verdict format (UI-continuity-spec Rule 2: Case/verdict view) ────
//
// Organizes the spec's verdict format into one coherent block: tier + runway, OE + method, credited g →
// terminal, implied multiple + market-implied g, buy price + buy_price_version, Shariah status +
// purification %, the rubric scores + anchor-vs-proposed tier, key-wrong-assumption, thesis-break triggers,
// and the red-team objection + response. The underlying detail still renders in the valuation / lanes
// panels below; this block is the spec's organized verdict header. Absent fields render "Not yet
// available" honestly (e.g. market-implied g if not computed, or a key-wrong-assumption not recorded).

function verdictFormatLine(label: string, value: ReactNode) {
  return createElement(
    'div',
    { key: label, style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', justifyContent: 'space-between', borderBottom: '1px solid rgba(148,163,184,0.1)', padding: '0.4rem 0' } },
    createElement('span', { style: { color: 'var(--owl-color-muted)', fontWeight: 700, minWidth: '14rem' } }, label),
    createElement('span', { style: { color: 'var(--owl-color-text)', textAlign: 'right' } }, value),
  )
}

const NOT_YET = createElement('span', { style: { color: 'var(--owl-color-quiet)' } }, 'Not yet available')

function createVerdictFormatBlock(researchCase: AppResearchCase) {
  const valuation = researchCase.valuation
  // Only render the organized verdict format once a deep-dive valuation exists (gated/awaiting states
  // have their own dossiers handled above).
  if (valuation === undefined) {
    return null
  }

  const moatClass = valuation.moat_class
  const runway = valuation.runway
  const oe = valuation.normalized_owner_earnings_per_share
  const g = valuation.growth_rate
  const terminalG = valuation.terminal_growth_rate
  const impliedMultiple = valuation.implied_multiple ?? valuation.verdict_state?.implied_multiple
  const buyPrice = valuation.buy_price_per_share
  const buyPriceVersion = (valuation as { buy_price_version?: string }).buy_price_version
  const sf = researchCase.shariah_financial
  const purificationPct = sf?.purification_pct

  // Anchor-vs-proposed tier + rubric scores (judgment-objectivity layer).
  const moatJudgment = valuation.judgment?.moat
  const anchorVsProposed = moatJudgment === undefined
    ? NOT_YET
    : createElement('span', null, `${(moatJudgment.anchor_tier ?? '—').toUpperCase()} anchor → ${(moatJudgment.proposed_tier ?? '—').toUpperCase()} proposed → ${(moatJudgment.resolved_tier ?? '—').toUpperCase()} resolved`)
  const rubricScores = moatJudgment?.rubric_scores
  const rubricSummary = rubricScores === undefined || rubricScores.length === 0
    ? NOT_YET
    : createElement('span', null, rubricScores.map((s) => `${s.id} ${s.score}`).join(' · '))

  // Red-team objection + response.
  const redTeam = researchCase.red_team
  const redTeamLine = redTeam === undefined
    ? NOT_YET
    : redTeam.status === 'red_team_incomplete'
      ? createElement('span', { style: { color: '#fca5a5' } }, 'red_team_incomplete — case not adversarially tested')
      : createElement('span', null, redTeam.strongest_objection?.claim ?? 'Objection recorded')

  const lines: ReactNode[] = [
    verdictFormatLine('Tier + runway', moatClass === undefined ? NOT_YET : `${moatClass.toUpperCase()}${runway === undefined ? '' : ` · ${runway} runway`}`),
    verdictFormatLine('Owner earnings + method', oe === undefined ? NOT_YET : `$${oe.toFixed(2)}/sh · two-stage discounted owner earnings`),
    verdictFormatLine('Credited g → terminal', g === undefined ? NOT_YET : `${(g * 100).toFixed(1)}%${terminalG === undefined ? '' : ` → ${(terminalG * 100).toFixed(1)}% terminal`}`),
    verdictFormatLine('Implied multiple', impliedMultiple === undefined ? NOT_YET : `${impliedMultiple.toFixed(1)}× OE`),
    // Market-implied g is not computed by the harness yet → honest "not yet available".
    verdictFormatLine('Market-implied g', NOT_YET),
    verdictFormatLine('Buy price + version', buyPrice === undefined ? NOT_YET : `$${buyPrice}${buyPriceVersion === undefined ? ' (buy_price_version not recorded)' : ` (buy_price_version ${buyPriceVersion})`}`),
    verdictFormatLine('Shariah + purification', researchCase.shariah_status === undefined ? NOT_YET : `${researchCase.shariah_status}${purificationPct === undefined ? '' : ` · purification ${(purificationPct * 100).toFixed(1)}%`}`),
    verdictFormatLine('Anchor vs proposed tier', anchorVsProposed),
    verdictFormatLine('Rubric scores', rubricSummary),
    verdictFormatLine('Key-wrong assumption', NOT_YET),
    verdictFormatLine('Thesis-break triggers', NOT_YET),
    verdictFormatLine('Red-team objection', redTeamLine),
  ]

  return createElement(
    'section',
    { 'data-testid': 'verdict-format', className: 'owl-section-card', style: { gap: '0.3rem' } },
    createElement('p', { className: 'owl-section-accent' }, 'Verdict format'),
    createElement('p', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: '0 0 0.5rem' } }, 'The full verdict at a glance. Fields not yet computed are shown honestly as not-yet-available; the gate table, rubric detail, and red-team response render in full below.'),
    ...lines,
  )
}

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

// ── Valuation panel ───────────────────────────────────────────────────────────

function createValuationPanel(researchCase: AppResearchCase, marketQuote?: MarketQuote) {
  const valuation = researchCase.valuation
  if (valuation === undefined) return null

  const buyPrice = valuation.buy_price_per_share
  const fairValue = valuation.fair_value_per_share
  const discountRateVal = valuation.discount_rate
  const mosVal = valuation.margin_of_safety
  const moatClass = valuation.moat_class ?? 'unknown'
  const roic = valuation.roic
  const incrementalRoic = valuation.incremental_roic
  const growthRate = valuation.growth_rate
  const terminalGrowthRate = valuation.terminal_growth_rate
  const reinvestmentRate = valuation.reinvestment_rate
  const runway = valuation.runway
  const impliedMultiple = valuation.implied_multiple
  const verdictState = valuation.verdict_state
  // Judgment-objectivity layer (Mechanisms 1+2): mechanical anchor vs the lane's proposed tier vs the
  // harness-resolved tier. Surfaced so the dossier shows where judgment moved the tier (and by how much).
  const moatJudgment = valuation.judgment?.moat
  const moatAnchorLabel = moatJudgment !== undefined
    ? (moatJudgment.anchor_computable === false
        ? `${(moatJudgment.proposed_tier ?? '?').toUpperCase()} (anchor n/a → lane rubric)`
        : `${(moatJudgment.anchor_tier ?? '?').toUpperCase()} anchor → ${(moatJudgment.resolved_tier ?? '?').toUpperCase()}${moatJudgment.adjustment_applied ? ` (±1 from ${(moatJudgment.proposed_tier ?? '?').toUpperCase()})` : ''}`)
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

  // Mechanism 5 (Red-Team Pass): the adversarial pre-synthesis run + the synthesis obligation. We
  // surface the strongest objection + the synthesis response (answered-with-evidence vs accepted→
  // downgraded), and the deterministic flags: objection_unaddressed (synthesis was silent — never
  // dropped) and red_team_incomplete (the case was not adversarially tested).
  const redTeam = researchCase.red_team
  const redTeamIncomplete = redTeam?.status === 'red_team_incomplete'
  const redTeamObjection = redTeam?.strongest_objection
  const redTeamResponse = redTeam?.synthesis_response
  const redTeamUnaddressed = redTeam?.objection_unaddressed === true

  const discountLabel = discountRateVal !== undefined ? `${Math.round(discountRateVal * 100)}%` : '10%'
  const mosLabel = mosVal !== undefined ? `${Math.round(mosVal * 100)}%` : undefined
  const moatLabel = mosLabel !== undefined
    ? `${moatClass.toUpperCase()} MOAT · ${discountLabel} DISCOUNT · ${mosLabel} MOS`
    : `${moatClass.toUpperCase()} MOAT · ${discountLabel} DISCOUNT`

  // Two-stage credited-growth label: g (10yr) fading to terminal g_t, gated by incremental ROIC.
  // Growth credit requires incremental ROIC > 10%; runway is the binding axis, moat tier the ceiling.
  const eligRoic = incrementalRoic ?? roic
  const fadeLabel = terminalGrowthRate !== undefined ? ` → terminal ${(terminalGrowthRate * 100).toFixed(0)}%` : ''
  const runwayLabel = runway !== undefined ? ` · ${runway} runway` : ''
  const roicGateLabel = growthRate !== undefined
    ? growthRate > 0
      ? `g=${(growthRate * 100).toFixed(0)}%${fadeLabel}${eligRoic !== undefined ? ` · incremental ROIC ${(eligRoic * 100).toFixed(0)}% > 10% credited` : ''}${runwayLabel}`
      : `g=0%${fadeLabel}${eligRoic !== undefined ? ` · incremental ROIC ${(eligRoic * 100).toFixed(0)}% ≤ 10% (no growth credit)` : ' (no growth credit)'}${runwayLabel}`
    : undefined

  // Bar layout:
  //   Buy-below tick is anchored at 46% of the bar width.
  //   Market tick is scaled relative to buy-below:
  //     - If market ≤ buy-below: tick is left of buy-below (green zone)
  //     - If market > buy-below: tick shifts proportionally right (red zone)
  //   We cap the market tick position between 2% and 96% so labels stay visible.
  const buyTickPercent = 46
  const marketTickPercent = (marketQuote !== undefined && buyPrice !== undefined && buyPrice > 0)
    ? Math.min(96, Math.max(2, buyTickPercent * (marketQuote.price_per_share / buyPrice)))
    : null

  // Gap computation: how far market is from buy-below, as a signed %
  const gapPercent = (marketQuote !== undefined && buyPrice !== undefined && buyPrice > 0)
    ? ((marketQuote.price_per_share - buyPrice) / buyPrice) * 100
    : null

  const gapLabel = gapPercent !== null
    ? gapPercent <= 0
      ? `${Math.abs(gapPercent).toFixed(1)}% below buy-below — in the buy zone`
      : `${gapPercent.toFixed(1)}% above buy-below`
    : null

  const gapIsGood = gapPercent !== null && gapPercent <= 0

  // Market price annotation for the bar
  const marketPriceNote = marketQuote !== undefined
    ? `Yahoo Finance · as of ${new Date(marketQuote.as_of).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : 'market price unavailable / manual'

  // Build fair value → buy price summary line
  const fairValueSummary = (fairValue !== undefined && buyPrice !== undefined && mosLabel !== undefined)
    ? `fair value $${fairValue.toFixed(2)} · less ${mosLabel} margin of safety (${moatClass.toLowerCase()}) · buy below $${buyPrice}`
    : fairValue !== undefined
      ? `fair value $${fairValue.toFixed(2)}`
      : undefined

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
    // Bar with generous vertical padding (breathing room as owner requested)
    createElement(
      'div',
      { style: { padding: '2.6rem 0 2.4rem', position: 'relative' } },
      createElement(
        'div',
        {
          style: {
            background: 'linear-gradient(90deg, rgba(34, 197, 94, 0.20), rgba(34, 197, 94, 0.05) 55%, rgba(239, 68, 68, 0.16))',
            border: '1px solid var(--owl-color-border)',
            borderRadius: '0.7rem',
            height: '48px',
            position: 'relative',
          },
        },
        // Buy-below tick
        buyPrice !== undefined ? createElement(
          'div',
          {
            style: {
              background: 'var(--owl-color-accent-bright)',
              bottom: '-8px',
              left: `${buyTickPercent}%`,
              position: 'absolute',
              top: '-8px',
              width: '2px',
            },
          },
          // label above
          createElement(
            'span',
            {
              style: {
                color: 'var(--owl-color-accent-bright)',
                fontFamily: 'var(--owl-font-mono)',
                fontSize: 'var(--owl-text-2xs)',
                left: '50%',
                position: 'absolute',
                top: '-26px',
                transform: 'translateX(-50%)',
                whiteSpace: 'nowrap',
              },
            },
            `Buy below (${discountLabel} discount)`,
          ),
          // value below
          createElement(
            'span',
            {
              style: {
                bottom: '-28px',
                color: 'var(--owl-color-accent-bright)',
                fontFamily: 'var(--owl-font-mono)',
                fontSize: 'var(--owl-text-sm)',
                fontWeight: 800,
                left: '50%',
                position: 'absolute',
                transform: 'translateX(-50%)',
                whiteSpace: 'nowrap',
              },
            },
            `$${buyPrice}`,
          ),
        ) : null,
        // Market tick (only when quote is available)
        marketTickPercent !== null && marketQuote !== undefined ? createElement(
          'div',
          {
            style: {
              background: gapIsGood ? '#34d399' : '#f87171',
              bottom: '-8px',
              left: `${marketTickPercent}%`,
              position: 'absolute',
              top: '-8px',
              width: '2px',
            },
          },
          // label above
          createElement(
            'span',
            {
              style: {
                color: gapIsGood ? '#34d399' : '#f87171',
                fontFamily: 'var(--owl-font-mono)',
                fontSize: 'var(--owl-text-2xs)',
                left: '50%',
                position: 'absolute',
                top: '-26px',
                transform: 'translateX(-50%)',
                whiteSpace: 'nowrap',
              },
            },
            'Market',
          ),
          // value below
          createElement(
            'span',
            {
              style: {
                bottom: '-28px',
                color: gapIsGood ? '#34d399' : '#f87171',
                fontFamily: 'var(--owl-font-mono)',
                fontSize: 'var(--owl-text-sm)',
                fontWeight: 800,
                left: '50%',
                position: 'absolute',
                transform: 'translateX(-50%)',
                whiteSpace: 'nowrap',
              },
            },
            `$${marketQuote.price_per_share.toFixed(2)}`,
          ),
        ) : null,
        // Market price source / unavailable note
        createElement(
          'span',
          {
            style: {
              color: 'var(--owl-color-quiet)',
              fontFamily: 'var(--owl-font-mono)',
              fontSize: 'var(--owl-text-2xs)',
              position: 'absolute',
              right: '0.6rem',
              top: '-22px',
            },
          },
          marketPriceNote,
        ),
      ),
    ),
    // Fair value → buy below summary line
    fairValueSummary !== undefined ? createElement(
      'p',
      { style: { color: '#d7e2d7', fontSize: 'var(--owl-text-base)', lineHeight: 1.5, margin: 0 } },
      createElement('strong', { style: { color: 'var(--owl-color-accent-bright)' } }, fairValueSummary),
    ) : buyPrice !== undefined ? createElement(
      'p',
      { style: { color: '#d7e2d7', fontSize: 'var(--owl-text-base)', lineHeight: 1.5, margin: 0 } },
      'Buy below ',
      createElement('strong', { style: { color: 'var(--owl-color-accent-bright)' } }, `$${buyPrice}`),
    ) : createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-base)', lineHeight: 1.5, margin: 0 } },
      'Buy-price target not yet computed — run the valuation lane.',
    ),
    // ROIC gate / growth note
    roicGateLabel !== undefined ? createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.4, margin: '0.2rem 0 0' } },
      roicGateLabel,
    ) : null,
    // WATCH-FAIR callout (valuation-recalibration-spec §2): quality at fair (not deep-discount) — the
    // human-discretion zone. Shows the discount-to-FV and the editorial line; never a harness buy signal.
    verdictState?.state === 'WATCH-FAIR' ? createElement(
      'div',
      {
        'data-testid': 'watch-fair-callout',
        style: {
          background: 'rgba(214, 178, 94, 0.08)',
          border: '1px solid rgba(214, 178, 94, 0.4)',
          borderRadius: '0.7rem',
          display: 'grid',
          gap: '0.3rem',
          margin: '0.6rem 0 0',
          padding: '0.7rem 0.85rem',
        },
      },
      createElement(
        'p',
        { style: { color: 'var(--owl-color-gold-bright)', fontSize: 'var(--owl-text-base)', fontWeight: 800, margin: 0 } },
        'WATCH-FAIR',
      ),
      createElement(
        'p',
        { style: { color: '#f0d999', fontSize: 'var(--owl-text-base)', lineHeight: 1.5, margin: 0 } },
        verdictState.note ?? 'Wonderful at fair — human-discretion zone. No harness buy signal.',
      ),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-muted)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-sm)', margin: 0 } },
        [
          verdictState.discount_to_fv_pct !== undefined ? `${verdictState.discount_to_fv_pct.toFixed(1)}% discount to fair value` : undefined,
          verdictState.implied_multiple !== undefined ? `implied ${verdictState.implied_multiple.toFixed(1)}× OE` : undefined,
        ].filter((s): s is string => s !== undefined).join(' · '),
      ),
    ) : null,
    // Key figures — the ledger-line of the valuation (fair value / buy below /
    // MoS / owner-earnings·sh / discount, plus market & its read when quoted).
    createElement(
      'div',
      { className: 'owl-ledger-line', style: { marginTop: '1rem' } },
      createValuationLedgerStat('Fair value', fairValue !== undefined ? `$${fairValue.toFixed(2)}` : 'Pending', 'owl-ledger-figure-money'),
      createValuationLedgerStat('Buy below', buyPrice !== undefined ? `$${buyPrice}` : 'Pending', 'owl-ledger-figure-money'),
      createValuationLedgerStat('Implied multiple', impliedMultiple !== undefined ? `${impliedMultiple.toFixed(1)}× OE` : 'Pending', ''),
      createValuationLedgerStat('Margin of safety', mosLabel ?? 'Pending', ''),
      createValuationLedgerStat('Owner earnings / sh', valuation.normalized_owner_earnings_per_share !== undefined ? `$${valuation.normalized_owner_earnings_per_share.toFixed(2)}` : 'Pending', 'owl-ledger-figure-money'),
      createValuationLedgerStat('Terminal g', terminalGrowthRate !== undefined ? `${(terminalGrowthRate * 100).toFixed(0)}%` : 'Pending', ''),
      createValuationLedgerStat('Runway', runway ?? 'Pending', ''),
      ...(moatAnchorLabel !== undefined ? [createValuationLedgerStat('Moat anchor', moatAnchorLabel, '')] : []),
      createValuationLedgerStat('Discount', discountLabel, ''),
      ...(marketQuote !== undefined ? [
        createValuationLedgerStat(
          `Market (${marketQuote.currency})`,
          `$${marketQuote.price_per_share.toFixed(2)}`,
          `owl-ledger-figure-money ${gapIsGood ? 'owl-ledger-figure-emerald' : 'owl-ledger-figure-risk'}`,
        ),
      ] : []),
    ),
    // Gap summary line (only when market quote is available)
    gapLabel !== null ? createElement(
      'p',
      {
        style: {
          color: gapIsGood ? '#34d399' : '#f87171',
          fontFamily: 'var(--owl-font-mono)',
          fontSize: 'var(--owl-text-sm)',
          margin: 0,
        },
      },
      gapIsGood ? `Market is ${gapLabel}` : `Market is +${gapLabel}`,
    ) : null,
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
      }, 'Red-team'),
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
    createElement(
      'div',
      {
        style: {
          alignItems: 'start',
          display: 'grid',
          gap: '0.9rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        },
      },
      createDossierCard('Thesis', thesis, undefined, { note: 'Full thesis available in the disclosure below.' }),
      createDossierCard('Valuation', valuationText, researchCase.valuation_status, { note: valuationProvenanceNote(researchCase) }),
      createDossierCard('Shariah / compliance', shariahText, researchCase.shariah_status, { extra: createShariahRatioLedger(researchCase) }),
      createDossierCard('Risks / open questions', [...risks, ...openQuestions]),
    ),
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
    const discount = valuation.discount_rate !== undefined ? `${Math.round(valuation.discount_rate * 100)}%` : '10%'
    const mos = valuation.margin_of_safety !== undefined ? ` · ${Math.round(valuation.margin_of_safety * 100)}% margin of safety (${(valuation.moat_class ?? 'wide').toLowerCase()})` : ''
    const fair = valuation.fair_value_per_share !== undefined ? `fair value $${valuation.fair_value_per_share.toFixed(2)} → ` : ''
    return `${fair}buy below $${valuation.buy_price_per_share}/sh · ${discount} flat discount${mos}. Quality is not in question; price is.`
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
        background: 'var(--owl-color-panel-deep)',
        border: '1px solid rgba(148, 163, 184, 0.14)',
        borderRadius: '0.85rem',
        display: 'grid',
        gap: '0.5rem',
        padding: '0.85rem',
      },
    },
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
    createElement(
      'div',
      {
        style: {
          display: 'grid',
          gap: '0.7rem',
          gridTemplateColumns: 'repeat(2, 1fr)',
        },
      },
      ...allFindings.map((finding) => createSpecialistLaneCard(finding)),
    ),
  )
}

type ResearchFindingCard = NonNullable<AppResearchCase['specialist_findings']>[number]

function createSpecialistLaneCard(finding: ResearchFindingCard) {
  const laneLabel = deepDiveLaneShortLabel(finding.specialist_lane)
  const sourceIds = finding.source_ids ?? []
  const isRiskyLane = finding.specialist_lane === 'risks' || finding.specialist_lane === 'risk'
  const confidenceClass = finding.confidence?.toLowerCase().includes('high') ? 'high' : 'normal'

  return createElement(
    'article',
    {
      key: finding.finding_id,
      style: {
        background: 'var(--owl-color-panel-elevated)',
        border: `1px solid ${isRiskyLane ? 'var(--owl-color-fiduciary)' : 'var(--owl-color-border)'}`,
        borderLeft: isRiskyLane ? '3px solid var(--owl-color-fiduciary)' : undefined,
        borderRadius: '0.7rem',
        display: 'grid',
        gap: '0.4rem',
        padding: '0.75rem 0.85rem',
      },
    },
    // Lane name + confidence
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
    // Finding summary
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.45, margin: 0 } },
      finding.finding_summary ?? 'No lane summary recorded.',
    ),
    // Source count
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

function createWatchlistPromotionAction(researchCaseId: string) {
  return createElement(
    'section',
    {
      style: {
        ...cardStyle,
        border: '1px solid var(--owl-color-gold)',
        background: 'rgba(214, 178, 94, 0.12)',
      },
    },
    createElement('p', { style: labelStyle }, 'User confirmation'),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-gold-bright)', fontSize: 'var(--owl-text-md)', fontWeight: 700, margin: '0.35rem 0 1rem' } },
      'Advance this drafted decision into durable personal-local watchlist state.',
    ),
    createElement(
      'form',
      { action: `/api/research/${researchCaseId}/watchlist`, method: 'post' },
      createElement(
        'button',
        {
          type: 'submit',
          style: {
            background: 'var(--owl-color-gold)',
            border: 0,
            borderRadius: '999px',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: 'var(--owl-text-base)',
            fontWeight: 900,
            padding: '0.75rem 1rem',
          },
        },
        'Promote to watchlist',
      ),
    ),
  )
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
