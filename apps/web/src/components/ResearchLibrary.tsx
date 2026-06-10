import { createElement, type CSSProperties, type ReactNode } from 'react'

import type { ResearchCaseProjection, ResearchCaseStage } from '@owlfolio/ledger/projections/researchCaseProjection'

import { OwlButtonLink, RouteHeader } from './designSystem'
import type { WorkflowMode } from '../lib/workflow'

function humanRelativeDate(isoString: string): string {
  const diffMs = Date.now() - Date.parse(isoString)
  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return isoString.slice(0, 10)
  }
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  const diffWeeks = Math.floor(diffDays / 7)
  if (diffWeeks < 5) return `${diffWeeks} ${diffWeeks === 1 ? 'week' : 'weeks'} ago`
  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 13) return `${diffMonths} ${diffMonths === 1 ? 'month' : 'months'} ago`
  const diffYears = Math.floor(diffDays / 365)
  return `${diffYears} ${diffYears === 1 ? 'year' : 'years'} ago`
}

export type ResearchLibraryProps = {
  mode: WorkflowMode
  selectedStrategyLabel: string
  cases: ResearchCaseProjection[]
}

// ── Verdict classification ───────────────────────────────────────────────────
type VerdictKind = 'buy' | 'watch' | 'avoid' | 'pass' | 'in_progress'

type VerdictChip = { label: string; bg: string; border: string; color: string }

const VERDICT_CHIP: Record<VerdictKind, VerdictChip> = {
  buy: { label: 'BUY', bg: 'rgba(34,197,94,0.13)', border: 'rgba(34,197,94,0.4)', color: '#bbf7d0' },
  watch: { label: 'WATCH', bg: 'rgba(240,180,41,0.12)', border: 'rgba(240,180,41,0.34)', color: '#f6d990' },
  avoid: { label: 'AVOID', bg: 'rgba(239,68,68,0.13)', border: 'rgba(239,68,68,0.4)', color: '#fca5a5' },
  pass: { label: 'PASS', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.3)', color: '#cbd5e1' },
  in_progress: { label: 'IN PROGRESS', bg: 'rgba(214,178,94,0.12)', border: 'rgba(214,178,94,0.34)', color: '#f0d999' },
}

const TERMINAL_STAGES: ReadonlySet<ResearchCaseStage> = new Set([
  'decision_drafted',
  'decision_pending',
  'analysis_drafted',
  'watchlist_draft',
  'watchlist',
  'holding',
  'rejected',
  'pass',
])

/**
 * Derive a coarse verdict for grouping. Honest about in-progress cases: a case
 * is only assigned a BUY/WATCH/AVOID/PASS bucket once it has reached a decision
 * or analysis stage. Anything earlier is "in progress".
 */
function verdictFor(researchCase: ResearchCaseProjection): VerdictKind {
  const raw = (researchCase.investment_verdict ?? researchCase.decision ?? '').toUpperCase()
  const stage = researchCase.stage

  if (stage === 'rejected') {
    return 'avoid'
  }
  if (stage === 'pass') {
    return 'pass'
  }

  if (raw.includes('BUY')) {
    return 'buy'
  }
  if (raw.includes('AVOID') || raw.includes('REJECT')) {
    return 'avoid'
  }
  if (raw.includes('WATCH')) {
    return 'watch'
  }
  if (raw.includes('PASS')) {
    return 'pass'
  }

  // Watchlist / holding stages without an explicit verdict still read as WATCH/BUY signals.
  if (stage === 'holding') {
    return 'buy'
  }
  if (stage === 'watchlist' || stage === 'watchlist_draft') {
    return 'watch'
  }

  if (TERMINAL_STAGES.has(stage)) {
    return 'watch'
  }

  return 'in_progress'
}

const STAGE_LABEL: Partial<Record<ResearchCaseStage, string>> = {
  discovered: 'Discovered',
  quick_screened: 'Quick screened',
  awaiting_deep_dive_approval: 'Awaiting deep-dive approval',
  queued_for_deep_dive: 'Queued for deep dive',
  deep_dive_started: 'Deep dive started',
  specialist_finding_recorded: 'Specialist findings in progress',
  deep_dive_in_progress: 'Deep dive in progress',
  deep_dive_synthesis_drafted: 'Synthesis drafted',
  deep_dive_completed: 'Deep dive completed',
  deep_dive_complete: 'Deep dive completed',
  decision_pending: 'Decision pending',
  analysis_drafted: 'Analysis drafted',
  decision_drafted: 'Decision drafted',
  watchlist_draft: 'Watchlist draft',
  watchlist: 'On watchlist',
  holding: 'Open holding',
  rejected: 'Rejected',
  pass: 'Passed',
}

function stageLabel(stage: ResearchCaseStage): string {
  return STAGE_LABEL[stage] ?? stage
}

// ── Styles (gold-forward tokens; no blue/purple) ─────────────────────────────
const cardStyle: CSSProperties = {
  background: 'var(--owl-color-panel)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-panel)',
  padding: '1.15rem 1.3rem',
  boxShadow: 'var(--owl-shadow-panel)',
}

const monoLabel: CSSProperties = {
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'var(--owl-color-quiet)',
}

const groupHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  margin: '1.4rem 0 0.6rem',
}

const dossierLinkStyle: CSSProperties = {
  fontWeight: 800,
  color: 'var(--owl-color-gold-bright)',
  textDecoration: 'none',
  fontSize: 'var(--owl-text-md)',
}

const metaChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  padding: '0.18rem 0.5rem',
  borderRadius: '999px',
  fontSize: 'var(--owl-text-2xs)',
  fontWeight: 700,
  border: '1px solid var(--owl-color-border)',
  color: 'var(--owl-color-muted)',
  background: 'var(--owl-color-panel-elevated)',
}

function verdictChipNode(kind: VerdictKind): ReactNode {
  const chip = VERDICT_CHIP[kind]
  return createElement(
    'span',
    {
      role: 'status',
      'aria-label': `Verdict: ${chip.label}`,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.2rem 0.6rem',
        borderRadius: '999px',
        fontSize: 'var(--owl-text-2xs)',
        fontWeight: 800,
        letterSpacing: '0.04em',
        background: chip.bg,
        border: `1px solid ${chip.border}`,
        color: chip.color,
      },
    },
    chip.label,
  )
}

function metaChip(label: string, value: string): ReactNode {
  return createElement(
    'span',
    { style: metaChipStyle, key: label },
    createElement('span', { style: { color: 'var(--owl-color-quiet)' } }, label),
    createElement('span', { style: { color: 'var(--owl-color-text)' } }, value),
  )
}

function dossierCard(researchCase: ResearchCaseProjection): ReactNode {
  const ticker = researchCase.ticker ?? 'Untitled case'
  const company = researchCase.company_id
  const verdict = verdictFor(researchCase)
  const isInProgress = verdict === 'in_progress'
  const isTerminal = TERMINAL_STAGES.has(researchCase.stage)
  const relDate = humanRelativeDate(researchCase.updated_at)

  const chips: ReactNode[] = []
  if (researchCase.moat !== undefined) {
    chips.push(metaChip('moat', researchCase.moat))
  } else if (researchCase.valuation?.moat_class !== undefined) {
    chips.push(metaChip('moat', researchCase.valuation.moat_class))
  }
  if (researchCase.valuation_status !== undefined) {
    chips.push(metaChip('valuation', researchCase.valuation_status))
  } else if (researchCase.valuation_sanity !== undefined) {
    chips.push(metaChip('valuation', researchCase.valuation_sanity))
  }
  if (researchCase.shariah_status !== undefined) {
    chips.push(metaChip('shariah', researchCase.shariah_status))
  }
  // In-progress: add screening result + confidence if present
  if (isInProgress) {
    if (researchCase.screening_result !== undefined) {
      chips.push(metaChip('screen', researchCase.screening_result))
    }
    if (researchCase.confidence !== undefined) {
      chips.push(metaChip('confidence', researchCase.confidence))
    }
  }

  // Terminal verdict extra info
  const thesisSummary = isTerminal && researchCase.thesis_summary !== undefined
    ? researchCase.thesis_summary.length > 120
      ? `${researchCase.thesis_summary.slice(0, 120)}…`
      : researchCase.thesis_summary
    : undefined

  const buyPrice = isTerminal && researchCase.valuation?.buy_price_per_share !== undefined
    ? researchCase.valuation.buy_price_per_share
    : undefined

  return createElement(
    'article',
    {
      key: researchCase.research_case_id,
      'data-research-case-id': researchCase.research_case_id,
      style: { ...cardStyle, display: 'flex', flexDirection: 'column', gap: '0.6rem' },
    },
    createElement(
      'div',
      { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' } },
      createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '0.15rem' } },
        createElement(
          'a',
          {
            className: 'owl-focusable',
            href: `/research/${researchCase.research_case_id}`,
            style: dossierLinkStyle,
            'aria-label': `Open research dossier for ${ticker}`,
          },
          ticker,
        ),
        company !== undefined
          ? createElement('span', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)' } }, company)
          : null,
      ),
      verdictChipNode(verdict),
    ),
    chips.length > 0
      ? createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem' } }, ...chips)
      : null,
    // Thesis snippet for terminal-verdict cards
    thesisSummary !== undefined
      ? createElement('p', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: 0, fontStyle: 'italic' } }, thesisSummary)
      : null,
    // Buy price for terminal-verdict cards
    buyPrice !== undefined
      ? createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '0.4rem' } },
          createElement('span', { style: { ...monoLabel } }, 'Buy price'),
          createElement('span', { style: { color: 'var(--owl-color-accent-bright)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' } }, `$${buyPrice.toFixed(2)}`),
        )
      : null,
    // In-progress: "View in Pipeline →" link
    isInProgress
      ? createElement(
          'a',
          {
            className: 'owl-focusable',
            href: `/pipeline?case=${encodeURIComponent(researchCase.research_case_id)}`,
            style: { color: 'var(--owl-color-gold-bright)', fontWeight: 700, textDecoration: 'none', fontSize: 'var(--owl-text-sm)' },
          },
          'View in Pipeline →',
        )
      : null,
    createElement(
      'div',
      { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', marginTop: 'auto' } },
      createElement('span', { style: { ...monoLabel, color: 'var(--owl-color-quiet)' } }, stageLabel(researchCase.stage)),
      createElement('span', { style: { ...monoLabel, color: 'var(--owl-color-quiet)' } }, relDate),
    ),
  )
}

type LibraryGroup = { kind: VerdictKind; title: string; description: string }

const GROUP_ORDER: LibraryGroup[] = [
  { kind: 'in_progress', title: 'In progress', description: 'Cases still moving through quick screen, deep dive, or synthesis.' },
  { kind: 'buy', title: 'Buy candidates', description: 'Cases whose decision reads as a buy or an open holding.' },
  { kind: 'watch', title: 'Watch', description: 'Cases worth monitoring before any capital is committed.' },
  { kind: 'avoid', title: 'Avoided', description: 'Cases rejected on the quality, valuation, or Shariah gates.' },
  { kind: 'pass', title: 'Passed', description: 'Cases set aside without a watch or buy verdict.' },
]

function groupCard(group: LibraryGroup, cases: ResearchCaseProjection[]): ReactNode {
  return createElement(
    'section',
    { key: group.kind, 'aria-label': group.title },
    createElement(
      'div',
      { style: groupHeaderStyle },
      createElement(
        'div',
        null,
        createElement('h2', { style: { fontSize: 'var(--owl-text-md)', margin: 0, color: 'var(--owl-color-gold-bright)' } }, group.title),
        createElement('p', { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-sm)', margin: '0.2rem 0 0' } }, group.description),
      ),
      createElement('span', { style: metaChipStyle }, String(cases.length)),
    ),
    createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.85rem' } },
      ...cases.map(dossierCard),
    ),
  )
}

export function ResearchLibrary({ mode, selectedStrategyLabel, cases }: ResearchLibraryProps): ReactNode {
  // Latest version per company: keep only non-superseded cases, then dedupe by ticker keeping the highest version.
  const latestByTicker = new Map<string, ResearchCaseProjection>()
  for (const researchCase of cases) {
    if (researchCase.superseded) {
      continue
    }
    const key = (researchCase.ticker ?? researchCase.research_case_id).toUpperCase()
    const existing = latestByTicker.get(key)
    if (existing === undefined || researchCase.version > existing.version) {
      latestByTicker.set(key, researchCase)
    }
  }

  const latest = [...latestByTicker.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at))

  const grouped = new Map<VerdictKind, ResearchCaseProjection[]>()
  for (const researchCase of latest) {
    const kind = verdictFor(researchCase)
    const bucket = grouped.get(kind) ?? []
    bucket.push(researchCase)
    grouped.set(kind, bucket)
  }

  const newResearchAction = createElement(
    OwlButtonLink,
    { href: '/research/new', variant: 'primary' },
    'New research',
  )

  const intakeLink = createElement(
    'a',
    { className: 'owl-button owl-button-secondary owl-focusable', href: '/research/new' },
    'Manual ticker intake',
  )

  const pipelineLink = createElement(
    'a',
    {
      className: 'owl-focusable',
      href: '/pipeline',
      style: { color: 'var(--owl-color-gold-bright)', fontWeight: 700, textDecoration: 'none' },
    },
    'Watch live execution on the Pipeline →',
  )

  const populatedGroups = GROUP_ORDER.filter((group) => (grouped.get(group.kind) ?? []).length > 0)

  return createElement(
    'section',
    { style: { display: 'grid', gap: '0.4rem' } },
    createElement(RouteHeader, {
      kicker: 'Research',
      title: 'Research library',
      description:
        'Start new research and browse your dossiers. Each company shows its latest, non-superseded research case — grouped by verdict, with in-progress cases called out. Live stage execution lives on the Pipeline.',
    }),

    // New research + intake + live pipeline
    createElement(
      'div',
      { style: { ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: '0.9rem', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.6rem' } },
      createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '0.25rem' } },
        createElement('p', { style: { ...monoLabel, color: 'var(--owl-color-gold)', margin: 0 } }, 'Start a case'),
        createElement('p', { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-base)', margin: 0, maxWidth: '40rem' } }, 'Kick off a new research case from a ticker; the harness runs the quick screen and deep-dive swarm.'),
      ),
      createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' } }, newResearchAction, intakeLink),
    ),

    createElement(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', margin: '0.6rem 0 0' } },
      createElement('span', { style: metaChipStyle }, selectedStrategyLabel),
      pipelineLink,
    ),

    // The library
    latest.length === 0
      ? createElement(
          'div',
          { style: { ...cardStyle, color: 'var(--owl-color-muted)', marginTop: '0.8rem' } },
          createElement('p', { style: { margin: 0 } }, 'No research yet — start with Manual ticker intake.'),
        )
      : createElement(
          'div',
          { style: { display: 'grid', gap: '0.2rem' } },
          ...populatedGroups.map((group) => groupCard(group, grouped.get(group.kind) ?? [])),
        ),
  )
}
