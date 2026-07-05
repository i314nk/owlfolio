// `owlfolio status` — read-only. Loads app config and prints mode, provider + model, the
// effective support level (the honest, certification-bounded one — never the catalog claim),
// readiness, and the onboarding-gate state. Never prompts; safe to run headless.
import { getOnboardingState, getProviderReadinessSnapshot } from '@owlfolio/onboarding/onboarding'
import { evaluateOnboardingGate } from '@owlfolio/onboarding/onboardingGate'

import type { CliContext } from './context'
import { effectiveEnv } from './effectiveEnv'

export async function runStatus(ctx: CliContext): Promise<number> {
  const { out, cwd, env } = ctx
  const { config, is_initialized } = await getOnboardingState({ cwd, env })

  out('Owlfolio')
  out(`  Mode:      ${config.mode}${is_initialized ? ' · initialized' : ''}`)

  if (config.mode === 'unconfigured') {
    out('  Provider:  not selected yet')
    out('')
    out('  Run `owlfolio start` to launch the app and set up a provider in the browser.')
    return 0
  }

  const model = config.provider.model_id === undefined ? '' : ` · ${config.provider.model_id}`
  out(`  Provider:  ${config.provider.provider_id}${model}`)

  let readyIsTrue = false
  try {
    const readiness = await getProviderReadinessSnapshot(config, { cwd, env: await effectiveEnv(env) })
    readyIsTrue = readiness.is_ready
    out(`  Support:   ${readiness.support_level}`)
    out(`  Ready:     ${readiness.is_ready ? 'yes' : 'no'} — ${readiness.status_label}`)
  } catch {
    out('  Support:   unknown (provider not in catalog)')
  }

  const gate = await evaluateOnboardingGate({
    ledgerPath: config.ledger_path,
    configuredProviderReady: readyIsTrue,
  })
  out(`  Setup gate: ${gate.is_complete ? 'complete' : 'incomplete'}`)
  for (const item of gate.missing_items) {
    out(`    ✗ ${item.label}`)
  }
  if (!gate.is_complete) {
    out('')
    out('  Run `owlfolio start` and finish setup in the browser.')
  }
  return 0
}
