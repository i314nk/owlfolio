// `owlfolio doctor` — read-only diagnostics. Prints PASS/WARN/FAIL lines for config, the credential
// file (+ 0600 perms), provider readiness, the ledger, certification reports, and the onboarding gate.
// Exit code reflects the worst level (FAIL → 1). Never prompts; safe headless.
import { stat } from 'node:fs/promises'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { resolveEnvKeyFilePath } from '@owlfolio/onboarding/envKeys'
import { getOnboardingState, getProviderReadinessSnapshot } from '@owlfolio/onboarding/onboarding'
import { evaluateOnboardingGate } from '@owlfolio/onboarding/onboardingGate'
import { getLatestProviderCertificationReports } from '@owlfolio/onboarding/providerStatus'

import type { CliContext } from './context'
import { effectiveEnv } from './effectiveEnv'

type Level = 'PASS' | 'WARN' | 'FAIL'

export async function runDoctor(ctx: CliContext): Promise<number> {
  const { out, cwd, env } = ctx
  const merged = await effectiveEnv(env)
  const levels: Level[] = []
  const line = (level: Level, label: string, detail: string): void => {
    levels.push(level)
    out(`  [${level}] ${label}${detail.length === 0 ? '' : ` — ${detail}`}`)
  }

  out('owlfolio doctor')

  const { config, is_initialized } = await getOnboardingState({ cwd, env })

  // Configuration
  if (config.mode === 'unconfigured') {
    line('FAIL', 'Configuration', 'unconfigured — run `owlfolio start`')
  } else {
    line('PASS', 'Configuration', `mode ${config.mode}, provider ${config.provider.provider_id}`)
  }

  // Credential file + permissions
  const envPath = resolveEnvKeyFilePath({ env })
  try {
    const fileStat = await stat(envPath)
    const mode = fileStat.mode & 0o777
    if (mode === 0o600) {
      line('PASS', 'Credential file', `${envPath} (0600)`)
    } else {
      line('WARN', 'Credential file', `${envPath} is ${mode.toString(8)} (expected 600)`)
    }
  } catch {
    line('PASS', 'Credential file', 'none yet (no secrets stored)')
  }

  // Provider readiness
  let providerReady = false
  if (config.mode !== 'unconfigured') {
    try {
      const snapshot = await getProviderReadinessSnapshot(config, { cwd, env: merged })
      providerReady = snapshot.is_ready
      if (snapshot.is_ready) {
        line('PASS', 'Provider readiness', `${config.provider.provider_id} ready (${snapshot.support_level})`)
      } else {
        line('WARN', 'Provider readiness', `${config.provider.provider_id} not ready — ${snapshot.status_label}`)
      }
    } catch {
      line('WARN', 'Provider readiness', 'configured provider is not in the catalog')
    }
  }

  // Ledger
  if (config.ledger_path !== undefined && is_initialized) {
    try {
      const store = new SQLiteEventStore(config.ledger_path)
      const count = (await store.list()).length
      store.close()
      line('PASS', 'Ledger', `${count} events`)
    } catch (error) {
      line('FAIL', 'Ledger', `unreadable: ${error instanceof Error ? error.message : String(error)}`)
    }
  } else if (config.mode !== 'unconfigured') {
    line('WARN', 'Ledger', 'not initialized')
  }

  // Certification reports (informational — provider claims fall back to the catalog without them)
  try {
    const reports = await getLatestProviderCertificationReports({ cwd, env })
    if (reports.length > 0) {
      line('PASS', 'Certification reports', `${reports.length} present`)
    } else {
      line('WARN', 'Certification reports', 'none recorded')
    }
  } catch {
    line('WARN', 'Certification reports', 'unreadable')
  }

  // Onboarding gate
  const gate = await evaluateOnboardingGate({ ledgerPath: config.ledger_path, configuredProviderReady: providerReady })
  if (gate.is_complete) {
    line('PASS', 'Onboarding gate', 'complete')
  } else {
    line('WARN', 'Onboarding gate', `incomplete: ${gate.missing_items.map((item) => item.label).join(', ')}`)
  }

  const worst: Level = levels.includes('FAIL') ? 'FAIL' : levels.includes('WARN') ? 'WARN' : 'PASS'
  out('')
  out(`  Result: ${worst === 'FAIL' ? 'problems found' : worst === 'WARN' ? 'warnings' : 'all good'}`)
  return worst === 'FAIL' ? 1 : 0
}
