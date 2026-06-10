# Phase 0 LIVE dogfood — full Codex swarm on COST (2026-06-10)

**Headline:** The complete autonomous research swarm runs **end-to-end, live, on a real frontier model**, and
produces genuinely **investment-grade reasoning** with the **correct verdict** — alongside one real valuation
units bug and one reliability bug. The existential thesis is proven; the architecture is sound; the gaps are fixable.

## Run parameters
- Ticker **COST** (Costco), company `costco-wholesale`, strategy Buffett-Munger v1.0.0.
- Provider **Codex CLI** (`openai`), model `gpt-5.5`, live, `--sandbox read-only`; grounding HTTP-verified in the Node worker.
- Wall time **416.5s (~7 min)**, **6 of 7 specialist lanes** recorded (management lane did not record — see gaps), 14 ledger events, run **completed** (no abort).
- A parallel **AAPL** run **FAILED at exactly 180.1s** — `Codex CLI timed out` (the reliability bug below).

## Verdict produced
**PASS** — `investment_verdict: PASS`, `strategy_compliance: NON_COMPLIANT`, `shariah_status: CONDITIONAL`,
`valuation_status: EXPENSIVE`.

> "Costco is a rare high-quality retailer … The issue is not business quality. The decision blockers are **Shariah
> non-compliance from core retail exposure to alcohol/pork** and **valuation near 49x FCF/earnings, implying about a
> 2% current owner-earnings yield**."

This is exactly the disciplined verdict a rigorous Buffett-Munger + Shariah analyst would reach: a wonderful business,
correctly **rejected on price + permissibility**.

## Per-dimension honest assessment

| Dimension | Score | Evidence |
|---|---|---|
| **Grounding quality** | **Strong** | Cited the real Costco **FY2024 Form 10-K** (business-model, membership-fees, private-label sections) + the real **$968.59 Jun-9-2026 close**. Honest about vintage (couldn't source FY25/26 primary; said so). |
| **Per-lane depth** | **Strong** | Each lane is company-specific + analytical, not boilerplate: moat = "self-reinforcing scale/value/membership **flywheel**"; risks = "wonderful business … the Buffett-Munger risk is **paying a wonderful-business price**"; financials = "exceptional … high-turnover, **member-funded** model". |
| **Valuation rigor** | **Prose Strong / Structured BUGGED** | Real owner-earnings bridge (NI 8,838; D&A 2,565; maint capex 2,052 @80% proxy; SBC 911), ROIC **38.4%**, growth capped 3%, MoS 30% (wide). The **prose** valuation ("49x FCF, ~2% yield, EXPENSIVE") is correct — but the **structured per-share fields are ~100× too high** (see bug 1). |
| **Strategy fit** | **Strong** | Moat gate (wide, passes), ROIC, margin-of-safety, equity-bond capitalization all applied. |
| **Shariah screen** | **Adequate** | Correct decisive call ("not shariah-suitable … alcohol/pork") but **thin** — 1 source, medium confidence. |
| **Verdict justification** | **Strong** | PASS correctly weighs business quality vs price vs permissibility; well-supported. |
| **Autonomy** | **Strong** | Gathered its own evidence, no hand-feeding; produced a complete dossier. |

## Lanes (6/7)
business_quality [high, 5 src] · moat [high, 3 src] · financial_quality [high, 4 src] · shariah [medium, 1 src] ·
risks [high, 5 src] · valuation [medium, 3 src]. **Missing: management.**

## Source quality (mixed — a real finding)
- Primary issuer IR pages (`investor.costco.com`, `investor.apple.com`) **consistently 403** the fetcher → correctly
  **fail closed**, so lanes fall back to SEC 10-K (when reachable) + secondary news (NY Post, stockanalysis.com,
  investors.com, Business Insider).
- One AAPL lane **padded its source count by citing the same SEC 10-K URL 5×** (identical sha256) — verified + primary,
  but not 5 distinct sources.
- The fail-closed gate held throughout: every unfetchable/fabricated URL was rejected.

## Prioritized fixes (what most improves investment-grade quality)
1. **[HIGH] Valuation per-share units bug.** `fair_value_per_share = $120,571`, `buy_price = $84,400`, `OE/sh = $8,440`
   for a ~$968 stock — the pipeline treats **total** owner earnings ($M) as **per-share** (missing the `÷ shares
   outstanding` step; ~443M shares → real OE/sh ≈ $19, fair value ≈ $270). The verdict survived only because the prose
   reasoning + `valuation_status` were right. Fix the structured valuation to divide by share count.
2. **[HIGH] Reliability — unguarded bookend calls.** The per-lane calls are wrapped in try/catch (a lane that times out
   degrades), but **quick-screen and synthesis are not**, so one slow 180s Codex call aborts the whole run (killed the
   AAPL run outright). Wrap them in the same timeout/degrade guard.
3. **[MED] Source quality + diversity.** IR/SEC pages 403 → add a real fetch strategy (SEC EDGAR full-text/API, proper
   UA/headers), **dedupe `source_ids`** within a lane, and require **N distinct** verified sources per lane.
4. **[MED] Lane completeness.** The management lane produced no finding (6/7). Ensure every lane either records or is
   explicitly marked degraded with a reason.
5. **[LOW] Data vintage.** The model honestly flagged it could only source FY2024 primary filings; a filings feed
   (EDGAR) would let lanes reason on current-year data.

## Conclusion
A live frontier model, under Owlfolio's grounded multi-agent discipline, produced **disciplined, grounded,
verdict-correct** research on a real company in ~7 minutes. The "autonomous investment-grade research" thesis is
**validated**. Next: fix the valuation units bug (1) and the bookend-timeout reliability bug (2) — both small,
high-leverage — then re-dogfood.
