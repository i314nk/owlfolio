<div align="center">

# 🦉 Owner's Manual

**A local-first investment research workflow with harness-verified grounding,<br/>an append-only audit ledger, and optional Shariah screening.**

[![CI](https://github.com/i314nk/owlfolio/actions/workflows/ci.yml/badge.svg)](https://github.com/i314nk/owlfolio/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-app%20router-black?logo=nextdotjs)
![pnpm](https://img.shields.io/badge/pnpm-monorepo-F69220?logo=pnpm&logoColor=white)
![tests](https://img.shields.io/badge/tests-2%2C400%2B-2ea44f)
![local-first](https://img.shields.io/badge/data-local--first-8A2BE2)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[What it is](#what-it-is) ·
[Screenshots](#see-it-in-action) ·
[Install & run](#install--run-the-dashboard) ·
[Architecture](#repository-map) ·
[Portfolio notes](#as-a-portfolio-piece--what-this-demonstrates)

*(Engine namespace: Owlfolio — `OWLFOLIO_*` env vars, `@owlfolio/*` packages, the repo name, and the `owlfolio` CLI alias keep the internal name so existing configs and ledgers keep working.)*

</div>

> ## 🎓 An educational project and portfolio piece
>
> Owner's Manual is a **personal educational project and CV portfolio piece**: it exists to
> learn — and to demonstrate — how to build a local-first product around grounded LLM
> orchestration, event-sourced auditability, and a deterministic finance core. It is an
> **alpha** under active development: features are incomplete, interfaces change without
> notice, and some capabilities are deliberately gated off until they pass verification.
>
> It is **not investment advice** and not a robo-advisor, brokerage integration, tax
> software, or a fatwa engine. Nothing it produces is a recommendation to buy or sell
> anything. Run it locally, read the limitations below, and treat every model output as a
> draft for a human to judge.

---

## See it in action

**Setup** — clone, `pnpm dev`, onboard in the browser, and the Command Center is live:

![Setup: from unconfigured to a live Command Center](docs/assets/readme-setup.gif)

**An analysis** — a real grounded dossier (Costco): verdict, valuation, lane findings, and the
thesis re-review card checking the recorded break triggers against newly-filed documents (renewal
rate, comp sales, and gross margin read out of the hash-verified filings):

![An example analysis dossier with the thesis re-review card](docs/assets/readme-analysis.gif)

**The pages** — intake → dossier → promote to watchlist → record your entry → the held-thesis view,
plus the pipeline, audit trail, the Learn docs, and the strategy overview:

![A tour of the main pages](docs/assets/readme-pages.gif)

---

## What it is

Owner's Manual runs a strategy-driven research workflow (default: Buffett 4-Pillar) on
your own machine, structured as **Buffett's four pillars applied in order**:
discovery → a grounded Shariah front gate → **Pillar 1: understand the
business** (the circle-of-competence gate answers two questions — how does
this company make money, and what key moving parts determine its success or
failure) → **Pillar 2: the moat** (structural protection, cite-checked, with
three harness-computed tests; a below-gate moat ends the run before further
spend) → **Pillar 3: management** (integrity & talent, DEF 14A-grounded, with
a veto) → **Pillar 4: value the business** (a computed intrinsic value on
free cash flow — the exit multiple anchored to named comparables — with the
30% margin-of-safety buy threshold and the 50% load-up threshold) → an adversarial inversion
pass → a drafted decision → watchlist/holding transitions you explicitly
author → ongoing check-ins as new SEC filings land. Everything is recorded in an append-only
SQLite event ledger with causation/correlation IDs, so every number and claim is
auditable back to its source.

The core design rule is **"code computes, judgment proposes"**:

- Deterministic code computes numbers (free cash flow, intrinsic value and
  the buy thresholds, ratios, the purification rate). Models never set a
  figure anyone acts on.
- Models propose judgments (moat, management, thesis) — but every citable source is
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

- Browser onboarding, Command Center, research cockpit, watchlist (the zone
  board), the held-thesis portfolio view, audit trail, provider status, and a
  Learn section documenting the strategy and grounding architecture.
- **Compact boards, one home per name**: each row is one line
  ("TICKER — Company Name · buy ≤ / now") that expands into a small decision
  card (verdict summary + the load-up → buy → IV price ladder) and links to
  the full analysis. The boards always display from the LATEST non-superseded
  analysis of a ticker, with its date shown; a held name lives on the
  portfolio only and returns to the watchlist when its holding closes.
- **Shariah screening is an opt-out** (Settings, default ON). OFF is
  fail-visible: transition gates record explicit DISABLED decisions (never a
  fake pass), boards show a neutral GATE OFF chip, the Shariah lanes stop
  spending provider quota, the quarterly re-screen disables, and the
  purification surfaces hide. Names admitted while OFF stay labeled that way
  in the ledger forever.
- **Human-authored exits**: "Remove from watchlist" and "Close holding
  (record the exit)" — reason recorded, machine actors rejected at the ledger
  level, raw events kept forever. Owner's Manual never trades; the close records
  the exit you executed at your broker.
- **The 10-K cadence**: check-ins cover the year; when one detects a new
  annual report, the boards raise "full re-analysis recommended" with a
  one-click superseding re-run (confirm-gated — the spend stays yours).
- The multi-agent research swarm with a hardened circle-of-competence gate
  (k-sample unanimous agreement + grounded evidence floors, tunable in
  Settings) — "outside the circle" is a recorded early exit, not a failure.
- **Thesis re-review**: on demand (dossier, watchlist, and portfolio pages) or
  via a worker tick, Owner's Manual diffs the filings that appeared since a decision
  against the recorded thesis and its break triggers, and records
  INTACT / WEAKENED / BROKEN — or, honestly, INCONCLUSIVE / UNVERIFIED when the
  evidence can't support a verdict. A broken thesis on a held name escalates a
  full re-run draft; a human still decides everything.
- **Insider Form 4 signal**: deterministic parsing of insider transactions
  (never a model judgment), a computed digest for the management lane, a
  sell-cluster trigger, and a dossier card.
- **Superinvestors (13F discovery)**: the idea source at the top of the
  funnel. The /discovery page tracks seven owner-curated value investors —
  Warren Buffett (Berkshire), Mohnish Pabrai (dormant filer, labeled), Michael
  Burry (Scion, intermittent filer, labeled), Li Lu (Himalaya), Seth Klarman
  (Baupost), Bill Ackman (Pershing Square), and Guy Spier (Aquamarine) — via
  their quarterly SEC 13F filings: latest portfolios as expandable manager
  cards, and buys/sells as one action heat-map matrix with your held/watched
  names flagged. Every figure is stamped "as of report · filed" (the ~45-day
  lag), the filing gives no reasons, and a signal is an idea to research —
  never a copy trade or an auto-promotion. See
  `docs/architecture/superinvestors-13f-discovery.md`. Watchlist/portfolio
  price checks ride the same human-fired worker.
- A small read-only CLI (`owners-manual start|status|doctor`; `owlfolio` compat alias) for launch/inspect/
  diagnose; all onboarding and decisions live in the browser.
- **Duty nudges — the alert IS the schedule.** There is no autonomous
  scheduler by design; instead the Command Center's attention rail computes,
  from the ledger, when a configured rhythm has lapsed — a 13F discovery
  harvest due, the monthly/quarterly thesis check-in due, the annual
  re-analysis of held names due — and links to where *you* run it. Every
  cadence knob in Settings is wired and notify-only: nothing initiates
  anything automatically (locked by test).
- **Pre-spend ticker validation.** A research case only starts for a real SEC
  filer: the typed ticker resolves against SEC's official filer list (the same
  universe the whole pipeline grounds in), `BRK.B` auto-normalizes to EDGAR's
  `BRK-B`, and an SEC outage fails open (the run's own grounding still fails
  closed).
- **An anomaly-guarded valuation base.** The DCF's starting free cash flow is
  the latest filed year *unless* it deviates more than 25% from the five-year
  median (one-off tax deposits, earnout payments) — then the median is used
  and a loud FACT flag names both figures on the dossier. Symmetric: windfall
  years are trimmed exactly like depressed ones.
- **A decision-trail audit view.** The audit page defaults to what matters —
  user-authored transitions, gates, verdicts, failures — with the full raw
  event stream one click away and trace links that always resolve.
- **English-only UI, translation on demand.** The app ships English; any
  language is a page translation away (the shell's Translate control drives
  Chromium's on-device Translator API; elsewhere it points at the browser's
  own translate — Firefox's runs fully on-device). Machine vocabulary the user
  must type, run, or search — tickers, ids, commands, env names — is marked
  `translate="no"` so no translator can corrupt it.
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
  default) runs a proven grounded tool loop and is usable with one API key;
  certification is an **optional deeper audit** a user can run per model, and
  support labels stay `experimental` until a target-specific report exists.
- **One model runs the whole analysis.** There is no model tiering: the single
  configured reasoning model runs every stage, so the analysis is only as good
  as the model you choose. Deterministic work (valuation math, ratio checks,
  parsing) is pure code and never uses a model.
- **The local provider (Ollama / vLLM) is UNSTABLE / EXPERIMENTAL / UNTESTED.**
  It is an OpenAI-compatible endpoint you run yourself; it has not been
  exercised end-to-end — expect failures. Runs fail closed and are never
  silently trusted.
- **Grounding quality depends on the routed model's tool support.** When a
  routed model does not support the multi-step tool loop, the grounded agent
  degrades to a no-tools path: the harness pre-verifies and injects the filing
  text instead of the model reading it mid-run via `read_source`. Judgments
  stay grounded and cite-checked either way, but interactive reads need a
  tool-loop-capable model.
- No broker sync, live trading, automatic portfolio actions, market-data
  ingestion hardening, tax-grade accounting, or formal Shariah scholar review.
- A historical (as-of-date) backtester is deferred pending point-in-time data
  quality.
- Known issue: the Next/Turbopack NFT import-trace warning noted below.

Gaps are tracked in `docs/ALPHA_READINESS.md`.

---

## Where this is headed

The intent is a **personal fiduciary analyst that runs on your machine** — an
always-on research department for one investor, with the judgment loop of a
disciplined value shop and a complete audit trail:

- **From human-fired to scheduled.** Every capability is already a one-tick,
  cadence-tagged unit. The next structural arc is the scheduler that fires
  them unattended — quarterly re-review sweeps when new filings land, daily
  price checks against frozen buy-belows, discovery sweeps feeding the
  candidate pipeline — governed by an explicit unattended-spend policy so an
  idle machine can never silently burn provider budget.
- **The agent watches; you decide — permanently.** "Human-authored
  irreversible transitions" is a design commitment, not an alpha limitation.
  The end state is not an auto-trader: it is a system that reads every filing
  the day it lands, keeps every thesis honestly marked (intact / weakened /
  broken), and interrupts you only when something crosses a line you defined.
- **Trust through evidence, not claims.** Per-model certification runs you can
  execute yourself, the golden-set qualification gate, and eventually a
  point-in-time backtester — so the system's track record is a recorded
  artifact, not marketing.
- **Grounded Shariah screening.** The front gate, harness-recomputed AAOIFI
  ratios, and the purification rate as dossier guidance — aiming for
  scholar-reviewable methodology, while staying honest that software is not a
  fatwa. (The obligation/payment bookkeeping was deliberately removed: its
  inputs are unverifiable by design, and confidently wrong purification
  amounts are worse than none.)
- **Local forever.** Your research, ledger, and keys stay on your machine. The
  only thing that leaves is a grounded, SSRF-guarded fetch to a public filing
  archive or the model provider you chose.

---

## Install & run the dashboard

Prerequisites: **Node.js 22+** (the ledger uses the built-in `node:sqlite`; Corepack ships with Node) and **git**. No
database to install — the ledger is a local SQLite file the app creates for
you.

**1. Clone and install**

```bash
git clone https://github.com/i314nk/owlfolio.git
cd owlfolio
corepack enable
corepack pnpm install
```

**2. Start the app**

```bash
corepack pnpm dev
```

…or use the zero-setup launcher, which starts the app *and* opens your
browser:

```bash
./owners-manual start
```

**3. Open the dashboard**

Go to `http://127.0.0.1:3000`. First launch walks you through onboarding in
the browser — pick personal-local mode, choose a provider (OpenRouter is the
default: create a key at openrouter.ai, paste it in) and pick a model. That's
it: the Command Center is your dashboard, and you can start your first
research run from there.

Everything is local: runtime state lives under `data/` (git-ignored), and API
keys live in a local env file (`OWLFOLIO_ENV_FILE`, default `~/.owlfolio/.env`)
— never in the ledger, logs, or git.

To check the install or diagnose problems:

```bash
./owners-manual status   # mode, provider/model, readiness, onboarding gate
./owners-manual doctor   # config, credential file permissions, ledger, certifications
```

Optional — run with explicit isolated paths:

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
  cli/       read-only launch/inspect/diagnose CLI (owners-manual start|status|doctor)
packages/
  ledger/    append-only SQLite event store, event contracts, projections
  workflow/  research swarm, grounding, EDGAR adapters, re-review, reviews
  providers/ provider catalog, adapters, certification runner
  strategies/ Buffett 4-Pillar strategy policy: source policy, valuation, checklist
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

Owner's Manual distinguishes **readiness** (a key is configured) from
**certification** (a recorded report proving the grounded research contract).
The retired CLI/OAuth lanes (Codex CLI, Claude CLI, Gemini CLI) were removed on
2026-06-29; the surviving providers all share one function-calling grounded
tool loop.

| Provider id | Role | Support |
| --- | --- | --- |
| `mock-provider` | Deterministic test provider (tests/e2e only — demo mode was removed; the app is unconfigured → personal-local) | **Certified** for the audited test slice. |
| `openrouter` | Default personal-local provider — one `OPENROUTER_API_KEY` routes to many models | Experimental. Proven grounded tool loop; **this is where nearly all live testing has happened**. Model choice is yours. |
| `local` | Local OpenAI-compatible endpoint you run yourself (Ollama / vLLM; `OWLFOLIO_LOCAL_API_BASE_URL`, key optional) | **UNSTABLE / EXPERIMENTAL / UNTESTED** — not exercised end-to-end; expect failures; fail-closed. Data stays on your machine; quality tracks the local model you serve. |

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
corepack pnpm --filter @owlfolio/worker dev -- --task-kind re_review_check
corepack pnpm --filter @owlfolio/worker dev -- --task-kind watchlist_monitor
```

Nine task kinds exist (the quarterly re-review check, the watchlist/holdings
monitors, the Shariah re-screen, the held+watched price poll, forecast
resolution, 13F discovery, and the cadence-engine passes). All are one-tick
and human-gated:
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
The Playwright e2e suite (9 specs) is green as of this branch.

---

## As a portfolio piece — what this demonstrates

Beyond the product itself, this repo is a worked example of a set of engineering
disciplines applied end-to-end:

- **Event sourcing as the source of truth** — an append-only SQLite ledger with
  stable event ids and causation/correlation chains; every screen is a
  projection, and curated views never rewrite the record.
- **Grounded LLM orchestration** — a multi-agent research swarm where models
  propose and the harness verifies: SSRF-guarded fetching, SHA-256'd sources,
  cite-checking against a hash-verified corpus, and fail-closed abstains when
  evidence doesn't hold.
- **A deterministic finance core** — valuation, thresholds, ratios, and the
  purification rate are pure code with recorded provenance; models never set a
  number anyone acts on.
- **Fail-closed, fail-visible design** — degraded states are named on the
  surface that shows them (gate-off chips, anomaly flags, unpriced dossiers)
  rather than silently papered over.
- **Test discipline** — TDD for behavior changes; ~2,400 unit/integration
  tests plus a Playwright e2e suite and a provider certification harness, all
  run as release gates.
- **Honest product copy as a testable invariant** — vocabulary rules (no
  roadmap promises, no overclaimed support levels) are locked by tests, not
  style guides.

---

## Shariah screening limitations

Shariah screening is a first-class, fully-grounded, **optional** feature (Settings,
default ON) — but this is an educational project, and its output is never a fatwa:

- The screens are local policy/audit aids. Before acting on any Shariah
  conclusion, obtain a ruling from certified Islamic scholars.
- The dossier states the purification RATE as guidance ("CONDITIONAL — purify
  ~X% of dividends"); tracking and paying it is yours. Owner's Manual deliberately
  keeps no books: bookkeeping built on unverifiable manual inputs was removed
  in the 2026-07 scale-down.
- Provider outputs are drafts/observations. User-authored transitions are
  required for watchlist confirmations, holding opens and closes, watchlist
  removals, and any portfolio action.

---

## Development rules

- TypeScript/pnpm only; the old Python `owlfolio` CLI instructions are retired.
- TDD for behavior changes: failing test first, confirm RED, then implement.
- Keep runtime/generated artifacts out of commits: `data/`, `.next/`, `test-results/`, `playwright-report/`, `*.tsbuildinfo`, `.playwright-runtime/`, `.worktrees/`.
- Never raise provider support claims above the latest certification report.
- Keep provider/worker-authored drafts separate from explicit user-authored ledger transitions.
- No secrets in git, logs, or provider reports.

MIT — see `LICENSE`.
