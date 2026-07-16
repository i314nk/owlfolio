# Owlfolio worker

The worker is a local, ledger-first process for scheduled task runtime and observability. It intentionally has no CommandCenter or UI imports: it loads runtime paths, reads/writes the ledger, and appends scheduled-task lifecycle events.

## Safety model

Current handlers are dry-run/mock-safe only. Every task is ONE-TICK (`--once` is the only mode) and
scheduler-shaped: cadence metadata rides the `scheduled_task_defined` events, but **no scheduler
exists yet** — nothing evaluates the cron strings; a human (or, later, a scheduler) fires each tick.
Scheduled-task kinds:

- `re_review_check`: the thesis re-review sweep — diffs filings NEW since each decided case's persisted corpus (8-K item-code-weighted); strong triggers run a grounded thesis diff (`research_case_re_review_recorded`), capped per tick; medium/weak triggers are observations with zero provider spend. A BROKEN thesis on a held name escalates a versioned full-reanalysis *draft*. REVIEW RETIRED (2026-07-14): the provider-drafted holding review + its reminder are gone — this sweep, the annual-report re-run prompt, and the zone board carry the periodic-review duty; the `thesis_review` automation setting now drives only this task.
- `watchlist_monitor` / `holdings_monitor`: deterministic buy-window / tranche / concentration / staleness monitors; append `*_monitor_alert_recorded` observation events surfaced by the monitor-alert projection.
- `shariah_rescreen`, `portfolio_valuation_refresh` (the held+watched price poll — valuations retired in the scale-down), `forecast_resolution`, `discovery_13f` (the Superinvestors 13F harvest — roster, thresholds, and honesty rails in `architecture/superinvestors-13f-discovery.md`), `falsifier_check`, `re_underwrite`: deterministic/cadence passes over ledger + injected data.
- `process_research_queue` / `process_deep_dive_queue`: the research-run executors, auto-spawned per run by the web app (the only automatic invocations today).

The worker never auto-approves investment decisions, watchlist confirmations, holding opens or closes, watchlist removals, buys, sells, Shariah overrides, or portfolio actions (holding opens/closes and watchlist prunes are rejected for machine actors at the ledger level). Completed run payloads include `auto_approved_actions: 0`; live/non-dry-run task execution is skipped. Provider-backed tasks fail closed before provider/proposal events when readiness is missing, unsupported, quota-limited, reauth-required, or target-mismatched.

## Runtime paths

The worker resolves paths in this order:

- Project directory: `OWLFOLIO_PROJECT_DIR`, otherwise the nearest parent containing `pnpm-workspace.yaml`.
- App config: `OWLFOLIO_APP_CONFIG_PATH`, otherwise `data/app-config.json` under the project directory.
- Ledger: `OWLFOLIO_LEDGER_PATH`, otherwise `config.ledger_path`, otherwise `data/owlfolio-ledger.sqlite`.
- Source ledger: `OWLFOLIO_SOURCE_LEDGER_PATH`, otherwise `config.source_ledger_path`, otherwise `data/source-ledger`.

If the app config file is missing, the worker uses `defaultDemoAppConfig()` and still stays dry-run.

## Local commands

From the repo root:

```bash
corepack pnpm worker -- --once --dry-run --define-defaults
```

Limit a tick to one task kind:

```bash
corepack pnpm --filter @owlfolio/worker dev -- --task-kind re_review_check
corepack pnpm --filter @owlfolio/worker dev -- --task-kind watchlist_monitor
```

Use an isolated test ledger:

```bash
OWLFOLIO_PROJECT_DIR=$PWD \
OWLFOLIO_LEDGER_PATH=$PWD/.data/local-worker-ledger.sqlite \
corepack pnpm worker -- --once --dry-run --define-defaults
```

## Ledger events

Default task setup appends idempotent `scheduled_task_defined` events for the nine scheduled task
kinds (the quarterly `task_re_review_check_quarterly`, the watchlist/holdings monitors, the Shariah
re-screen, the price poll, forecast resolution, 13F discovery, and the falsifier/re-underwrite
cadence passes), each carrying its cadence cron string as metadata for the future scheduler. Legacy
ledgers that still define the retired review tasks skip them quietly.

Each run appends:

1. `scheduled_task_run_started` with attempt metadata plus task timeout/max-cost metadata when defined
2. `scheduled_task_run_completed` on success, with observations, result summary, proposal/provider-run ids, and approval gates when relevant
3. `scheduled_task_run_failed` on handler failure, with attempt/max-attempts/retry-after metadata

Read task status with `projectScheduledTasks(events)` from `@owlfolio/ledger/projections/scheduledTaskProjection`.
