import { spawn } from 'node:child_process'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { VALUATION_PARAMS, type ValuationParams } from '@owlfolio/strategies/valuationParams'
import {
  buildValuationConfigChangeDraft,
  type ValuationConfigChangeDraft,
} from '@owlfolio/strategies/valuationConfigEvent'

import type { OnboardingState } from './onboarding'

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

/**
 * Build a gated, human-confirmed valuation-parameter-change DRAFT (valuation-recalibration-spec §3.4
 * anti-drift). This is NOT a casual tune knob: the draft computes the diff, REQUIRES an attached
 * calibration_run backtest, refuses to touch the constitutional 10% discount rate, and is never
 * auto-applied. The caller renders the returned draft for explicit user confirmation; only confirming it
 * writes a `valuation_config` ledger event.
 */
export function proposeValuationConfigChange(args: {
  strategy_id: string
  /** Partial override merged onto the current VALUATION_PARAMS (must include a bumped `version`). */
  next: Partial<ValuationParams> & { version: string }
  /** The recorded calibration_run event id whose backtest justifies the change (required, §3.4). */
  calibration_run_event_id: string
  rationale?: string
}): ValuationConfigChangeDraft {
  const next: ValuationParams = { ...VALUATION_PARAMS, ...args.next }
  return buildValuationConfigChangeDraft({
    proposal_id: `valcfg_proposal_${Date.now()}`,
    strategy_id: args.strategy_id,
    previous: VALUATION_PARAMS,
    next,
    calibration_run_event_id: args.calibration_run_event_id,
    ...(args.rationale === undefined ? {} : { rationale: args.rationale }),
    actor_id: 'user_local',
  })
}
