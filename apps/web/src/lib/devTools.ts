import type { AppConfig } from '@owlfolio/shared'

/**
 * Environment surface read by the dev-tools gate. Only the two flags below matter; everything else on
 * `process.env` is ignored so the gate stays a small, auditable predicate.
 */
export type DevToolsEnv = {
  [key: string]: string | undefined
  OWLFOLIO_TEST_MODE?: string
  OWLFOLIO_DEV_TOOLS?: string
}

const PLAYWRIGHT_TEST_MODE = 'playwright'
const DEV_TOOLS_OPT_IN = '1'

/**
 * Server-truth gate for the DESTRUCTIVE bulk reset of research/ledger state.
 *
 * This is the crux of the safety design: the wholesale clear must NOT appear in normal personal-local
 * operation. It is enabled ONLY when one of the following is true:
 *
 *  - the e2e test harness is driving the app (`OWLFOLIO_TEST_MODE === 'playwright'`); or
 *  - the operator has explicitly opted into dev tools (`OWLFOLIO_DEV_TOOLS === '1'`); or
 *
 * A plain `personal-local` (or `unconfigured`) environment WITHOUT the dev opt-in returns `false`, so the
 * API route 404s and the UI control renders nothing. This is intentionally distinct from the append-only
 * single-run archive, which is always available in personal-local.
 */
export function isResearchResetEnabled({
  env,
  mode: _mode,
}: {
  env: DevToolsEnv
  mode: AppConfig['mode']
}): boolean {
  if (env.OWLFOLIO_TEST_MODE === PLAYWRIGHT_TEST_MODE) {
    return true
  }

  if (env.OWLFOLIO_DEV_TOOLS === DEV_TOOLS_OPT_IN) {
    return true
  }

  return false
}
