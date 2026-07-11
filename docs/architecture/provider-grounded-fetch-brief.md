# Brief: Grounded, agentic, live provider fetch

**Audience:** the provider agent working in `packages/providers`.
**Status:** design brief / investigation request. Not yet implemented.

## Goal

Give providers **agentic** (model-driven) and **live** (current-web) source retrieval, **without
losing Owlfolio's audit guarantee**. Today only OpenRouter has a working tool loop; Claude CLI and
the OpenAI Codex CLI are `multi-step-tool-loop: unsupported`, so they propose URLs from training
memory and the harness verifies post-hoc. We want better fetch — but every cited source must stay
content-hashed and ledgered.

## The non-negotiable invariant

> **A provider may *propose* sources; only the harness may *verify* them.**

All fetching routes through the workflow-layer grounding (`fetchAndCaptureSource` → SSRF guard +
SHA-256 + source-ledger). `packages/providers` must **not** import grounding. The harness builds the
grounded tool executor (`buildGroundedToolExecutor`, `packages/workflow/src/groundedAgent.ts`) and
injects it into `provider.runToolLoop`. **Never enable a provider's native web *browsing* as the
retrieval path** — that puts retrieval in the model's black box and destroys reproducibility/audit.
Native web search is acceptable **only** if it returns *URLs* that the harness then re-fetches +
hashes + ledgers.

## The simplest architecture: harness never searches, it only verifies

Owlfolio already has a propose-then-verify path (`runGroundedAgent` grounds the model's
`proposed_sources` via `groundProposedSources`). Reuse it:

1. **Offload discovery** → the provider's live web tool puts candidate **URLs** into the response.
2. **Keep verify** → the harness re-fetches *those* URLs with the grounding code that already exists.
3. **No custom harness search backend required** (no DDG scraping, no Brave keys to maintain).

This works because the decision-critical data is already EDGAR + harness-computed. Tier the sources:

| Tier | Source | Grounding | May support |
|---|---|---|---|
| Decision-grade | EDGAR filings + harness-computed numbers | hard (done) | valuation, moat, Shariah, the verdict |
| Context-grade | provider live web search | re-fetched + hashed, best-effort | risks / recency context only |

The lane whitelist (`packages/strategies/src/sourcePolicy.ts`) already enforces most of this:
classification lanes reject web/media; only `risks` admits them. If a context URL fails to ground,
**drop it (fail-closed)** — the thesis still rests on the hard-grounded EDGAR tier.

## Freshness constraint (critical)

"Offload to the model" must mean **live web search**, not **training memory** (the model's cutoff is
too old for current events). Enforce:

- The provider must expose a **live** web-search tool that **returns real URLs**. A provider with no
  live tool (Codex `exec` today, Claude CLI) **must not be relied on for current/qualitative claims**
  — EDGAR carries those cases instead.
- Prompt discipline: "for anything after your training cutoff, retrieve via the web tool and cite the
  fetched source; never assert current facts from memory."
- Recency check on the context tier: captured sources carry `fetched_at`; flag/reject risks-lane
  sources that are stale or predate the latest filing.
- The verify gate already auto-drops dead/stale URLs (they 404 → unground → uncitable). Worst case is
  *no* source, never a fabricated one.

## Current state (findings)

- `multi-step-tool-loop`: OpenRouter `adapter` (only real `runToolLoop` impl); Claude CLI
  `unsupported`; OpenAI Codex CLI `unsupported`; mock `native` (test only).
- Owlfolio's Codex provider (`openaiCodexCliProvider.ts`) runs **one-shot**
  `codex exec --sandbox read-only --output-schema …` — no loop, no network, no tools. This is why it
  feels clunky/stale.
- Hermes drives the **same `codex` binary** via **`codex app-server`** (persistent JSON-RPC-over-stdio
  agent runtime) — which is why it is smooth and current.

## Tasks (prioritized)

1. **Fix Codex via a grounded `codex app-server` transport** (highest leverage — the main model in
   use). Replace one-shot `codex exec` with a persistent app-server session, but **intercept Codex's
   `requestApproval` / `exec` / tool events and route any fetch through the harness grounding** —
   "offload the *driving* to Codex, keep the *fetching* in the harness." Reference implementation in
   hermes:
   - `/home/hermes_agent/.hermes/hermes-agent/agent/transports/codex_app_server.py` (spawns
     `[codex_bin, "app-server"]`, JSON-RPC 2.0 over stdio)
   - `/home/hermes_agent/.hermes/hermes-agent/agent/transports/codex_app_server_session.py`
     (approval/tool bridge, `auto_approve_exec`)
   - `/home/hermes_agent/.hermes/hermes-agent/agent/codex_runtime.py` (turn driver)
2. **Broaden the tool loop.** Implement `runToolLoop` on more providers; for OpenAI models the clean
   path is a real `openai-api` provider (currently catalog-only, **not** in `providerFactory.ts`)
   using native function-calling + the injected grounded executor. OpenRouter (`openRouterProvider.ts`)
   already proves the pattern.
3. **Keep the executor harness-side.** Providers implement transport only; the harness injects
   `buildGroundedToolExecutor`. Do not let providers import or perform grounding.
4. **Certify.** Each provider's agentic fetch must pass the `multi-step-tool-loop` scenario in
   `certificationRunner.ts` before it is claimed (readiness ≠ certification).

## Coordination (do not duplicate)

- Branch `live-search-discovery` (commit `d7144e7`, workflow-only, **not merged**) adds harness-side
  DuckDuckGo discovery (`packages/workflow/src/webSearch.ts`, `sourceDiscovery.ts`). Its discovery
  logic is intended to become a grounded `web_search` tool *inside* the loop. Given the "offload
  discovery to the provider" direction, the custom DDG search backend may be **shelved** — but the
  re-fetch-and-hash step is kept. Coordinate before changing `packages/workflow/groundedAgent.ts`.
- The providers-page UI work is on `feat+v02-cli-onboarding`; avoid colliding on
  `apps/web/src/lib/providerKeys.ts` / `ProviderKeysPanel.tsx`.

## Open decision (owner)

OpenRouter (smooth now, but third-party hop for portfolio data) vs. direct `openai-api` (tighter
privacy) vs. `codex app-server`. Driver is **privacy/cost**, not capability.

## One-line summary

> A provider may **propose** sources via a **live** web tool; only the **harness verifies** them
> (re-fetch + SHA-256 + ledger); **EDGAR + harness numbers decide**. No live web tool ⇒ not trusted
> for current/qualitative claims.
