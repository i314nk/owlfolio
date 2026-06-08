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
        gap: '1rem',
      },
    },
    createElement(
      'header',
      {
        style: {
          background: 'linear-gradient(135deg, rgba(124, 140, 255, 0.14) 0%, rgba(10, 132, 255, 0.08) 100%)',
          border: '1px solid rgba(148, 163, 184, 0.18)',
          borderRadius: '1.25rem',
          display: 'grid',
          gap: '1rem',
          padding: '1.5rem',
        },
      },
      createElement('p', { style: labelStyle }, 'Research dossier'),
      createElement(
        'div',
        { style: { alignItems: 'start', display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between' } },
        createElement(
          'div',
          { style: { display: 'grid', gap: '0.5rem', maxWidth: '48rem' } },
          createElement(
            'h1',
            { style: { fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: 1, margin: 0 } },
            displayName,
          ),
          createElement(
            'p',
            { style: { color: '#9aa4b7', fontSize: '1rem', margin: 0 } },
            `Company: ${researchCase.company_id ?? 'Unknown company'}`,
          ),
        ),
        createElement(
          'span',
          {
            style: {
              background: 'rgba(124, 140, 255, 0.18)',
              border: '1px solid rgba(199, 210, 254, 0.42)',
              borderRadius: '999px',
              color: '#f7f8ff',
              fontSize: '0.9rem',
              fontWeight: 900,
              padding: '0.5rem 0.8rem',
            },
          },
          verdict,
        ),
      ),
      createElement(
        'section',
        { style: { display: 'grid', gap: '0.85rem' } },
        createElement('p', { style: labelStyle }, 'Verdict summary'),
        createElement(
          'p',
          { style: { color: '#f7f8ff', fontSize: '1.1rem', lineHeight: 1.6, margin: 0 } },
          verdictReason,
        ),
        createElement(
          'p',
          { style: { color: '#c7d2fe', fontSize: '1rem', fontWeight: 850, margin: 0 } },
          createElement('strong', null, 'Next action: '),
          nextAction,
        ),
      ),
    ),
    canPromoteToWatchlist ? createWatchlistPromotionAction(researchCase.research_case_id) : null,
    createResearchDossier(researchCase),
    createQuickScreenPanel(researchCase),
    createEvidenceAndAuditDetails(researchCase),
  )
}

function createVerdictReason(researchCase: AppResearchCase): string {
  const verdict = researchCase.investment_verdict ?? researchCase.decision
  const valuation = researchCase.valuation_status
  const shariah = researchCase.shariah_status
  const strategy = researchCase.strategy_compliance

  if (verdict !== undefined) {
    const gates = [
      valuation === undefined ? undefined : `valuation ${valuation}`,
      shariah === undefined ? undefined : `Shariah ${shariah}`,
      strategy === undefined ? undefined : `strategy ${strategy}`,
    ].filter((gate): gate is string => gate !== undefined)

    if (gates.length > 0) {
      return `${verdict} based on ${gates.join(', ')}.`
    }
  }

  return firstNonEmpty([
    researchCase.evidence_summary,
    researchCase.reason,
    researchCase.thesis_summary,
  ]) ?? 'This dossier is waiting for a source-backed investment reason.'
}

function createResearchDossier(researchCase: AppResearchCase) {
  const fullThesis = firstNonEmpty([
    researchCase.thesis_summary,
    researchCase.reason,
    researchCase.evidence_summary,
  ]) ?? 'No investment thesis has been drafted yet.'
  const thesis = createConciseDossierSummary(fullThesis, researchCase.ticker ?? researchCase.company_id)
  const valuationRationale = researchCase.valuation_rationale?.trim().length
    ? researchCase.valuation_rationale
    : `Needs structured valuation detail. Current valuation gate: ${researchCase.valuation_status ?? 'Pending'}.`
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
    { className: 'owl-workflow-card', style: { ...cardStyle, display: 'grid', gap: '1rem' } },
    createElement('p', { style: labelStyle }, 'Dossier cards'),
    createElement('h2', { style: { fontSize: '1.45rem', margin: 0 } }, 'Decision evidence'),
    createElement(
      'div',
      {
        style: {
          alignItems: 'start',
          display: 'grid',
          gap: '0.85rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
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

function createDossierCard(label: string, content: string | string[], status?: string, options?: { note?: string }) {
  const contentItems = Array.isArray(content) ? content : [content]

  return createElement(
    'article',
    {
      'data-testid': `research-dossier-card-${slugifyDossierLabel(label)}`,
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
      createElement('h3', { style: { color: '#f7f8ff', fontSize: '1rem', margin: 0 } }, label),
      status === undefined ? null : createElement('span', { style: { color: '#c7d2fe', fontSize: '0.82rem', fontWeight: 900 } }, status),
    ),
    contentItems.length === 1
      ? createElement('p', { style: { color: '#dbe3ef', lineHeight: 1.55, margin: 0 } }, contentItems[0])
      : createElement(
        'ul',
        { style: { color: '#dbe3ef', display: 'grid', gap: '0.45rem', lineHeight: 1.45, margin: 0, paddingLeft: '1.1rem' } },
        ...contentItems.map((item) => createElement('li', { key: item }, item)),
      ),
    options?.note === undefined
      ? null
      : createElement('p', { style: { color: '#9aa4b7', fontSize: '0.86rem', fontWeight: 750, lineHeight: 1.45, margin: 0 } }, options.note),
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
        borderRadius: '0.95rem',
        padding: '1rem',
      },
    },
    createElement(
      'summary',
      {
        style: {
          color: '#c7d2fe',
          cursor: 'pointer',
          fontSize: '0.95rem',
          fontWeight: 900,
        },
      },
      'Full thesis',
    ),
    createElement(
      'p',
      { style: { color: '#dbe3ef', lineHeight: 1.6, margin: '0.85rem 0 0' } },
      fullThesis,
    ),
  )
}

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

function createQuickScreenPanel(researchCase: AppResearchCase) {
  if (researchCase.quick_screen_id === undefined && researchCase.screening_result === undefined) {
    return null
  }

  const strategyLabel = researchCase.strategy_version === undefined
    ? researchCase.strategy_id ?? 'Unknown strategy'
    : `${researchCase.strategy_id ?? 'unknown'}@${researchCase.strategy_version}`
  const redFlags = researchCase.red_flags === undefined || researchCase.red_flags.length === 0
    ? ['No red flags recorded']
    : researchCase.red_flags
  const caveats = researchCase.caveats === undefined || researchCase.caveats.length === 0
    ? ['No caveats recorded']
    : researchCase.caveats

  return createElement(
    'section',
    { className: 'owl-workflow-card', style: cardStyle },
    createElement('p', { style: labelStyle }, 'Quick screen'),
    createElement(
      'h2',
      { style: { fontSize: '1.35rem', margin: '0.35rem 0 0.6rem' } },
      'Single-agent company screen',
    ),
    createElement(
      'p',
      { style: { color: '#9aa4b7', margin: '0 0 1rem' } },
      'A selected-strategy first pass can recommend deep dive, pass, reject, or request more data. It does not mutate watchlist or holding state without explicit approval.',
    ),
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' } },
      createDetail('Selected strategy', strategyLabel),
      createDetail('Screening result', researchCase.screening_result ?? 'Pending'),
      createDetail('Business quality', researchCase.business_quality ?? 'Pending'),
      createDetail('Moat', researchCase.moat ?? 'Pending'),
      createDetail('Management / capital allocation', researchCase.management_capital_allocation ?? 'Pending'),
      createDetail('Financial quality', researchCase.financial_quality ?? 'Pending'),
      createDetail('Valuation sanity', researchCase.valuation_sanity ?? 'Pending'),
      createDetail('Shariah status', researchCase.shariah_status ?? 'Pending'),
      createDetail('Red flags', redFlags.join('; ')),
      createDetail('Confidence / caveats', `${researchCase.confidence ?? 'Pending'} — ${caveats.join('; ')}`),
      createDetail('Source ids', researchCase.source_ids.length === 0 ? 'No source IDs recorded' : researchCase.source_ids.join(', ')),
    ),
  )
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
        createDetail('Valuation gate', researchCase.valuation_status ?? 'Pending'),
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
