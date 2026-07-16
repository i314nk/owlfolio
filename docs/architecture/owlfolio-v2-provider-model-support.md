# Owner's Manual v2 provider/model support matrix

Verified: 2026-06-03, from public provider documentation, OpenRouter model inventory, and Owner's Manual phase-4 provider-surface implementation closeout. Updated 2026-06-09 for the multi-agent grounded research swarm and harness-verified source-grounding certification gate (see "Research execution model and grounding contract" below).

This document is a planning and certification handoff for the Owner's Manual v2 provider-status UI, live certification lane, and alpha documentation. It does not certify a provider by itself. Owner's Manual support labels must still be bounded by adapter implementation plus the latest certification report.

## Current implementation baseline

The current v2 repo has these catalog/runtime paths. **Update 2026-06-29:** the entire CLI/OAuth lane — Codex (`openai` / `openai-codex-cli`, app-server and one-shot exec), Claude CLI (`claude` / `claude-cli`), and Gemini CLI (`gemini-cli`) — was **excised**. Surviving providers are `mock-provider` plus OpenRouter and the direct API-key providers, all on the function-calling tool-loop. The `openai`/`anthropic` **vendor** ids and their models are preserved (they back `openai-api`/`anthropic-api` + OpenRouter routes); only the CLI **providers** were removed.

| Owner's Manual provider id | Runtime path | Current catalog label | Current certification stance |
|---|---|---:|---|
| `mock-provider` | deterministic in-process provider | `certified` | Certified for the audited local/demo vertical slice and regression tests. |
| `openrouter` | OpenAI-compatible meta-aggregator (`OpenRouterProvider`); the default grounded-loop provider | `experimental` | Proven `runToolLoop`; routes one key to many models, so each routed model still needs its own target-specific certification report before it is trusted. Fail-closed until then. |
| `openai-api` | Direct OpenAI API (OpenAI-compatible adapter = `OpenRouterProvider` configured per-endpoint) | `experimental` | Shares OpenRouter's `runToolLoop`; distinct from the retired Codex CLI lane. Fail-closed until a target-specific report exists. |
| `anthropic-api` | Direct Anthropic API (OpenAI-compatible adapter) | `experimental` | Shares OpenRouter's `runToolLoop`; distinct from the retired Claude CLI lane. Fail-closed until a target-specific report exists. |
| `gemini-developer-api` | Direct Gemini Developer API (OpenAI-compatible adapter) | `experimental` | Shares OpenRouter's `runToolLoop`; distinct from the retired Gemini CLI lane; paid Developer API remains an experimental candidate behind privacy/security gates, free/unpaid posture unsuitable for production. Fail-closed until a target-specific report exists. |

**Grounding deny-bridge invariant (all surviving providers).** Native/provider-side web search is disabled (or risks-lane-only), and every grounded tool call routes through the harness-injected `ProviderToolExecutor`. Confirmed by inspection (2026-06-29): `OpenRouterProvider.createChatCompletion` sends only `model` + `messages` + `max_tokens` + the unified `reasoning` param + our function `tools`/`response_format` — **no OpenRouter `plugins` field and no `:online` model suffix**, so it cannot quietly web-search into a decision lane. The direct API-key providers are `OpenRouterProvider` instances and inherit this body construction. When configuring any provider, prove the native-disable took by inspecting the *sent* request, not just the config struct.

## Research execution model and grounding contract (2026-06-09)

Research no longer runs as a single LLM call. The web app enqueues a `research_run_requested` event and the local worker executes a **strategy-driven multi-agent swarm** (`runStrategyResearchSwarm`): a quick-screen agent, a concurrent per-lane specialist swarm (the Buffett 4-Pillar lanes), and a synthesis/decision agent — each a separate provider call.

Every cited source is subject to a **harness-side grounding invariant**: agents propose citations, and the harness fetches each URL (public sources only, fail-closed, SSRF-guarded) and content-hashes it. Only harness-verified sources are attached to ledger events; unverifiable ones are recorded in the source bundle as `unavailable` and excluded from findings. The mock/demo path uses a deterministic grounder (no network); real providers use the fetching grounder.

The provider certification's `source-grounded-research-task` enforces this same invariant: a provider fails the scenario unless its cited sources are harness-verified (actually fetched and content-hashed). A provider that returns plausible-but-unfetchable or fabricated citations therefore cannot reach certified support for grounded research.

**Read path + recency tiering (provider tree ⇄ EDGAR tree seam).** Grounded filings are hashed but their full text is not retained, so a section-aware, hash-verified `read_source(source_id, {section, offset, limit})` grounded tool lets a model read the 10-K; its contract (owned by the EDGAR tree, consumed unchanged by the provider tool loop) is specified in [`read-source-contract.md`](./read-source-contract.md). Post-10-K recency tiers by type: **material 8-K events are grounded** by the EDGAR tree as hashed readable documents, while the **web tier stays risk color** — best-effort recency/consensus context, never a cover for an ungrounded gap. This split is stated to the model in the `risks`-lane brief (`RISKS_RECENCY_NOTE` in `packages/workflow/src/researchSwarm.ts`).

## Latest live certification evidence

Live harness run: 2026-06-10 (multi-agent grounded swarm + harness-verified source grounding enabled; Codex re-certified live on the real grounded-research path). Reports are persisted under `data/provider-certifications/` (gitignored runtime evidence) and surfaced by the Provider status page.

| Owner's Manual provider id | Latest report | Effective support | Evidence summary |
|---|---|---:|---|
| `mock-provider` | `mock-provider.latest.json` | `certified` | Completed: 18/18 scenarios passed (both `research_draft` and `scheduled_monitoring_dry_run` roles), including the source-grounded scenario verified through the deterministic mock grounder. |
| `claude` | `claude.latest.json` | `unsupported` | Not configured: Claude CLI readiness heartbeat timed out after 180000ms in this environment; enable Claude access or use an Anthropic API key before rerunning certification. |
| `openai` / `openai-codex-cli` | `openai.latest.json` | `experimental` | Completed: 14/18 scenarios passed with Codex OAuth and `gpt-5.5`. The `source-grounded-research-task` now **passes the grounding gate** on the real product path: Codex returns `proposed_sources` with real public URLs (e.g. SEC EDGAR filings, company IR/newsroom pages) and the harness post-hoc HTTP-fetches and content-hashes them (live run: 4/8 proposed sources genuinely verified; the rest — e.g. a 403-gated IR page — correctly fail closed). Four tool-call / multi-step / end-to-end / no-direct-ledger scenarios are skipped because Codex declares no `tool-function-calling`. Certified/production support remains **blocked at experimental** because the Codex subscription/workspace privacy retention/ZDR status is `not_verified` — a policy gate, not a capability gap. |
| `openai-api` | `openai-api.latest.json` | `unsupported` / not configured | Not run: no direct OpenAI API key in this environment (Codex CLI credentials do not certify the direct API surface). |
| `gemini-developer-api` | `gemini-developer-api.latest.json` | `unsupported` / not configured | Not run: no Gemini Developer API key. Privacy posture remains a blocker: free/unpaid Developer API is unsuitable for production/autonomous private-investment workflows, paid Developer API remains experimental behind privacy/security gates, and Vertex/Gemini Enterprise is a separate ZDR/data-residency candidate. |
| `gemini-cli` | none recorded yet | setup-only | No execution adapter/certification exists yet; onboarding must not imply runnable workflow execution. |

Do not upgrade catalog/docs above this evidence: only the deterministic mock provider is certified. The certification's `source-grounded-research-task` asserts the contract the product actually runs — the provider returns `proposed_sources` (real URLs) and the harness grounds them post-hoc via the same `groundProposedSources` HTTP-fetch+sha256 verification the swarm uses; the scenario passes only when at least one proposed source is genuinely fetched and content-hashed (it does **not** accept model self-attested inline citations). OpenAI Codex CLI now **passes** that grounding gate live, proving it can ground research on real fetchable sources, but its catalog support stays **experimental** because its privacy retention/ZDR posture is unverified — raising it to `certified` is a deliberate owner policy decision, not something this run is entitled to do. Claude CLI is unavailable in this environment despite credential-file presence; OpenAI/Gemini direct API candidates and Gemini CLI remain fail-closed until target-specific reports pass and their privacy/support caveats are accepted.

Additional direct API adapters such as `anthropic`, `perplexity`, `openrouter`, `xai`, `deepseek`, `qwen`, or `local-openai-compatible` are candidates, not current certified Owner's Manual providers.

## Expanded pluggable catalog (2026-06-09): OpenRouter meta + curated frontier candidates

The catalog now lists a broader, curated set of frontier providers so Owner's Manual can route to investment-grade-capable models once they are certified. Breadth is curated, not a free-for-all: only frontier reasoning + grounding-capable providers are added, and every new entry is `experimental`, fail-closed, and hidden from normal onboarding (`visible_in_onboarding: false`).

| Owner's Manual provider id | Surface | Default model | Catalog support | Investment-grade candidate | Status |
|---|---|---|---:|:--:|---|
| `openrouter` | `openrouter-api` | `openrouter/auto` | `experimental` | yes (frontier) | Meta-aggregator: one OpenAI-compatible API key routes to many models. Adapter is a fail-closed skeleton (`OpenRouterProvider`): readiness detects `OPENROUTER_API_KEY`, but execution throws until a target-specific certification report exists. Per-routed-model certification is required; OpenRouter cannot be certified provider-wide. |
| `deepseek` | `deepseek-api` | `deepseek-reasoner` | `experimental` | yes (frontier) | Direct API candidate; no adapter/certification yet. Capability varies per model (e.g. `deepseek-reasoner` tool-call limits). |
| `qwen` | `qwen-dashscope-api` | `qwen-max` | `experimental` | yes (frontier) | Alibaba Qwen via DashScope direct API candidate; no adapter/certification yet, and data-region posture is unverified. |
| `mistral` | `mistral-api` | `mistral-large-latest` | `experimental` | yes (frontier) | Direct API candidate (OpenAI-compatible); no adapter/certification yet. |

The existing real providers (`claude`, `openai`/Codex CLI, `openai-api`, `gemini-developer-api`, `gemini-cli`) are also flagged as frontier investment-grade candidates. The `mock-provider` is certified for the demo slice but is not an investment-grade candidate for live research.

### Investment-grade suitability rule (certification-bounded)

A `catalog.investment_grade_candidate` flag plus an `isInvestmentGradeSuitable(provider, latestCertification?)` helper derive an honest, certification-bounded suitability signal that the Providers UI badges and the research path consult:

- **`suitable for research`** — returned ONLY when the provider is an investment-grade candidate AND its latest certification report is `run_status: completed`, `support_level: certified`, and the `source-grounded-research-task` scenario passed (harness-verified citations). Today no live research provider meets this; the only `certified` catalog entry is `mock-provider`, which is not a candidate, so no provider is `suitable` in live research.
- **`candidate — not certified`** — the provider is a flagged frontier candidate but lacks a passing certified report. This is the state of every real provider and every newly-added entry today.
- **`not suitable for research`** — the provider is not an investment-grade candidate (or is otherwise unsupported).

Readiness is still not certification: a present `OPENROUTER_API_KEY`/`DEEPSEEK_API_KEY`/`DASHSCOPE_API_KEY`/`MISTRAL_API_KEY` is a credential signal only; the surface stays `is_ready: false` / `unsupported_surface` and fail-closed until an adapter and a target-specific certification report exist. The Providers page groups providers into **Investment-grade (certified)**, **Frontier candidates (experimental)**, and **Other / unsupported**, with a per-provider investment-grade badge alongside the certification-bounded effective-support label.

## Recommended support tiers

| Tier | Providers | Owner's Manual role | Certification rule |
|---|---|---|---|
| Certified default now | `mock-provider` | Demo, tests, e2e regression, certification harness sanity checks. | Keep certified only because behavior is deterministic and covered by tests. |
| Certified candidate, direct API | Anthropic direct API; OpenAI direct API | Core production candidates after adapters land: structured workflow, evidence analysis, final memo, Shariah/policy review. | Must pass all certified certification scenarios before catalog support is raised above experimental. |
| Supported candidate | Google Gemini direct API; Perplexity/Sonar; OpenRouter | Complementary roles: long-document analysis, web/finance search/evidence bundles, fallback/benchmark routing. | May be shown as supported for specific roles only after role-specific harness reports pass and privacy posture is recorded. |
| Experimental/plugin | Claude CLI, OpenAI Codex CLI, xAI, DeepSeek, Qwen, local OpenAI-compatible stacks such as Ollama/vLLM | Personal-local/dev, comparison runs, cost-sensitive extraction, local/offline experiments. | Do not certify for final investment outputs or Shariah conclusions until direct adapter + role certification evidence exists. |

## Role suitability matrix

| Provider family | Evidence gathering | Document analysis | Structured workflow | Shariah/policy review | Final memo | Local/dev fallback | Notes |
|---|---|---|---|---|---|---|---|
| Mock provider | Good for deterministic fixtures only | Fixture only | Certified demo path | Fixture only | Fixture only | Excellent | Never present as real research intelligence. |
| Anthropic direct API / Claude | Good if paired with explicit source collection | Strong long-context reasoning; current docs list Claude models with up to 1M-token context and large outputs | Candidate; verify structured outputs and tool-loop behavior in harness | Strong candidate for careful policy explanations | Strong candidate for memo synthesis | CLI path is dev/personal-local | Use direct API for certifiable production; keep CLI adapter experimental unless harness proves parity. |
| OpenAI direct API | Good with Responses/Agents tooling and file/search tools | Strong for extraction/normalization and multimodal/document tasks | Strong candidate for structured JSON workflows and workflow-state transitions | Candidate; require source-grounded and policy tests | Candidate | Codex CLI is useful for local/dev but not production certification | Do not equate Codex CLI success with OpenAI API certification. |
| Google Gemini | Candidate for long-context and multimodal evidence | Strong candidate for PDFs, video/audio/image, and very long context; docs advertise Gemini 3.5/3 family, long context, structured outputs, function calling, Google Search, URL context, file search, code execution | Candidate after schema/tool tests | Candidate with source-policy guardrails | Candidate second-opinion memo | No | Useful alternate analysis lane; certify only after role-specific behavior is stable. |
| Perplexity/Sonar | Strong evidence/search role; docs expose Search API, Sonar API, Agent API tools, finance search, academic search, web search, fetch URL content | Good for source discovery and citations, not canonical document parser | Limited: use as evidence provider, not ledger writer | Not recommended as sole policy authority | Not recommended as sole final memo writer | No | Best as source/evidence bundle adapter feeding another certified reasoning provider. |
| OpenRouter | Good for benchmarking if model supports web/search via provider | Depends on routed model | Depends on routed model and OpenRouter feature parity | Experimental only | Experimental only | Possible remote fallback | API exposes many models and shifting availability; record underlying model/provider/version on every run. |
| xAI / Grok | Candidate; docs advertise Responses, function calling, web/X search, code execution, structured outputs, files/collections | Candidate | Experimental | Experimental | Experimental | No | Useful for comparison and X/web-oriented evidence, but not v2 certified. |
| DeepSeek | Limited unless paired with external search | Good cost-sensitive reasoning/coding; docs list OpenAI/Anthropic-compatible bases, JSON output, tool calls for v4, and reasoning models | Candidate extraction/reasoning; note DeepSeek reasoner docs say function calling is not supported for `deepseek-reasoner` | Experimental | Experimental | Possible through API-compatible path | Treat reasoning-vs-tool-call capability per model, not provider-wide. |
| Qwen / Alibaba Model Studio | Candidate | Good long-context/cost-sensitive alternate; docs list Qwen3.5/Qwen3 models, 1M-token options, tool calling on selected models | Candidate extraction/structured workflow after tests | Experimental | Experimental | Possible through API-compatible path | Deployment/data-location modes vary; surface data-region caveats. |
| Local OpenAI-compatible: Ollama/vLLM | No live web unless paired with tools | Depends on local model | Good for offline/dev extraction if model supports JSON/tools | Not certified | Not certified | Excellent | Ollama docs list OpenAI-compatible chat completions, streaming, JSON mode, vision, tools; local models still need per-model validation. vLLM provides OpenAI-compatible serving for hosted local models. |

## Capability caveats to surface in UI

- Provider support is role-specific. A provider can be suitable for source discovery while unsuitable for final investment decisions.
- `support_level` must not exceed adapter capabilities or the latest `certification_report_recorded` event.
- Record provider id, model id, model version/alias, support tier, workflow role, and certification report id on provider-authored ledger proposals.
- CLI-backed providers are not production-equivalent to direct APIs. They depend on local auth, shell/CLI behavior, and user-specific account limits.
- Search/evidence providers should produce source bundles and citations, not direct portfolio writes.
- Final investment actions remain explicit user-authored ledger transitions; providers only draft recommendations/reviews.
- Data-retention and region behavior must be displayed for real providers before certification. Google/Qwen/OpenRouter routing can involve provider-specific regional or routing behavior; OpenRouter availability can shift by model endpoint.
- Cost/latency varies by role: long-context memos and multi-agent research should default to high-quality models only when audit value justifies cost; cheaper models should be limited to extraction/classification until certified.

## Default role recommendations for v2 alpha

| Workflow role | Default now | Candidate future default | Rationale |
|---|---|---|---|
| Demo/e2e | `mock-provider` | `mock-provider` | Stable deterministic audit trail. |
| Personal-local research | `openai` Codex CLI or `claude` CLI when ready | Anthropic/OpenAI direct API after certification | Current implementation supports CLI paths; production should prefer direct API adapters. |
| Evidence gathering | Mock fixtures in tests | Perplexity/Sonar plus optional Gemini/OpenAI search tools | Evidence/source collection should be separated from decision drafting. |
| Structured workflow execution | Mock/Codex CLI experimental | OpenAI direct API | Owner's Manual needs reliable JSON/schema/tool-state behavior. |
| Shariah/policy review | Mock fixtures until certified | Anthropic direct API primary; OpenAI/Gemini second-opinion candidates | Requires conservative source-grounded reasoning and auditable caveats. |
| Final memo synthesis | Mock fixtures until certified | Anthropic direct API primary; OpenAI/Gemini candidates | Requires long-context synthesis and explicit uncertainty handling. |
| Local/offline fallback | None certified | Ollama/vLLM per-model experimental | Good for dev/privacy experiments, not certified investment decisions. |

## Source notes

Public sources checked on 2026-06-01:

- Anthropic Claude models overview and pricing docs: model table includes Claude Opus/Sonnet/Haiku families, extended thinking, 1M-token context for top models, tool-use pricing, structured-output/citation docs in the docs index.
- OpenAI models docs: API docs expose Responses API, structured output, function calling, tools, Agents SDK, file/search/retrieval, MCP/connectors, and Codex docs. The API reference page blocked one direct fetch, so UI copy should cite the main models/docs pages and live certification rather than unverified detailed claims.
- Google Gemini API docs/pricing: docs expose Gemini 3/3.5 model families, structured outputs, function calling, long context, Google Search grounding, URL context, File Search, code execution, OpenAI compatibility, batch/flex/priority inference.
- Perplexity docs: `llms.txt` and model/pricing pages expose Search API, Sonar API, Agent API, OpenAI compatibility, web search, finance search, academic search, URL fetch, model fallback, structured/output control.
- OpenRouter `/api/v1/models`: live API returned current model inventory including Anthropic, OpenAI, Gemini, Perplexity and xAI model entries, context lengths, architecture modalities, and pricing fields. Treat as dynamic routing inventory, not certification.
- xAI docs: expose Grok models, Responses/text generation, function calling, structured outputs, web/X search, code execution, files/collections, remote MCP tools.
- DeepSeek docs: models/pricing page lists OpenAI and Anthropic-compatible base URLs, JSON output, tool calls, thinking modes, 1M context for v4; reasoner docs state `deepseek-reasoner` does not support function calling.
- Alibaba Qwen / Model Studio docs: model overview lists Qwen3.5/Qwen3 families, selected tool-calling support, long-context variants, global deployment modes, and pricing bands.
- Ollama OpenAI compatibility docs: list `/v1/chat/completions`, streaming, JSON mode, reproducible outputs, vision, tools, and limitations such as missing `tool_choice`/logprobs in the compatibility matrix.
- vLLM docs: OpenAI-compatible server documentation was reachable via redirect/HTML; use for local serving candidates but validate concrete served model behavior in Owner's Manual's harness.

## Handoff for downstream cards

- T10 provider status UI should display the role matrix, support tier, readiness state, latest certification report, and limitations separately. Do not collapse everything to one green/red badge.
- T13 live certification should generate reports per provider and per workflow role, and should record unavailable credentials as `not configured`/`skipped`, not failures.
- T14 alpha docs should document only the current implementation as usable: mock certified, Claude CLI/OpenAI Codex CLI experimental, direct APIs future candidates.
