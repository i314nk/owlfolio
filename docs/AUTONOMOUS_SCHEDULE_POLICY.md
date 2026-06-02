# Owlfolio autonomous schedule policy

This file describes the active Owlfolio v2 alpha worker policy. The older Python/CLI/Claude scheduler note was moved to `docs/archive/AUTONOMOUS_SCHEDULE_POLICY.v0.1.md` and is historical only.

## Alpha policy

Owlfolio v2 may observe and remind, but it must not autonomously create irreversible investment, accounting, or purification actions.

Allowed alpha worker behavior:

- Define default scheduled tasks idempotently.
- Append scheduled-task run lifecycle events to the local SQLite ledger.
- Project due/upcoming holding reviews and confirmed watchlist items.
- Record dry-run/mock-safe observations for `review_reminder` and `watchlist_monitor`.

Disallowed alpha worker behavior:

- Auto-approve provider recommendations.
- Confirm watchlist items or open holdings.
- Buy, sell, rebalance, or place orders.
- Override Shariah status.
- Close accounting periods or create tax/accounting filings.
- Mark purification obligations as paid or execute payments.
- Run real provider research on a schedule without explicit future cost/timeout/approval controls.

## Current commands

Run one dry-run tick:

```bash
corepack pnpm worker -- --once --dry-run --define-defaults
```

Limit a tick to a specific supported handler:

```bash
corepack pnpm --filter @owlfolio/worker dev -- --task-kind review_reminder
corepack pnpm --filter @owlfolio/worker dev -- --task-kind watchlist_monitor
```

Use isolated local state when testing:

```bash
OWLFOLIO_PROJECT_DIR=$PWD \
OWLFOLIO_LEDGER_PATH=$PWD/.data/local-worker-ledger.sqlite \
corepack pnpm worker -- --once --dry-run --define-defaults
```

## Future requirements before higher autonomy

Before scheduled provider research or portfolio-changing automation becomes eligible for certification, Owlfolio needs:

- provider role certification for the scheduled task,
- explicit user opt-in and cadence/cost controls,
- timeout/retry/circuit-breaker limits,
- source-ledger provenance for provider evidence,
- approval queues for proposed ledger transitions,
- audit UI that explains what was observed, proposed, approved, rejected, or skipped.

See `docs/WORKER.md` and `docs/ALPHA_READINESS.md` for current worker safety and release boundaries.
