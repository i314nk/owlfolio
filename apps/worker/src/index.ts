#!/usr/bin/env node
import { pathToFileURL } from 'node:url'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { redactProviderDiagnostic, resolveProvider } from '@owlfolio/providers'
import { mergeAutomationSettings, mergeSavingsSleeveConfig, resolveLocale, userSetRequiredReturn } from '@owlfolio/shared'

import { defineDefaultScheduledTasks, resolveWorkerProviderReadiness, resolveWorkerRuntimePaths, runProcessResearchQueueTask, runProcessDeepDiveQueueTask, runScheduledTasks } from './runtime.ts'

type CliOptions = {
  help: boolean
  define_defaults: boolean
  dry_run: boolean
  task_kind?: string
}

function usage(): string {
  return [
    'Owner’s Manual worker',
    '',
    'Usage:',
    '  corepack pnpm worker -- --once --dry-run --define-defaults',
    '  corepack pnpm --filter @owlfolio/worker dev -- --task-kind watchlist_monitor',
    '  corepack pnpm --filter @owlfolio/worker dev -- --task-kind re_review_check',
    '  corepack pnpm --filter @owlfolio/worker dev -- --task-kind re_review_check',
    '',
    'Options:',
    '  --once              Run one worker tick (currently the only mode).',
    '  --dry-run           Only execute mock-safe dry-run task handlers (default).',
    '  --define-defaults   Ensure default safe scheduled tasks exist before running.',
    '  --task-kind KIND    Limit this tick to watchlist_monitor, re_review_check, shariah_rescreen, or portfolio_valuation_refresh.',
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
  // Run-journal output (owner feedback 2026-07-18): the log used to be a full app-config echo + one
  // JSON blob — "settings, no value". Now: timestamped lifecycle lines + a COMPACT runtime line +
  // the result JSON. Lane-level live detail stays on the pipeline timeline (ledger breadcrumbs);
  // this journal's job is what ran, what it concluded, and — via stderr — how anything died.
  const startedAtMs = Date.now()
  const logLine = (message: string): void => {
    console.log(`[${new Date().toISOString()}] ${message}`)
  }
  const runtimeSummary = {
    project_dir: runtime.project_dir,
    config_path: runtime.config_path,
    ledger_path: runtime.ledger_path,
    source_ledger_path: runtime.source_ledger_path,
    mode: runtime.config.mode,
    provider_id: runtime.config.provider.provider_id,
    ...(runtime.config.provider.model_id === undefined ? {} : { model_id: runtime.config.provider.model_id }),
  }
  const reportResult = (result: { summaries?: string[] }): void => {
    for (const summary of result.summaries ?? []) logLine(summary)
    logLine(`worker done in ${((Date.now() - startedAtMs) / 1000).toFixed(1)}s`)
    console.log(JSON.stringify({ runtime: runtimeSummary, result }, null, 2))
  }

  const store = new SQLiteEventStore<import('@owlfolio/ledger/eventEnvelope').LedgerEventEnvelope<unknown>>(runtime.ledger_path)
  try {
    if (options.define_defaults) {
      await defineDefaultScheduledTasks(store, {
        ...(runtime.config.automation !== undefined ? { automation: runtime.config.automation } : {}),
        shariah_enabled: runtime.config.shariah.enabled,
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
    // B8: user-set only — an absent field lets the engine stamp basis 'book_default' honestly.
    const userRequiredReturn = userSetRequiredReturn(runtime.config.valuation)
    // SCREENING TOGGLE: forwarded so a worker-executed run skips the Shariah phases exactly like a
    // web-executed one when screening is OFF.
    const shariah_enabled = runtime.config.shariah.enabled
    // Task #88: an Arabic app language asks each run for the Arabic prose rendering (fail-open).
    const prose_locale = resolveLocale(runtime.config.language) === 'ar' ? ('ar' as const) : undefined

    logLine(`worker start — task=${options.task_kind ?? 'all'} dry_run=${options.dry_run === true} provider=${runtime.config.provider.provider_id}${runtime.config.provider.model_id === undefined ? '' : ` model=${runtime.config.provider.model_id}`}`)

    if (options.task_kind === 'process_research_queue') {
      logLine('processing the research queue (front gates → deep dive when approval is automatic)…')
      const result = await runProcessResearchQueueTask(store, {
        provider,
        source_ledger_path: runtime.source_ledger_path,
        maxToolCalls,
        circle_gate,
        risk_free_rate,
        shariah_enabled,
        ...(prose_locale === undefined ? {} : { prose_locale }),
        ...(userRequiredReturn === undefined ? {} : { required_return: userRequiredReturn }),
        // The deep-dive approval pause honors the SAME merged automation setting the web path uses —
        // a worker-executed run pauses behind the gates exactly like an in-process one.
        deep_dive_approval: automation.deep_dive_approval,
        // Defense-in-depth: let the task fail closed if the run requested a provider/mode that differs
        // from the config the worker actually loaded (e.g. a silent demo/mock fallback).
        loaded_provider_id: runtime.config.provider.provider_id,
        loaded_mode: runtime.config.mode,
        config_path: runtime.config_path,
      })
      reportResult(result)
      return 0
    }

    if (options.task_kind === 'process_deep_dive_queue') {
      logLine('processing the deep-dive queue…')
      const result = await runProcessDeepDiveQueueTask(store, {
        provider,
        source_ledger_path: runtime.source_ledger_path,
        maxToolCalls,
        circle_gate,
        risk_free_rate,
        shariah_enabled,
        ...(prose_locale === undefined ? {} : { prose_locale }),
        ...(userRequiredReturn === undefined ? {} : { required_return: userRequiredReturn }),
      })
      reportResult(result)
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
    reportResult(result)
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
