<div align="center">

# Owlfolio v2

**A local-first investment workflow dashboard with a Shariah-by-design ledger.**

Owlfolio v2 is a TypeScript rewrite focused on the full investment workflow:
research cases, watchlist decisions, holdings, reviews, monthly accounting,
purification tracking, provider certification, scheduled worker runs, and an
immutable audit trail.

</div>

---

## Current alpha status

This branch is an alpha hardening slice, not the older Python/FastAPI product.
The primary app is a local Next.js web UI backed by a SQLite event ledger. The
CLI is secondary; the local worker handles dry-run scheduled task ticks.

Built alpha surfaces:

- Command Center with setup-aware status, next actions, accounting prompts, and recent ledger activity.
- Browser onboarding for demo and personal-local mode.
- Research case intake and provider-authored draft recommendations.
- Watchlist draft, explicit user confirmation, and open-holding transitions.
- Portfolio page for holdings, lot entry, manual valuation, and holding review actions.
- Monthly accounting snapshot projection and report page.
- Purification obligations/payments projection and report page.
- Shariah workflow gates and policy projections in the ledger layer.
- Audit activity page over append-only ledger events.
- Provider status page using latest certification reports.
- Local worker for dry-run scheduled `review_reminder` and `watchlist_monitor` tasks.

Full-v2 gaps are tracked honestly in `docs/ALPHA_READINESS.md`: real direct API
provider parity, autonomous discovery/research at production quality, broker
sync/trading, cash/dividend ingestion, tax-grade accounting, formal Shariah
scholar review, and non-Buffett strategy certification are not complete.

---

## Quick start

Requires Node/Corepack. From the repo root:

```bash
corepack enable
corepack pnpm install
corepack pnpm dev
```

Open `http://127.0.0.1:3000` and complete onboarding. The app stores runtime
state locally under `data/` by default; `data/` is ignored by git.

Useful isolated local run:

```bash
OWLFOLIO_PROJECT_DIR=$PWD \
OWLFOLIO_APP_CONFIG_PATH=$PWD/.playwright-runtime/app-config.json \
OWLFOLIO_DEMO_LEDGER_PATH=$PWD/.playwright-runtime/demo-ledger.sqlite \
OWLFOLIO_PERSONAL_LEDGER_PATH=$PWD/.playwright-runtime/personal-ledger.sqlite \
OWLFOLIO_CLAUDE_CREDENTIALS_PATH=$PWD/.playwright-runtime/missing-claude.json \
OWLFOLIO_CODEX_AUTH_PATH=$PWD/.playwright-runtime/missing-codex-auth.json \
ANTHROPIC_API_KEY= OPENAI_API_KEY= \
corepack pnpm dev
```

---

## Repository map

```text
apps/
  web/       Next.js web app and API routes
  worker/    local scheduled-task worker
packages/
  ledger/    SQLite event store, event contracts, projections
  providers/ provider catalog, adapters, certification runner
  shared/    app config and shared domain/provider types
  shariah/   Shariah policy helpers
  strategies/ strategy package placeholder/reference surface
  workflow/  workflow helpers for research, watchlist, holdings, reviews
scripts/
  certify-providers.mjs
```

Important docs:

- `CLAUDE.md` — current agent/development instructions for this TypeScript branch.
- `docs/ALPHA_READINESS.md` — release gate, verification status, limitations, remaining v2 gaps.
- `docs/WORKER.md` — worker safety model and commands.
- `docs/architecture/owlfolio-v2-domain-boundaries.md` — ledger event families and route ownership.
- `docs/architecture/owlfolio-v2-provider-model-support.md` — provider support matrix and latest certification evidence.
- `docs/superpowers/specs/2026-05-27-owlfolio-v02-typescript-design.md` — original v2 design target.

---

## Provider support

Owlfolio distinguishes provider readiness from provider certification.

| Provider id | Current role | Latest alpha support |
| --- | --- | --- |
| `mock-provider` | Deterministic demo/test provider | Certified; latest report passes 13/13 scenarios. |
| `openai` | OpenAI Codex CLI-backed development path | Experimental; latest report passes 9/13 scenarios and lacks certified tool-loop parity. |
| `claude` | Claude CLI-backed development path | Unsupported/not-configured in this environment; latest report says Claude Code subscription access is disabled. |

Direct Anthropic/OpenAI/Gemini/Perplexity/OpenRouter/xAI/DeepSeek/Qwen/local
API adapters are candidates, not certified Owlfolio providers, until adapters
and certification reports exist.

Readiness inputs:

- Claude: `ANTHROPIC_API_KEY` or Claude credential file (`OWLFOLIO_CLAUDE_CREDENTIALS_PATH`).
- OpenAI/Codex: `OPENAI_API_KEY`, `CODEX_ACCESS_TOKEN`, `OWLFOLIO_CODEX_AUTH_PATH`, or `CODEX_HOME`.

Latest reports live in `data/provider-certifications/*.latest.json` and are the
source of truth for support labels surfaced in docs/UI.

---

## Worker

Run one dry-run tick:

```bash
corepack pnpm worker -- --once --dry-run --define-defaults
```

Run a specific handler:

```bash
corepack pnpm --filter @owlfolio/worker dev -- --task-kind review_reminder
corepack pnpm --filter @owlfolio/worker dev -- --task-kind watchlist_monitor
```

The alpha worker is intentionally conservative. It records scheduled-task run
lifecycle events and observations, but it does not auto-approve investment
decisions, trades, watchlist confirmations, holding opens, Shariah overrides,
or purification payments.

---

## Verification

Final release gate commands:

```bash
git diff --check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm audit --filter @owlfolio/web --prod --audit-level moderate
NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build
corepack pnpm e2e
```

Provider certification:

```bash
corepack pnpm certify:providers
```

Known warning: Next/Turbopack can emit an NFT/import-trace warning involving
local filesystem helpers in `next.config.mjs` / `appConfigStore` / `onboarding`.
The build is only acceptable if it exits 0 and no generated/runtime artifacts
remain in git status.

---

## Shariah/accounting/purification limitations

Owlfolio is Shariah-by-design, but the alpha is not a fatwa engine, broker, tax
system, or accounting firm:

- Shariah screens are local policy/audit aids and may require human scholar review.
- Purification obligations and payments are tracked as auditable ledger events; users remain responsible for final calculation and payment decisions.
- Monthly accounting is bounded by local ledger events and manual valuation/cash inputs; it is not a broker statement or tax filing substitute.
- Provider outputs are drafts/observations. User-authored transitions are required for watchlist confirmations, holding opens, review overrides, payments, and any portfolio action.

---

## Development rules

- Use TypeScript/pnpm commands, not the retired Python `owlfolio` CLI instructions.
- Write tests before behavior changes; confirm RED before implementation.
- Keep runtime/generated artifacts out of commits: `data/`, `.next/`, `test-results/`, `playwright-report/`, `*.tsbuildinfo`, `.playwright-runtime/`, `.live-openai-runtime/`, `.worktrees/`.
- Do not raise provider support claims above the latest certification report.
- Keep provider/worker-authored drafts separate from explicit user-authored ledger transitions.

MIT — see `LICENSE`.
