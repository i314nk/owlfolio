import type { AppConfig } from '@owlfolio/shared'

/**
 * Two-state mode guard. `unconfigured` is the explicit "not yet chosen" state for a fresh install (see
 * `@owlfolio/shared` `owlfolioModeValues`). Pages must FIRST short-circuit on `isUnconfigured`, because
 * an unconfigured app has no chosen mode and no ledger: it must steer the user to setup, never a
 * misleading empty personal view that looks like a configured-but-empty workflow.
 */
export function isUnconfigured(config: Pick<AppConfig, 'mode'>): boolean {
  return config.mode === 'unconfigured'
}

/**
 * View-time "nothing hooked up" gate. A fresh/unconfigured app renders the honest "connect a provider"
 * surfaces rather than an empty personal view. (A stale on-disk `"mode":"demo"` from before demo mode
 * was removed is already coerced to `unconfigured` at load time.) View-only — never mutates config.
 */
export function isUnconfiguredForUser(
  config: Pick<AppConfig, 'mode'>,
  _env: { readonly [key: string]: string | undefined } = process.env,
): boolean {
  return isUnconfigured(config)
}
