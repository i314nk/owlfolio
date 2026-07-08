<div align="center">

# Owlfolio v2

**A local-first investment research workflow with harness-verified grounding and a Shariah-by-design ledger.**

</div>

> ## ⚠️ Status: alpha, under active development
>
> Owlfolio v2 is a personal project in **active development**. It is an **alpha**:
> features are incomplete, interfaces change without notice, and some documented
> capabilities are deliberately gated off until they pass verification. It is a
> local workflow tool — **not** a robo-advisor, a brokerage integration, tax
> software, a fatwa engine, or investment advice. Run it locally, read the
> limitations below, and treat every model output as a draft for a human to judge.

---

## What it is

Owlfolio runs a strategy-driven research workflow (default: Buffett-Munger) on
your own machine: discovery → quick screen → a multi-agent deep dive → a drafted
decision → watchlist/holding transitions you explicitly author → ongoing
re-review as new SEC filings land. Everything is recorded in an append-only
SQLite event ledger with causation/correlation IDs, so every number and claim is
auditable back to its source.

The core design rule is **"code computes, judgment proposes"**:

- Deterministic code computes numbers (owner earnings, ratios, valuations,
  purification amounts). Models never set a figure anyone acts on.
- Models propose judgments (moat, risks, thesis) — but every citable source is
  fetched by the harness itself (SSRF-guarded, SEC-host-allowlisted),
  SHA-256-hashed, and recorded in a source ledger. Citations that don't verify
  are discarded, and judgments built on them fail closed to a visibly flagged
  abstain. A model cannot cite what the harness didn't verify.

### The grounded document set (SEC EDGAR)

- Annual reports — 10-K, 20-F, 40-F — numbers via XBRL company facts, text
  readable by Item through a hash-verified `read_source` tool.
- Interim filings — 8-K (weighted by item code: impairments/restatements/exec
  departures are strong signals, routine earnings announcements are not, and
  the EX-99 press-release exhibits are grounded alongside the cover), 10-Q
  (narrative readable; interim numbers quarantined as context), 6-K for foreign
  filers.
- DEF 14A proxy statements for the management/governance lane.
- Cross-run persistence: source bundles store pointers + hashes (never
  content); EDGAR's immutable archive URLs let any source be re-fetched and
  re-verified on demand, forever.

### Built and working today (local alpha)

- Browser onboarding, Command Center, research cockpit, watchlist, portfolio,
  purification/accounting projections, audit trail, provider status, and a
  Learn section documenting the strategy and grounding architecture.
- The multi-agent research swarm with a hardened circle-of-competence gate
  (k-sample unanimous agreement + grounded evidence floors, tunable in
  Settings) — "outside the circle" is a recorded early exit, not a failure.
- **Thesis re-review**: on demand (dossier, watchlist, and portfolio pages) or
  via a worker tick, Owlfolio diffs the filings that appeared since a decision
  against the recorded thesis and its break triggers, and records
  INTACT / WEAKENED / BROKEN — or, honestly, INCONCLUSIVE / UNVERIFIED when the
  evidence can't support a verdict. A broken thesis on a held name escalates a
  full re-run draft; a human still decides everything.
- A small read-only CLI (`owlfolio start|status|doctor`) for launch/inspect/
  diagnose; all onboarding and decisions live in the browser.
- A local worker that runs **one tick at a time** (`--once`), dry-run/mock-safe,
  recording observations and drafts. It never auto-approves investment
  decisions, trades, confirmations, Shariah overrides, or payments.

### Not done yet (deliberately)

- **No scheduler / unattended automation.** Every worker task is
  scheduler-shaped (one-tick, cadence metadata recorded), but nothing fires
  them automatically yet. That arc is gated on an explicit unattended-spend
  policy.
- **Provider/model choice is the user's responsibility.** Only the
  deterministic mock provider carries a certification report. OpenRouter (the
  default) and the direct OpenAI/Anthropic/Gemini API adapters run a proven
  grounded tool loop and are usable with an API key; certification is an
  **optional deeper audit** a user can run per model, and support labels stay
  `experimental` until a target-specific report exists.
- **Insider forms (Forms 3/4/5)** — in progress on a branch (deterministic
  parsing for the management lane and insider-activity trigger signals).
- No broker sync, live trading, automatic portfolio actions, market-data
  ingestion hardening, tax-grade accounting, or formal Shariah scholar review.
- A historical (as-of-date) backtester is deferred pending point-in-time data
  quality.
- Known issues: a handful of Playwright e2e specs are failing and under
  diagnosis; the Next/Turbopack NFT import-trace warning noted below.

Gaps are tracked in `docs/ALPHA_READINESS.md`.

---

## Quick start

Requires Node + Corepack. From the repo root:

```bash
corepack enable
corepack pnpm install
corepack pnpm dev
```

Open `http://127.0.0.1:3000` and complete onboarding in the browser (mode,
provider, API key, model, capital). Runtime state lives locally under `data/`
(git-ignored); API keys live in a local env file (`OWLFOLIO_ENV_FILE`, default
`~/.owlfolio/.env`) — never in the ledger, logs, or git.

Isolated run with explicit paths:

```bash
OWLFOLIO_PROJECT_DIR=$PWD \
OWLFOLIO_APP_CONFIG_PATH=$PWD/data/app-config.json \
OWLFOLIO_PERSONAL_LEDGER_PATH=$PWD/data/personal-ledger.sqlite \
OWLFOLIO_SOURCE_LEDGER_PATH=$PWD/data/source-ledger \
corepack pnpm dev
```

---

## Repository map

```text
apps/
  web/       Next.js web app and API routes (the primary surface)
  worker/    local one-tick scheduled-task worker (dry-run/mock-safe)
  cli/       read-only launch/inspect/diagnose CLI (owlfolio start|status|doctor)
packages/
  ledger/    append-only SQLite event store, event contracts, projections
  workflow/  research swarm, grounding, EDGAR adapters, re-review, reviews
  providers/ provider catalog, adapters, certification runner
  strategies/ Buffett-Munger strategy policy: source policy, valuation, checklist
  shared/    app config and shared domain/provider types
  shariah/   Shariah policy helpers
```

Important docs:

- `CLAUDE.md` — current development instructions for this TypeScript branch.
- `docs/ALPHA_READINESS.md` — release gate, verification status, remaining gaps.
- `docs/WORKER.md` — worker safety model and commands.
- `docs/architecture/owlfolio-v2-domain-boundaries.md` — event families and route ownership.
- `docs/architecture/owlfolio-v2-provider-model-support.md` — provider support matrix (the bounding document for all support claims).

---

## Provider support

Owlfolio distinguishes **readiness** (a key is configured) from
**certification** (a recorded report proving the grounded research contract).
The retired CLI/OAuth lanes (Codex CLI, Claude CLI, Gemini CLI) were removed on
2026-06-29; the surviving providers all share one function-calling grounded
tool loop.

| Provider id | Role | Support |
| --- | --- | --- |
| `mock-provider` | Deterministic demo/test provider | **Certified** for the local/demo slice and regression tests. |
| `openrouter` | Default personal-local provider — one `OPENROUTER_API_KEY` routes to many models | Experimental. Proven grounded tool loop; usable with a key, model choice is yours. |
| `openai-api` | Direct OpenAI API (`OPENAI_API_KEY`) | Experimental; usable with a key. |
| `anthropic-api` | Direct Anthropic API (`ANTHROPIC_API_KEY`) | Experimental; usable with a key. |
| `gemini-developer-api` | Direct Gemini Developer API (`GEMINI_API_KEY`/`GOOGLE_API_KEY`) | Experimental; usable with a key. Privacy posture caveats apply. |

**Certification is the user's responsibility and optional**: pick a capable
reasoning model (reasoning + tool calling + structured output — the model
picker's floor) and you can run research immediately; the certification runner
(`pnpm certify:providers`) is a deeper per-model audit you may run when you
want recorded evidence, and support labels stay `experimental` until such a
report exists. Either way the grounding harness is what protects you: docs/UI
never claim more than the latest report proves, and native/provider-side web
search is disabled by construction — the harness executor is the only egress.

---

## Worker

Run one dry-run tick from the repo root:

```bash
corepack pnpm worker -- --once --dry-run --define-defaults
```

Limit a tick to one task kind:

```bash
corepack pnpm --filter @owlfolio/worker dev -- --task-kind review_reminder
corepack pnpm --filter @owlfolio/worker dev -- --task-kind watchlist_monitor
corepack pnpm --filter @owlfolio/worker dev -- --task-kind re_review_check
```

Twelve task kinds exist (reviews, monitors, Shariah re-screen, valuation
refresh, purification, forecast resolution, 13F discovery, thesis re-review
checks, and the research/deep-dive queues). All are one-tick and human-gated:
the worker records observations and drafts, and provider spend is bounded
(e.g. the re-review sweep only spends on strong triggers, capped per tick).

---

## Verification

Gates on the final tree:

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
local filesystem helpers (`next.config.mjs` / `appConfigStore` / `onboarding`).
Known issue: several e2e specs are currently failing (pre-existing, under
diagnosis); the unit/integration suite (2,300+ tests) is the green gate.

---

## Shariah / accounting / purification limitations

Owlfolio is Shariah-by-design, but the alpha is not a fatwa engine, broker, tax
system, or accounting firm:

- Shariah screens are local policy/audit aids and may require human scholar review.
- Purification obligations and payments are tracked as auditable ledger events; users remain responsible for final calculation and payment decisions.
- Monthly accounting is bounded by local ledger events and manual valuation/cash inputs; it is not a broker statement or tax filing substitute.
- Provider outputs are drafts/observations. User-authored transitions are required for watchlist confirmations, holding opens, review overrides, payments, and any portfolio action.

---

## Development rules

- TypeScript/pnpm only; the old Python `owlfolio` CLI instructions are retired.
- TDD for behavior changes: failing test first, confirm RED, then implement.
- Keep runtime/generated artifacts out of commits: `data/`, `.next/`, `test-results/`, `playwright-report/`, `*.tsbuildinfo`, `.playwright-runtime/`, `.worktrees/`.
- Never raise provider support claims above the latest certification report.
- Keep provider/worker-authored drafts separate from explicit user-authored ledger transitions.
- No secrets in git, logs, or provider reports.

MIT — see `LICENSE`.
