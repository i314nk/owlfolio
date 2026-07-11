#!/usr/bin/env node
import { pathToFileURL } from 'node:url'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { redactProviderDiagnostic, resolveProvider } from '@owlfolio/providers'
import { mergeAutomationSettings, mergeSavingsSleeveConfig, mergeValuationConfig } from '@owlfolio/shared'

import { defineDefaultScheduledTasks, resolveWorkerProviderReadiness, resolveWorkerRuntimePaths, runProcessResearchQueueTask, runProcessDeepDiveQueueTask, runScheduledTasks } from './runtime.ts'

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
    '  corepack pnpm --filter @owlfolio/worker dev -- --task-kind re_review_check',
    '  corepack pnpm --filter @owlfolio/worker dev -- --task-kind purification_projection',
    '',
    'Options:',
    '  --once              Run one worker tick (currently the only mode).',
    '  --dry-run           Only execute mock-safe dry-run task handlers (default).',
    '  --define-defaults   Ensure default safe scheduled tasks exist before running.',
    '  --task-kind KIND    Limit this tick to review_reminder, watchlist_monitor, holding_review_draft, re_review_check, portfolio_valuation_refresh, or purification_projection.',
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
    // Advanced research knobs (clamped, default-filled): per-lane tool-call cap + circle-gate hardening.
    const automation = mergeAutomationSettings(runtime.config.automation)
    const maxToolCalls = automation.research_max_tool_calls
    const circle_gate = {
      k_samples: automation.circle_gate_k_samples,
      min_drivers: automation.circle_gate_min_drivers,
      min_breakers: automation.circle_gate_min_breakers,
    }

    // F.2 — the discount risk-free anchor is the COMPLIANT app-config savings rate (clamped fail-closed
    // to default via the shared helper). Threaded into BOTH research paths so the automatic-mode run and
    // the approval-resume value at the SAME discount.
    const risk_free_rate = mergeSavingsSleeveConfig(runtime.config.savings).savings_expected_profit_rate
    const required_return = mergeValuationConfig(runtime.config.valuation).required_return

    if (options.task_kind === 'process_research_queue') {
      const result = await runProcessResearchQueueTask(store, {
        provider,
        source_ledger_path: runtime.source_ledger_path,
        maxToolCalls,
        circle_gate,
        risk_free_rate,
        required_return,
        // The deep-dive approval pause honors the SAME merged automation setting the web path uses —
        // a worker-executed run pauses behind the gates exactly like an in-process one.
        deep_dive_approval: automation.deep_dive_approval,
        // Defense-in-depth: let the task fail closed if the run requested a provider/mode that differs
        // from the config the worker actually loaded (e.g. a silent demo/mock fallback).
        loaded_provider_id: runtime.config.provider.provider_id,
        loaded_mode: runtime.config.mode,
        config_path: runtime.config_path,
      })
      console.log(JSON.stringify({ runtime, result }, null, 2))
      return 0
    }

    if (options.task_kind === 'process_deep_dive_queue') {
      const result = await runProcessDeepDiveQueueTask(store, {
        provider,
        source_ledger_path: runtime.source_ledger_path,
        maxToolCalls,
        circle_gate,
        risk_free_rate,
        required_return,
      })
      console.log(JSON.stringify({ runtime, result }, null, 2))
      return 0
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
      // re_review_check needs the persisted decision corpus for its new-filings delta.
      source_ledger_path: runtime.source_ledger_path,
      ...(runtime.config.provider.model_id === undefined ? {} : { provider_model_id: runtime.config.provider.model_id }),
      ...(runtime.config.automation === undefined ? {} : { automation: runtime.config.automation }),
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
