import { createElement } from 'react'

import { SourceChip } from './designSystem'
import { StatusBadge } from './StatusBadge'
import type { AppResearchCase, AppSourceEvidence, WorkflowMode } from '../lib/workflow'

export type ResearchCasePanelProps = {
  researchCase: AppResearchCase
  mode?: WorkflowMode
}

const cardStyle = {
  background: 'rgba(255, 255, 255, 0.035)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: '1rem',
  boxShadow: '0 18px 50px rgba(0, 0, 0, 0.18)',
  padding: '1.25rem',
}

const labelStyle = {
  color: '#9aa4b7',
  fontSize: '0.78rem',
  fontWeight: 800,
  margin: 0,
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

export function ResearchCasePanel({ researchCase, mode = 'demo' }: ResearchCasePanelProps) {
  const canPromoteToWatchlist = mode === 'personal-local'
    && researchCase.stage === 'decision_drafted'
    && researchCase.decision !== undefined
    && researchCase.decision_id !== undefined
  const displayName = researchCase.ticker ?? researchCase.company_id ?? researchCase.research_case_id
  const verdict = researchCase.investment_verdict ?? researchCase.decision ?? 'Research pending'
  const verdictReason = createVerdictReason(researchCase)
  const nextAction = researchCase.next_required_action ?? 'Continue the review workflow'

  return createElement(
    'section',
    {
      style: {
        display: 'grid',
        gap: '0.85rem',
      },
    },
    // ── 1. Verdict hero ──────────────────────────────────────────────────
    createElement(
      'header',
      {
        style: {
          background: 'linear-gradient(135deg, rgba(124, 140, 255, 0.14) 0%, rgba(10, 132, 255, 0.08) 100%)',
          border: '1px solid rgba(148, 163, 184, 0.18)',
          borderRadius: '1.25rem',
          display: 'grid',
          gap: '0.75rem',
          padding: '1.25rem 1.5rem',
        },
      },
      createElement('p', { style: labelStyle }, 'Research dossier'),
      // Ticker + verdict badge row
      createElement(
        'div',
        { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between' } },
        createElement(
          'div',
          { style: { display: 'grid', gap: '0.35rem', maxWidth: '48rem' } },
          createElement(
            'h1',
            { style: { fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: 1, margin: 0 } },
            displayName,
          ),
          createElement(
            'p',
            { style: { color: '#9aa4b7', fontSize: '0.95rem', margin: 0 } },
            `Company: ${researchCase.company_id ?? 'Unknown company'}`,
          ),
        ),
        // Verdict chip — prominent
        createElement(
          'span',
          {
            style: {
              background: 'rgba(52, 211, 153, 0.16)',
              border: '1px solid rgba(52, 211, 153, 0.42)',
              borderRadius: '999px',
              color: '#f7f8ff',
              fontSize: '1.05rem',
              fontWeight: 900,
              letterSpacing: '0.04em',
              padding: '0.55rem 1rem',
            },
          },
          verdict,
        ),
      ),
      // One-line thesis
      createElement(
        'p',
        {
          style: {
            color: '#dbe3ef',
            fontSize: '0.97rem',
            lineHeight: 1.5,
            margin: 0,
            maxWidth: '70ch',
          },
        },
        createConciseDossierSummary(
          firstNonEmpty([
            researchCase.thesis_summary,
            researchCase.reason,
            researchCase.evidence_summary,
          ]) ?? 'No investment thesis drafted yet.',
          researchCase.ticker ?? researchCase.company_id,
        ),
      ),
      // Status chip row
      createElement(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: '0.45rem' } },
        createStatusChip('Shariah', researchCase.shariah_status ?? 'Pending', resolveShariahChipColor(researchCase.shariah_status)),
        createStatusChip('Strategy', researchCase.strategy_compliance ?? 'Pending', resolveComplianceChipColor(researchCase.strategy_compliance)),
        createStatusChip('Valuation', researchCase.valuation_status ?? 'Pending', resolveValuationChipColor(researchCase.valuation_status)),
        createStatusChip('Next', nextAction.length > 55 ? `${nextAction.slice(0, 52).replace(/\s+\S*$/, '')}…` : nextAction, { bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.28)', text: '#c7d2fe' }),
      ),
      // Verdict summary sub-section
      createElement(
        'section',
        { style: { borderTop: '1px solid rgba(148, 163, 184, 0.12)', display: 'grid', gap: '0.55rem', paddingTop: '0.65rem' } },
        createElement('p', { style: labelStyle }, 'Verdict summary'),
        createElement(
          'p',
          { style: { color: '#f7f8ff', fontSize: '1rem', lineHeight: 1.55, margin: 0 } },
          verdictReason,
        ),
        createElement(
          'p',
          { style: { color: '#c7d2fe', fontSize: '0.95rem', fontWeight: 850, margin: 0 } },
          createElement('strong', null, 'Next action: '),
          nextAction,
        ),
      ),
    ),
    // ── 2. Watchlist promotion (personal-local only) ─────────────────────
    canPromoteToWatchlist ? createWatchlistPromotionAction(researchCase.research_case_id) : null,
    // ── 3. Four summary cards (always visible) ───────────────────────────
    createResearchDossier(researchCase),
    // ── 4. Specialist details (collapsed) ────────────────────────────────
    createQuickScreenCollapsible(researchCase),
    createDeepDiveCollapsible(researchCase),
    // ── 5. Evidence and audit details (collapsed, e2e anchor preserved) ──
    createEvidenceAndAuditDetails(researchCase),
  )
}

// ── Status chip helpers ──────────────────────────────────────────────────────

type ChipColors = { bg: string; border: string; text: string }

function resolveShariahChipColor(status?: string): ChipColors {
  if (status === 'COMPLIANT') return { bg: 'rgba(34, 197, 94, 0.14)', border: 'rgba(134, 239, 172, 0.38)', text: '#bbf7d0' }
  if (status === 'CONDITIONAL') return { bg: 'rgba(214, 178, 94, 0.14)', border: 'rgba(243, 223, 177, 0.36)', text: '#f3dfb1' }
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
  if (status === 'EXPENSIVE') return { bg: 'rgba(239, 68, 68, 0.14)', border: 'rgba(252, 165, 165, 0.36)', text: '#fecaca' }
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

// ── Verdict reason ────────────────────────────────────────────────────────────

function createVerdictReason(researchCase: AppResearchCase): string {
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

// ── Four summary cards (always visible) ──────────────────────────────────────

function createResearchDossier(researchCase: AppResearchCase) {
  const fullThesis = firstNonEmpty([
    researchCase.thesis_summary,
    researchCase.reason,
    researchCase.evidence_summary,
  ]) ?? 'No investment thesis has been drafted yet.'
  const thesis = createConciseDossierSummary(fullThesis, researchCase.ticker ?? researchCase.company_id)
  const valuationRationale = researchCase.valuation_rationale?.trim().length
    ? researchCase.valuation_rationale
    : createLegacyValuationRationale(researchCase)
  const shariahRationale = researchCase.shariah_rationale?.trim().length
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
    { className: 'owl-workflow-card', style: { ...cardStyle, display: 'grid', gap: '0.75rem' } },
    createElement('p', { style: labelStyle }, 'Dossier cards'),
    createElement('h2', { style: { fontSize: '1.25rem', margin: 0 } }, 'Decision evidence'),
    createElement(
      'div',
      {
        style: {
          alignItems: 'start',
          display: 'grid',
          gap: '0.65rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        },
      },
      createDossierCard('Thesis', thesis, undefined, { note: 'Full thesis available in the disclosure below.' }),
      createDossierCard('Valuation', valuationRationale, researchCase.valuation_status),
      createDossierCard('Shariah / compliance', shariahRationale, researchCase.shariah_status),
      createDossierCard('Risks / open questions', [...risks, ...openQuestions]),
    ),
    createFullThesisDisclosure(fullThesis, thesis),
  )
}

function createLegacyValuationRationale(researchCase: AppResearchCase): string {
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
  if (fullThesis === conciseThesis) {
    return null
  }

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

// ── Quick screen collapsible ──────────────────────────────────────────────────

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

// ── Deep dive collapsible ─────────────────────────────────────────────────────

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

// ── Evidence and audit details (keeps existing label for e2e) ─────────────────

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

function humanizeAuditSourceId(sourceId: string): string {
  const tokens = sourceId
    .replace(/^src_/, '')
    .split(/[_\s-]+/)
    .filter((token) => token.length > 0)

  if (tokens.length === 0) {
    return 'Audit source recorded'
  }

  return tokens.map((token, index) => {
    if (/^(?:fy\d+|q\d+|\d+k|\d{4})$/i.test(token)) {
      return token.toUpperCase()
    }

    const nextToken = tokens[index + 1]
    const looksLikeTickerPrefix = index === 0 && /^(?:fy\d+|q\d+|\d+k|proxy|market)$/i.test(nextToken ?? '')
    if (looksLikeTickerPrefix) {
      return token.toUpperCase()
    }

    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
  }).join(' ')
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0)
}

function createCurrentWorkflowStatus(researchCase: AppResearchCase) {
  const statusLabel = describeWorkflowStatus(researchCase)

  return createElement(
    'section',
    { className: 'owl-workflow-card', style: cardStyle },
    createElement('p', { style: labelStyle }, 'Workflow audit status'),
    createElement('p', { style: { color: '#f7f8ff', fontSize: '1.25rem', fontWeight: 900, margin: '0.35rem 0 0' } }, statusLabel),
    createElement('p', { style: { color: '#9aa4b7', fontSize: '0.9rem', margin: '0.55rem 0 0' } }, `Audit stage: ${researchCase.stage}`),
  )
}

function describeWorkflowStatus(researchCase: AppResearchCase): string {
  const stageLabel = humanizeToken(researchCase.stage)
  const actionHint = researchCase.next_required_action === undefined
    ? 'Workflow review required'
    : 'User action required'

  return `${stageLabel} · ${actionHint}`
}

type ResearchFindingCard = NonNullable<AppResearchCase['specialist_findings']>[number]

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

function legacyManagementDigest(_researchCase: AppResearchCase): string {
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
      finding_summary: legacyManagementDigest(researchCase),
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
      createDetail('Management / capital allocation', researchCase.management_capital_allocation ?? legacyManagementDigest(researchCase)),
      createDetail('Financial quality', researchCase.financial_quality ?? legacyFinancialQualityDigest(researchCase)),
      createDetail('Shariah / data availability', researchCase.shariah_status ?? 'Pending'),
      createDetail('Red flags', redFlags.join('; ')),
      createDetail('Uncertainty / caveats', `${researchCase.confidence ?? 'Pending'} — ${caveats.join('; ')}`),
      createDetail('Valuation belongs in deep dive', researchCase.valuation_sanity ?? 'Owner-earnings valuation runs in deep dive.'),
      createDetail('Source ids', researchCase.source_ids.length === 0 ? 'No source IDs recorded' : researchCase.source_ids.join(', ')),
    ),
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

function createDeepDiveFindingCard(finding: NonNullable<AppResearchCase['specialist_findings']>[number]) {
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

function deepDiveLaneLabel(lane?: string): string {
  if (lane === 'business_quality') {
    return 'Business quality lane'
  }
  if (lane === 'moat') {
    return 'Moat lane'
  }
  if (lane === 'management') {
    return 'Management lane'
  }
  if (lane === 'financial_quality') {
    return 'Financial quality lane'
  }
  if (lane === 'shariah') {
    return 'Shariah lane'
  }
  if (lane === 'risks' || lane === 'risk') {
    return 'Risk lane'
  }
  if (lane === 'valuation') {
    return 'Owner earnings buy-price lane'
  }

  return `${humanizeToken(lane ?? 'unknown')} lane`
}

function createConciseDossierSummary(thesis: string, subject?: string): string {
  const compact = thesis.trim().replace(/\s+/g, ' ')
  if (compact.length <= 110) {
    return compact
  }

  const withoutSubject = removeSubjectLeadIn(compact, subject)
  const firstContrast = withoutSubject.split(/,\s+but\s+/i)[0]?.trim()
  const firstSentence = withoutSubject.split(/\.\s+/)[0]?.trim()
  const summaryCandidate = firstContrast !== undefined && firstContrast.length >= 24
    ? firstContrast
    : firstSentence !== undefined && firstSentence.length >= 24
      ? firstSentence
      : withoutSubject

  if (summaryCandidate.length <= 110) {
    return ensureTerminalPunctuation(capitalizeSentence(summaryCandidate))
  }

  const clipped = summaryCandidate.slice(0, 105).replace(/\s+\S*$/, '').trim()
  return `${capitalizeSentence(clipped)}…`
}

function removeSubjectLeadIn(value: string, subject?: string): string {
  if (subject === undefined || subject.trim().length === 0) {
    return value
  }

  const pattern = new RegExp(`^${escapeRegExp(subject.trim())}\\s+(remains|is|appears|looks)\\s+(an?|the)?\\s*`, 'i')
  const withoutKnownSubject = value.replace(pattern, '')
  if (withoutKnownSubject !== value) {
    return withoutKnownSubject
  }

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

function describeGateEvidence(label: string, sourceIds: string[]) {
  if (sourceIds.length === 0) {
    return `${label} is awaiting source-backed evidence.`
  }

  return `${label} is tied to ${sourceIds.join(', ')}.`
}

function humanizeToken(value: string): string {
  const words = value
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase())

  const firstWord = words.at(0)

  if (firstWord === undefined) {
    return value
  }

  return [`${firstWord.charAt(0).toUpperCase()}${firstWord.slice(1)}`, ...words.slice(1)].join(' ')
}

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

function createDetail(label: string, value: string) {
  return createElement(
    'p',
    { style: { color: '#cbd5e1', margin: '0.55rem 0 0' } },
    createElement('strong', null, `${label}: `),
    value,
  )
}
