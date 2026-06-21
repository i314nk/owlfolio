import { spawn } from 'node:child_process'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import {
  buildCalibrationUniverseMemberAddedEvent,
  buildCalibrationUniverseMemberRemovedEvent,
  loadCalibrationUniverse,
  projectCalibrationUniverse,
  type CalibrationMarket,
  type CalibrationUniverse,
} from '@owlfolio/workflow/calibrationUniverse'

import type { OnboardingState } from './onboarding'

/**
 * Require an initialized personal-local workflow with a ledger path; throw otherwise. Shared by the
 * calibration curation/enqueue actions (they all write user-authored events to the personal ledger).
 */
function requirePersonalLedgerPath(state: OnboardingState): string {
  if (
    !state.is_initialized
    || state.config.mode !== 'personal-local'
    || state.config.ledger_path === undefined
  ) {
    throw new Error('Personal-local workflow is not initialized')
  }
  return state.config.ledger_path
}

/**
 * Append a user-authored calibration-universe curation event to the personal ledger, then return the
 * CURRENT projected universe (seed config + all member add/remove events). Curation is REVERSIBLE
 * list-editing recorded as a DIRECT user-authored event (Rule 1: the user authors by clicking) — there is
 * no draft-for-confirmation step. Idempotency is handled by the projection (re-adding an active ticker is a
 * no-op). The seed config is the default; removing a seed name tombstones it until it is re-added.
 */
async function appendCurationEvent(
  state: OnboardingState,
  event: ReturnType<typeof buildCalibrationUniverseMemberAddedEvent | typeof buildCalibrationUniverseMemberRemovedEvent>,
): Promise<CalibrationUniverse> {
  const ledgerPath = requirePersonalLedgerPath(state)
  const seed = loadCalibrationUniverse()
  if (seed === undefined) {
    throw new Error('Calibration universe config not found or invalid')
  }
  const store = new SQLiteEventStore(ledgerPath)
  try {
    await store.append(event)
    const events = await store.list()
    return projectCalibrationUniverse(seed, events)
  } finally {
    store.close()
  }
}

/**
 * Add a ticker to the calibration universe (user-authored `calibration_universe_member_added`). The ticker
 * is required (normalized upper-case); company + market are optional. Returns the updated projected universe.
 */
export async function addCalibrationUniverseMember(
  state: OnboardingState,
  args: { ticker: string; company?: string; market?: CalibrationMarket },
): Promise<CalibrationUniverse> {
  const ticker = args.ticker.trim()
  if (ticker.length === 0) {
    throw new Error('A ticker is required to add a calibration-universe member')
  }
  const market: CalibrationMarket | undefined = args.market === 'intl' ? 'intl' : args.market === 'US' ? 'US' : undefined
  return appendCurationEvent(
    state,
    buildCalibrationUniverseMemberAddedEvent({
      ticker,
      ...(args.company === undefined || args.company.trim().length === 0 ? {} : { company: args.company }),
      ...(market === undefined ? {} : { market }),
    }),
  )
}

/**
 * Remove a ticker from the calibration universe (user-authored `calibration_universe_member_removed` —
 * tombstones a seed name until re-added). Returns the updated projected universe.
 */
export async function removeCalibrationUniverseMember(
  state: OnboardingState,
  args: { ticker: string },
): Promise<CalibrationUniverse> {
  const ticker = args.ticker.trim()
  if (ticker.length === 0) {
    throw new Error('A ticker is required to remove a calibration-universe member')
  }
  return appendCurationEvent(state, buildCalibrationUniverseMemberRemovedEvent({ ticker }))
}

/**
 * Enqueue a calibration backtest run (valuation-recalibration-spec §3 — DELIBERATE, enqueued, not a sync
 * HTTP request). Records a user-authored `calibration_run_requested` ledger event and spawns the worker to
 * run the deterministic, observation-only backtest over the user-curated universe (EDGAR + 10yr prices are
 * slow/network-bound — they belong in the worker). The page renders the recorded `calibration_run` once the
 * worker completes. This function does NOT run the backtest synchronously.
 */
export async function enqueueCalibrationRun(
  state: OnboardingState,
  deps: { spawn?: (paths: { ledgerPath: string; sourceLedgerPath: string }) => void } = {},
): Promise<{ calibration_run_id: string }> {
  if (
    !state.is_initialized
    || state.config.mode !== 'personal-local'
    || state.config.ledger_path === undefined
    || state.config.source_ledger_path === undefined
  ) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const strategyId = state.config.strategy_id ?? 'buffett-munger'
  const calibrationRunId = `cal_${Date.now()}`

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    await store.append({
      event_id: `evt_calibration_run_requested_${calibrationRunId}`,
      event_type: 'calibration_run_requested',
      aggregate_type: 'strategy',
      aggregate_id: strategyId,
      correlation_id: calibrationRunId,
      actor_type: 'user',
      actor_id: 'user_local',
      payload: {
        calibration_run_id: calibrationRunId,
        strategy_id: strategyId,
        requested_by: 'user_local',
      },
      source_ids: [],
      created_at: new Date().toISOString(),
      schema_version: 1,
      idempotency_key: `calibration-run-request:${calibrationRunId}:v1`,
    })
  } finally {
    store.close()
  }

  ;(deps.spawn ?? defaultSpawnCalibrationWorker)({
    ledgerPath: state.config.ledger_path,
    sourceLedgerPath: state.config.source_ledger_path,
  })

  return { calibration_run_id: calibrationRunId }
}

function defaultSpawnCalibrationWorker({ ledgerPath, sourceLedgerPath }: { ledgerPath: string; sourceLedgerPath: string }): void {
  // Never spawn a real worker under the test harness (vitest / playwright); the request is still recorded.
  if (process.env.VITEST !== undefined || process.env.OWLFOLIO_TEST_MODE === 'playwright') {
    return
  }
  const child = spawn('corepack', ['pnpm', '--filter', '@owlfolio/worker', 'dev', '--', '--once', '--task-kind', 'process_calibration_queue'], {
    cwd: process.env.OWLFOLIO_PROJECT_DIR ?? process.cwd(),
    env: {
      ...process.env,
      OWLFOLIO_LEDGER_PATH: ledgerPath,
      OWLFOLIO_SOURCE_LEDGER_PATH: sourceLedgerPath,
      OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR ?? process.cwd(),
    },
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}
