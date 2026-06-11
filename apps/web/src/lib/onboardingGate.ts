import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { projectInvestableCapital } from '@owlfolio/ledger/projections/investableCapitalProjection'

import { isEnvKeySet, type EnvKeyOptions } from './envKeys'
import { buildOnboardingGate, LLM_API_KEY_GROUPS, MARKET_DATA_ENV_KEY, type OnboardingGate } from './providerKeys'
import { projectConnectedProviders } from './providerConnections'

/**
 * Server-side evaluation of the onboarding gate against the real sources of
 * truth: the ledger (connected providers + investable capital) and the local
 * `.env` (market-data key). The deep-dive start path composes this with the
 * existing `research_engine_enabled` switch and refuses with a NAMED missing
 * item when incomplete.
 */

export type EvaluateOnboardingGateArgs = {
  /** The personal-local ledger path, or undefined when not initialized. */
  ledgerPath: string | undefined
  envKeyOptions?: EnvKeyOptions
  /** Process env (injectable for tests) — a market-data key here also satisfies the gate. */
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
  const [ledgerFrontierLlm, hasCapital] = await readLedgerSignals(args.ledgerPath)
  const hasFrontierLlm = ledgerFrontierLlm || args.configuredProviderReady === true
  const processEnv = args.processEnv ?? (process.env as Record<string, string | undefined>)
  const marketKeyFromProcessEnv = (processEnv[MARKET_DATA_ENV_KEY] ?? '').length > 0
  const hasMarketDataKey = marketKeyFromProcessEnv || (await isEnvKeySet(MARKET_DATA_ENV_KEY, args.envKeyOptions ?? {}))

  return buildOnboardingGate({
    has_frontier_llm_connected: hasFrontierLlm,
    has_market_data_key: hasMarketDataKey,
    has_investable_capital: hasCapital,
  })
}

async function readLedgerSignals(ledgerPath: string | undefined): Promise<[boolean, boolean]> {
  if (ledgerPath === undefined) {
    return [false, false]
  }

  const store = new SQLiteEventStore(ledgerPath)
  try {
    const events = await store.list()
    const connected = projectConnectedProviders(events)
    const hasFrontierLlm = connected.some((providerId) => FRONTIER_LLM_GROUP_IDS.has(providerId))
    const hasCapital = projectInvestableCapital(events) !== undefined
    return [hasFrontierLlm, hasCapital]
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
