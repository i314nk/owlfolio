/**
 * Next.js startup hook (runs once, before the server handles requests).
 *
 * Bridges the local env file (`~/.owlfolio/.env`, written by the providers page) into `process.env` so a
 * saved credential is usable by the RUNTIME — the research-run gate, the spawned worker (it inherits this
 * env), and the provider adapters — not just the readiness UI. Shell/exported vars still win. Without this a
 * key saved via the UI reads as "connected" on the providers page but "not set" when a run starts.
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime can read the local file; the Edge runtime has no fs access.
  // The import is deferred INSIDE this guard so Turbopack never bundles the fs/os-backed envKeys module
  // for the Edge instrumentation runtime (a static top-level import fails to compile there).
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return
  }
  try {
    const { hydrateProcessEnvFromEnvKeys } = await import('@owlfolio/onboarding/envKeys')
    const hydrated = await hydrateProcessEnvFromEnvKeys()
    if (hydrated.length > 0) {
      // Log NAMES only — never values (security invariant).
      console.info(`[owlfolio] loaded ${hydrated.length} provider key(s) from the local env file: ${hydrated.join(', ')}`)
    }
  } catch (error) {
    // Never block startup on an env-file read issue; the readiness overlay + manual export remain fallbacks.
    console.warn('[owlfolio] local env-file hydration skipped:', error instanceof Error ? error.message : error)
  }
}
