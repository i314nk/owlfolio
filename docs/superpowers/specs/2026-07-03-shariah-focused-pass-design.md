# Shariah Compliance as a Dedicated Focused Pass — Design

**Date:** 2026-07-03
**Status:** design — awaiting review before planning

## Goal

Move Shariah compliance out of the parallel deep-dive **lane** set into a dedicated, always-run **focused pass** — mirroring the `valuationReasoningPass` we just shipped. Compliance is a first-class domain that deserves its own grounded, cite-checked call rather than competing for attention as one of N parallel lanes. The deep dive drops to **5 lanes** (business_quality, moat, management, financial_quality, risks).

## Motivation

- **First-class compliance.** Shariah correctness matters more than a normal analytical lane; a dedicated pass gives it isolated grounding + independent fail-closing.
- **Already special-cased.** The shariah lane doesn't fit the generic lane mold — it emits a *judgment overlay* (`sector_status` + `impermissible_income`) that the harness feeds into a deterministic AAOIFI ratio recompute + purification math. That's exactly the "model grounds the inputs, harness computes" shape the focused-pass pattern is built for.
- **The pass pattern is robust.** The `valuationReasoningPass` grounded reliably across every live run where lanes intermittently skipped. (Note: the lane-skipping root cause was the Task-1 `finding_summary` placeholder guard discarding grounded sources — reverted separately in this branch. So the pass is NOT needed to fix lane-vanishing; it's warranted on the compliance-first-class + always-run grounds above.)

## Architecture

New `packages/workflow/src/shariahReasoningPass.ts`, sibling to `valuationReasoningPass.ts`. It runs during **synthesis**, at the same point the valuation pass runs, and **always** runs (not gated on the quick-screen compliance read — thorough by design).

**What moves out of the lane, into the pass:**
- `SHARIAH_OVERLAY_PROMPT` and `ShariahLaneSchema` (from `researchSwarmSchemas.ts`) relocate to back the pass.
- The `runValidatedAgent(... SHARIAH_OVERLAY_PROMPT, ShariahLaneSchema, requiredFields:[sector_status, impermissible_income])` call currently inside the shariah-lane branch of `researchSwarm.ts` (~1335–1378) becomes `runShariahReasoningPass(...)`, invoked from the synthesis stage.

**What it produces (unchanged in shape):** the grounded compliance overlay —
- `sector_status`: `compliant | conditional | non_compliant`, confirmed with cited segment revenue.
- `impermissible_income`: $M of non-permissible income, or `null` (undetermined — never guessed 0).
- a short **cited** rationale (owner of the judgment; the harness owns the ratios).
All cite-checked against verified filing sources, exactly like the valuation pass cite-checks its owner-earnings / growth citations.

**What stays exactly as-is:** the deterministic AAOIFI ratio recompute + verdict + purification % (`shariahFinancialRatios` / `harnessCompute`). The pass only supplies the grounded overlay inputs; the harness still divides impermissible income by EDGAR revenue and applies the AAOIFI thresholds. The `shariahLaneJudgment` variable in `researchSwarm.ts` (~1417) is rewired to read the **pass** result instead of the lane result.

## Data flow

quick screen (unchanged) → deep dive **5 lanes** → **synthesis**: valuation pass + **shariah pass** (both grounded, cite-checked, in the synthesis stage) → decision. The decision + dossier read the shariah overlay + recomputed ratios from the pass, same as today.

## Fail-closed policy — flag only (chosen)

If the pass cannot ground the overlay to verified sources (or its citations don't verify): the existing `shariah_deep_screen_incomplete` flag fires → compliance reads **UNDETERMINED / "not deep-verified"** in the dossier, the verdict is **not** flipped, the human decides. The flag is **rewired to key off the pass** (grounded/cite-verified or not) instead of the lane's `verified_ids`. `impermissible_income: null` continues to fail closed to UNDETERMINED (existing behavior, unchanged).

## Removal surfaces (mechanical — same set as the valuation-lane removal)

Drop `shariah` from: `buffettMungerDeepDiveLanes`, `PRIMARY_FILING_LANES`, `PIPELINE_SPECIALIST_LANES`, the UI `orderedLanes` + `LANE_DETAILS` (StrategyOverview) + `laneDetails` (LearnTabs), and `DEEP_DIVE_LANE_TOTAL` 6→5 — each guarded by the existing drift tests. Update the "5 lanes" copy on strategy/learn/pipeline/loading, and add a "Shariah is a dedicated focused pass" clarification (mirroring the valuation-pass clarification). The `RECENT_FILINGS_LANES` set (`researchSwarm.ts`) drops `shariah` if present.

## Error handling

- Pass throws / provider error → degrade gracefully with the deep-screen-incomplete flag (mirror the valuation pass's degradation path; a completed 5-lane deep dive is never discarded for a shariah-pass failure).
- Legacy events (shariah recorded as a lane finding) still project — the dossier tolerates both the old lane-shaped and new pass-shaped shariah data.

## Testing

- `shariahReasoningPass.test.ts` — mirror `valuationReasoningPass.test.ts`: schema parse, the prompt carries the overlay instructions + the "harness owns the ratios; you supply grounded inputs" guard, and the cite-check fail-closed path.
- Rewire + keep the existing `shariah_deep_screen_incomplete` tests (workflow + projection + dossier) to key off the pass.
- Removal drift-guards updated for 5 lanes across all four lane-list sources.
- A swarm-level test that a run with a failing shariah pass still completes the 5-lane deep dive + decision, with the flag set and the verdict not flipped.

## Out of scope

- business_quality / risks intermittent skipping — already fixed by the Task-1 revert in this branch (separate concern).
- Changing AAOIFI thresholds, purification math, or the quick-screen shariah gate.
- Moving any other lane to a pass.

## Open items to confirm during planning

1. Exact synthesis-stage wiring point for two focused passes (valuation + shariah) — run them together, confirm ordering/independence.
2. Whether the shariah pass needs the pre-verified filing block (segment revenue) threaded in the way the lane got it — verify the pass has access to the same grounded corpus.
