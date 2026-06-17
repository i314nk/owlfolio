import type { AppConfig } from '@owlfolio/shared'

import { shouldUseTestDemoDefault } from './appConfigStore'

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

/**
 * View-time "nothing hooked up" gate. A persisted `demo` config in PRODUCTION is treated as
 * unconfigured so the UI renders the honest "connect a provider" surfaces instead of seeded demo
 * data (demo is a test-only deterministic harness). Test mode keeps demo as a legitimate configured
 * mode so e2e/unit suites still render demo data. This is a view-only decision — it never mutates or
 * persists the config. Write paths must keep using the literal mode checks (handled separately).
 */
export function isUnconfiguredForUser(
  config: Pick<AppConfig, 'mode'>,
  env: { readonly [key: string]: string | undefined } = process.env,
): boolean {
  return isUnconfigured(config) || (config.mode === 'demo' && !shouldUseTestDemoDefault({ ...env }))
}
