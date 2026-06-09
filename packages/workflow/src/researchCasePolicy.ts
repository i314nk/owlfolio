/**
 * Research-case dedup / staleness policy for the Owlfolio workflow.
 *
 * - User re-runs always create a new version superseding the prior.
 * - Automated discovery deduplicates: reuse non-stale cases, version stale ones.
 * - Scheduled reanalysis (quarterly/annual) always creates a new version.
 */

export type ResearchTrigger = 'user' | 'automated_discovery' | 'scheduled_reanalysis'
export type ResearchCaseAction = 'create_first' | 'create_version' | 'reuse_existing'

const DEFAULT_REANALYSIS_CADENCE_DAYS = 90

/**
 * Returns true if the case created at `createdAt` is stale relative to `now`,
 * where staleness is defined as age >= cadenceDays.
 */
export function isResearchCaseStale(createdAt: string, now: Date, cadenceDays: number = DEFAULT_REANALYSIS_CADENCE_DAYS): boolean {
  const createdAtMs = new Date(createdAt).getTime()
  const nowMs = now.getTime()
  const ageDays = (nowMs - createdAtMs) / (1000 * 60 * 60 * 24)
  return ageDays >= cadenceDays
}

/**
 * Determines what action to take when a research run is triggered for a ticker.
 *
 * Rules:
 * - No latestCase → `create_first` (regardless of trigger).
 * - `user` → `create_version` (user re-runs always supersede; no dedup).
 * - `automated_discovery` → `reuse_existing` if latestCase exists and is NOT stale;
 *   otherwise `create_version`.
 * - `scheduled_reanalysis` → `create_version` (quarterly/annual always re-analyzes).
 */
export function selectResearchCaseAction(input: {
  trigger: ResearchTrigger
  latestCase?: { research_case_id: string; created_at: string; version: number }
  now: Date
  reanalysisCadenceDays?: number
}): ResearchCaseAction {
  const { trigger, latestCase, now, reanalysisCadenceDays = DEFAULT_REANALYSIS_CADENCE_DAYS } = input

  if (latestCase === undefined) {
    return 'create_first'
  }

  switch (trigger) {
    case 'user':
      return 'create_version'

    case 'automated_discovery': {
      const stale = isResearchCaseStale(latestCase.created_at, now, reanalysisCadenceDays)
      return stale ? 'create_version' : 'reuse_existing'
    }

    case 'scheduled_reanalysis':
      return 'create_version'
  }
}
