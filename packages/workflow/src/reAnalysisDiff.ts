// Pure, deterministic re-analysis diff (lifecycle-spec-v3 Module 10:
// "re-analysis supersedes prior case; diffs are first-class output — what changed
// since last case"). When a NEW research case supersedes a PRIOR one for the same
// company, this computes the structured field-level diff surfaced on the dossier.

export type ReAnalysisCaseSnapshot = {
  research_case_id: string
  investment_verdict?: string
  /** Price→verdict band: BUY-WINDOW | WATCH-FAIR | WATCH. */
  verdict_state?: string
  /** Moat tier. */
  moat_class?: string
  credited_g?: number
  fair_value_per_share?: number
  buy_price_per_share?: number
  shariah_status?: string
  /** Hard gates that passed. */
  gate_pass?: string[]
  /** Hard gates that failed. */
  gate_fail?: string[]
}

export type ReAnalysisFieldChange = {
  field: string
  from?: string | number | null
  to?: string | number | null
  note?: string
}

export type ReAnalysisDiff = {
  prior_research_case_id: string
  new_research_case_id: string
  has_changes: boolean
  changes: ReAnalysisFieldChange[]
}

function scalarChange<T extends string | number | undefined>(
  field: string,
  from: T,
  to: T,
): ReAnalysisFieldChange | undefined {
  if (from === to) return undefined
  return {
    field,
    from: from ?? null,
    to: to ?? null,
  }
}

function setDiff(prior: string[] | undefined, next: string[] | undefined): { added: string[]; removed: string[] } {
  const priorSet = new Set(prior ?? [])
  const nextSet = new Set(next ?? [])
  const added = [...nextSet].filter((value) => !priorSet.has(value))
  const removed = [...priorSet].filter((value) => !nextSet.has(value))
  return { added, removed }
}

export function computeReAnalysisDiff(prior: ReAnalysisCaseSnapshot, next: ReAnalysisCaseSnapshot): ReAnalysisDiff {
  const changes: ReAnalysisFieldChange[] = []

  const scalarFields: (keyof ReAnalysisCaseSnapshot)[] = [
    'investment_verdict',
    'verdict_state',
    'moat_class',
    'credited_g',
    'fair_value_per_share',
    'buy_price_per_share',
    'shariah_status',
  ]
  for (const field of scalarFields) {
    const change = scalarChange(field, prior[field] as string | number | undefined, next[field] as string | number | undefined)
    if (change !== undefined) changes.push(change)
  }

  // Gate pass/fail set change → a single structured entry naming the gates that
  // newly pass or newly fail (the integrity-relevant transitions).
  const passDiff = setDiff(prior.gate_pass, next.gate_pass)
  const failDiff = setDiff(prior.gate_fail, next.gate_fail)
  if (passDiff.added.length > 0 || passDiff.removed.length > 0 || failDiff.added.length > 0 || failDiff.removed.length > 0) {
    const notes: string[] = []
    if (failDiff.added.length > 0) notes.push(`newly failing: ${failDiff.added.join(', ')}`)
    if (failDiff.removed.length > 0) notes.push(`no longer failing: ${failDiff.removed.join(', ')}`)
    if (passDiff.added.length > 0) notes.push(`newly passing: ${passDiff.added.join(', ')}`)
    if (passDiff.removed.length > 0) notes.push(`no longer passing: ${passDiff.removed.join(', ')}`)
    changes.push({
      field: 'gates',
      from: (prior.gate_fail ?? []).join(', ') || 'none failing',
      to: (next.gate_fail ?? []).join(', ') || 'none failing',
      note: notes.join('; '),
    })
  }

  return {
    prior_research_case_id: prior.research_case_id,
    new_research_case_id: next.research_case_id,
    has_changes: changes.length > 0,
    changes,
  }
}
