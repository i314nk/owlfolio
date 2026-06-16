import type { AppConfig } from '@owlfolio/shared'

/**
 * Three-state mode guard. `unconfigured` is the explicit "not yet chosen" state for a real fresh
 * install (see `@owlfolio/shared` `owlfolioModeValues`). Pages that branch `demo ? … : personal`
 * must FIRST short-circuit on `isUnconfigured`, because an unconfigured app has no chosen mode and no
 * ledger: it must steer the user to setup, never render demo data and never a misleading empty
 * personal view that looks like a configured-but-empty workflow.
 */
export function isUnconfigured(config: Pick<AppConfig, 'mode'>): boolean {
  return config.mode === 'unconfigured'
}
