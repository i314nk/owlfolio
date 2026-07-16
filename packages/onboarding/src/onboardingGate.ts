import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { type EnvKeyOptions } from './envKeys'
import { buildOnboardingGate, LLM_API_KEY_GROUPS, type OnboardingGate } from './providerKeys'
import { projectConnectedProviders } from './providerConnections'

/**
 * Server-side evaluation of the onboarding gate against the real sources of
 * truth: the ledger (connected providers). The deep-dive
 * start path composes this with the existing `research_engine_enabled` switch and
 * refuses with a NAMED missing item when incomplete.
 *
 * The gate is frontier-LLM-connected ONLY (scale-down S5). A market-data
 * API key is NOT a prerequisite (the owner uses SEC EDGAR directly), so it never
 * blocks research even though it remains a settable tool key on the providers page.
 */

export type EvaluateOnboardingGateArgs = {
  /** The personal-local ledger path, or undefined when not initialized. */
  ledgerPath: string | undefined
  /**
   * Retained for call-site compatibility; the gate no longer reads any env key.
   * @deprecated The market-data key is no longer part of the gate.
   */
  envKeyOptions?: EnvKeyOptions
  /**
   * Retained for call-site compatibility; the gate no longer reads any env key.
   * @deprecated The market-data key is no longer part of the gate.
   */
  processEnv?: Record<string, string | undefined>
  /**
   * When the configured provider is already ready (readiness verified upstream),
   * the frontier-LLM checklist item is satisfied without needing a ledger
   * provider-connected event — readiness IS the connection. Defaults to false.
   */
  configuredProviderReady?: boolean
}

const FRONTIER_LLM_GROUP_IDS = new Set(LLM_API_KEY_GROUPS.map((group) => group.id))

export async function evaluateOnboardingGate(args: EvaluateOnboardingGateArgs): Promise<OnboardingGate> {
  const ledgerFrontierLlm = await readLedgerSignals(args.ledgerPath)
  const hasFrontierLlm = ledgerFrontierLlm || args.configuredProviderReady === true

  return buildOnboardingGate({
    has_frontier_llm_connected: hasFrontierLlm,
  })
}

async function readLedgerSignals(ledgerPath: string | undefined): Promise<boolean> {
  if (ledgerPath === undefined) {
    return false
  }

  const store = new SQLiteEventStore(ledgerPath)
  try {
    const events = await store.list()
    const connected = projectConnectedProviders(events)
    return connected.some((providerId) => FRONTIER_LLM_GROUP_IDS.has(providerId))
  } finally {
    store.close()
  }
}

/**
 * Throw a clear, item-naming error when the onboarding gate is incomplete.
 * Wired into the deep-dive start path so the pipeline refuses to start with the
 * checklist incomplete and says exactly which item is missing.
 */
export async function assertOnboardingGateAllowsDeepDive(args: EvaluateOnboardingGateArgs): Promise<void> {
  const gate = await evaluateOnboardingGate(args)
  if (!gate.is_complete) {
    throw new Error(gate.blocked_reason ?? 'Cannot start a deep dive: onboarding is incomplete.')
  }
}
