# Owner's Manual v2 research harness — internals & execution model

> **HISTORICAL NOTE (2026-07-19).** Parts of this document predate the 2026-06-29 CLI/OAuth
> provider excision, the 2026-07-18 provider consolidation (OpenRouter + an experimental local
> endpoint ONLY), and the model-tiering removal (ONE configured model runs every stage). References
> to Codex/Claude/Gemini CLI providers, direct API surfaces, T1/T2/T3 tiers, or `OWLFOLIO_MODEL_ROLE_*`
> are preserved as decision-record context — they do not describe the current app.


Verified: 2026-06-13, against the live code and the OpenRouter golden-set qualification run.

This is the "how the harness actually runs under the hood" reference — the living companion to the
design spec (`docs/superpowers/specs/2026-06-08-owlfolio-v2-multi-agent-research-harness-design.md`)
and its implementation plan. The spec says *what we decided*; this says *how it executes today and why*,
so the operating knowledge survives context loss. When you change a load-bearing mechanism (the grounded
loop, the EDGAR anchor, the golden set, model tiering, the tool-call budget), update the matching section
here in the same change.

Guiding principle (the two non-negotiables everything else is measured against):

1. **The grounding invariant** — no claim ships without a source the harness itself HTTP-fetched,
   SSRF-guarded, sha256-hashed, and can replay from the source ledger. A model-asserted fact with no
   captured source is discarded, not trusted.
2. **Wire-level control** — the harness owns the request to the model (strict JSON-schema transform,
   reasoning param, nullable-optionals, tool-name sanitization) and owns the numbers (EDGAR-anchored
   financials, deterministic valuation math). The model proposes judgment; the harness computes facts.

Anything that does not touch those two is borrowable; anything that does stays ours.

---

## 1. Execution shape: a strategy-driven, grounded, async swarm

A research case is **not** one LLM call. It is a swarm of separate grounded agent calls, run as
background/worker work and progressed through ledger events (the UI renders live from projections):

```
quick_screen  →  deep dive (7 specialist lanes, concurrent)  →  red-team  →  synthesis  →  decision draft
                  business_quality · moat · management · financial_quality · shariah · risks · valuation
```

Each lane is its own grounded agent. The strategy contract (`packages/strategies`,
`buffettMungerStrategy`) drives which lanes run, which hard gates must pass, and the valuation
discipline. The human authors every irreversible transition (watchlist confirm, holding open,
purification payment); the swarm only produces drafts/observations.

Key seams:
- `packages/workflow/src/researchSwarm.ts` — orchestrator (`runStrategyResearchSwarm`,
  `runResearchDeepDivePhase`). Decomposed into `researchSwarmSchemas.ts` + `researchSwarmCompute.ts`.
- `packages/workflow/src/groundedAgent.ts` — the per-agent grounding wrapper + tool loop.
- Worker entry: `apps/worker/src/runtime.ts` (`runProcessResearchQueueTask`,
  `runProcessDeepDiveQueueTask`); dispatched from `apps/worker/src/index.ts`.
- Web inline path: `apps/web/src/lib/workflow.ts`.

A grounded swarm of 7+ agents cannot run synchronously inside an HTTP request (one grounded call is
~80s and blew the 120s timeout), which is why research is worker/background-driven and `/api/research/start`
is enqueue-and-return.

---

## 2. The grounded tool loop (the autonomy + grounding mechanism)

Tool-capable providers (OpenRouter-routed models) gather their own evidence through a **two-phase
grounded loop** in `runGroundedAgentWithTools`:

- **Phase 1 — gather.** Reasoning ON. The model is given two harness tools and may call them up to
  `budget.max_tool_calls` times:
  - `fetch_source(url)` → the harness fetches the URL through the grounding firewall
    (`assertPublicHttpUrl` SSRF guard → fetch → sha256 → record in the source ledger) and returns a
    `source_id`. The model never sees a byte we did not capture.
  - `search_filings(ticker)` → EDGAR fundamentals via `fetchCompanyFundamentals` (precise, free for the
    primary case).
- **Phase 2 — synthesize.** A strict-JSON-schema final turn. The model emits the lane finding and may
  cite **only** `source_id`s the harness verified in Phase 1. Post-hoc verification re-enforces this:
  any cited id not in `verified_ids` is dropped (see the fail-closed test in
  `groundedAgentTools.test.ts`).

Why this loop exists: Codex (the subscription workhorse) gathers agentically in its own sandbox and its
proposals verify; but a bare OpenRouter model proposes URLs from memory and fabricates them — they fail
the grounding firewall. The loop makes the model *fetch real sources first*, then cite only those. A
live smoke proved it: a model searched EDGAR, fetched the real 10-Ks, content-hash-verified them, and
cited only verified ids.

Providers that do **not** support the loop (`multi-step-tool-loop: 'unsupported'`, e.g. mock, Codex CLI)
fall back to the existing propose-then-verify path unchanged. Capability gating lives in
`runGroundedAgentWithTools` (`provider.capabilities['multi-step-tool-loop'] !== 'unsupported' &&
typeof provider.runToolLoop === 'function'`).

**Why we keep the ~150-line manual loop instead of an SDK:** the loop builds the raw request, so the
wire-level fixes (strict-schema transform, reasoning param, nullable-optionals, tool-name sanitization)
all apply — they were the difference between gpt-5.5 scoring 0 and working. The two-phase
*strict-schema final turn* is non-standard (most agent SDKs do free-form tool loops). The manual loop
is portable to any OpenAI-compatible endpoint and is a transparent, auditable showcase of the grounding
enforcement. An SDK would save ~100 lines and hide the mechanic that is the whole point.

### 2a. Search/discovery is borrowable; grounding is not
OpenRouter server-side web search and Perplexity sonar do search *server-side* and inject results we
never see — we cannot SSRF-guard, hash, or replay them, so they can never be the source of truth. The
clean pattern (not yet built): wrap them as the *executor* behind a `web_search` tool that returns
candidate URLs, which the model then pulls through `fetch_source` (the mandatory grounding gate). We
wrap their search engine; `fetch_source` stays the grounding gate. We do not build a search engine.

---

## 3. The `max_tool_calls` advanced research-depth knob

`budget.max_tool_calls` caps how many grounded tool calls a single lane may make in Phase 1. Higher =
deeper sourcing, more cost/time; lower = faster/cheaper but shallower. It is now **config-backed and
user-adjustable**:

- Source of truth + bounds: `packages/shared/src/appConfig.ts` —
  `AutomationSettings.research_max_tool_calls`, `DEFAULT_RESEARCH_MAX_TOOL_CALLS = 10`,
  `RESEARCH_MAX_TOOL_CALLS_MIN = 1`, `RESEARCH_MAX_TOOL_CALLS_MAX = 50`, and
  `clampResearchMaxToolCalls()` (rounds, clamps, default-fills; `mergeAutomationSettings` applies it).
- UI: `apps/web/src/components/AutomationSettingsPanel.tsx` (Research section → "Research depth
  (advanced)"), persisted via `POST /api/settings/automation`. Import the bounds from
  `@owlfolio/shared/appConfig`, **not** the `@owlfolio/shared` barrel — the barrel re-exports
  `runtimeBackup` (node:fs) and won't bundle into a client component.
- Threading: `apps/web/src/lib/workflow.ts` and `apps/worker/src/index.ts` read the merged value and
  pass `maxToolCalls` into the swarm deps; `runStrategyResearchSwarm`/`runResearchDeepDivePhase`
  forward it (`...deps`) to `runGroundedAgentWithTools`, which sets `budget.max_tool_calls`
  (`?? DEFAULT_MAX_TOOL_CALLS`). Tested end-to-end in `groundedAgentTools.test.ts`.

---

## 4. EDGAR fundamentals & "judgment proposes, code computes" (the owner-earnings bridge)

`packages/workflow/src/secEdgar.ts` (`fetchCompanyFundamentals`) reads the primary filing's XBRL facts
(us-gaap for 10-K filers; ifrs-full for 20-F foreign filers like Novo Nordisk, which reports in DKK).
It resolves the **latest filed fiscal year** per field, multi-currency, with split-consistency handling.

In `researchSwarm.ts`, when EDGAR fundamentals are present the harness **owns the numbers**: D&A, SBC,
and diluted shares come straight from EDGAR. Net income is *anchored* to EDGAR's reported figure, with
the model allowed only a bounded one-off normalization overlay.

### 4a. The net-income anchor (`anchorNetIncomeToEdgar`, `rangeSanity.ts`) — three tiers
By how far the model's proposed NI sits from EDGAR's reported NI (fraction of |EDGAR NI|):

- **≤ `OE_NORMALIZATION_MAX_FRACTION` (35%)** → HONOR the model's normalization (a genuine one-off cleanup).
- **35% < dev ≤ `OE_GROSS_MISMATCH_FRACTION` (60%)** → CLAMP to the nearest band edge (over-aggressive
  normalization; the anchor caps how far the model may restate NI). Flag: `oe_bridge_net_income_clamped`.
- **dev > 60%, non-finite, or ≤0 while EDGAR positive** → SCALE/CURRENCY/UNITS error: discard the
  proposal and use EDGAR's REPORTED figure verbatim. Flag: `oe_bridge_net_income_scale_mismatch`.

**Why the third tier exists (the Novo Nordisk bug, fixed 2026-06-13):** Novo reports NI in DKK
(102,434M DKK in EDGAR), but the lane prompt asks for "$millions", so the model proposed a USD-scaled
NI (~14,845). The OLD code clamped that beyond-band proposal to the band *floor*
(102434 × 0.65 = 66,582.1 → 35% off → failed qualification). A ~7× gap is a currency/scale error, not a
normalization, so the harness now trusts the primary filing. (A future polish: tell the lane the filer's
reporting currency to reduce flag noise; the anchor is the load-bearing defense regardless.)

The recorded bridge carries `reporting_currency` (DKK for IFRS filers) so downstream consistency checks
and the qualification scorer compare like-for-like, never mixing a DKK bridge with a USD scale.

---

## 5. Model tiering & OpenRouter routing

- Strategy: **one OpenAI-compatible OpenRouter key routes to many models**, plus **Codex CLI with
  gpt-5.5** as the subscription workhorse. Reasoning-with-thinking is required for every research model.
- Curated catalog: `packages/providers/src/modelCatalog.ts` (T1 synthesis/judgment, T2 specialist,
  T3 monitor/screen; reasoning-only candidates). Role→tier derivation in
  `packages/strategies/src/autoTierAssignment.ts`; per-role pins via UI-managed env file
  (`OWLFOLIO_MODEL_ROLE_*`, `modelRoleEnvFile.ts`) layered over the AUTO defaults (file wins).
- Adapter: `packages/providers/src/openRouterProvider.ts` — live `/chat/completions`, strict
  `json_schema` transform, nullable-optionals, tool-name sanitization, reasoning param, and the
  `runToolLoop` implementation. `multi-step-tool-loop` capability is `'adapter'`.
- Data posture (`dataPosturePolicy.ts`): owner enabled ZDR-only routing for all models EXCEPT the
  Anthropic/OpenAI/Gemini frontier (vendor no-training terms; OpenRouter advises against ZDR there).
  Posture is recorded per-route into certs. ZDR is a privacy ceiling, not a quality gate.
- **No overclaiming:** a routed model is experimental/fail-closed until a target-specific latest
  certification + qualification report exists. Readiness ≠ certification ≠ qualification.

---

## 6. The qualification gate (golden set) — quality is verified, not assumed

"A model touches production only after passing the golden set."

- Frozen references: `packages/strategies/src/goldenSet.ts` (`GOLDEN_SET`, version-bumped on every
  change). Companies the analyst has deeply analyzed, with FIRM/approximate-tagged reference answers.
- Pure scorer: `packages/strategies/src/qualificationEval.ts` (`scoreQualification`). Criteria:
  moat EXACT-or-more-conservative; OE-bridge inputs within ±10% **in a matching currency**; Shariah on
  **permissibility** (`compliant`↔`conditional` are a matched pair — both holdable, differing only in
  purification; the only failure is permissible↔`non_compliant`, the safety-critical line); zero
  fabricated citations; ≥90% first-attempt schema-valid (aggregate). *Rationale for permissibility (not
  exact 3-tier): the compliant/conditional boundary is genuinely fuzzy — any cash-rich company earns
  some interest income → arguably "conditional" — so exact-3-tier matching failed correct models (COST,
  then MSFT) on a benign distinction. The prohibited-sector path is still tested both by this rule and
  by the quick-screen sector rejection (BTI/tobacco short-circuits).*
- Live runner (operator-run, real spend): `scripts/qualify-models.mjs` → writes
  `<provider>__<model>.qualification.latest.json`. Production gate `modelQualification.ts`
  (`isModelQualified`) reads the latest report; **fail-closed** (no/unreadable/not-qualified report ⇒
  not qualified).

The golden set is the analyst's INDEPENDENT reading of the primary filing — do **not** copy the
harness's own output into it, or the gate would test the harness against itself.

### 6a. Qualification findings (2026-06-13 correctness pass → 2026-06-14 live re-qualify + golden-set v4)
Re-verified every golden-set discrepancy against primary SEC filings (raw EDGAR XBRL), then re-ran the
live qualify (gpt-5.5 + opus) to confirm. The financial-correctness pass fully succeeded — after it, the
gate's ONLY remaining failures were Shariah classification (a judgment domain).

- **CPRT — golden set was wrong (fixed), then Shariah flipped to `compliant`.** The OE references (D&A
  120 / SBC 70, pinned FY2024) were approximate-from-memory and off ~80%/~46%; the harness correctly
  pulled the latest FY2025. Re-pinned FIRM to FY2025 (ended 2025-07-31): NI 1,552.449 / D&A 215.849 /
  SBC 38.004 / diluted shares 977.563M — the live re-qualify confirmed the OE bridge now passes on both
  models. Shariah was frozen `conditional` (analyst-conservative hunch); both models independently
  returned `compliant`, and CPRT is genuinely clean (permissible auctions, no prohibited income, passing
  ratios) → **flipped to `compliant` by owner decision 2026-06-14**.
- **NVO — golden set was right; the harness was wrong (fixed in code), now QUALIFIES.** EDGAR ProfitLoss
  is 102,434M DKK (matches the reference). Both models had output an identical 66,582.1 = 102434 × 0.65 —
  the old net-income anchor band floor. After the scale-mismatch fix (§4a), the live re-qualify shows
  **NVO passing on both models** (moat + Shariah + OE all match). Reference unchanged.
- **COST — removed from the golden set; replaced by MSFT.** COST's OE bridge was confirmed correct, but
  its Shariah status is genuinely contested: the owner ruled `non_compliant` (mainstream retail screens
  exclude Costco), while capable models compute `conditional`/`compliant` (permissible sector + ratios).
  With exact-match Shariah scoring, that contested call structurally blocked ALL qualification (no model
  could reach 3/3). **Owner decision 2026-06-14: swap COST for a clean-Shariah name** so the gate tests
  Shariah on an unambiguous case. The non_compliant path is still validated by sector-rejection (e.g.
  BTI/tobacco short-circuits at the quick screen — see the 2026-06-14 dogfood).
- **MSFT — the new clean-Shariah golden-set name (added).** Wide moat (Morningstar-rated), unambiguously
  Shariah-compliant (permissible software; debt/mktcap ~1%, cash+sec/mktcap ~3% vs 30% ceilings; top
  SPUS/Wahed holding). FIRM FY2025 refs (ended 2025-06-30): NI 101,832 / D&A 28,000 (Depreciation 22,000
  + intangible amortization 6,000) / SBC 11,974 / diluted shares 7,465M — independently verified against
  the filed concepts. Golden set bumped to `golden-set-2026-06-4`.

Live re-qualify result (golden-set v3, pre-swap): both gpt-5.5 and opus 1/3 — NVO passed; CPRT and COST
failed ONLY on Shariah classification; every OE bridge passed (both fixes confirmed working live). With
v4 (CPRT→compliant, COST→MSFT), all three names are clean-Shariah, so a capable model is expected to
qualify on the next run. Spend: ~$14.92 for the two qualify runs + the AAPL/COST/BTI dogfood.

Model-selection signal from the run: gpt-5.5 rated moat `wide` (correct, Morningstar-aligned); opus
rated `narrow` on all three — technically "more conservative" so it passes the gate rule, but in
production opus would reject every wide-moat name. gpt-5.5 looks better-calibrated for research.

### 6c. FIRST QUALIFIED MODEL (2026-06-14, golden-set v4 + permissibility-pair gate)
The v4 confirming re-qualify took gpt-5.5 from 1/3 (v3) to **2/3** raw: CPRT and NVO fully passed
(CPRT Shariah flip + NVO anchor fix both confirmed live); MSFT failed ONLY because the model returned
`conditional` vs a `compliant` reference — the fuzzy compliant/conditional boundary again (MSFT's ~$95B
cash earns interest → defensibly "conditional"). That motivated the **permissibility-pair Shariah gate**
(§6). Re-scoring the existing reports OFFLINE against the new gate (`.data/runlogs/rescore-reports.mjs`
— reconstructs lane outputs from the stored report, re-runs the real `scoreQualification`, NO live re-run,
NO spend) took gpt-5.5 to **3/3 → `isModelQualified` returns qualified: true.** This is Owner's Manual's first
production-qualified research model (`openrouter` / `openai/gpt-5.5`). The opus v4 run was cancelled
mid-flight to conserve OpenRouter budget (it isn't the workhorse — narrow-moat overconservatism).
**Codex/gpt-5.5 (subscription, no OpenRouter spend) v4 also qualified 3/3** (raw 2/3 → re-scored offline):
identical shape to the OpenRouter path — MSFT `conditional` (permissibility match), CPRT + NVO exact, all
OE bridges within ±10% — the only difference is Codex rated CPRT moat `moderate` (more conservative than
OpenRouter's `wide`; still passes). So both `openrouter`/`openai/gpt-5.5` and `openai` (Codex) read
qualified at the gate. The subscription workhorse matches the metered path. (Qualification reports live in
`.data/openrouter-cert/reports/`, gitignored; to make the production app honor them, point
`OWLFOLIO_PROVIDER_CERTIFICATION_DIR` there or copy the report into the configured cert dir.)

**Provider strategy (2026-06-14 owner decision):** make Codex/gpt-5.5 the daily workhorse (subscription →
~zero marginal cost per research run, so the harness can be iterated freely); keep OpenRouter as the
"qualify a candidate occasionally, then shelve" path (~$16 balance remaining, preserved).

**Known gate limits (hardening candidates, deferred until the core is proven):** only 3 names, all
wide-moat + permissible — thin coverage; no full-swarm `non_compliant` case (only sector-rejection);
references track the latest filed FY (drift). And note the gate tests moat/OE/Shariah *accuracy*, NOT
whether the valuation produces economically reasonable buy points — see the valuation-strictness finding
(the reinvestment-only growth model is blind to distribution-driven compounding, so it never buys quality
like AAPL/COST/MSFT at any price they trade). Qualifying a model and fixing that are independent.

### 6b. Dogfood (2026-06-14, gpt-5.5, AAPL/COST/BTI) — full swarm on real names
- **AAPL** WATCH · wide · EXPENSIVE (OE/sh $5.49, fair $72.91, buy $54.69; grounded NI $93,736M, 15,005M
  shares). Correct — wide-moat business above buy price.
- **COST** WATCH · wide · EXPENSIVE (fair $216, buy $162). Correct.
- **BTI** PASS (declined) · NON_COMPLIANT — the tobacco **sector hard-stop fired at the quick screen** and
  short-circuited in 24s (no wasteful deep dive). `PASS` here = "decline/set aside" (the verdict enum is
  BUY/WATCH/PASS/RESEARCH_MORE, no REJECT; PASS is the decline outcome, rendered as a neutral grey badge).
  This is the designed behavior and validates the non_compliant sector path.

---

## 7. Invariants to never regress
- No claim without a captured, replayable source (grounding firewall + post-hoc verification).
- The harness owns the request wire and the financial numbers; the model owns judgment.
- Worker stays dry-run/no-auto-approve; every irreversible transition is human-authored.
- No secrets in git, logs, ledger, source bundles, or provider/qualification reports (never print the
  OpenRouter key).
- Fail-closed everywhere external (EDGAR down, market cap unavailable, no qualification report).
- No overclaiming: UI/docs reflect the actual `*.latest.json`; readiness ≠ certification ≠ qualification.
