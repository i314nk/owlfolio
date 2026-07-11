# Pipeline Restructure — gates first, focused passes, Munger lattice

**Status:** approved direction (owner, 2026-07-09). Implementation on branch `pipeline-restructure`.
**Prereqs (all landed):** Shariah gate A/B/C reliability slices; calibrated + k-sample circle gate;
structured-output repair retry; partial-source salvage; capability probe; prompt-calibration audit.

## Why

The deep dive's spine has three structural debts, each proven by live dogfooding:

1. **The quick screen is a fragile, redundant single point of failure.** One parse/auth failure kills
   the run; its Shariah-activity + worth-it checks duplicate what the (now reliable) Shariah gate and
   the (now calibrated) circle gate do better. Its rubric also carries a known pass-forward bias we
   agreed NOT to fix because the stage is being retired.
2. **Synthesis is overloaded.** One call owns verdict + the whole valuation judgment + the
   margin-of-safety self-grade + break triggers + risks. The week's structured-output failures were
   synthesis-shaped; the biggest schema fails most and dilutes attention per judgment.
3. **Expensive lanes run before cheap gates.** Names that were never going to pass (non-compliant,
   outside-circle) burn five lane calls first.

Design rule throughout: **code computes, judgment proposes** — every judgment gets one focused call;
everything gradable by arithmetic is graded by arithmetic.

## Target spine

```
intake → SHARIAH GATE (deterministic sector exclusion + AAOIFI ratios; reasoning pass only if needed)
       → CIRCLE GATE (calibrated k-sample; existing machinery, unchanged)
       → 5 LANES in parallel (unchanged: moat, risks, management, business_quality, financial)
       → VALUATION PASS (new focused call)
       → T0 MARGIN-OF-SAFETY GRADE (deterministic)
       → SYNTHESIS (slimmed: reconcile + verdict + MoS narrative + audit artifacts)
       → MUNGER LATTICE PASS (reframed red team)
       → decision draft → (existing: cross-checks, admit, watchlist…)
```

Lanes stay **parallel** (independence prevents anchoring); the **spine** is sequential where data
dependencies exist. Set-asides at either gate produce the existing coherent set-aside dossier.

---

## Phase 1 — front-load the gates, retire the quick screen

- Move the Shariah gate to the front: deterministic sector exclusion + AAOIFI ratio computation run
  BEFORE any lane spend (they already exist — A/B/C made them reliable); `runShariahReasoningPass`
  runs only when the deterministic result needs judgment, seeded with the grounded corpus (relocation
  findings preserved in `~/.claude/plans/create-a-seperate-git-serialized-newell.md`).
- Circle gate stays as-is (calibrated prompt, k-sample unanimity, evidence floors, settings) but is
  now the SECOND gate; the quick screen's "worth-it" judgment is absorbed by it ("durably
  predictable" is a stricter form of "worth a deep dive").
- **Retire the quick screen** — the tail that must not be tripped over:
  - Projections stay legacy-tolerant: old cases carry `quick_screen_drafted` events; folds keep
    working (read-only compat, no new emissions).
  - `quick_screen_approval` automation setting: remove from UI + settings route; `mergeAutomationSettings`
    tolerates the stale persisted key (drop silently).
  - E2e specs drive the quick-screen flow (`personal-workflow-intake`, `accounting-monthly` set
    `quick_screen_approval: 'automatic'`) — update to the new gate flow.
  - Pipeline page / research progress labels: stage taxonomy changes (quick_screen → shariah_gate +
    circle_gate stages); update `researchRunProgress` labels + PipelineObservatory stage map.
  - Learn/strategy copy pins ("quick screen is a lightweight Shariah-first gate…") — update copy + tests.
- **Per-stage cost stamping (scheduler prerequisite):** every stage event gains
  `stage_cost: { provider_calls, input_tokens?, output_tokens?, wall_ms }` (whatever the provider
  reports; wall_ms always). Additive payload fields; contract doc updated. This is the data the
  unattended-spend policy will be written against.

## Phase 2 — the valuation pass + deterministic MoS

- **New focused call `valuation_judgment_drafted`** between lanes and synthesis. Inputs: the financial
  lane's grounded owner-earnings bridge (T0-computed), the resolved moat class, circle-gate
  drivers/breakers. Owns exactly what synthesis carries today (moved, not redesigned):
  `owner_earnings_basis` + citation (cite-checked), `assumed_growth` + rationale + citation
  (cite-checked), `proposed_buy_below` (verbatim), `valuation_status` — with the existing
  deterministic rails (market-implied-growth cross-check both directions, growth caps) unchanged.
- **Foreign-filer FX (the deferred B follow-up) lands HERE:** the pass receives the reporting
  currency + the ADR ratio context; fair-value/buy-below emitted in the PRICE currency with the FX
  conversion computed by T0 code (never the model). NVO is the acceptance case (DKK fundamentals,
  USD ADR).
- **T0 margin-of-safety grade:** adequacy (`adequate|thin|inadequate`) becomes arithmetic — price
  discount (buy-below vs reference value) measured against the required margin for the resolved moat
  tier (the required-MoS-by-moat-class params already exist; post-mortems use them). The model no
  longer grades its own margin. Synthesis keeps the NARRATIVE: which source (price/moat/both) the
  margin rests on and why — judgment about substitution, not the grade.
- **Synthesis slims** to reconciliation + verdict + `key_wrong_assumption`/`thesis_break_triggers`
  (with the audit-bookkeeping decoupling line already shipped) + the MoS narrative, consuming the
  valuation artifact.
- **Cheap re-underwrite unlock:** the annual re-underwrite becomes gates + valuation pass + synthesis
  on fresh numbers, REUSING lane findings when the re-review filing delta shows nothing qualitative
  changed. (Design the events for it now; the re-underwrite wiring itself may be a follow-up.)

## Phase 3 — the Munger lattice (red team reframed)

One pass, fixed lens set, structured per-lens findings (NOT five provider calls):

- **Inversion** — how does this fail? Attacks the recorded thesis AND the valuation artifact's
  assumed_growth specifically.
- **Incentives** — where do comp structure (grounded proxy) / insider behavior (Form 4 digest,
  already computed) corrupt the exact metrics the thesis relies on?
- **Psychology of misjudgment** — which classic biases is THIS thesis most exposed to (social proof,
  authority halo, commitment to a prior verdict…)? ADVISORY-ONLY findings, labeled as reasoning.
- **Second-order effects** — competitor/customer/supplier responses the thesis assumes away.

Rules (learned this week): each lens states "no material finding" is an equally valid answer
(symmetric framing — no manufactured objections); factual claims are cite-checked, psychology flags
are advisory-labeled; the pass still emits ONE `strongest_objection` synthesized from the lenses so
existing projections/UI keep working, now with lens attribution for the dossier.

## Threaded throughout

- **Insider refinements:** Form 4 sell-cluster counts as a STRONG re-review trigger in
  `checkForNewFilings` (deterministic thresholds); the re-review pass gains a computed
  "insider delta since decision" context block; the dossier insider card moves into the management
  lane's section, promoting to the decision layer only when the cluster threshold trips.
- **Stage-resume-friendly events:** each stage event carries enough (corpus refs, stage inputs hash)
  that a future re-run can resume from the failed stage. Design-only this arc — no resume engine yet.
- **Red-team/cross-check ordering:** moat + Shariah cross-checks unchanged; the lattice pass replaces
  the red-team slot after synthesis.

## Deliberately out of scope

- The scheduler (next arc; consumes the cost stamps).
- The dossier-as-argument display redesign (own arc after the stages settle; the lattice's
  lens-attributed output is designed for it).
- Provider fallback mid-run; partial-run resume ENGINE (events designed for it only).
- Golden-set qualification button (queued separately).
- Shariah cross-check "stricter-when-in-doubt" (owner policy, untouched).

## Verification

- TDD per slice; projections legacy-tolerance pinned (old quick-screen cases still render).
- Full gates per phase: workspace suite, typecheck/lint 0, `next build`, e2e (updated specs) 8/8.
- Live dogfood per phase on the sandbox: phase 1 = a non-compliant ticker + an outside-circle ticker
  die cheaply at the gates (zero lane spend, coherent set-aside dossiers); phase 2 = NVO values in
  USD correctly + a re-run shows the valuation artifact + T0 MoS grade on the dossier; phase 3 = a
  full run shows the four-lens panel with at least one honestly-clean lens.
- Commit per slice on `pipeline-restructure`; PR at the end of each phase (owner merges).

---

## Phase 1 implementation notes (seam map, 2026-07-09)

**Favorable finding:** the circle gate ALREADY runs before the lanes (researchSwarm.ts ~1160 circle →
~1390 queueDeepDive → ~1413 lanes). Phase 1's surgery is therefore the QUICK-SCREEN REPLACEMENT, not
a circle move. The Shariah reasoning pass currently runs AFTER lanes (~1715); the sector judgment
currently lives in the quick-screen PROMPT; AAOIFI ratios compute in synthesis (~2814) and take
`impermissible_income` (a model judgment) as input.

**Slices:**
- **S1 — the front Shariah gate**: new `shariah_gate_judged` event (contract + projection stage).
  Composition: deterministic AAOIFI ratio math on fundamentals + market cap (computable pre-lane;
  impermissible income UNDETERMINED at this point is fine — it refines later in the pass) + ONE
  grounded model call = `runShariahReasoningPass` moved to the front, seeded with the pre-verified
  EDGAR filing block (the same injection the quick screen gets today; no lanes exist yet so no
  laneDigest — the relocation notes anticipated this). NON_COMPLIANT → the existing set-aside
  dossier path (reuse the quick-screen short-circuit code at ~751-843, reworded reason).
- **S2 — retire the quick screen**: remove the call + prompt; REDIRECT the causation chain
  (`queued_for_deep_dive.causation_id` = quick_screen event → the shariah/circle gate event —
  the riskiest coupling; thread the gate event id through). Keep `draftQuickScreen` code for
  legacy replay only. The circle gate inherits gate-#2 position unchanged.
- **S3 — the approval pause successor**: `quick_screen_approval` is retired from UI/route;
  its SEMANTICS survive as `deep_dive_approval` ('automatic' | 'review', default 'review') applied
  AFTER the two gates pass and BEFORE lane spend (the pause is now behind the cheap gates — better
  than today). mergeAutomationSettings migrates the old key's value; the stale key is tolerated.
- **S4 — taxonomy + copy tail**: researchCaseProjection gains 'shariah_gate_judged' stage
  (legacy 'quick_screened' folds read-only); pipelineProjection PipelineStageKey 'quick_screen' →
  'shariah_gate' (+ 'circle' exists); researchRunProgress already has 'circle'; PipelineObservatory
  labels; Learn/strategy copy pins ("quick screen" → the two-gate story); e2e specs updated to the
  new flow (they set quick_screen_approval: 'automatic' — becomes deep_dive_approval).
- **S5 — cost stamping**: ProviderRunMetadata gains optional `input_tokens/output_tokens`
  (OpenRouter runToolLoop captures usage from the API response but doesn't surface it — plumb it),
  and every stage-event append site stamps `stage_cost: { provider_calls, input_tokens?,
  output_tokens?, wall_ms }`.
  - LANDED (Phase 1): the token plumb end-to-end (adapter sums usage across gather rounds +
    synthesis + repair retries → metadata → GroundedAgentResult.usage), `stage_cost` on
    `shariah_gate_judged` (S1a) and on `circle_competence_judged` (k samples + tokens + wall time).
  - RESIDUAL (ride Phase 2's valuation-pass event work): stamping the lane/synthesis/red-team
    stages — their events flow through the fixed-payload pipeline helpers and the lane outcomes
    don't surface usage yet; Phase 2 touches those seams anyway.

**Do-not-break list:** ticker→company resolution (currently a quick-screen side effect — verify
where company_id resolution happens and preserve it), the review-pause worker/UI flow
(deep_dive_approval_pending event consumers), set-aside dossier coherence, old-case rendering.

### S1b wiring spec (pinned 2026-07-09; S1a = commit 48aee5a)

Insert in `runStrategyResearchSwarm` (researchSwarm.ts) immediately AFTER the pre-verified block
build (`qsPreVerifiedSourcesBlock`, ~L655) and BEFORE the quick-screen call:

1. `const shariahGateRuntime = resolveRoleRuntime('lane_shariah', provider, command)`
2. `runShariahGatePhase(store, { research_case_id, company_id, ticker, model_id:
   shariahGateRuntime.model_id, causation_event_id: researchCase.event_id }, { reasoningPass: () =>
   runShariahReasoningPass(shariahGateRuntime.provider, { research_case_id, ticker, model_id,
   laneDigest: [], corpusSourceIds: [...accumulated.values()].map(s => s.source_id),
   preVerifiedSourceIds: qsPrimaryFilingSourceId ? [qsPrimaryFilingSourceId] : [],
   impermissibleIncomeLines: qsFundamentals?.latest_annual?.impermissible_income_lines }, { ground,
   grounding, readCorpus: accumulated }), corpusSourceIds, /* ratioInputs: SKIP in S1b — market cap
   resolves later; synthesis recompute unchanged */ })`
3. `if (!gate.allowed)`: emit the set-aside exactly like the quick-screen `isRejected` block
   (~L751-843: buffett_munger_analysis_drafted PASS + decision + same return shape) with
   rejectionReason = gate.reason, strategyCompliance 'NON_COMPLIANT', shariah_status from the gate —
   read the FULL isRejected block first and mirror its return contract precisely.
4. Orchestration test: swarm test fake returns sector_status 'non_compliant' from the Shariah-pass
   schema → assert shariah_gate_judged(allowed:false) + PASS decision + ZERO quick-screen/lane events
   … plus the happy path: gate open → the run proceeds exactly as before (event sequence unchanged
   apart from the new leading gate event).
5. NOTE: after S1b the reasoning pass runs TWICE per full run (gate + post-lane). Acceptable for one
   slice; S2 dedupes by reusing the gate's judgment at synthesis when the corpus hash is unchanged.

---

## Phase 2 implementation notes (pinned 2026-07-11; branch `phase2-valuation-pass` off main@283df3b)

Dogfood targets from the Phase-1 live week: the model buy-below swing ($340/$450/$420 across three
SPGI runs), kimi under-filling monolithic synthesis fields (net_income 0, missing buy-below,
decision_reason "BUY"), and the SPGI amortization collision (merger-intangible D&A vs maintenance
capex fighting inside one field).

**Status (2026-07-11, PHASE 2 COMPLETE):** V1 DONE (510b7c7 + bb20521). V2 DONE (b285dff,
owner-validated). V3 DONE (d504f95, option A; NVO LIVE acceptance PASSED — DKK→USD @ live rate,
assumed-1 flag, moat-gated set-aside). V5 DONE (866258d). V4 DONE (7cb76ed — after the live
checkpoint proved the stage grounded 2/2 on kimi; monolithic fields dropped, stage retry-forced,
currency instructions added). **V6 WITHDRAWN (resolved by prior fixes):** the bridge already adds
back ALL D&A (OE = NI + D&A − maint − SBC − ΔNWC), so merger amortization is excluded from OE by
construction — an explicit intangible_amortization_addback would DOUBLE-COUNT; the real SPGI
collision (the D&A-tied proxy overstating maintenance capex) was fixed by the capex-envelope cap
(e69fc51). Live-week riders shipped alongside: the gated-dossier invariant (no unvetted numbers on
set-asides), no-buy-zone-on-moat-fail, 'Not priced (moat gate)' labels.

**Slices:**
- **V1 — the always-on valuation pass + event**: PROMOTE the existing focused
  `runValuationReasoningPass` (today a fallback when the monolithic decision drops
  valuation_reasoning) to an ALWAYS-ON stage between the lanes and synthesis, emitting
  `valuation_judgment_drafted` (contract + stage_cost + researchCaseProjection stage). It owns what
  synthesis carries today (MOVED, not redesigned): owner_earnings_basis + citation (cite-checked),
  assumed_growth + rationale + citation (cite-checked), proposed_buy_below (verbatim),
  valuation_status. Inputs: the T0 EDGAR OE bridge, the resolved moat tier, circle drivers/breakers.
  Existing deterministic rails unchanged (implied-growth cross-checks both directions, growth caps,
  the absurd-buy-below WATCH clamp). Synthesis stops REQUIRING valuation_reasoning once V4 lands;
  V1 keeps the monolithic fields tolerated-but-ignored.
- **V2 — T0 margin-of-safety grade**: adequacy (`adequate|thin|inadequate`) becomes arithmetic —
  price discount (buy-below vs the harness reference value) vs the required margin for the resolved
  moat tier (required-MoS-by-moat params exist; post-mortems use them). The model no longer grades
  its own margin; margin_of_safety_judgment keeps ONLY the narrative (sources + reasoning), the
  grade field is harness-computed. Audit-only posture preserved (Guard 1: never gates).
- **V3 — foreign-filer FX**: the pass receives reporting currency + ADR ratio context; fair-value /
  buy-below emitted in the PRICE currency with the conversion computed by T0 code (never the model).
  NVO is the acceptance case (DKK fundamentals, USD ADR). Builds on the existing
  resolveFxRateValue + the DKK AAOIFI ratio handling.
- **V4 — synthesis slims**: DecisionAgentSchema drops the valuation-owned fields (bridge fields,
  proposed_buy_below, valuation_reasoning, valuation_status); synthesis consumes the V1 artifact and
  keeps verdict + reconciliation + key_wrong_assumption/thesis_break_triggers + the MoS NARRATIVE.
  Kimi reliability bet: smaller focused schemas are where it is dependable.
- **V5 — S5 stage-cost residual**: stamp `stage_cost` on lane findings, red team, the new valuation
  event, and synthesis (thread GroundedAgentResult.usage through LaneOutcome + the pass outcomes).
- **V6 — amortization add-back (design + cite-gated input)**: an explicit
  `intangible_amortization_addback` line in the OE bridge (model-judged, cite-gated, bounded by the
  EDGAR amortization figure) so amortization-heavy filers (SPGI) stop expressing the judgment by
  distorting maintenance_capex. Envelope: [0, min(D&A, EDGAR-reported intangible amortization when
  tagged)]. Advisory divergence flag mirrors maintenance_capex_below_proxy.

**Do-not-break list:** the monolithic-decision fallback path until V4 completes; legacy dossiers
rendering valuation off the analysis payload; the buy-zone/absurd-growth clamp family (now keyed off
the V1 artifact's buy-below); admit-judgment cite-checks; re-review + post-mortem readers of
margin_of_safety_judgment.

**Acceptance (live, per plan):** NVO values in USD correctly; a re-run shows the valuation artifact +
T0 MoS grade on the dossier; buy-below run-to-run variance visibly bounded by the arithmetic rails.
