import { Children, createElement, isValidElement, type ReactNode } from 'react'
import { RunDeepDiveButton } from './RunDeepDiveButton'

import type {
  ResearchCaseSellBiasCaveatProjection,
  ResearchCaseSellWorstCaseProjection,
} from '@owlfolio/ledger/projections/researchCaseProjection'
import type { SavingsSleeveConfig } from '@owlfolio/shared'
import { buffettMungerStrategy, discountRate } from '@owlfolio/strategies/buffettMunger'
import { ENGINE_VERSION } from '@owlfolio/strategies/engineVersion'
import { isDeepDiveComplete } from '@owlfolio/workflow/admitAssessment'

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
// Rounding bug fix (owner find, 2026-07-11): Math.round(9.5)=10 rendered a 9.5% discount as "10%".
const pctLabel = (rate: number): string => `${(rate * 100).toFixed(1).replace(/\.0$/, '')}%`
const DEFAULT_DISCOUNT_LABEL = pctLabel(discountRate(buffettMungerStrategy))

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
  /**
   * The owner's compliant savings sleeve config (from app-config). Drives the discount-anchor VINTAGE line:
   * the savings rate is the discount's risk-free anchor, and `savings_rate_set_at` makes a stale/never-set
   * anchor visible. Absent → the dossier shows the frozen default and flags "not set".
   */
  savings?: SavingsSleeveConfig
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

// ── Collapsible section helper (Priority 1) ────────────────────────────────────
//
// The dossier reads as a single-column VERTICAL stack: the decision essentials stay open, and dense
// supporting sections collapse behind the file's existing <details>/<summary> idiom. Children stack
// FULL-WIDTH (one row each) so long-form prose is never crammed into narrow masonry columns — every
// finding and lane gets the full content width it needs.
function createCollapsibleSection(
  testId: string,
  summaryText: string,
  open: boolean,
  children: ReactNode[],
) {
  return createElement(
    'details',
    { 'data-testid': testId, className: 'owl-collapsible-card', ...(open ? { open: true } : {}) },
    createElement(
      'summary',
      { className: 'owl-collapsible-card-summary' },
      createElement('span', { className: 'owl-section-accent', style: { margin: 0 } }, summaryText),
    ),
    createElement('div', { style: { display: 'grid', gap: '0.7rem', marginTop: '0.35rem' } }, ...children),
  )
}

// ── Collapsible info-box wrapper ──────────────────────────────────────────────
//
// Turns an already-rendered section card into a collapsed drop-down WITHOUT rewriting the section's body:
// the card's FIRST child must be its `owl-section-accent` title — that title moves into a <summary> (plus an
// optional one-line "basic info" hint), and the remaining children become the expandable body. The card
// keeps its own testid / className / style (e.g. the MoS gold rail). `open` renders it expanded; the hero
// and the decision panel stay open, every other box collapses. Passes null/non-elements through untouched
// (sections that render nothing).
function makeCollapsible(section: ReactNode, open: boolean, hint?: ReactNode): ReactNode {
  if (!isValidElement(section)) return section
  const props = section.props as {
    children?: ReactNode
    className?: string
    style?: Record<string, string>
    'data-testid'?: string
  }
  const kids = Children.toArray(props.children)
  const [titleEl, ...rest] = kids
  const title = isValidElement(titleEl) ? (titleEl.props as { children?: ReactNode }).children : ''
  // Keep ONLY the accent left-rail from the section's own inline style (e.g. the MoS/circle/position-plan
  // gold/green rail); drop per-box background/padding/gap so the shared .owl-collapsible-card class drives a
  // uniform card look. This is what stops the boxes reading as patched-together panels of differing darkness.
  const accentRail = props.style?.borderLeft === undefined ? undefined : { borderLeft: props.style.borderLeft }
  return createElement(
    'details',
    {
      'data-testid': props['data-testid'],
      className: 'owl-collapsible-card',
      ...(open ? { open: true } : {}),
      ...(accentRail ? { style: accentRail } : {}),
    },
    createElement(
      'summary',
      { className: 'owl-collapsible-card-summary' },
      createElement('span', { className: 'owl-section-accent', style: { margin: 0 } }, title),
      hint === undefined || hint === null || hint === '' ? null : createElement('span', { className: 'owl-collapsible-card-hint' }, hint),
    ),
    ...rest,
  )
}

// ── Source anchor id sanitization ─────────────────────────────────────────────
//
// Citation strings and evidence source ids must produce the SAME url-safe fragment so a compact marker
// anchor (`#source-<id>`) lands on its matching evidence entry (`id="source-<id>"`). Strip everything
// outside [A-Za-z0-9_-] to a single hyphen so href and id agree byte-for-byte.
function sanitizeSourceAnchorId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]+/g, '-')
}

/** The DOM id / href fragment for an evidence source — shared by markers and evidence entries. */
function sourceAnchorId(raw: string): string {
  return `source-${sanitizeSourceAnchorId(raw)}`
}

// ── Compact citation marker (Priority 5 + accessibility) ───────────────────────
//
// The verbose inline `[cited: sec_edgar_10k_<id>]` after every claim clutters the reading line. It is a
// COMPACT superscript marker — but NOT hover-only: the marker is a real in-page anchor link to its source
// entry, keyboard-focusable (owl-focusable → visible focus ring) with an `aria-label` that NAMES the source,
// so keyboard + screen-reader users reach the evidence without a mouse hover. Full traceability is preserved:
// the complete id stays in the `title` hover, the accessible name, AND in the always-visible Sources section.
// A marker that did NOT verify is rendered in the risk tone, reads "✕", and its aria-label notes it "did not
// verify". Native owl-* tokens only.
function createCitationMarker(citation: string, grounded: boolean | undefined, index: number) {
  const verified = grounded !== false
  const anchor = `#${sourceAnchorId(citation)}`
  return createElement(
    'sup',
    {
      key: `cite-${index}-${citation}`,
      style: { marginLeft: '0.2rem', whiteSpace: 'nowrap' as const },
    },
    createElement(
      'a',
      {
        'data-testid': 'citation-marker',
        className: 'owl-focusable',
        href: anchor,
        title: verified ? `Source: ${citation}` : `Citation did not verify: ${citation}`,
        'aria-label': verified
          ? `Source: ${citation} — jump to evidence`
          : `Source: ${citation} — did not verify; jump to evidence`,
        style: {
          color: verified ? 'var(--owl-color-gold)' : 'var(--owl-color-risk-bright)',
          fontFamily: 'var(--owl-font-mono)',
          fontSize: 'var(--owl-text-2xs)',
          fontWeight: 800,
          textDecoration: 'none',
        },
      },
      verified ? `[${index}]` : `[${index}✕]`,
    ),
  )
}

// ── Gated-state detection ─────────────────────────────────────────────────────

/**
 * A case is "gated" (rejected at quick screen) when:
 * - stage is 'rejected' (screening_result === 'reject') — Shariah/hard fail
 * - stage is 'pass' with moat_passes_gate === false — below wide-moat gate
 */
function isGatedCase(researchCase: AppResearchCase): boolean {
  // A CLOSED front Shariah gate is a gated set-aside regardless of the final projected stage — the
  // set-aside's analysis/decision events advance the stage past 'rejected' (dogfood find: JPM rendered
  // the generic decision dossier with no gate rationale).
  if (researchCase.shariah_gate?.allowed === false) return true
  if (researchCase.stage === 'rejected') return true
  if (researchCase.stage === 'pass' && researchCase.valuation?.moat_passes_gate === false) return true
  return false
}

function gatedReason(researchCase: AppResearchCase): { title: string; reason: string; failingGate: string } {
  const frontGate = researchCase.shariah_gate
  if (frontGate !== undefined && frontGate.allowed === false) {
    const incomeNote = typeof frontGate.impermissible_income === 'number'
      ? ` · impermissible income $${frontGate.impermissible_income.toLocaleString('en-US')}M per the cited filing`
      : ''
    return {
      title: 'Set aside at the Shariah gate · deep dive skipped',
      reason: frontGate.sector_reasoning
        ?? frontGate.reason
        ?? 'The grounded sector judgment found the core business non-compliant. The gate stops here by design: no deep-dive swarm was run, so no provider cost was spent.',
      failingGate: frontGate.ratio_verdict === 'FAIL'
        ? `Shariah gate — AAOIFI financial ratios FAIL${incomeNote}`
        : `Shariah gate — sector ${frontGate.sector_status ?? 'non_compliant'}${incomeNote}`,
    }
  }
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

// ── Set-aside (early-exit) detection ──────────────────────────────────────────

/**
 * A case is "set aside" when the circle-of-competence gate failed AND the expensive 5-lane deep dive did
 * NOT run. Such a run carries verdict PASS + valuation_status INSUFFICIENT_DATA, the circle judgment, and
 * the `outside_circle`/`circle_competence_unmet` mirror flags — but no specialist findings, no valuation.
 * Rendering the full deep-dive scaffold for it is incoherent (empty "Pending" key figures, a "Not yet
 * available" MoS, empty lanes). This detector routes it to a coherent early-exit dossier instead.
 *
 * Conservative by design:
 * - a full run that PASSED the circle gate (`in_competence === true`) is never set aside;
 * - a run that produced specialist findings (the deep dive ran) is never set aside;
 * - legacy runs with no circle data (both signals absent) render normally.
 * Quick-screen rejects (stage 'rejected') are handled earlier by `isGatedCase` → `createGatedDossier`.
 */
function isSetAsideCase(researchCase: AppResearchCase): boolean {
  const circle = researchCase.circle_competence
  // A full run that PASSED the circle gate is never an early exit.
  if (circle?.in_competence === true) return false
  // The deep dive ran (it populated specialist findings) → not an early exit.
  if ((researchCase.specialist_findings?.length ?? 0) > 0) return false
  // The circle gate set it aside — the valuation mirror flag OR the circle outcome. Legacy runs with
  // neither signal present fall through to false (render normally).
  return researchCase.valuation?.outside_circle === true || circle?.in_competence === false
}

// ── Main component ────────────────────────────────────────────────────────────

export function ResearchCasePanel({ researchCase, mode = 'personal-local', configuredProviderId, marketQuote, positionPlan, promptForCapital = false, savings }: ResearchCasePanelProps) {
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

  if (isSetAsideCase(researchCase)) {
    return createElement(
      'section',
      { style: { display: 'grid', gap: '1rem' } },
      mockWarningBanner,
      createSetAsideDossier(researchCase),
    )
  }

  // Headline summaries shown on each collapsed info-box, so its key result is visible WITHOUT expanding
  // (the drop-down holds the "why"). The hero and circle box carry their own headline as the first line;
  // these hints enrich the generic-titled boxes.
  const hintValuation = researchCase.valuation
  const hintVerdict = researchCase.investment_verdict ?? researchCase.decision
  const hintBuyBelow = hintValuation?.proposed_buy_below ?? hintValuation?.buy_price_per_share
  const hintInBuyZone = hintValuation?.in_buy_zone
    ?? (marketQuote?.price_per_share !== undefined && hintBuyBelow !== undefined
      ? marketQuote.price_per_share <= hintBuyBelow
      : undefined)
  const decisionHint = [
    hintVerdict,
    hintBuyBelow === undefined ? undefined : `buy-below $${hintBuyBelow.toFixed(2)}`,
    hintInBuyZone === undefined ? undefined : (hintInBuyZone ? 'in buy zone' : 'not in buy zone'),
  ].filter((part): part is string => part !== undefined).join(' · ') || undefined
  // Phase 2 V2: the T0-computed grade is primary; the legacy model-graded adequacy is the fallback.
  const mosAdequacy = researchCase.valuation?.margin_of_safety_grade?.grade ?? researchCase.margin_of_safety_judgment?.adequacy
  const mosHint = mosAdequacy === undefined ? undefined : `margin ${mosAdequacy}`
  // Valuation headline: the moat tier + discount rate on the right of the card header (mirrors the in-card
  // moat label). Reuses the same DEFAULT_DISCOUNT_LABEL fallback as the valuation panel.
  const valDiscountRate = researchCase.valuation?.discount_rate
  const valDiscountLabel = valDiscountRate !== undefined ? pctLabel(valDiscountRate) : DEFAULT_DISCOUNT_LABEL
  const valuationHint = researchCase.valuation === undefined
    ? undefined
    : `${(researchCase.valuation.moat_class ?? 'unknown').toUpperCase()} MOAT · ${valDiscountLabel} DISCOUNT`
  // Position-plan headline (right side of its collapsed header): moat tier + entry-cap tag.
  const positionPlanHint = positionPlan?.investable ? `${positionPlan.moat_class.toUpperCase()} MOAT · ENTRY CAP` : undefined

  // ── S8 (Phase 3): the PILLAR frame — the dossier reads as Buffett's checklist applied in order.
  // Front gate (Shariah) → P1 Understand → P2 Moat → P3 Management → P4 Value → Synthesis & decision.
  // pillarStatus makes the gated-dossier invariant structural: a moat-gate death renders P3/P4
  // "not evaluated — failed at the moat filter"; an outside-circle set-aside marks P2–P4 likewise.
  const gateShortCircuited = researchCase.moat_gate_short_circuited === true
  const outsideCircle = researchCase.circle_competence?.in_competence === false
  const notEvaluatedReason = outsideCircle
    ? 'not evaluated — outside the circle of competence'
    : gateShortCircuited
      ? 'not evaluated — failed at the moat filter'
      : undefined
  const p2Status = outsideCircle ? notEvaluatedReason : undefined
  const p3p4Status = notEvaluatedReason

  return createElement(
    'section',
    { style: { display: 'grid', gap: '1rem' } },
    // ── 0. Mock-provider honesty banner (personal-local, mock-authored, real provider configured) ──
    mockWarningBanner,
    // ── Verdict hero (the always-visible top-level headline: ticker, verdict badges, engine/model) ──
    createVerdictHero(researchCase),
    // ── S6 gate banners: a short-circuited case says WHY pillars 3–4 have no data (and what re-arms
    //    them); an overridden run is PERMANENTLY labeled as user-authorized spend. ──
    researchCase.moat_gate_short_circuited === true
      ? createElement('p', {
          'data-testid': 'moat-gate-short-circuit-banner',
          style: { background: 'var(--owl-color-panel)', border: '1px solid var(--owl-color-border)', borderRadius: '0.6rem', color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: 0, padding: '0.6rem 0.8rem' },
        }, 'Failed at the moat filter (Pillar 2). Management, valuation, red team, and synthesis were NOT evaluated — no provider spend past the gate, so no numbers exist for those pillars. "Run remaining pillars anyway" starts a labeled override run.')
      : null,
    researchCase.moat_gate_overridden === true
      ? createElement('p', {
          'data-testid': 'moat-gate-overridden-marker',
          style: { color: 'var(--owl-color-gold-bright)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', fontWeight: 800, letterSpacing: '0.07em', margin: 0, textTransform: 'uppercase' as const },
        }, 'Moat gate overridden by user — this analysis ran past a failed moat gate; the verdict remains gated.')
      : null,
    // ── Exit post-mortem (predicted vs realized) ─────────────────────────────
    createPostMortemPanel(researchCase),
    // ── FRONT GATE — Shariah (precedes Buffett's four filters; sector judgment + AAOIFI ratios) ──
    createPillarHeader('front-gate', 'Front gate — Shariah', undefined),
    makeCollapsible(createComplianceRatioBlock(researchCase), false, researchCase.shariah_status),
    // ── PILLAR 1 — Understand the business (the circle-of-competence judgment + the one-pager) ──
    createPillarHeader('pillar-1', 'Pillar 1 — Understand the business', undefined),
    makeCollapsible(createCircleCompetencePanel(researchCase), false),
    createOnePagerCard(researchCase),
    // ── PILLAR 2 — Moat: FIRST which moats were identified (taxonomy, drivers, direction, peers),
    //    THEN whether the numbers back them (the three named tests). ──
    createPillarHeader('pillar-2', 'Pillar 2 — Moat', p2Status),
    p2Status === undefined ? createMoatsIdentifiedCard(researchCase) : null,
    p2Status === undefined ? createMoatTestsCard(researchCase) : null,
    // ── PILLAR 3 — Management (integrity & talent + the deterministic insider summary) ──
    createPillarHeader('pillar-3', 'Pillar 3 — Management', p3p4Status),
    p3p4Status === undefined ? createManagementPillarPanel(researchCase) : null,
    p3p4Status === undefined ? createInsiderActivityPanel(researchCase) : null,
    // ── PILLAR 4 — Value the business (price is the LAST filter; the decision moves to the END) ──
    createPillarHeader('pillar-4', 'Pillar 4 — Value the business', p3p4Status),
    makeCollapsible(createValuationPanel(researchCase, marketQuote, savings), true, valuationHint),
    // ── SYNTHESIS & DECISION — the reasoning (lattice, lanes, forecasts) leads; the DECISION lands at
    //    the end after all four pillars (D1, owner feedback), followed by the thesis-break audit and
    //    the actionable plans (admit / position plan / sizing / sell). ──
    createPillarHeader('synthesis', 'Synthesis & decision', undefined),
    createMungerLatticePanel(researchCase),
    createSpecialistLanesGrid(researchCase),
    createForecastsPanel(researchCase),
    makeCollapsible(createDecisionPanel(researchCase, marketQuote), true, decisionHint),
    makeCollapsible(createThesisBreakAuditCard(researchCase), false, mosHint),
    showAdmitPanel ? createAdmitRecommendationPanel(researchCase) : null,
    makeCollapsible(createPositionPlanPanel(positionPlan, promptForCapital), false, positionPlanHint),
    showSizingPanel ? createSizingRecommendationPanel(researchCase) : null,
    showSellPanel ? createSellDecisionPanel(researchCase) : null,
    canPromoteToWatchlist ? createWatchlistPromotionAction(researchCase) : null,
    createActionsRow(),
    createReAnalysisDiffPanel(researchCase),
    createReReviewPanel(researchCase),
    // ── Evidence & sources — collapsed; citation markers (#source-<id>) still resolve. ──
    createEvidenceAndAuditDetails(researchCase),
  )
}

// ── S8: pillar section header — the dossier reads as the four filters applied in order. A pillar
// that never ran says so in the header (the gated-dossier invariant, structurally). ──
function createPillarHeader(id: string, title: string, status: string | undefined) {
  return createElement(
    'div',
    {
      'data-testid': `pillar-header-${id}`,
      style: { alignItems: 'baseline', borderBottom: '1px solid var(--owl-color-border)', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.4rem', paddingBottom: '0.25rem' },
    },
    createElement('span', { style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-sm)', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' as const } }, title),
    status === undefined
      ? null
      : createElement('span', { 'data-testid': `pillar-status-${id}`, style: { color: 'var(--owl-color-gold-bright)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', letterSpacing: '0.05em' } }, status),
  )
}

// ── S8: the three named moat tests (T0) — capital efficiency / two-engine / standout, each rendered
// computable-or-honestly-deferred. The peer half of standout is the moat lane's labeled judgment
// (see the valuation panel's judgment provenance). ──
// ── D1 (owner feedback): the MOATS IDENTIFIED card — Pillar 2 opens with WHICH moats were found. ──
//
// The grounded taxonomy (which of the nine named moat types the cited drivers establish), the drivers
// themselves, the width provenance (proposed → resolved vs the quant anchor), the direction (grounded-or-
// labeled; narrowing carries the sell-signal principle), and the peer-standout judgment (per-peer
// cited / model-asserted stamps). All of this reads BEFORE the three named tests — first what the moat IS,
// then whether the numbers back it. Pre-pillar cases render an honest fallback (width only).
function createMoatsIdentifiedCard(researchCase: AppResearchCase) {
  const valuation = researchCase.valuation
  if (valuation === undefined) return null
  const moatJudgment = valuation.judgment?.moat

  const mono = { color: 'var(--owl-color-muted)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-xs)', lineHeight: 1.5, margin: 0 } as const

  // Width headline: the resolved class + the gate read (always available — legacy cases carry moat_class).
  const widthClass = (valuation.moat_class ?? 'unknown').toUpperCase()
  const gateLabel = valuation.moat_passes_gate === true
    ? 'passes the investability gate'
    : valuation.moat_passes_gate === false
      ? 'FAILS the investability gate'
      : 'gate not judged'

  // Width provenance (proposed → resolved · grounded drivers · quant corroboration) — moved from the
  // valuation panel (D1): the moat pillar owns its own provenance.
  const provenanceLabel = moatJudgment !== undefined
    ? `${(moatJudgment.proposed_tier ?? '?').toUpperCase()} proposed → ${(moatJudgment.resolved_tier ?? '?').toUpperCase()} resolved`
      + ` · ${moatJudgment.grounded_driver_count ?? 0} grounded driver(s)`
      + ` · quant ${moatJudgment.anchor_computable === false ? 'n/a' : (moatJudgment.anchor_tier ?? '?').toUpperCase()}`
    : undefined

  // Taxonomy chips: types come from GROUNDED drivers only.
  const moatTypes = moatJudgment?.resolved_moat_types
  const moatTypesLabel = moatTypes !== undefined && moatTypes.length > 0
    ? moatTypes.map((t) => t.replace(/_/g, ' ')).join(', ')
    : undefined

  // The drivers themselves — the cited advantages, each labeled with its taxonomy type + grounding.
  const drivers = moatJudgment?.moat_drivers ?? []

  // Direction: grounded-or-labeled; a narrowing moat is a sell signal no matter how wide it still looks.
  const moatDirection = moatJudgment?.moat_direction
  const moatDirectionLabel = moatDirection === undefined
    ? undefined
    : moatDirection === 'undetermined'
      ? (moatJudgment?.direction_ungrounded === true ? 'undetermined (claimed but ungrounded — carries no weight)' : 'undetermined')
      : `${moatDirection.toUpperCase()} (grounded)${moatDirection === 'narrowing' ? ' — a narrowing moat is a sell signal no matter how wide it still looks' : ''}`

  // Peer standout: the model judgment with per-peer cited / model-asserted stamps.
  const peerStandout = moatJudgment?.peer_standout
  const peerStandoutLabel = peerStandout?.judgment === undefined
    ? undefined
    : `${peerStandout.judgment.replace(/_/g, ' ')} — ${(peerStandout.peers ?? [])
        .map((peer) => `${peer.name} ${peer.gross_margin_note}${peer.model_asserted === true ? ' (model-asserted, not verified)' : ' (cited)'}`)
        .join('; ')}`

  return createElement(
    'div',
    { 'data-testid': 'moats-identified-card', className: 'owl-section-card', style: { gap: '0.45rem' } },
    createElement('p', { className: 'owl-section-accent' }, 'Moats identified'),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)', fontWeight: 700, margin: 0 } },
      `${widthClass} moat — ${gateLabel}`,
    ),
    provenanceLabel === undefined
      ? createElement('p', { style: mono }, 'Moat taxonomy not recorded — this case predates the moat-pillar judgment display.')
      : createElement('p', { style: mono }, `Moat: ${provenanceLabel}`),
    moatTypesLabel === undefined ? null : createElement(
      'p',
      { 'data-testid': 'moat-types', style: mono },
      `Moat types (grounded): ${moatTypesLabel}`,
    ),
    drivers.length === 0 ? null : createElement(
      'ul',
      { 'data-testid': 'moat-drivers-list', style: { color: 'var(--owl-color-muted)', display: 'grid', fontSize: 'var(--owl-text-sm)', gap: '0.25rem', margin: 0, paddingLeft: '1.1rem' } },
      ...drivers.map((driver, i) => createElement(
        'li',
        { key: `moat-driver-${i}`, style: { lineHeight: 1.5 } },
        `${driver.advantage}`
        + `${driver.moat_type !== undefined ? ` — ${driver.moat_type.replace(/_/g, ' ')}` : ''}`
        + `${driver.grounded ? ' (grounded)' : ' (uncited — carries no weight)'}`,
      )),
    ),
    moatDirectionLabel === undefined ? null : createElement(
      'p',
      { 'data-testid': 'moat-direction', style: { ...mono, color: moatDirection === 'narrowing' ? 'var(--owl-color-down, #b91c1c)' : mono.color } },
      `Moat direction: ${moatDirectionLabel}`,
    ),
    peerStandoutLabel === undefined ? null : createElement(
      'p',
      { 'data-testid': 'peer-standout', style: mono },
      `Standout vs peers (model judgment): ${peerStandoutLabel}`,
    ),
  )
}

function createMoatTestsCard(researchCase: AppResearchCase) {
  const tests = researchCase.moat_tests
  if (tests === undefined) return null
  const mono = { color: 'var(--owl-color-muted)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-xs)', lineHeight: 1.5, margin: 0 }
  const line = (testId: string, label: string, t?: { computable?: boolean; note?: string; reason?: string; passes?: boolean; band?: string }) =>
    t === undefined
      ? null
      : createElement('p', { key: testId, 'data-testid': `moat-test-${testId}`, style: mono },
          createElement('strong', { style: { color: 'var(--owl-color-text)' } }, `${label}: `),
          t.computable === true
            ? `${t.band !== undefined ? `${t.band.toUpperCase()} — ` : t.passes !== undefined ? `${t.passes ? 'PASSES' : 'FAILS'} — ` : ''}${t.note ?? ''}`
            : `not computable (${t.reason ?? 'insufficient data'})`)
  const children: ReactNode[] = [
    createElement('p', { key: 'intro', style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', margin: 0 } },
      'Harness-computed from the EDGAR annual series (T0). Capital efficiency + two-engine also form the mechanical moat anchor; standout is displayed, not scored — its peer half is the moat lane\u2019s labeled judgment.'),
    line('capital-efficiency', 'Capital efficiency (ROIC bands)', tests.capital_efficiency),
    line('two-engine', 'Two-engine (revenue + margins)', tests.two_engine),
    line('standout', 'Standout (gross margin vs peers)', tests.standout),
  ]
  return createCollapsibleSection('moat-tests-card', 'The three moat tests (T0)', false, children)
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
    { 'aria-label': 'What changed since last case', className: 'owl-collapsible-card' },
    createElement(
      'summary',
      { className: 'owl-collapsible-card-summary' },
      createElement('span', { className: 'owl-section-accent', style: { margin: 0 } }, 'What changed since last case'),
    ),
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

/**
 * "Thesis re-review — vs. new filings": the latest post-decision DIFF observation
 * (research_case_re_review_recorded). Never a verdict — INTACT | WEAKENED | BROKEN | UNVERIFIED, with
 * every recorded thesis-break trigger assessed against the filings that appeared since the decision.
 * BROKEN opens expanded and points at the existing re-run action; UNVERIFIED is flagged loudly.
 */
// ── Insider activity (Form 4, §3.3) ──────────────────────────────────────────
// Deterministic, harness-computed insider-transaction summary rendered independently of what the
// management lane said. Discretionary open-market (P/S) trades are the signal; mechanical RSU/option/tax
// disposals are shown SEPARATELY so they are never read as selling. Absent (null) when no summary.
function createInsiderActivityPanel(researchCase: AppResearchCase) {
  const s = researchCase.insider_summary
  if (s === undefined) return null
  const sh = (n?: number) => (n ?? 0).toLocaleString('en-US')
  const usd = (n?: number) => `$${Math.round(n ?? 0).toLocaleString('en-US')}`
  const rowStyle = { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)' }
  const rows: ReactNode[] = [
    createElement('li', { key: 'sell', style: { ...rowStyle, color: 'var(--owl-color-risk-bright)' } },
      `Discretionary sells: ${sh(s.discretionary_sell_shares)} shares (~${usd(s.discretionary_sell_value)}) by ${s.distinct_sellers ?? 0} insider(s)`
      + `${(s.officer_director_sell_shares ?? 0) > 0 ? ` — officers/directors ${sh(s.officer_director_sell_shares)} shares` : ''}`
      + `${(s.ten_percent_owner_sell_shares ?? 0) > 0 ? `, 10% owners ${sh(s.ten_percent_owner_sell_shares)} shares` : ''}`),
    createElement('li', { key: 'buy', style: rowStyle },
      `Discretionary buys: ${sh(s.discretionary_buy_shares)} shares (~${usd(s.discretionary_buy_value)}) by ${s.distinct_buyers ?? 0} insider(s)`),
    createElement('li', { key: 'mech', style: { ...rowStyle, color: 'var(--owl-color-muted)' } },
      `Mechanical (RSU vest / option exercise / tax withholding), NOT sales: ${sh(s.mechanical_disposed_shares)} shares disposed`),
  ]
  if (s.cluster !== undefined) {
    rows.push(createElement('li', { key: 'cluster', style: { ...rowStyle, color: 'var(--owl-color-gold-bright)', fontWeight: 700 } },
      `Cluster: ${s.cluster.discretionary_sell_count ?? 0} discretionary sale(s) by ${s.cluster.distinct_sellers ?? 0} insider(s) within ${s.cluster.window_days ?? 0} days (~${usd(s.cluster.net_sell_value)} net)`))
  }
  const children: ReactNode[] = [
    createElement('p', { key: 'meta', style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: '0 0 0.4rem' } },
      `SEC Form 4, trailing ${s.window_months ?? 12} months${s.as_of === undefined ? '' : ` as of ${s.as_of}`} — harness-computed observation. Discretionary open-market trades only; mechanical RSU/option/tax activity is shown separately, never as selling.`
      + `${s.window_truncated === true ? ' Filing window capped — counts are a recent-window floor.' : ''}`),
    createElement('ul', { key: 'rows', style: { display: 'grid', gap: '0.35rem', margin: 0, paddingLeft: '1.1rem' } }, ...rows),
  ]
  return createCollapsibleSection('insider-activity-card', 'Insider activity (Form 4)', false, children)
}

// B3 (Phase 4, book alignment): the ONE-PAGER — the understand lane's seven-item distillation of
// Pillar 1 ("the page you would hand someone who has never heard of the company"). Renders on gated
// dossiers too (Pillar 1 runs before the moat gate). Display verbatim; absent on legacy cases.
function createOnePagerCard(researchCase: AppResearchCase) {
  const op = researchCase.one_pager
  if (op === undefined) return null
  const listBlock = (label: string, items?: string[]) =>
    items === undefined || items.length === 0
      ? null
      : createElement(
          'div',
          { key: label, style: { display: 'grid', gap: '0.25rem' } },
          createElement('p', { style: { color: 'var(--owl-color-gold)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', fontWeight: 800, letterSpacing: '0.08em', margin: 0, textTransform: 'uppercase' as const } }, label),
          createElement('ul', { style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0, paddingLeft: '1.1rem' } },
            ...items.map((item, i) => createElement('li', { key: i }, item))),
        )
  const children: ReactNode[] = [
    op.plain_english === undefined
      ? null
      : createElement('p', { 'data-testid': 'one-pager-plain-english', style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)', fontWeight: 700, lineHeight: 1.5, margin: 0 } }, op.plain_english),
    listBlock('Core business segments', op.segments),
    listBlock('How it makes money', op.revenue_drivers),
    listBlock('Where the real profits come from', op.most_profitable_segments),
    listBlock('Key strengths / competitive advantages', op.strengths),
    listBlock('Key risks / weak spots', op.weak_spots),
    listBlock('Growth levers', op.growth_levers),
  ]
  return createCollapsibleSection('one-pager-card', 'The one-pager', false, children)
}

// S5 (Phase 3 pillars): the MANAGEMENT pillar — the two core traits (integrity + talent), the
// harness T0 observations (ROIC / payout / debt), and the retained-earnings test. Everything is
// grounded-or-labeled: unverified flags say so, not-computable T0 lines say why, and a fired veto
// renders loud. Opens automatically when the veto fired.
function createManagementPillarPanel(researchCase: AppResearchCase) {
  const mj = researchCase.management_judgment
  if (mj === undefined) return null
  const vetoTrait = researchCase.management_veto_applied
  const muted = { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: '0.35rem 0' }
  const mono = { color: 'var(--owl-color-muted)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-xs)', lineHeight: 1.5, margin: 0 }
  const tierTone = (tier?: string) => tier === 'red_flag' || tier === 'poor'
    ? 'var(--owl-color-risk-bright)'
    : tier === 'undetermined'
      ? 'var(--owl-color-gold-bright)'
      : 'var(--owl-color-text)'

  const children: ReactNode[] = []
  if (vetoTrait !== undefined) {
    children.push(createElement('p', {
      key: 'veto', 'data-testid': 'management-veto-badge',
      style: { color: 'var(--owl-color-risk-bright)', fontWeight: 800, fontSize: 'var(--owl-text-base)', margin: '0 0 0.5rem' },
    }, `MANAGEMENT VETO (${vetoTrait}): ${researchCase.management_veto_reason ?? 'BUY clamped to RESEARCH_MORE.'}`))
  }
  children.push(createElement('p', { key: 'tiers', style: { margin: '0 0 0.4rem', fontSize: 'var(--owl-text-base)' } },
    createElement('strong', { style: { color: tierTone(mj.resolved_integrity) } }, `Integrity: ${(mj.resolved_integrity ?? 'undetermined').replace(/_/g, ' ').toUpperCase()}`),
    ' · ',
    createElement('strong', { style: { color: tierTone(mj.resolved_talent) } }, `Talent: ${(mj.resolved_talent ?? 'undetermined').toUpperCase()}`),
    mj.judgment_degraded === true ? createElement('span', { style: { color: 'var(--owl-color-gold-bright)' } }, ' — the lane omitted its judgment blocks (resolved undetermined, never a silent clean)') : null,
    mj.t0_contradicts_talent === true ? createElement('span', { style: { color: 'var(--owl-color-gold-bright)' } }, ' — advisory: the grounded EXCELLENT sits on a weak T0 ROIC') : null,
  ))
  const comp = mj.integrity?.comp_structure
  if (comp?.summary !== undefined) {
    children.push(createElement('p', { key: 'comp', style: muted },
      `Pay structure (DEF 14A${mj.integrity?.comp_grounded === true ? ', cited' : ', citation UNVERIFIED'}): ${comp.summary}`
      + `${comp.alignment !== undefined ? ` — ${comp.alignment}` : ''}`
      + `${(comp.incentive_metrics ?? []).length > 0 ? ` [${(comp.incentive_metrics ?? []).join(', ')}]` : ''}`))
  }
  for (const [i, f] of (mj.integrity?.flags ?? []).entries()) {
    children.push(createElement('p', { key: `flag-${i}`, style: { ...muted, color: f.grounded === true ? 'var(--owl-color-risk-bright)' : 'var(--owl-color-gold-bright)' } },
      `Integrity flag (${f.severity ?? 'unrated'}${f.grounded === true ? ', cite-verified' : ', UNVERIFIED — carries no weight'}): ${f.claim}`))
  }
  for (const [i, o] of (mj.integrity?.communication_observations ?? []).entries()) {
    children.push(createElement('p', { key: `obs-${i}`, style: mono },
      `Communication: ${o.observation} ${o.grounded === true ? '(cited)' : '(uncited)'}`))
  }
  for (const [i, d] of (mj.talent?.talent_drivers ?? []).entries()) {
    children.push(createElement('p', { key: `drv-${i}`, style: mono },
      `Talent driver: ${d.evidence} ${d.grounded === true ? '(cited)' : '(uncited)'}`))
  }
  // The T0 strip + the retained-earnings test — self-describing computable unions, rendered honestly.
  const t0 = mj.talent_t0 as { roic?: Record<string, unknown>; payout?: Record<string, unknown>; debt?: Record<string, unknown> } | undefined
  const t0Line = (label: string, block?: Record<string, unknown>, fmt?: (b: Record<string, unknown>) => string) =>
    block === undefined
      ? null
      : createElement('p', { key: `t0-${label}`, style: mono },
          block['computable'] === true && fmt !== undefined
            ? `${label}: ${fmt(block)}`
            : `${label}: not computable (${String(block['reason'] ?? 'insufficient data')})`)
  children.push(
    createElement('p', { key: 't0-head', style: { ...muted, fontWeight: 800, marginTop: '0.6rem' } }, 'Harness T0 observations (the model reconciles; it never re-derives):'),
    t0Line('ROIC', t0?.roic, (b) => `median ${((b['median_roic'] as number) * 100).toFixed(1)}% — ${String(b['band'])}`),
    t0Line('Payout', t0?.payout, (b) => `dividends ${String(b['dividend_paying_years'])}/${String(b['years_used'])} yrs, buybacks ${String(b['buyback_years'])}/${String(b['years_used'])}${b['payout_ratio_latest'] !== undefined ? `, ratio ${((b['payout_ratio_latest'] as number) * 100).toFixed(0)}% of NI` : ''}${b['buybacks_below_sbc'] === true ? ' — buybacks below SBC (only mop up dilution)' : ''}`),
    t0Line('Debt', t0?.debt, (b) => `total $${Math.round(b['latest_total_debt_musd'] as number)}M`
      + `${b['debt_to_equity'] !== undefined ? `, D/E ${(b['debt_to_equity'] as number).toFixed(2)} (${(b['debt_to_equity'] as number) < 1 ? 'conservative' : (b['debt_to_equity'] as number) > 2 ? 'WARNING >2' : 'moderate'})` : ''}`
      + `${b['current_ratio'] !== undefined ? `, current ratio ${(b['current_ratio'] as number).toFixed(2)} (${(b['current_ratio'] as number) >= 2 ? 'healthy' : (b['current_ratio'] as number) >= 1 ? 'ok' : 'RED FLAG <1'})` : ''}`
      + `${b['interest_coverage'] !== undefined ? `, coverage ${(b['interest_coverage'] as number).toFixed(0)}×` : ''}`),
  )
  const retained = mj.retained_earnings
  if (retained !== undefined) {
    children.push(createElement('p', {
      key: 'retained', 'data-testid': 'retained-earnings-test',
      style: { ...mono, color: retained['computable'] === true ? (retained['passes'] === true ? '#4ade80' : 'var(--owl-color-risk-bright)') : 'var(--owl-color-gold-bright)' },
    }, retained['computable'] === true
      ? `Retained-earnings test (Buffett): ${retained['passes'] === true ? 'PASSES' : 'FAILS'} — ${String(retained['note'] ?? '')}`
      : `Retained-earnings test (Buffett): deferred on data (${String(retained['reason'] ?? 'not computable')})`))
  }
  return createCollapsibleSection('management-pillar-card', 'Management pillar — integrity & talent', vetoTrait !== undefined, children)
}

// S7 (Phase 3 pillars): the Munger mental-model lattice — deterministic harness assembly. An entry
// is APPLIED only when its artifact exists and survived its cite-check; unavailable entries say why.
// The "thesis IS the consensus" social-proof caution opens the panel and renders loud.
function createMungerLatticePanel(researchCase: AppResearchCase) {
  const lattice = researchCase.munger_lattice
  if (lattice?.entries === undefined || lattice.entries.length === 0) return null
  const consensusCaution = lattice.entries.some((e) => e.model === 'social_proof' && e.status === 'applied' && /thesis IS the consensus/i.test(e.summary))
  const labelFor = (model: string) => model === 'inversion'
    ? 'Inversion'
    : model === 'base_rates'
      ? 'Base rates'
      : model === 'incentive_analysis'
        ? 'Incentive analysis'
        : model === 'social_proof'
          ? 'Social proof / consensus'
          : model.replace(/_/g, ' ')
  const children: ReactNode[] = [
    createElement('p', { key: 'note', style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', lineHeight: 1.5, margin: 0 } },
      lattice.note ?? 'Deterministic harness assembly — applied entries derive from cite-checked artifacts.'),
    ...lattice.entries.map((entry, i) => createElement(
      'p',
      {
        key: `lattice-${i}`,
        'data-testid': `munger-lattice-${entry.model}`,
        style: {
          color: entry.status === 'unavailable'
            ? 'var(--owl-color-gold-bright)'
            : /thesis IS the consensus/i.test(entry.summary)
              ? 'var(--owl-color-risk-bright)'
              : 'var(--owl-color-text)',
          fontSize: 'var(--owl-text-sm)',
          lineHeight: 1.5,
          margin: 0,
        },
      },
      createElement('strong', {}, `${labelFor(entry.model)} — ${entry.status === 'applied' ? 'APPLIED' : 'UNAVAILABLE'}: `),
      entry.status === 'applied' ? entry.summary : `${entry.summary} (${entry.reason ?? 'no artifact'})`,
    )),
  ]
  return createCollapsibleSection('munger-lattice-card', 'Munger lattice — mental models applied', consensusCaution, children)
}

function createReReviewPanel(researchCase: AppResearchCase) {
  const reReview = researchCase.re_review
  if (reReview === undefined) return null
  const tone = reReview.assessment === 'BROKEN'
    ? 'var(--owl-color-risk-bright)'
    : reReview.assessment === 'INTACT'
      ? '#4ade80'
      : 'var(--owl-color-gold-bright)'
  return createElement(
    'details',
    { 'aria-label': 'Check-in vs new filings', className: 'owl-collapsible-card', ...(reReview.assessment === 'BROKEN' ? { open: true } : {}) },
    createElement(
      'summary',
      { className: 'owl-collapsible-card-summary' },
      createElement('span', { className: 'owl-section-accent', style: { margin: 0 } }, 'Check-in — vs. new filings'),
      createElement('span', {
        'data-testid': 're-review-assessment',
        style: { color: tone, fontFamily: 'var(--owl-font-mono)', fontWeight: 800, marginLeft: '0.6rem', letterSpacing: '0.05em' },
      }, reReview.assessment),
    ),
    reReview.re_review_ungrounded === true
      ? createElement('p', { style: { color: 'var(--owl-color-gold-bright)', fontSize: 'var(--owl-text-sm)', margin: '0.5rem 0' } }, `Unverified: ${reReview.ungrounded_reason ?? 'the pass could not cite-verify its evidence (fail-closed).'}`)
      : null,
    reReview.assessment === 'INCONCLUSIVE'
      ? createElement('p', { style: { color: 'var(--owl-color-gold-bright)', fontSize: 'var(--owl-text-sm)', margin: '0.5rem 0' } }, 'The new filings carried no assessable signal for any recorded break trigger (e.g. announcement covers without exhibit data) — not evidence the thesis is intact, and not evidence it is broken.')
      : null,
    createElement('p', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: '0.5rem 0' } },
      `Filings new since this decision were compared against the recorded thesis${reReview.checked_at === undefined ? '' : ` (checked ${reReview.checked_at.slice(0, 10)})`}. An observation — the decision itself is unchanged.`),
    reReview.narrative === undefined ? null : createElement('p', { style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-base)', margin: '0 0 0.5rem' } }, reReview.narrative),
    reReview.broken_claim === undefined ? null : createElement('p', { style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-base)', margin: '0 0 0.5rem' } }, `Broken claim: ${reReview.broken_claim} — use "Re-run on current engine" for the full re-underwrite.`),
    reReview.weakened_dimension === undefined ? null : createElement('p', { style: { color: 'var(--owl-color-gold-bright)', fontSize: 'var(--owl-text-base)', margin: '0 0 0.5rem' } }, `Weakened dimension: ${reReview.weakened_dimension}`),
    reReview.trigger_assessments.length === 0
      ? null
      : createElement(
          'ul',
          { style: { display: 'grid', gap: '0.35rem', margin: 0, paddingLeft: '1.1rem' } },
          ...reReview.trigger_assessments.map((assessment, index) => {
            // Verdict vocabulary, not the model's raw yes/no/unclear: "NO" on a break trigger is a
            // double-negative ("no, it didn't trip" = good news reading as a negative).
            const label = assessment.tripped === 'yes' ? 'BROKEN' : assessment.tripped === 'no' ? 'INTACT' : 'INCONCLUSIVE'
            const labelTone = assessment.tripped === 'yes'
              ? 'var(--owl-color-risk-bright)'
              : assessment.tripped === 'no'
                ? '#4ade80'
                : 'var(--owl-color-gold-bright)'
            return createElement(
              'li',
              { key: index, style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-sm)' } },
              createElement('strong', { style: { color: labelTone } }, `${label}: `),
              `${assessment.trigger} — ${assessment.reasoning}`,
            )
          }),
        ),
    createElement('p', { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-2xs)', fontFamily: 'var(--owl-font-mono)', margin: '0.6rem 0 0' } },
      `Reviewed: ${reReview.new_filings.map((f) => `${f.form} ${f.filed}`).join(', ')}${reReview.skipped_filings.length > 0 ? ` · skipped ${reReview.skipped_filings.length}` : ''}`),
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
 * outcome with reasoning. When outside-competence, the case was SET ASIDE (verdict PASS) before the 5-lane
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
    { 'aria-label': 'Falsifiable forecasts', className: 'owl-collapsible-card' },
    createElement(
      'summary',
      { className: 'owl-collapsible-card-summary' },
      createElement('span', { className: 'owl-section-accent', style: { margin: 0 } }, `Falsifiable forecasts (${forecasts.length})`),
    ),
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
        `${researchCase.company_id ?? 'Unknown company'} · ${researchCase.shariah_gate !== undefined ? 'Shariah gate' : 'quick screen gate'}`,
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
          researchCase.shariah_gate !== undefined ? 'Set aside at the Shariah gate' : 'Rejected at quick screen',
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
          // The stage the closed gate short-circuited: on current runs that is the circle-of-competence
          // gate (which absorbed the retired quick screen's business-quality read); legacy quick-screen
          // rejects keep the historical label.
          createElement(
            'span',
            { style: { color: 'var(--owl-color-quiet)' } },
            researchCase.shariah_gate !== undefined
              ? 'Circle-of-competence gate — skipped (gated)'
              : 'Business-quality check — skipped (gated)',
          ),
        ),
        createElement(
          'div',
          { style: { alignItems: 'center', display: 'flex', gap: '0.6rem', fontSize: 'var(--owl-text-base)', color: 'var(--owl-color-quiet)' } },
          createElement('span', null, '—'),
          createElement('span', { style: { color: 'var(--owl-color-quiet)' } }, 'Deep-dive swarm (5 lanes) — skipped'),
        ),
      ),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)', margin: '0 0 1rem' } },
        researchCase.shariah_gate !== undefined
          ? 'Evidence and the gate judgment are recorded in the audit trail.'
          : 'Evidence and the quick-screen assessment are recorded in the audit trail.',
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
          researchCase.shariah_gate !== undefined ? 'Front gates passed' : 'Quick screen passed',
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
        'Front gates passed — review and run the deep dive when ready',
      ),
      createElement(
        'p',
        { style: { color: '#dbe3ef', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: '0 0 1rem' } },
        'The Shariah gate and the circle-of-competence gate both admitted this company. The expensive lane swarm has not run yet — click "Run deep dive" to start it.',
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
          createElement('span', { style: { color: 'var(--owl-color-quiet)' } }, 'Deep-dive swarm (5 lanes) — not yet started'),
        ),
      ) : null,
      // Run deep dive action (client-side POST + in-place refresh — the old plain-HTML form navigated
      // the browser to the raw JSON API response; dogfood find 2026-07-10).
      createElement(
        'div',
        { style: { marginTop: '0.5rem' } },
        createElement(RunDeepDiveButton, { caseId: researchCase.research_case_id }),
      ),
    ),
    // Still render evidence for audit trail visibility
    createEvidenceAndAuditDetails(researchCase),
  )
}

// ── Set-aside (early-exit) state ──────────────────────────────────────────────
//
// When the circle-of-competence gate set a candidate aside, the deep dive never ran: there is no
// valuation, no margin-of-safety, no specialist lanes — only the grounded judgment of WHY. This dossier
// tells that honest short story and omits the full deep-dive scaffold entirely (no "Pending" key-figures
// strip, no discount figure, no "Not yet available" MoS, no empty lanes).

/**
 * Set-aside hero — LEADS with the dominant set-aside state (a calm gold treatment, NOT a green PASS badge
 * that would mislead). The raw verdict / valuation_status / strategy_compliance labels are demoted to a
 * small, clearly-secondary mono/quiet provenance line — "Set aside" already explains the INSUFFICIENT_DATA
 * placeholders, so the reader sees "set aside, here's why" rather than four co-equal labels to reconcile.
 * Reuses the verdict-hero idioms (owl-section-card, owl-section-accent, owl-page-title, serif headline) and
 * the shared `buildEngineVersionMarker` / `buildVersionBadge` provenance stamps.
 */
function createSetAsideHero(researchCase: AppResearchCase) {
  const displayName = researchCase.ticker ?? researchCase.company_id ?? researchCase.research_case_id
  const versionBadge = buildVersionBadge(researchCase)

  // Subordinate provenance metadata: the raw labels as a single small mono/quiet line, not co-equal chips.
  const metaParts = [
    researchCase.investment_verdict ?? researchCase.decision,
    researchCase.valuation_status === undefined ? undefined : `Valuation: ${researchCase.valuation_status}`,
    researchCase.strategy_compliance === undefined ? undefined : `Strategy: ${researchCase.strategy_compliance}`,
  ].filter((part): part is string => part !== undefined && part !== '')

  return createElement(
    'header',
    {
      className: 'owl-section-card',
      'data-testid': 'set-aside-hero',
      style: { borderLeft: '3px solid var(--owl-color-gold)', gap: '0.7rem' },
    },
    // kicker + version/engine provenance row
    createElement(
      'div',
      { style: { alignItems: 'baseline', display: 'flex', gap: '0.75rem', justifyContent: 'space-between', flexWrap: 'wrap' } },
      createElement('p', { className: 'owl-section-accent' }, 'Research dossier'),
      createElement(
        'div',
        { style: { alignItems: 'flex-end', display: 'flex', flexDirection: 'column', gap: '0.2rem', textAlign: 'right' } },
        versionBadge === null ? null : createElement(
          'span',
          { style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-xs)' } },
          versionBadge,
        ),
        buildEngineVersionMarker(researchCase),
      ),
    ),
    // Ticker (serif page title — the briefing's subject)
    createElement('h1', { className: 'owl-page-title', style: { lineHeight: 1, margin: 0 } }, displayName),
    // Company
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-base)', margin: 0 } },
      researchCase.company_id ?? 'Unknown company',
    ),
    // Dominant set-aside state — the headline the reader sees first (calm gold, never a green PASS badge).
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.15rem' } },
      createElement(
        'span',
        {
          'data-testid': 'set-aside-badge',
          style: {
            background: 'rgba(214, 178, 94, 0.15)',
            border: '1px solid rgba(214, 178, 94, 0.45)',
            borderRadius: '0.6rem',
            color: 'var(--owl-color-gold-bright)',
            fontFamily: 'var(--owl-font-mono)',
            fontSize: 'var(--owl-text-md)',
            fontWeight: 800,
            letterSpacing: '0.06em',
            padding: '0.3rem 0.8rem',
          },
        },
        'SET ASIDE',
      ),
    ),
    createElement(
      'h2',
      { className: 'owl-section-title', style: { fontFamily: 'var(--owl-font-display)', fontSize: 'var(--owl-text-lg)', margin: 0 } },
      'Set aside — outside circle of competence',
    ),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } },
      'The circle-of-competence gate set this candidate aside before the expensive 5-lane deep dive ran. There is no valuation or deep-dive analysis to show — only the grounded judgment of why it was set aside, below.',
    ),
    // Subordinate provenance metadata (small, quiet mono — NOT co-equal chips).
    metaParts.length === 0 ? null : createElement(
      'p',
      {
        'data-testid': 'set-aside-meta',
        style: {
          color: 'var(--owl-color-quiet)',
          fontFamily: 'var(--owl-font-mono)',
          fontSize: 'var(--owl-text-2xs)',
          letterSpacing: '0.04em',
          margin: 0,
        },
      },
      metaParts.join(' · '),
    ),
  )
}

/**
 * Set-aside dossier — the coherent early-exit read. Renders ONLY: the reconciled hero, the grounded
 * circle-of-competence judgment FOREGROUNDED (cited drivers + predictability-breakers + reasoning = the
 * whole "why"), and the evidence/audit details (citation traceability). The re-analysis diff and exit
 * post-mortem are collapsible no-ops that render null without data — included for the rare set-aside re-run
 * while staying clean. Deliberately OMITS the deep-dive scaffold (decision/key-figures strip, MoS audit,
 * valuation panel, decision-evidence cards, specialist lanes, forecasts, admit/sizing/sell, watchlist
 * promotion) — none of it ever populated for a set-aside run.
 */
function createSetAsideDossier(researchCase: AppResearchCase) {
  return createElement(
    'section',
    { 'data-testid': 'set-aside-dossier', style: { display: 'grid', gap: '1rem' } },
    createSetAsideHero(researchCase),
    createCircleCompetencePanel(researchCase),
    createReAnalysisDiffPanel(researchCase),
    createReReviewPanel(researchCase),
    createPostMortemPanel(researchCase),
    createEvidenceAndAuditDetails(researchCase),
  )
}

// ── Shared not-yet-available fallback (honest absent-field rendering) ──────────

const NOT_YET = createElement('span', { style: { color: 'var(--owl-color-quiet)' } }, 'Not yet available')

// ── Verdict hero ──────────────────────────────────────────────────────────────

function createVerdictHero(researchCase: AppResearchCase) {
  const displayName = researchCase.ticker ?? researchCase.company_id ?? researchCase.research_case_id
  const nextAction = researchCase.next_required_action ?? 'Continue the review workflow'
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
    // (The verdict / valuation / moat / Shariah / strategy chips were removed here — the same facts now read
    // as the scannable bullet list inside the Verdict summary below, so they are no longer duplicated.)
    // Verdict summary section
    createElement('hr', { className: 'owl-rule', style: { marginTop: '0.15rem' } }),
    createElement(
      'section',
      { style: { display: 'grid', gap: '0.5rem' } },
      createElement('p', { className: 'owl-section-accent' }, 'Verdict summary'),
      createVerdictSummaryBody(researchCase),
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
  // Read the ROOT-level stamp first (present on every run, incl. early-exit reject/set-aside paths), with the
  // nested valuation.judgment.* as a legacy fallback for older full-run events that only carried it nested.
  const engineVersion = researchCase.engine_version ?? researchCase.valuation?.judgment?.engine_version
  const engineCommit = researchCase.engine_commit ?? researchCase.valuation?.judgment?.engine_commit
  const generatedDate = researchCase.updated_at === undefined
    ? undefined
    : new Date(researchCase.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const commitSuffix = engineCommit === undefined ? '' : ` · commit ${engineCommit.slice(0, 7)}`

  // "run by {provider} / {model}" — who executed this run (provider from the authoring event, model from the
  // run request). Either may be absent on older cases; show whatever is known, or nothing.
  const provider = researchCase.authored_by_provider_id
  const model = researchCase.authored_by_model_id
  const authorSuffix = provider === undefined
    ? (model === undefined ? '' : ` · run by ${model}`)
    : ` · run by ${provider}${model === undefined ? '' : ` / ${model}`}`

  const baseStyle = {
    color: 'var(--owl-color-quiet)',
    fontFamily: 'var(--owl-font-mono)',
    fontSize: 'var(--owl-text-2xs)',
  } as const

  if (engineVersion === undefined) {
    return createElement(
      'span',
      { 'data-testid': 'engine-version-marker', style: baseStyle },
      `Engine version unknown · pre-versioning${commitSuffix}${authorSuffix}`,
    )
  }

  const isCurrent = engineVersion === ENGINE_VERSION
  const generatedSuffix = generatedDate === undefined ? '' : ` · generated ${generatedDate}`
  const marker = createElement(
    'span',
    { 'data-testid': 'engine-version-marker', style: baseStyle },
    `Engine ${engineVersion}${generatedSuffix}${commitSuffix}${authorSuffix}`,
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

// The hero verdict summary: the model's THESIS as prose, then the key judgments as scannable BULLETS
// (verdict, valuation + market-implied growth + buy-below, moat, margin of safety, Shariah). Each bullet is
// omitted when its datum is absent, so the list stays honest. The full per-card detail lives in the boxes.
function createVerdictSummaryBody(researchCase: AppResearchCase): ReactNode {
  const verdict = researchCase.investment_verdict ?? researchCase.decision
  const valuationStatus = researchCase.valuation_status
  const moat = researchCase.valuation?.moat_class
  const impliedGrowth = researchCase.valuation?.market_implied_growth
  const buyBelow = researchCase.valuation?.proposed_buy_below ?? researchCase.valuation?.buy_price_per_share
  // Phase 2 V2: the T0-computed grade is primary; the legacy model-graded adequacy is the fallback.
  const mosAdequacy = researchCase.valuation?.margin_of_safety_grade?.grade ?? researchCase.margin_of_safety_judgment?.adequacy
  const shariah = researchCase.shariah_status

  // The WHOLE thesis leads the verdict summary as prose (the standalone Thesis box was removed — this is now
  // its only home), followed by the scannable judgment bullets below.
  const fullThesis = firstNonEmpty([researchCase.thesis_summary, researchCase.evidence_summary, researchCase.reason])
  const thesis = fullThesis ?? (verdict === undefined ? 'This dossier is waiting for a source-backed investment reason.' : undefined)

  const valuationValue = [
    valuationStatus === undefined ? undefined : valuationStatus.toLowerCase(),
    impliedGrowth === undefined ? undefined : `market implies ~${(impliedGrowth * 100).toFixed(1)}% growth`,
    buyBelow === undefined ? undefined : `model buy-below $${buyBelow.toFixed(2)}`,
  ].filter((p): p is string => p !== undefined).join(' · ')

  const points: Array<[string, string]> = []
  if (verdict !== undefined) points.push(['Verdict', verdict])
  if (valuationValue.length > 0) points.push(['Valuation', valuationValue])
  if (moat !== undefined) points.push(['Moat', moat])
  if (mosAdequacy !== undefined) points.push(['Margin of safety', mosAdequacy])
  if (shariah !== undefined) points.push(['Shariah', shariah])

  return createElement(
    'div',
    { style: { display: 'grid', gap: '0.6rem' } },
    thesis === undefined ? null : createElement(
      'p',
      { style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-md)', lineHeight: 1.6, margin: 0 } },
      thesis,
    ),
    points.length === 0 ? null : createElement(
      'ul',
      { style: { color: 'var(--owl-color-muted)', display: 'grid', gap: '0.3rem', listStyle: 'disc', margin: 0, paddingLeft: '1.15rem' } },
      ...points.map(([label, value]) => createElement(
        'li',
        { key: label, style: { fontSize: 'var(--owl-text-base)', lineHeight: 1.5 } },
        createElement('strong', { style: { color: 'var(--owl-color-sand)' } }, `${label}: `),
        value,
      )),
    ),
  )
}

// ── Decision panel (R1) ───────────────────────────────────────────────────────

/**
 * RELIGHTENED DECISION (R1) — the dossier LEADS with what the human needs to decide:
 *   - the model's investment verdict + valuation_status,
 *   - the MODEL-proposed buy-below vs the live price, with the arithmetic in-buy-zone read,
 *   - the deterministic flag-only sanity-check (`sanity_flags`) as advisory amber annotations.
 * The sanity-check FLAGS internal absurdity; it NEVER blocks the verdict. The reasoning to audit
 * (cited valuation_reasoning, market-implied growth, the implied multiples, the bear case) lives
 * in the valuation panel beneath. Native owl-*; no band/gap axis.
 */
function createDecisionPanel(researchCase: AppResearchCase, marketQuote?: MarketQuote) {
  const valuation = researchCase.valuation
  if (valuation === undefined) return null

  const buyBelow = valuation.proposed_buy_below ?? valuation.buy_price_per_share
  const sanityFlags = valuation.sanity_flags ?? []
  // No decision-relevant FIGURES (no buy-below, no flags, no buy-zone read): a RESEARCH_MORE /
  // INSUFFICIENT_DATA run whose synthesis could not ground a valuation. The card must STATE that
  // outcome, never silently vanish (the SPGI dogfood: the whole decision section disappeared). Only a
  // case with NO verdict at all (mid-run) still returns null — the progress view owns those.
  if (buyBelow === undefined && sanityFlags.length === 0 && valuation.in_buy_zone === undefined) {
    const degradedVerdict = researchCase.investment_verdict ?? researchCase.decision
    if (degradedVerdict === undefined) return null
    return createElement(
      'details',
      { 'data-testid': 'decision-summary', className: 'owl-collapsible-card', open: true },
      createElement(
        'summary',
        { className: 'owl-collapsible-card-summary' },
        createElement('span', { className: 'owl-section-accent', style: { margin: 0 } }, 'The decision'),
        createElement('span', { className: 'owl-collapsible-card-hint' }, `${degradedVerdict} · no recordable buy signal`),
      ),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
        'No recordable buy signal: the run did not produce a usable buy-below (the synthesis could not ground '
        + 'a valuation, or the price was unavailable), so there are no decision figures to show. The recorded '
        + 'verdict and the reason are below — re-run when the gap is addressed.',
      ),
      createElement(
        'div',
        { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
        createPill(`Verdict: ${degradedVerdict}`, resolveVerdictColors(degradedVerdict)),
        ...(researchCase.valuation_status !== undefined
          ? [createPill(`Valuation: ${researchCase.valuation_status}`, resolveValuationChipColor(researchCase.valuation_status))]
          : []),
      ),
      ...(researchCase.reason !== undefined && researchCase.reason.length > 0
        ? [createElement(
            'p',
            { style: { color: '#dbe3ef', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } },
            researchCase.reason,
          )]
        : []),
    )
  }

  const verdict = researchCase.investment_verdict ?? researchCase.decision
  const valuationStatus = researchCase.valuation_status
  const livePrice = marketQuote?.price_per_share
  // The in-buy-zone read is pure arithmetic (current_price <= buy_below). Prefer the recorded flag, else
  // derive it from the live quote vs the model buy-below when both are present.
  const inBuyZone = valuation.in_buy_zone
    ?? (livePrice !== undefined && buyBelow !== undefined ? livePrice <= buyBelow : undefined)

  // Key-figures strip (Priority 2): the full decision-critical figure set LEADS as stat blocks, not buried
  // in prose. Beyond buy-below / live price / buy-zone, surface the two hidden assumptions the price bakes in
  // — market-implied growth (reverse-DCF) and the implied exit multiple — together. Prose reasoning stays
  // below in the valuation panel. (forward-DCF removal: the dollar reference fair value is gone.)
  const marketImpliedGrowth = valuation.market_implied_growth
  const impliedExitMultiple = valuation.implied_exit_multiple
  // The model's assumed sustainable growth: the headline growth_rate IS the model's cite-verified
  // assumed_growth (architecture inversion); fall back to the raw valuation_reasoning field for
  // legacy shapes that predate the headline field.
  const modelAssumedGrowth = valuation.growth_rate ?? valuation.valuation_reasoning?.assumed_growth

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
    // vs live price + the in-buy-zone arithmetic; and the two hidden price-implied assumptions surfaced
    // together. (forward-DCF removal: the dollar reference fair value stat is gone.)
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
      // B2 (Phase 4, rule 8): the LOAD-UP threshold + zone — a ≥50% discount to intrinsic value marks
      // the concentrated-sizing zone ("once you find a margin of safety, load up the truck").
      createValuationLedgerStat(
        'Load-up below (rule 8)',
        researchCase.valuation?.load_up_below !== undefined ? `$${researchCase.valuation.load_up_below.toFixed(2)}` : 'Not computable',
        'owl-ledger-figure-money',
      ),
      researchCase.valuation?.in_load_up_zone === true
        ? createValuationLedgerStat('Load-up zone', 'IN THE LOAD-UP ZONE', 'owl-ledger-figure-emerald')
        : null,
      // The MODEL's assumed sustainable growth sits BESIDE the market-implied read (owner requirement):
      // the gap between what the model judges sustainable and what the price demands is the decision.
      createValuationLedgerStat(
        'Model assumed growth',
        modelAssumedGrowth !== undefined ? `${(modelAssumedGrowth * 100).toFixed(1)}%` : 'Not yet available',
        '',
      ),
      createValuationLedgerStat(
        'Market-implied growth',
        marketImpliedGrowth !== undefined ? `${(marketImpliedGrowth * 100).toFixed(1)}%` : 'Not yet available',
        '',
      ),
      createValuationLedgerStat(
        'Market-implied exit multiple',
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
 * D1 (owner feedback): the THESIS-BREAK AUDIT — the model's forward-looking risk reasoning for the
 * human to audit, riding with the decision at the end of the dossier:
 *   1. the model's key_wrong_assumption (the one assumption that, if wrong, breaks the thesis).
 *   2. the thesis_break_triggers (observable events that would invalidate the thesis).
 * The pre-pillar JOINT margin-of-safety judgment was retired here — the book's mechanical 30%/50%
 * thresholds (the T0 margin_of_safety_grade) own the margin; a model adequacy that could "rest on moat
 * durability" is the substitutable-margin concept the 4-pillar method replaced. Deliberately NOT
 * cite-gated. Absent fields render the honest "Not yet available" fallback (no crash).
 */
function createThesisBreakAuditCard(researchCase: AppResearchCase) {
  // Only render once a deep-dive valuation exists (gated/awaiting states have their own dossiers).
  if (researchCase.valuation === undefined) return null

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
      'data-testid': 'thesis-break-audit',
      className: 'owl-section-card',
      // The gold accent rail marks the human's audit surface riding with the decision.
      style: { gap: '0.6rem', borderLeft: '3px solid var(--owl-color-gold)' },
    },
    createElement('p', { className: 'owl-section-accent' }, 'Thesis-break audit'),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
      'The one assumption that, if wrong, breaks the thesis — and the observable triggers that would invalidate it. The model’s forward-looking risk reasoning for you to audit against the decision above.',
    ),
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

// ── Discount-anchor vintage (savings-rate provenance) ─────────────────────────
//
// The discount's risk-free anchor is the compliant savings rate (savings + a uniform equity premium =
// discount). There is no record of WHEN that rate was set, so a stale value would drift silently. This small
// mono/quiet line surfaces the breakdown AND the vintage so a stale/never-set anchor is VISIBLE:
//   - set:    "Discount 7.5% = compliant savings 2.0% + equity premium 5.5% · savings rate last set Jun 28 2026"
//   - unset:  "Discount 7.5% = … · savings rate: using default 2.0% — not set"
// Read-only: it never changes discount math (the live rate already flows through discountRate()).
// B2 (Phase 4): the run's OWN discount provenance — the flat required return (setting | book default).
// Renders for runs carrying the new discount_inputs shape; legacy savings-anchored runs keep the old line.
function createRequiredReturnProvenance(researchCase: AppResearchCase) {
  const di = researchCase.valuation?.discount_inputs
  if (di?.required_return === undefined) return null
  const pct = (frac: number) => `${(frac * 100).toFixed(1)}%`
  return createElement(
    'p',
    {
      'data-testid': 'required-return-provenance',
      style: {
        color: 'var(--owl-color-quiet)',
        fontFamily: 'var(--owl-font-mono)',
        fontSize: 'var(--owl-text-2xs)',
        lineHeight: 1.5,
        margin: '0.5rem 0 0',
      },
    },
    `Required return ${pct(di.required_return)} — ${di.required_return_basis === 'setting' ? 'user setting' : 'the book default (anything less, buy the index)'} · margins: buy at ≥30% below intrinsic value, load up at ≥50%`,
  )
}

function createDiscountAnchorProvenance(savings?: SavingsSleeveConfig) {
  const v = buffettMungerStrategy.valuation
  const pct = (frac: number) => `${(frac * 100).toFixed(1)}%`

  const configuredRate = savings?.savings_expected_profit_rate
  const hasValidRate = typeof configuredRate === 'number' && Number.isFinite(configuredRate) && configuredRate > 0
  const savingsRate = hasValidRate ? configuredRate : v.savings_rate_default
  const liveDiscount = discountRate(buffettMungerStrategy, hasValidRate ? savingsRate : undefined)
  // The anchor is "the frozen default" whenever the effective rate equals it (no config, or an explicit rate
  // that happens to equal the default) — that is the case the vintage flags as never-owner-set.
  const isDefaultRate = savingsRate === v.savings_rate_default

  const setAt = savings?.savings_rate_set_at
  const setAtValid = typeof setAt === 'string' && setAt.trim() !== '' && !Number.isNaN(Date.parse(setAt))
  const vintageText = setAtValid
    ? `savings rate last set ${new Date(setAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : isDefaultRate
      ? `savings rate: using default ${pct(v.savings_rate_default)} — not set`
      : `savings rate: ${pct(savingsRate)} — set date not recorded`

  return createElement(
    'p',
    {
      'data-testid': 'discount-anchor-provenance',
      style: {
        color: 'var(--owl-color-quiet)',
        fontFamily: 'var(--owl-font-mono)',
        fontSize: 'var(--owl-text-2xs)',
        lineHeight: 1.5,
        margin: '0.5rem 0 0',
      },
    },
    `Discount ${pct(liveDiscount)} = compliant savings ${pct(savingsRate)} + equity premium ${pct(v.equity_premium)} · ${vintageText}`,
  )
}

function createValuationPanel(researchCase: AppResearchCase, marketQuote?: MarketQuote, savings?: SavingsSleeveConfig) {
  const valuation = researchCase.valuation
  if (valuation === undefined) return null

  const pctPts = (frac: number) => `${(frac * 100).toFixed(1)}%`
  // NVO dogfood (2026-07-11): on a moat-gated case the buy-price math (fair-value derivatives, implied
  // growth/multiples, buy zone, MoS grade) is DELIBERATELY not computed — a below-gate name is set aside
  // before pricing. Say so once, instead of rendering a wall of "Pending" that reads as an incomplete run.
  const moatGatedNotPriced = valuation.moat_passes_gate === false

  // RELIGHTENED DECISION (R1): the MODEL's cited reasoning is the substance to audit. The reverse-DCF
  // market-implied growth is the richness read. (forward-DCF removal: the dollar reference fair value is gone.)
  const marketImpliedGrowth = valuation.market_implied_growth
  const reasoning = valuation.valuation_reasoning
  const discountRateVal = valuation.discount_rate
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
  // Judgment-objectivity layer (Mechanisms 1+2): the MOAT provenance (proposed → resolved, taxonomy,
  // direction, peers) moved to the Pillar-2 moats card (D1); the runway read stays here with valuation.
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

  const discountLabel = discountRateVal !== undefined ? pctLabel(discountRateVal) : DEFAULT_DISCOUNT_LABEL

  // Judged-growth label: the model's judged sustainable g (early years) fading to terminal g_t. growth_rate
  // is now the MODEL's cite-verified assumed/judged growth; the capped demonstrated CAGR is the
  // demonstrated-history reference (demonstrated_growth_reference), not shown here. ROIC is context only.
  const eligRoic = incrementalRoic ?? roic
  const fadeLabel = terminalGrowthRate !== undefined ? ` → terminal ${(terminalGrowthRate * 100).toFixed(0)}%` : ''
  const runwayLabel = runway !== undefined ? ` · ${runway} runway` : ''
  const roicGateLabel = growthRate !== undefined
    ? growthRate > 0
      ? `model-judged g=${(growthRate * 100).toFixed(0)}%${fadeLabel}${eligRoic !== undefined ? ` · incremental ROIC ${(eligRoic * 100).toFixed(0)}% > ${discountLabel} (filings)` : ''}${runwayLabel}`
      : `model-judged g=0%${fadeLabel}${eligRoic !== undefined ? ` · incremental ROIC ${(eligRoic * 100).toFixed(0)}% ≤ ${discountLabel} (filings, no growth credit)` : ' (no growth credit)'}${runwayLabel}`
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
    // Accent title (the collapsible wrapper lifts it into the summary; the moat + discount label lives on the
    // right of the collapsed header via the valuation hint, so it is not repeated here).
    createElement('p', { className: 'owl-section-accent' }, 'Valuation'),
    createElement(
      'p',
      { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.5, margin: 0 } },
      'The reasoning to audit. The model proposed the verdict and the buy-below above; here it shows its work. The reverse-DCF market-implied growth is the valuation cross-check — the decision rests on the model buy-below.',
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
        ? createElement('span', null, createElement('strong', { style: { color: 'var(--owl-color-sand)' } }, `${pctPts(marketImpliedGrowth)} market-implied growth`), ' (the rate the business must compound at to justify the price)')
        : createElement('span', null, 'a market-implied growth (not computable without a live price)'),
      ', and ',
      impliedExitMultiple !== undefined
        ? createElement('span', null, createElement('strong', { style: { color: 'var(--owl-color-sand)' } }, `a ${impliedExitMultiple.toFixed(1)}× market-implied exit multiple`), ' (the owner-earnings multiple the price must still command at the horizon).')
        : createElement('span', null, 'a market-implied exit multiple (not yet computed).'),
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
    // Key figures — the ledger-line of the valuation. The model's buy-below + verdict drive the decision;
    // the reverse-DCF market-implied growth + the implied multiples are the kept valuation lens.
    // (forward-DCF removal: the dollar reference fair value stat is gone.)
    createElement(
      'div',
      { className: 'owl-ledger-line', style: { marginTop: '1rem' } },
      createValuationLedgerStat(
        'Market-implied growth',
        marketImpliedGrowth !== undefined ? pctPts(marketImpliedGrowth) : (moatGatedNotPriced ? 'Not priced (moat gate)' : 'Pending'),
        '',
      ),
      // Provenance-labeled (owner requirement, the Visa dogfood): every stat says WHO derived it —
      // market-implied (reverse-DCF of today's price), model (the model's grounded judgment/bridge), or
      // policy (harness/strategy constants) — so the reader never mistakes a price-derived figure for a
      // model judgment or vice versa.
      createValuationLedgerStat('Market-implied multiple', impliedMultiple !== undefined ? `${impliedMultiple.toFixed(1)}× OE` : (moatGatedNotPriced ? 'Not priced (moat gate)' : 'Pending'), ''),
      createValuationLedgerStat('Market-implied exit multiple', impliedExitMultiple !== undefined ? `${impliedExitMultiple.toFixed(1)}× OE` : (moatGatedNotPriced ? 'Not priced (moat gate)' : 'Pending'), ''),
      createValuationLedgerStat('Owner earnings / sh (model)', valuation.normalized_owner_earnings_per_share !== undefined ? `$${valuation.normalized_owner_earnings_per_share.toFixed(2)}` : 'Pending', 'owl-ledger-figure-money'),
      createValuationLedgerStat('Terminal g (policy)', terminalGrowthRate !== undefined ? `${(terminalGrowthRate * 100).toFixed(0)}%` : 'Pending', ''),
      createValuationLedgerStat('Runway (model)', runway ?? 'Pending', ''),
      createValuationLedgerStat('Discount (policy)', discountLabel, ''),
    ),
    // Discount provenance: B2 runs show the flat required return; legacy runs keep the savings-anchor line.
    researchCase.valuation?.discount_inputs?.required_return !== undefined
      ? createRequiredReturnProvenance(researchCase)
      : createDiscountAnchorProvenance(savings),
    // Judgment provenance (Priority 2): the RUNWAY "proposed → resolved" anchor read is PROSE, not a
    // numeric — a labeled mono/muted text line. The MOAT provenance moved to the Pillar-2 moats card (D1).
    runwayAnchorLabel !== undefined ? createElement(
      'div',
      { 'data-testid': 'judgment-provenance', style: { display: 'grid', gap: '0.25rem', marginTop: '0.7rem' } },
      createElement('p', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', fontWeight: 800, margin: 0 } }, 'Judgment provenance'),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-muted)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-xs)', lineHeight: 1.5, margin: 0 } },
        `Runway: ${runwayAnchorLabel}`,
      ),
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
    // Accent title FIRST (the collapsible wrapper lifts it into the summary; the moat + entry-cap tag lives
    // on the right of the collapsed header via the position-plan hint, so it is not repeated here).
    createElement('p', { style: labelStyle }, 'Position plan · advisory'),
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
function createValuationLedgerStat(label: string, value: string, figureClass: string, subNote?: string) {
  return createElement(
    'article',
    { key: label, className: 'owl-ledger-stat' },
    createElement('p', { className: 'owl-ledger-label' }, label),
    createElement('p', { className: `owl-ledger-figure ${figureClass}`.trim() }, value),
    // Optional small mono/quiet secondary note beneath the figure — keeps the LABEL short and scannable
    // (e.g. "cross-check") instead of an over-long inline label that wraps to several lines.
    subNote === undefined ? null : createElement(
      'p',
      { style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', letterSpacing: '0.04em', margin: 0 } },
      subNote,
    ),
  )
}

// ── Whole-case thesis (the synthesis narrative — one home) ────────────────────
//
// Consolidation (Priority 3): the old four-card "decision evidence" duplicated content shown elsewhere —
// the Valuation card duplicated the Valuation box, the Shariah card duplicated the shariah lane (its unique
// AAOIFI ratio ledger now lives in createComplianceRatioBlock), and the Risks card duplicated the risks
// lane + the MoS thesis-break triggers. Per-dimension findings now live ONLY in the specialist lanes; what
// remains here is the unique whole-case thesis (the synthesis narrative), full-width.

/**
 * Shariah / compliance — the unique harness-computed AAOIFI ratio ledger, given its own compact home (the
 * per-dimension shariah finding lives in the specialist lane). Returns null when no harness ratios exist.
 */
function createComplianceRatioBlock(researchCase: AppResearchCase) {
  const ledger = createShariahRatioLedger(researchCase)
  if (ledger === null) return null
  return createElement(
    'section',
    {
      'data-testid': 'compliance-ratios',
      className: 'owl-section-card',
      style: { gap: '0.5rem' },
    },
    createElement('p', { className: 'owl-section-accent' }, 'Shariah / compliance'),
    createSectorPermissibilityRow(researchCase),
    ledger,
  )
}

/**
 * The SECTOR permissibility judgment — whether the BUSINESS ACTIVITIES themselves are permissible —
 * stated ABOVE the financial ratios (AAOIFI's own order: the sector gate precedes the ratio screens).
 * Sourced from the grounded Shariah pass's sector_status. Owner requirement (the Visa dogfood): the
 * compliance section must not read as numbers-only. Absent on legacy events without the field.
 */
function createSectorPermissibilityRow(researchCase: AppResearchCase) {
  const sector = researchCase.shariah_sector_status
  if (sector !== 'compliant' && sector !== 'conditional' && sector !== 'non_compliant') return null
  const EMERALD = 'var(--owl-color-emerald, #34d399)'
  const label = sector === 'compliant'
    ? 'Permissible ✓'
    : sector === 'conditional'
      ? 'Conditional — borderline activity, review'
      : 'Not permissible ✗'
  const color = sector === 'compliant' ? EMERALD : sector === 'conditional' ? 'var(--owl-color-gold-bright)' : 'var(--owl-color-risk)'
  return createElement(
    'div',
    {
      'data-testid': 'shariah-sector-permissibility',
      style: { alignItems: 'baseline', color: '#dbe3ef', display: 'flex', fontSize: 'var(--owl-text-sm)', gap: '0.4rem', justifyContent: 'space-between' },
    },
    createElement('span', null, 'Business activities (sector, grounded Shariah pass)'),
    createElement('span', { style: { color, fontWeight: 800 } }, label),
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
  // FAIL-CLOSED caveat: the SHARIAH deep re-screen lane grounded no verifiable source (skipped), so the deep
  // compliance re-verification did NOT run this run — the verdict rests on the earlier quick-screen gate.
  // Rendered ALONGSIDE whatever verdict/ratios exist (it never flips them), so a human does not read a
  // falsely-confident COMPLIANT. Absent on legacy events and on runs whose shariah lane grounded a source.
  const deepScreenCaveat = researchCase.shariah_deep_screen_incomplete === true
    ? createElement(
        'div',
        {
          'data-testid': 'shariah-deep-screen-incomplete',
          style: { borderTop: '1px solid rgba(148, 163, 184, 0.14)', display: 'grid', gap: '0.3rem', marginTop: '0.2rem', paddingTop: '0.45rem' },
        },
        createElement(
          'p',
          { style: { color: 'var(--owl-color-gold-bright)', fontSize: 'var(--owl-text-sm)', fontWeight: 800, lineHeight: 1.4, margin: 0 } },
          'Compliance not deep-verified this run.',
        ),
        createElement(
          'p',
          { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.4, margin: 0 } },
          'The Shariah deep re-screen cited no verified source. Any ratios shown rest on ungrounded model output rather than a grounded re-screen, and the compliance read leans on the quick-screen gate. Re-run before relying on it.',
        ),
      )
    : null
  if (sf === undefined) {
    // FAIL-CLOSED honesty: when impermissible income is UNDETERMINED (the lane could not extract a
    // separate impermissible-income line) the harness did NOT compute the ratios. Render the undetermined
    // state explicitly — NEVER a falsely-clean "0.0% purification / fully compliant". Otherwise no ledger.
    if (researchCase.shariah_impermissible_income_undetermined !== true) {
      // No harness ratios AND not undetermined — but if the deep re-screen was skipped, still surface the
      // caveat on its own so a skipped re-screen is never silent (would otherwise render nothing).
      return deepScreenCaveat
    }
    return createElement(
      'div',
      {
        'data-testid': 'shariah-aaoifi-undetermined',
        style: { borderTop: '1px solid rgba(148, 163, 184, 0.14)', display: 'grid', gap: '0.3rem', marginTop: '0.2rem', paddingTop: '0.45rem' },
      },
      createElement('p', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', fontWeight: 800, margin: 0 } }, 'AAOIFI financial ratios (harness-computed)'),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-gold-bright)', fontSize: 'var(--owl-text-sm)', fontWeight: 800, lineHeight: 1.4, margin: 0 } },
        'Impermissible income undetermined — purification cannot be determined.',
      ),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.4, margin: 0 } },
        'The filing does not separately disclose a quantifiable impermissible-income line. Obtain the interest-income / prohibited-revenue figure before treating this name as clean — it is not 0% / fully compliant.',
      ),
      deepScreenCaveat,
    )
  }
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

  // Itemized impermissible-income composition (owner requirement: SHOW every line — interest income,
  // dividend income, any model-quantified residual — not one opaque number). Sums to the figure the
  // purification % was computed from; absent for pre-itemization ledger events.
  const impermissibleLines = (sf.impermissible_income_lines ?? []).length === 0
    ? null
    : createElement(
        'div',
        {
          'data-testid': 'shariah-impermissible-income-lines',
          style: { display: 'grid', gap: '0.2rem', margin: '0.1rem 0 0.05rem', paddingLeft: '0.8rem' },
        },
        ...(sf.impermissible_income_lines ?? []).map((line) =>
          createElement(
            'div',
            { key: `${line.concept}:${line.label}`, style: { alignItems: 'baseline', color: '#9aa4b7', display: 'flex', fontSize: 'var(--owl-text-xs)', gap: '0.4rem', justifyContent: 'space-between' } },
            createElement('span', null, `· ${line.label}`),
            createElement('span', { style: { fontFamily: 'var(--owl-font-mono)' } }, `$${line.amount_musd.toLocaleString('en-US')}M`),
          )),
      )

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
    impermissibleLines,
    createElement(
      'div',
      { style: { alignItems: 'baseline', color: '#dbe3ef', display: 'flex', fontSize: 'var(--owl-text-sm)', gap: '0.4rem', justifyContent: 'space-between', marginTop: '0.15rem' } },
      createElement('span', { style: { fontWeight: 800 } }, `Verdict: ${verdict}`),
      createElement('span', { style: { color: verdictColor, fontWeight: 800 } }, `Purification: ${purification}`),
    ),
    deepScreenCaveat,
  )
}

// ── Visible specialist lanes grid (NEW — owner wants to see these) ────────────

function createSpecialistLanesGrid(researchCase: AppResearchCase) {
  const legacyDossier = isLegacyDecisionDossier(researchCase)
  const findings = researchCase.specialist_findings ?? []
  const displayFindings = findings.length === 0 && legacyDossier
    ? createLegacyDeepDiveFindings(researchCase)
    : findings

  // GUARD: only the all-5-lanes-visible treatment fires for a real completed deep-dive (≥1 grounded lane
  // finding). A legacy/empty/non-deep-dive case (no findings) behaves exactly as before — return null and let
  // the set-aside / gated / awaiting / progress paths own their own rendering. Legacy dossiers supply all
  // 7 findings via createLegacyDeepDiveFindings(); the 5 orderedLanes are all grounded, shariah and valuation
  // land in remainder, and no incomplete placeholders appear.
  if (displayFindings.length === 0) return null

  // S6 (Phase 3 pillars): TWO-ERA lane rendering. New runs record the pillar lanes
  // (understand/moat/management); historical runs recorded the legacy five. The dossier keys its
  // expected-lane slots off which era the case's findings belong to, so a legacy case renders its
  // five lanes untouched and a pillar case renders three — nothing ever vanishes either way.
  const PILLAR_LANES = ['understand', 'moat', 'management']
  const LEGACY_LANES = ['business_quality', 'moat', 'management', 'financial_quality', 'risks']
  const findingLaneIds = new Set(displayFindings.map((f) => f.specialist_lane ?? ''))
  const isLegacyCase = ['business_quality', 'financial_quality', 'risks'].some((l) => findingLaneIds.has(l))
  const orderedLanes = isLegacyCase ? LEGACY_LANES : PILLAR_LANES
  // For a completed deep dive we render ALL expected lanes IN ORDER: a grounded lane shows its full
  // finding card; an expected lane with NO finding (silently skipped upstream when it grounded zero verifiable
  // sources) shows an honest "incomplete" placeholder instead of vanishing. This is DISPLAY-ONLY — it does not
  // re-emit events or change the swarm's correct fail-closed skip; it only makes the skip VISIBLE.
  // A lane counts as GROUNDED only when it emitted a finding AND that finding carries real written analysis.
  // A finding with placeholder prose (e.g. the model emitted "..." for a lane) is treated exactly like a
  // missing lane: rendered as an honest "incomplete" slot, not a card showing a literal "...".
  const laneFinding = (lane: string) => displayFindings.find((f) => f.specialist_lane === lane)
  const laneSlots = orderedLanes.map((lane) => {
    const finding = laneFinding(lane)
    if (finding === undefined) return createSpecialistLaneIncompleteCard(lane)
    if (isPlaceholderLaneSummary(finding.finding_summary)) return createSpecialistLaneIncompleteCard(lane, 'empty')
    return createSpecialistLaneCard(finding)
  })
  // Any grounded finding whose lane is NOT one of the expected lanes still renders (remainder), unless it too
  // is an empty placeholder. Legacy shariah and valuation findings render here.
  const remainder = displayFindings.filter(
    (f) => !orderedLanes.includes(f.specialist_lane ?? '') && !isPlaceholderLaneSummary(f.finding_summary),
  )
  const groundedCount = orderedLanes.filter((lane) => {
    const finding = laneFinding(lane)
    return finding !== undefined && !isPlaceholderLaneSummary(finding.finding_summary)
  }).length
  const incompleteCount = orderedLanes.length - groundedCount

  // Collapsed by default (Priority 1): the dense per-lane reasoning lives behind the existing <details>
  // idiom, with an HONEST grounded-vs-expected count in the summary. Inside, each lane stacks FULL-WIDTH
  // (one card per row) so long-form lane prose gets the full content width — no narrow masonry columns.
  return createCollapsibleSection(
    'specialist-lanes-section',
    `Deep-dive specialist lanes (${groundedCount} of ${orderedLanes.length} grounded)`,
    false,
    [
      createElement(
        'p',
        { key: 'lanes-intro', style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: 0 } },
        incompleteCount > 0
          ? `${groundedCount} of ${orderedLanes.length} lanes source-backed · ${incompleteCount} incomplete (no verifiable sources this run)`
          : `${groundedCount} of ${orderedLanes.length} lanes source-backed`,
      ),
      createElement(
        'div',
        { key: 'lanes-flow', 'data-testid': 'specialist-lanes-flow', style: { display: 'grid', gap: '0.7rem' } },
        ...laneSlots,
        ...remainder.map((finding) => createSpecialistLaneCard(finding)),
      ),
    ],
  )
}

// An EXPECTED deep-dive lane that grounded zero verifiable sources this run is silently skipped upstream (no
// specialist_finding event is emitted — a correct fail-closed behavior). On the COMPLETED dossier we make that
// skip VISIBLE with a calm, clearly-distinct "incomplete" placeholder so the lane never just vanishes (a
// missing Management lane should read as attempted-and-dropped, not removed). Display-only; owl-* tokens.
function createSpecialistLaneIncompleteCard(lane: string, variant: 'no-sources' | 'empty' = 'no-sources') {
  const laneLabel = deepDiveLaneShortLabel(lane)
  const incompleteCopy = variant === 'empty'
    ? 'Incomplete — the lane grounded sources but returned no written analysis this run (not investment-grade; re-run before relying on it).'
    : 'Incomplete — no verifiable sources grounded this run (not investment-grade; re-run before relying on it).'
  return createElement(
    'article',
    {
      key: `incomplete-${lane}`,
      'data-testid': `specialist-lane-incomplete-${lane}`,
      style: {
        background: 'var(--owl-color-panel)',
        border: '1px dashed var(--owl-color-border)',
        borderRadius: '0.7rem',
        padding: '0.75rem 0.85rem',
        width: '100%',
      },
    },
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.4rem' } },
      createElement(
        'div',
        { style: { alignItems: 'center', display: 'flex', justifyContent: 'space-between' } },
        createElement(
          'span',
          {
            style: {
              color: 'var(--owl-color-quiet)',
              fontFamily: 'var(--owl-font-mono)',
              fontSize: 'var(--owl-text-xs)',
              fontWeight: 800,
              letterSpacing: '0.05em',
              textTransform: 'uppercase' as const,
            },
          },
          laneLabel,
        ),
        createElement(
          'span',
          {
            style: {
              border: '1px solid var(--owl-color-border)',
              borderRadius: '999px',
              color: 'var(--owl-color-risk-bright)',
              fontSize: 'var(--owl-text-2xs)',
              padding: '0.12rem 0.45rem',
            },
          },
          'Incomplete',
        ),
      ),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', lineHeight: 1.45, margin: 0 } },
        incompleteCopy,
      ),
    ),
  )
}

type ResearchFindingCard = NonNullable<AppResearchCase['specialist_findings']>[number]

/**
 * Split a lane finding into its CONCLUSION (the bottom line — first sentence) and the supporting DETAIL
 * (the remainder). Density treatment (Priority 4): the reader sees the verdict at a glance; the supporting
 * reasoning is secondary, behind a disclosure. When the finding is a single short sentence there is no
 * detail to defer.
 */
export function splitLaneFinding(summary: string): { conclusion: string; detail: string | undefined } {
  const compact = summary.trim().replace(/\s+/g, ' ')
  if (compact.length <= 160) return { conclusion: compact, detail: undefined }
  // Prefer a clean sentence boundary: the first sentence is the bottom line, the remainder goes behind the
  // "Reasoning" disclosure. Allow a generous first-sentence length (≤320) so a normal lead sentence is shown
  // whole rather than chopped.
  const match = compact.match(/^(.+?[.!?])\s+(.*)$/s)
  if (
    match !== null && match[1] !== undefined && match[2] !== undefined &&
    match[2].trim().length > 0 && match[1].trim().length <= 320
  ) {
    return { conclusion: match[1].trim(), detail: match[2].trim() }
  }
  // No usable early sentence boundary (a single long sentence, or an over-long lead): show the FULL text —
  // NEVER cut a sentence mid-word with an ellipsis (owner feedback). The whole lanes section is collapsed by
  // default, so a longer card here is acceptable and strictly more honest than a cut-off fragment.
  return { conclusion: compact, detail: undefined }
}

/**
 * A lane finding whose prose is empty or a bare placeholder — e.g. the model emitted "..." for a lane it
 * deferred (the valuation lane can do this when its prompt tells it the harness owns the discount math). Such
 * a lane grounded metadata (sources/confidence) but produced NO written analysis, so it is rendered as an
 * honest "incomplete" slot rather than a card showing a literal "...".
 */
export function isPlaceholderLaneSummary(summary?: string): boolean {
  if (summary === undefined) return true
  const trimmed = summary.trim()
  if (trimmed.length === 0) return true
  // No alphanumeric content at all → a bare placeholder like "...", "…", ".", or "-".
  return !/[a-z0-9]/i.test(trimmed)
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
        background: 'var(--owl-color-panel-elevated)',
        border: `1px solid ${isRiskyLane ? 'var(--owl-color-fiduciary)' : 'var(--owl-color-border)'}`,
        borderLeft: isRiskyLane ? '3px solid var(--owl-color-fiduciary)' : undefined,
        borderRadius: '0.7rem',
        padding: '0.75rem 0.85rem',
        width: '100%',
      },
    },
    // Inner grid preserves vertical rhythm — the card is a full-width row in the vertical stack.
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

// ── Evidence & sources (collapsed drop-down; sources + audit trail, e2e anchor) ──

// `alwaysVisibleSources` (full dossier only): the cited Sources list is rendered as an ALWAYS-VISIBLE block
// ABOVE the collapsed audit details so the citation-marker anchors land on a target that is never hidden —
// keyboard/SR users reach the evidence without expanding a `<details>`. The set-aside / gated / awaiting
// dossiers keep the original single collapsed block (those paths are intentionally minimal — markers there
// still resolve via the browser's fragment auto-expand of `<details>`).
function createEvidenceAndAuditDetails(researchCase: AppResearchCase, options: { alwaysVisibleSources?: boolean } = {}) {
  const details = createElement(
    'details',
    { className: 'owl-collapsible-card' },
    createElement(
      'summary',
      { className: 'owl-collapsible-card-summary' },
      createElement('span', { className: 'owl-section-accent', style: { margin: 0 } }, 'Evidence & sources'),
    ),
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.85rem', marginTop: '1rem' } },
      // Sources (each filing collapses to its title). The gate checklist (empty/legacy) and the deep-dive lane
      // findings (already shown in the top-level Deep-dive lanes box) were removed to declutter this drop-down.
      options.alwaysVisibleSources ? null : createEvidenceAndSourcesPanel(researchCase),
      createLedgerTimelinePanel(researchCase),
      createQuickScreenCollapsible(researchCase),
    ),
  )

  if (!options.alwaysVisibleSources) return details

  return createElement(
    'div',
    { style: { display: 'grid', gap: '1rem' } },
    createEvidenceAndSourcesPanel(researchCase),
    details,
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

function createLedgerTimelinePanel(researchCase: AppResearchCase) {
  return createElement(
    'details',
    { style: collapsibleDetailsStyle },
    createElement('summary', { style: collapsibleSummaryStyle }, 'Ledger timeline'),
    createElement(
      'p',
      { style: { color: '#9aa4b7', fontSize: 'var(--owl-text-base)', margin: '0.6rem 0 1rem' } },
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
  // Each filing collapses to its title; the excerpt / URL / audit id reveal on expand. Stable anchor target:
  // the marker links (`#source-<id>`) land here and the browser auto-expands this <details> (and its Evidence
  // ancestor) on fragment navigation. `scrollMarginTop` keeps the landed card clear of any sticky header.
  const filingLabel = humanizeAuditSourceId(source.source_id)
  return createElement(
    'details',
    {
      key: source.source_id,
      id: sourceAnchorId(source.source_id),
      style: {
        background: 'var(--owl-color-panel-deep)',
        border: '1px solid rgba(148, 163, 184, 0.14)',
        borderRadius: '0.9rem',
        padding: '0.85rem 0.95rem',
        scrollMarginTop: '5rem',
      },
    },
    createElement(
      'summary',
      { style: { color: '#f7f8ff', cursor: 'pointer', fontSize: 'var(--owl-text-md)', fontWeight: 700 } },
      source.title,
    ),
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.45rem', marginTop: '0.6rem' } },
      filingLabel === source.title
        ? null
        : createElement('p', { style: { color: 'var(--owl-color-muted)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-xs)', margin: 0 } }, filingLabel),
      createElement('p', { style: { color: '#cbd5e1', lineHeight: 1.55, margin: 0 } }, source.excerpt),
      source.url === undefined
        ? null
        : createElement('a', { href: source.url, rel: 'noreferrer', style: { color: 'var(--owl-color-gold-bright)', fontSize: 'var(--owl-text-base)', fontWeight: 800 } }, 'Open source URL'),
      source.citation_locator === undefined
        ? null
        : createElement('p', { style: { color: '#9aa4b7', fontSize: 'var(--owl-text-base)', margin: 0 } }, `Citation: ${source.citation_locator}`),
      createElement(SourceChip, { id: source.source_id, label: 'Audit source id' }),
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
  // The grounded quick-screen source ids land on the projection from the `quick_screen_drafted` payload;
  // additive + optional so legacy events (no tool-grounded sources) leave this undefined → empty list.
  const quickScreenSourceIds = researchCase.quick_screen_source_ids ?? []

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
      // Grounding visibility: the quick screen now tool-grounds its judgment in fetched filings, so surface
      // the count of content-hash-verified sources it cited (consistent with the lane "N sources" chips).
      // Legacy dossiers that predate the tool-grounded gate carry none — render "—", never crash.
      createDetail(
        'Sources',
        quickScreenSourceIds.length === 0
          ? '—'
          : `${quickScreenSourceIds.length} source${quickScreenSourceIds.length === 1 ? '' : 's'}`,
      ),
      createDetail('Source ids', researchCase.source_ids.length === 0 ? 'No source IDs recorded' : researchCase.source_ids.join(', ')),
    ),
  )
}

// ── Deep dive collapsible (preserved for unit-test assertions, lives inside audit details) ──


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

// B6 (book alignment): each reason maps onto the book's sell rules so the dossier speaks the
// owner's vocabulary — rule 10 (a rotten business → sell), rule 11 (the business changed → ok to
// leave), rule 12 (well beyond fair value → lock in a profit), rule 13 (a great business staying
// great → ok to hold; the guard-held/hold postures ARE rule 13 working).
const SELL_REASON_CODE_LABEL: Record<string, string> = {
  thesis_broken: 'rule 10 (rotten) / rule 11 (changed) — the durable advantage or the bet no longer holds: sell or leave',
  permanent_impairment: 'rule 10 (rotten) — permanent impairment; the loss is not recoverable inside the thesis',
  valuation_inverted: 'rule 12 (lock in a profit) — price reached / exceeded the frozen intrinsic value',
  better_opportunity: 'better opportunity — a materially higher net OE yield clears the switching hurdle',
  original_mistake: 'original mistake — the underwriting was wrong from the start; admit it and exit',
  minimum_hold_released: 'minimum-hold guard released the review',
  minimum_hold_active: 'rule 13 (great stays great) — the guard is holding a fixable problem inside the window',
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
  // Review-and-promote: the dossier above (bear case, key wrong assumption, thesis-break triggers) IS the
  // analysis the decision rests on. The control is a single explicit "Promote to watchlist" button — the
  // human's click is the authored transition. No thesis re-authoring, no checklist gate (the server sources
  // the audit/thesis provenance for the ledger event).
  return createElement(WatchlistPromotionForm, {
    researchCaseId: researchCase.research_case_id,
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

function resolveValuationChipColor(status?: string): ChipColors {
  if (status === 'FAIR' || status === 'UNDERVALUED') return { bg: 'rgba(34, 197, 94, 0.14)', border: 'rgba(134, 239, 172, 0.38)', text: '#bbf7d0' }
  if (status === 'EXPENSIVE') return { bg: 'rgba(214, 178, 94, 0.14)', border: 'rgba(243, 223, 177, 0.36)', text: '#f0d999' }
  if (status === 'OVERVALUED') return { bg: 'rgba(239, 68, 68, 0.14)', border: 'rgba(252, 165, 165, 0.36)', text: '#fecaca' }
  return { bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.28)', text: 'var(--owl-color-muted)' }
}

// ── Lane labels (full, with " lane" suffix, used in deep-dive section) ────────

// Short labels for the visible specialist grid (no " lane" suffix)
function deepDiveLaneShortLabel(lane?: string): string {
  if (lane === 'understand') return 'Understand the business'
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
    || researchCase.shariah_gate !== undefined
    || researchCase.circle_competence !== undefined
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


function createDetail(label: string, value: string) {
  return createElement(
    'p',
    { style: { color: '#cbd5e1', margin: '0.55rem 0 0' } },
    createElement('strong', null, `${label}: `),
    value,
  )
}
