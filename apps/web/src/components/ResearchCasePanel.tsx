import { createElement } from 'react'

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
  fontSize: '0.72rem',
  fontWeight: 800,
  letterSpacing: '0.1em',
  margin: '0 0 0.5rem',
  textTransform: 'uppercase' as const,
}

const collapsibleSummaryStyle = {
  color: '#c7d2fe',
  cursor: 'pointer',
  fontSize: '0.95rem',
  fontWeight: 900,
  padding: '0.15rem 0',
  userSelect: 'none' as const,
}

const collapsibleDetailsStyle = {
  background: 'rgba(15, 23, 42, 0.24)',
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

export function ResearchCasePanel({ researchCase, mode = 'demo', marketQuote }: ResearchCasePanelProps) {
  const canPromoteToWatchlist = mode === 'personal-local'
    && researchCase.stage === 'decision_drafted'
    && researchCase.decision !== undefined
    && researchCase.decision_id !== undefined

  const gated = isGatedCase(researchCase)

  if (gated) {
    return createGatedDossier(researchCase)
  }

  return createElement(
    'section',
    { style: { display: 'grid', gap: '1rem' } },
    // ── 1. Verdict hero ─────────────────────────────────────────────────────
    createVerdictHero(researchCase),
    // ── 2. Valuation panel ──────────────────────────────────────────────────
    createValuationPanel(researchCase, marketQuote),
    // ── 3. Four summary cards (always visible) ───────────────────────────────
    createDecisionEvidence(researchCase),
    // ── 4. Visible specialist lanes ──────────────────────────────────────────
    createSpecialistLanesGrid(researchCase),
    // ── 5. Watchlist promotion (personal-local only) ─────────────────────────
    canPromoteToWatchlist ? createWatchlistPromotionAction(researchCase.research_case_id) : null,
    // ── 6. Actions row ──────────────────────────────────────────────────────
    createActionsRow(),
    // ── 7. Evidence and audit details (collapsed, e2e anchor) ────────────────
    createEvidenceAndAuditDetails(researchCase),
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
        { style: { fontSize: 'clamp(2rem, 5vw, 2.8rem)', letterSpacing: '-0.02em', lineHeight: 1, margin: '0.1rem 0 0.15rem' } },
        displayName,
      ),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-muted)', fontSize: '0.95rem', margin: '0 0 1rem' } },
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
              fontSize: '1rem',
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
              fontSize: '0.78rem',
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
              fontSize: '0.78rem',
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
        { style: { color: '#fecaca', fontSize: '1.15rem', margin: '0 0 0.4rem' } },
        title,
      ),
      createElement(
        'p',
        { style: { color: '#f3d7d7', fontSize: '0.95rem', lineHeight: 1.55, margin: '0 0 1rem' } },
        createElement('strong', null, 'Reason: '),
        reason,
      ),
      // Gate failure steps
      createElement(
        'div',
        { style: { display: 'grid', gap: '0.5rem', marginBottom: '0.75rem' } },
        createElement(
          'div',
          { style: { alignItems: 'center', display: 'flex', gap: '0.6rem', fontSize: '0.9rem', color: 'var(--owl-color-muted)' } },
          createElement('span', { style: { color: 'var(--owl-color-risk)', fontWeight: 800 } }, '✕'),
          createElement('strong', null, failingGate),
        ),
        createElement(
          'div',
          { style: { alignItems: 'center', display: 'flex', gap: '0.6rem', fontSize: '0.9rem', color: 'var(--owl-color-quiet)' } },
          createElement('span', null, '—'),
          createElement('span', { style: { color: 'var(--owl-color-quiet)' } }, 'Business-quality check — skipped (gated)'),
        ),
        createElement(
          'div',
          { style: { alignItems: 'center', display: 'flex', gap: '0.6rem', fontSize: '0.9rem', color: 'var(--owl-color-quiet)' } },
          createElement('span', null, '—'),
          createElement('span', { style: { color: 'var(--owl-color-quiet)' } }, 'Deep-dive swarm (7 lanes) — skipped'),
        ),
      ),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-quiet)', fontSize: '0.82rem', margin: '0 0 1rem' } },
        'Evidence and the quick-screen assessment are recorded in the audit trail.',
      ),
      // Re-run action
      createElement(
        'div',
        null,
        createElement(
          'button',
          {
            type: 'button',
            style: {
              background: 'transparent',
              border: '1px solid var(--owl-color-border)',
              borderRadius: '0.6rem',
              color: 'var(--owl-color-text)',
              cursor: 'pointer',
              font: 'inherit',
              fontSize: '0.9rem',
              fontWeight: 700,
              padding: '0.55rem 1rem',
            },
          },
          'Re-run research (new version)',
        ),
      ),
    ),
    // Still render evidence for audit trail visibility
    createEvidenceAndAuditDetails(researchCase),
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
      style: {
        ...cardStyle,
        display: 'grid',
        gap: '0.75rem',
      },
    },
    // kicker + version row
    createElement(
      'div',
      { style: { alignItems: 'baseline', display: 'flex', gap: '0.75rem', justifyContent: 'space-between', flexWrap: 'wrap' } },
      createElement('p', { style: labelStyle }, 'Research dossier'),
      versionBadge === null ? null : createElement(
        'span',
        {
          style: {
            color: 'var(--owl-color-quiet)',
            fontFamily: 'var(--owl-font-mono)',
            fontSize: '0.72rem',
          },
        },
        versionBadge,
      ),
    ),
    // Ticker
    createElement(
      'h1',
      { style: { fontSize: 'clamp(2rem, 5vw, 3.5rem)', letterSpacing: '-0.02em', lineHeight: 1, margin: 0 } },
      displayName,
    ),
    // Company
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: '0.95rem', margin: 0 } },
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
            fontSize: '1.05rem',
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
    createElement(
      'section',
      { style: { borderTop: '1px solid var(--owl-color-border)', display: 'grid', gap: '0.45rem', paddingTop: '0.7rem' } },
      createElement('p', { style: labelStyle }, 'Verdict summary'),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-text)', fontSize: '1rem', lineHeight: 1.55, margin: 0 } },
        createVerdictSummaryText(researchCase),
      ),
      // Next action
      createElement(
        'p',
        { style: { borderTop: '1px solid var(--owl-color-border)', color: '#d7e2d7', fontSize: '0.92rem', lineHeight: 1.5, margin: 0, paddingTop: '0.8rem' } },
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
  return { bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.28)', text: '#c7d2fe' }
}

function createVerdictSummaryText(researchCase: AppResearchCase): string {
  const verdict = researchCase.investment_verdict ?? researchCase.decision
  const valuation = researchCase.valuation_status
  const shariah = researchCase.shariah_status
  const strategy = researchCase.strategy_compliance

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
    return `Verdict is a drafted strategy decision: ${verdict}. ${qualitySentence} ${valuationSentence}`
  }

  return firstNonEmpty([
    researchCase.evidence_summary,
    researchCase.reason,
    researchCase.thesis_summary,
  ]) ?? 'This dossier is waiting for a source-backed investment reason.'
}

// ── Valuation panel ───────────────────────────────────────────────────────────

function createValuationPanel(researchCase: AppResearchCase, marketQuote?: MarketQuote) {
  const valuation = researchCase.valuation
  if (valuation === undefined) return null

  const buyPrice = valuation.buy_price_per_share
  const hurdleRate = valuation.hurdle_rate
  const moatClass = valuation.moat_class ?? 'unknown'
  const growthAssumptions = valuation.growth_assumptions
  const hurdleLabel = hurdleRate !== undefined ? `${Math.round(hurdleRate * 100)}%` : 'hurdle'
  const moatLabel = `${moatClass.toUpperCase()} MOAT · ${hurdleLabel} HURDLE`

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

  return createElement(
    'div',
    {
      style: {
        ...cardStyle,
        display: 'grid',
        gap: '0.5rem',
      },
    },
    // Header row
    createElement(
      'div',
      { style: { alignItems: 'baseline', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' } },
      createElement('p', { style: labelStyle }, 'Valuation'),
      createElement(
        'span',
        {
          style: {
            color: '#bbf7d0',
            fontFamily: 'var(--owl-font-mono)',
            fontSize: '0.76rem',
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
                fontSize: '0.7rem',
                left: '50%',
                position: 'absolute',
                top: '-26px',
                transform: 'translateX(-50%)',
                whiteSpace: 'nowrap',
              },
            },
            `Buy below (${hurdleLabel} hurdle)`,
          ),
          // value below
          createElement(
            'span',
            {
              style: {
                bottom: '-28px',
                color: 'var(--owl-color-accent-bright)',
                fontFamily: 'var(--owl-font-mono)',
                fontSize: '0.8rem',
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
                fontSize: '0.7rem',
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
                fontSize: '0.8rem',
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
              fontSize: '0.66rem',
              position: 'absolute',
              right: '0.6rem',
              top: '-22px',
            },
          },
          marketPriceNote,
        ),
      ),
    ),
    // Buy line summary
    buyPrice !== undefined ? createElement(
      'p',
      { style: { color: '#d7e2d7', fontSize: '0.92rem', lineHeight: 1.5, margin: 0 } },
      'Buy below ',
      createElement('strong', { style: { color: 'var(--owl-color-accent-bright)' } }, `$${buyPrice}`),
      ` · value at the ${hurdleLabel} ${moatClass.toLowerCase()}-moat hurdle (margin of safety embedded)`,
      growthAssumptions !== undefined ? ` · ${growthAssumptions}` : null,
    ) : createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: '0.9rem', lineHeight: 1.5, margin: 0 } },
      'Buy-price target not yet computed — run the valuation lane.',
    ),
    // Metrics row: buy-below, hurdle, growth est., and market/gap when available
    createElement(
      'div',
      {
        style: {
          display: 'grid',
          gap: '0.7rem',
          gridTemplateColumns: marketQuote !== undefined ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)',
          marginTop: '1rem',
        },
      },
      createMetricCell('Value @ hurdle', buyPrice !== undefined ? `$${buyPrice}` : 'Pending', true),
      createMetricCell('Hurdle', hurdleRate !== undefined ? `${Math.round(hurdleRate * 100)}%` : 'Pending', false),
      createMetricCell('Growth est.', valuation.growth_rate !== undefined ? `${Math.round(valuation.growth_rate * 100)}%` : 'Pending', false),
      ...(marketQuote !== undefined ? [
        createMetricCell(
          `Market (${marketQuote.currency})`,
          `$${marketQuote.price_per_share.toFixed(2)}`,
          false,
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
          fontSize: '0.82rem',
          margin: 0,
        },
      },
      gapIsGood ? `Market is ${gapLabel}` : `Market is +${gapLabel}`,
    ) : null,
  )
}

function createMetricCell(label: string, value: string, accent: boolean) {
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
          fontSize: '0.68rem',
          letterSpacing: '0.05em',
          textTransform: 'uppercase' as const,
        },
      },
      label,
    ),
    createElement(
      'div',
      {
        style: {
          color: accent ? 'var(--owl-color-accent-bright)' : 'var(--owl-color-text)',
          fontSize: '1.1rem',
          fontWeight: 800,
          marginTop: '0.15rem',
        },
      },
      value,
    ),
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
      className: 'owl-workflow-card',
      style: {
        ...cardStyle,
        display: 'grid',
        gap: '0.75rem',
      },
    },
    createElement('p', { style: labelStyle }, 'Decision evidence'),
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
      createDossierCard('Valuation', valuationText, researchCase.valuation_status),
      createDossierCard('Shariah / compliance', shariahText, researchCase.shariah_status),
      createDossierCard('Risks / open questions', [...risks, ...openQuestions]),
    ),
    createFullThesisDisclosure(fullThesis, thesis),
  )
}

function createFallbackValuationText(researchCase: AppResearchCase): string {
  const valuation = researchCase.valuation
  if (valuation?.buy_price_per_share !== undefined) {
    const hurdle = valuation.hurdle_rate !== undefined ? `${Math.round(valuation.hurdle_rate * 100)}%` : 'hurdle'
    return `Owner-earnings value at the ${hurdle} ${(valuation.moat_class ?? 'wide')}-moat hurdle ≈ $${valuation.buy_price_per_share}/sh. Quality is not in question; price is.`
  }
  if (researchCase.owner_earnings_valuation !== undefined) {
    return researchCase.owner_earnings_valuation.summary
      ?? 'Owner-earnings valuation details are available in the deep-dive valuation lane below.'
  }
  const valuationStatus = researchCase.valuation_status ?? 'Pending'
  return `Legacy dossier lacks structured owner-earnings assumptions; treat ${valuationStatus} as a deep-dive valuation status, not a Quick Screen gate.`
}

function createDossierCard(label: string, content: string | string[], status?: string, options?: { note?: string }) {
  const contentItems = Array.isArray(content) ? content : [content]

  return createElement(
    'article',
    {
      'data-testid': `research-dossier-card-${slugifyDossierLabel(label)}`,
      style: {
        background: 'rgba(15, 23, 42, 0.34)',
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
      createElement('h3', { style: { color: '#f7f8ff', fontSize: '0.95rem', margin: 0 } }, label),
      status === undefined ? null : createElement('span', { style: { color: '#c7d2fe', fontSize: '0.78rem', fontWeight: 900 } }, status),
    ),
    contentItems.length === 1
      ? createElement('p', { style: { color: '#dbe3ef', fontSize: '0.9rem', lineHeight: 1.5, margin: 0 } }, contentItems[0])
      : createElement(
        'ul',
        { style: { color: '#dbe3ef', display: 'grid', fontSize: '0.9rem', gap: '0.35rem', lineHeight: 1.4, margin: 0, paddingLeft: '1rem' } },
        ...contentItems.map((item) => createElement('li', { key: item }, item)),
      ),
    options?.note === undefined
      ? null
      : createElement('p', { style: { color: '#9aa4b7', fontSize: '0.82rem', fontWeight: 750, lineHeight: 1.4, margin: 0 } }, options.note),
  )
}

function createFullThesisDisclosure(fullThesis: string, conciseThesis: string) {
  if (fullThesis === conciseThesis) return null

  return createElement(
    'details',
    {
      style: {
        background: 'rgba(15, 23, 42, 0.24)',
        border: '1px solid rgba(148, 163, 184, 0.12)',
        borderRadius: '0.85rem',
        padding: '0.85rem',
      },
    },
    createElement(
      'summary',
      {
        style: {
          color: '#c7d2fe',
          cursor: 'pointer',
          fontSize: '0.92rem',
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
      style: {
        ...cardStyle,
        display: 'grid',
        gap: '0.7rem',
      },
    },
    createElement(
      'div',
      { style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'space-between' } },
      createElement('p', { style: labelStyle }, 'Deep-dive specialist lanes'),
      createElement(
        'span',
        { style: { color: 'var(--owl-color-muted)', fontSize: '0.78rem' } },
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
            fontSize: '0.72rem',
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
            fontSize: '0.64rem',
            padding: '0.12rem 0.45rem',
          },
        },
        finding.confidence,
      ),
    ),
    // Finding summary
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: '0.83rem', lineHeight: 1.45, margin: 0 } },
      finding.finding_summary ?? 'No lane summary recorded.',
    ),
    // Source count
    sourceIds.length > 0 ? createElement(
      'span',
      {
        style: {
          color: 'var(--owl-color-quiet)',
          fontFamily: 'var(--owl-font-mono)',
          fontSize: '0.66rem',
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
          fontSize: '1.05rem',
          fontWeight: 900,
        },
      },
      'Evidence and audit details',
    ),
    createElement(
      'div',
      { style: { display: 'grid', gap: '1rem', marginTop: '1rem' } },
      createCurrentWorkflowStatus(researchCase),
      createEvidenceAndSourcesPanel(researchCase),
      createGateChecklistPanel(researchCase),
      createResearchTransitionPanel(researchCase),
      createSourceIdsPanel(researchCase),
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
    createElement('h2', { style: { fontSize: '1.25rem', margin: '0 0 0.35rem' } }, 'Evidence and sources'),
    createElement(
      'p',
      { style: { color: '#9aa4b7', fontSize: '0.95rem', margin: '0 0 1rem' } },
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
    createElement('h2', { style: { fontSize: '1.25rem', margin: '0 0 1rem' } }, 'Gate checklist'),
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
            createElement('span', { style: { color: '#9aa4b7', fontSize: '0.86rem' } }, `Evidence source context: ${describeGateEvidence(gate.label, researchCase.source_ids)}`),
          ),
        ),
      ),
    ),
  )
}

function createSourceIdsPanel(researchCase: AppResearchCase) {
  return createElement(
    'section',
    { style: cardStyle },
    createElement('h2', { style: { fontSize: '1.25rem', margin: '0 0 0.75rem' } }, 'Source IDs'),
    createElement(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' } },
      ...researchCase.source_ids.map((sourceId) => createElement(SourceChip, { id: sourceId, key: sourceId, label: 'Audit source' })),
    ),
  )
}

function createLedgerTimelinePanel(researchCase: AppResearchCase) {
  return createElement(
    'section',
    { style: cardStyle },
    createElement('h2', { style: { fontSize: '1.25rem', margin: '0 0 0.35rem' } }, 'Ledger Timeline'),
    createElement(
      'p',
      { style: { color: '#9aa4b7', fontSize: '0.95rem', margin: '0 0 1rem' } },
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
            { style: { color: '#9aa4b7', fontSize: '0.85rem', margin: '0.2rem 0 0' } },
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
        background: 'rgba(15, 23, 42, 0.36)',
        border: '1px solid rgba(148, 163, 184, 0.14)',
        borderRadius: '0.9rem',
        display: 'grid',
        gap: '0.45rem',
        padding: '0.95rem',
      },
    },
    createElement('h3', { style: { color: '#f7f8ff', fontSize: '1rem', margin: 0 } }, source.title),
    createElement('p', { style: { color: '#cbd5e1', lineHeight: 1.55, margin: 0 } }, source.excerpt),
    source.url === undefined
      ? null
      : createElement('a', { href: source.url, rel: 'noreferrer', style: { color: '#c7d2fe', fontSize: '0.9rem', fontWeight: 800 } }, 'Open source URL'),
    source.citation_locator === undefined
      ? null
      : createElement('p', { style: { color: '#9aa4b7', fontSize: '0.86rem', margin: 0 } }, `Citation: ${source.citation_locator}`),
    createElement(SourceChip, { id: source.source_id, label: 'Audit source id' }),
  )
}

// ── Current workflow status ───────────────────────────────────────────────────

function createCurrentWorkflowStatus(researchCase: AppResearchCase) {
  const stageLabel = humanizeToken(researchCase.stage)
  const actionHint = researchCase.next_required_action === undefined
    ? 'Workflow review required'
    : 'User action required'
  const statusLabel = `${stageLabel} · ${actionHint}`

  return createElement(
    'section',
    { className: 'owl-workflow-card', style: cardStyle },
    createElement('p', { style: labelStyle }, 'Workflow audit status'),
    createElement('p', { style: { color: '#f7f8ff', fontSize: '1.25rem', fontWeight: 900, margin: '0.35rem 0 0' } }, statusLabel),
    createElement('p', { style: { color: '#9aa4b7', fontSize: '0.9rem', margin: '0.55rem 0 0' } }, `Audit stage: ${researchCase.stage}`),
  )
}

// ── Research transition map ───────────────────────────────────────────────────

function createResearchTransitionPanel(researchCase: AppResearchCase) {
  const latestProviderEntry = [...researchCase.ledger_timeline].reverse().find((entry) => entry.actor_label.startsWith('provider:'))
  const latestUserEntry = [...researchCase.ledger_timeline].reverse().find((entry) => entry.actor_label.startsWith('user:'))

  return createElement(
    'section',
    { className: 'owl-workflow-card', style: cardStyle },
    createElement('p', { style: labelStyle }, 'Research transition map'),
    createElement(
      'div',
      { className: 'owl-workflow-grid' },
      createElement(
        'section',
        { className: 'owl-workflow-panel owl-workflow-panel-draft' },
        createElement('h2', { style: { fontSize: '1.05rem', margin: 0 } }, 'Provider draft state'),
        createElement('p', { style: { color: '#9aa4b7', margin: '0.45rem 0 0' } }, latestProviderEntry?.summary ?? 'Provider draft has not been recorded yet.'),
        createDetail('Decision', researchCase.decision ?? researchCase.investment_verdict ?? 'Pending'),
        createDetail('Strategy gate', researchCase.strategy_compliance ?? 'Pending'),
      ),
      createElement(
        'section',
        { className: 'owl-workflow-panel owl-workflow-panel-gate' },
        createElement('h2', { style: { fontSize: '1.05rem', margin: 0 } }, 'Source-backed Shariah gate'),
        createElement('p', { style: { color: '#9aa4b7', margin: '0.45rem 0 0' } }, `Shariah status: ${researchCase.shariah_status ?? 'Pending'}`),
        createDetail('Source evidence', researchCase.source_ids.length === 0 ? 'No source IDs recorded' : researchCase.source_ids.join(', ')),
        createDetail('Valuation status', researchCase.valuation_status ?? 'Pending'),
      ),
      createElement(
        'section',
        { className: 'owl-workflow-panel owl-workflow-panel-user' },
        createElement('h2', { style: { fontSize: '1.05rem', margin: 0 } }, 'User transition checkpoint'),
        createElement('p', { style: { color: '#9aa4b7', margin: '0.45rem 0 0' } }, latestUserEntry?.summary ?? 'Awaiting user-authored transition.'),
        createDetail('Next action', researchCase.next_required_action ?? 'Continue the review workflow'),
      ),
    ),
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
      { style: { fontSize: '1.35rem', margin: '0.35rem 0 0.6rem' } },
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
      { style: { fontSize: '1.35rem', margin: 0 } },
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
        background: 'rgba(15, 23, 42, 0.34)',
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
      createElement('h3', { style: { color: '#f7f8ff', fontSize: '1rem', margin: 0 } }, laneLabel),
      finding.confidence === undefined ? null : createElement('span', { style: { color: '#c7d2fe', fontSize: '0.82rem', fontWeight: 900 } }, finding.confidence),
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
        background: 'rgba(124, 140, 255, 0.1)',
        border: '1px solid rgba(199, 210, 254, 0.22)',
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
        createElement('h3', { style: { color: '#f7f8ff', fontSize: '1rem', margin: 0 } }, 'Assumptions'),
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
        createElement('h3', { style: { color: '#f7f8ff', fontSize: '1rem', margin: 0 } }, 'Caveats'),
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
        border: '1px solid #c7d2fe',
        background: 'rgba(124, 140, 255, 0.12)',
      },
    },
    createElement('p', { style: labelStyle }, 'User confirmation'),
    createElement(
      'p',
      { style: { color: '#c7d2fe', fontSize: '1rem', fontWeight: 700, margin: '0.35rem 0 1rem' } },
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
            background: '#6366f1',
            border: 0,
            borderRadius: '999px',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: '0.95rem',
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
  return createElement(
    'div',
    { style: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap' } },
    createElement(
      'button',
      {
        type: 'button',
        style: {
          background: 'transparent',
          border: '1px solid var(--owl-color-border)',
          borderRadius: '0.6rem',
          color: 'var(--owl-color-text)',
          cursor: 'pointer',
          font: 'inherit',
          fontSize: '0.9rem',
          fontWeight: 700,
          padding: '0.55rem 1rem',
        },
      },
      'Re-run research (new version)',
    ),
  )
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
        fontSize: '0.74rem',
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
  return { bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.28)', text: '#c7d2fe' }
}

function resolveComplianceChipColor(status?: string): ChipColors {
  if (status === 'COMPLIANT' || status === 'PASS') return { bg: 'rgba(34, 197, 94, 0.14)', border: 'rgba(134, 239, 172, 0.38)', text: '#bbf7d0' }
  if (status === 'CONDITIONAL') return { bg: 'rgba(214, 178, 94, 0.14)', border: 'rgba(243, 223, 177, 0.36)', text: '#f3dfb1' }
  if (status === 'FAIL') return { bg: 'rgba(239, 68, 68, 0.14)', border: 'rgba(252, 165, 165, 0.36)', text: '#fecaca' }
  return { bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.28)', text: '#c7d2fe' }
}

function resolveValuationChipColor(status?: string): ChipColors {
  if (status === 'FAIR' || status === 'UNDERVALUED') return { bg: 'rgba(34, 197, 94, 0.14)', border: 'rgba(134, 239, 172, 0.38)', text: '#bbf7d0' }
  if (status === 'EXPENSIVE') return { bg: 'rgba(214, 178, 94, 0.14)', border: 'rgba(243, 223, 177, 0.36)', text: '#f0d999' }
  if (status === 'OVERVALUED') return { bg: 'rgba(239, 68, 68, 0.14)', border: 'rgba(252, 165, 165, 0.36)', text: '#fecaca' }
  return { bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.28)', text: '#c7d2fe' }
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
        fontSize: '0.78rem',
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
