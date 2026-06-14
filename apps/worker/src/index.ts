#!/usr/bin/env node
import { pathToFileURL } from 'node:url'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { redactProviderDiagnostic, resolveProvider } from '@owlfolio/providers'
import { mergeAutomationSettings } from '@owlfolio/shared'

import { defineDefaultScheduledTasks, resolveWorkerProviderReadiness, resolveWorkerRuntimePaths, runProcessResearchQueueTask, runProcessDeepDiveQueueTask, runProcessCalibrationQueueTask, runScheduledTasks } from './runtime.ts'

type CliOptions = {
  help: boolean
  define_defaults: boolean
  dry_run: boolean
  task_kind?: string
}

function usage(): string {
  return [
    'Owlfolio worker',
    '',
    'Usage:',
    '  corepack pnpm worker -- --once --dry-run --define-defaults',
    '  corepack pnpm --filter @owlfolio/worker dev -- --task-kind review_reminder',
    '  corepack pnpm --filter @owlfolio/worker dev -- --task-kind watchlist_monitor',
    '  corepack pnpm --filter @owlfolio/worker dev -- --task-kind holding_review_draft',
    '  corepack pnpm --filter @owlfolio/worker dev -- --task-kind purification_projection',
    '',
    'Options:',
    '  --once              Run one worker tick (currently the only mode).',
    '  --dry-run           Only execute mock-safe dry-run task handlers (default).',
    '  --define-defaults   Ensure default safe scheduled tasks exist before running.',
    '  --task-kind KIND    Limit this tick to review_reminder, watchlist_monitor, holding_review_draft, portfolio_valuation_refresh, or purification_projection.',
    '  --help              Show this help.',
    '',
    'Environment:',
    '  OWLFOLIO_PROJECT_DIR, OWLFOLIO_APP_CONFIG_PATH, OWLFOLIO_LEDGER_PATH, OWLFOLIO_SOURCE_LEDGER_PATH',
  ].join('\n')
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { help: false, define_defaults: false, dry_run: true }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      continue
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--once' || arg === '--dry-run') {
      options.dry_run = true
      continue
    }
    if (arg === '--define-defaults') {
      options.define_defaults = true
      continue
    }
    if (arg === '--task-kind' || arg === '--task') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`)
      }
      options.task_kind = value
      index += 1
      continue
    }

    throw new Error(`Unknown worker option: ${arg}`)
  }

  return options
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(usage())
    return 0
  }

  const runtime = await resolveWorkerRuntimePaths()
  const store = new SQLiteEventStore<import('@owlfolio/ledger/eventEnvelope').LedgerEventEnvelope<unknown>>(runtime.ledger_path)
  try {
    if (options.define_defaults) {
      await defineDefaultScheduledTasks(store, {
        ...(runtime.config.automation !== undefined ? { automation: runtime.config.automation } : {}),
      })
    }

    const provider = resolveProvider({ provider_id: runtime.config.provider.provider_id })
    // Advanced research-depth knob: per-lane grounded-tool-call cap (clamped, default-filled).
    const maxToolCalls = mergeAutomationSettings(runtime.config.automation).research_max_tool_calls

    if (options.task_kind === 'process_research_queue') {
      const result = await runProcessResearchQueueTask(store, {
        provider,
        source_ledger_path: runtime.source_ledger_path,
        maxToolCalls,
      })
      console.log(JSON.stringify({ runtime, result }, null, 2))
      return 0
    }

    if (options.task_kind === 'process_deep_dive_queue') {
      const result = await runProcessDeepDiveQueueTask(store, {
        provider,
        source_ledger_path: runtime.source_ledger_path,
        maxToolCalls,
      })
      console.log(JSON.stringify({ runtime, result }, null, 2))
      return 0
    }

    if (options.task_kind === 'process_calibration_queue') {
      // Deliberate, enqueued calibration backtest (valuation-recalibration-spec §3). Deterministic +
      // observation-only: runs the backtest over the user-curated universe via the tiered fundamentals
      // resolver and records a calibration_run with the coverage report. Never changes params.
      const result = await runProcessCalibrationQueueTask(store)
      console.log(JSON.stringify({ runtime, result }, null, 2))
      return result.failed > 0 ? 1 : 0
    }

    const providerReadiness = await resolveWorkerProviderReadiness({
      provider_id: runtime.config.provider.provider_id,
      provider_certification_dir: runtime.provider_certification_dir,
      ...(runtime.config.provider.model_id === undefined ? {} : { provider_model_id: runtime.config.provider.model_id }),
    })
    const result = await runScheduledTasks(store, {
      dry_run: options.dry_run,
      provider,
      provider_readiness: providerReadiness,
      ...(runtime.config.provider.model_id === undefined ? {} : { provider_model_id: runtime.config.provider.model_id }),
      ...(options.task_kind === undefined ? {} : { task_kind: options.task_kind }),
    })
    console.log(JSON.stringify({ runtime, result }, null, 2))
    return result.failed > 0 ? 1 : 0
  } finally {
    store.close()
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode
    },
    (error: unknown) => {
      console.error(redactProviderDiagnostic(error))
      process.exitCode = 1
    },
  )
}
