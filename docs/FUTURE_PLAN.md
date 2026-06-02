# Future plan

This is the forward-looking plan for the active Owlfolio v2 TypeScript/pnpm branch. Older Python/FastAPI/Claude-only phase notes are historical and no longer describe the active product surface.

For current release status, verification evidence, known warnings, provider support labels, and alpha boundaries, see `docs/ALPHA_READINESS.md`. For implementation architecture, see `docs/ARCHITECTURE.md`.

## Current alpha foundation

The v2 alpha establishes a local-first workflow spine:

- Next.js web app as the primary UI.
- Browser onboarding for deterministic demo mode and personal-local mode.
- SQLite append-only event ledger with projections for command center, research/watchlist/holdings, scheduled tasks, accounting, purification, Shariah status, and audit activity.
- Provider catalog, provider readiness checks, and latest certification reports as the support-label source of truth.
- Mock provider certified for deterministic demo/test/e2e use.
- OpenAI Codex CLI path experimental; Claude CLI path unsupported/not-configured in the current environment per latest certification evidence.
- Dry-run/mock-safe worker handlers for `review_reminder` and `watchlist_monitor`.
- User-authored transitions for watchlist confirmations, holding opens, review decisions, purification payments, and other irreversible workflow actions.

## Near-term hardening priorities

1. Production provider parity
   - Implement direct API adapters for the highest-value production candidates.
   - Certify providers by role, not by brand-level optimism.
   - Keep provider-authored drafts separate from user-authored ledger decisions.
   - Record provider id, model id/version, support tier, run id, source ids, and certification evidence on provider-authored proposals.

2. Evidence ingestion and provenance
   - Harden source bundle storage and citations.
   - Add filings, financial statements, market data freshness, dividend/corporate-action inputs, and broker-statement evidence ingestion.
   - Keep missing or stale evidence visible in the UI rather than silently filling gaps.

3. Worker safety and autonomy controls
   - Expand scheduled tasks only behind dry-run and explicit approval boundaries.
   - Add timeout/cost/retry controls for real provider work.
   - Preserve run lifecycle events and observations for every scheduled task tick.
   - Do not allow workers to auto-create irreversible investment/accounting/purification actions.

4. Portfolio and accounting completeness
   - Add dividend, fee, FX, realized gain/loss, tax-lot, corporate-action, and benchmark projections.
   - Support period close/reopen and reconciliation workflows.
   - Keep monthly accounting clearly separate from broker statements and tax filings until reconciled evidence exists.

5. Shariah and purification maturity
   - Strengthen source-grounded issuer screening, ratio calculation inputs, and conservative policy fallbacks.
   - Add formal methodology review and audit notes before claiming scholar-reviewed compliance.
   - Improve purification obligation calculation, evidence attachment, payment workflow, and period-close UX.

6. Strategy certification
   - Keep Buffett-Munger as the primary certified strategy direction.
   - Gate additional strategies behind valuation rules, Shariah handling, provider role certification, and audit-policy review.
   - Treat custom strategy YAML/manual methods as advanced configuration, not the main UI path.

7. Human review UX
   - Add richer approval queues for provider/worker proposals.
   - Show diffs between proposed and current ledger state before user confirmation.
   - Explain why a transition is blocked by missing evidence, Shariah status, provider support tier, or accounting state.

8. Packaging and operations
   - Add backup/restore UX for local ledgers and source bundles.
   - Consider signed desktop/local deployment packaging.
   - Add observability for local worker/provider runs without leaking secrets.
   - Keep hosted/multi-user auth out of scope until local-first behavior is stable.

## Explicit non-goals for the alpha

- Live trading or order placement.
- Broker credentials or broker synchronization.
- Tax filing or tax advice.
- Formal Shariah rulings.
- Autonomous portfolio actions without explicit user-authored ledger events.
- Provider support claims that exceed latest certification reports.

## Release-gate reminders

Before any alpha release or review handoff:

```bash
git diff --check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm audit --filter @owlfolio/web --prod --audit-level moderate
NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build
corepack pnpm e2e
```

`git status --short` must not contain accidental runtime/generated artifacts such as `data/`, `.next/`, `test-results/`, `playwright-report/`, `*.tsbuildinfo`, `.playwright-runtime/`, `.live-openai-runtime/`, `.worktrees/`, or local SQLite databases.
