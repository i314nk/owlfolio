"""Add-on specialists -- can be attached to any strategy via CLI flags
or run standalone via `run_addon`.

These are reusable specialist configurations that augment the strategy's
built-in specialist roster. Two ways to use them:

1. **Bundled with full analysis** — `owlfolio analyze TICKER --shariah`
   runs the full strategy pipeline + the addon. Use when you want both
   investment-decision context and the addon verdict.

2. **Standalone** — `owlfolio shariah TICKER` (or, via the chat agent,
   the `run_addon` MCP tool) runs ONLY the addon specialist. Faster
   (~1 min vs ~5 min), cheaper, and still persists as a `#NN` audit
   row with `decision='N/A'` so it shows up in the Activity feed.

The standalone path is the right one when the user just wants the
addon verdict on a ticker — no point spinning up 3-5 specialists from
the active strategy if the question is "is this Shariah-compliant?"

Add-ons come in two flavours:

- **Strategy-agnostic** (e.g. Shariah): same rules regardless of the
  active investment strategy. No previous-analysis context needed.

- **Strategy-aware** (e.g. review, news): their prompt references the
  active strategy's criteria and the most recent saved analysis for the
  ticker.  The `{PREVIOUS_ANALYSIS}` placeholder in their prompt_body
  is resolved at runtime by `run_addon` before the specialist runs.

The `ADDON_REGISTRY` below is the source of truth for which addons are
runnable. Add new addons by registering them here; CLI + MCP discover
them automatically.
"""

from src.specialists.runner import SpecialistConfig


SHARIAH_SPECIALIST = SpecialistConfig(
    name="shariah_compliance",
    prompt_body="""Check AAOIFI Shariah compliance for {COMPANY} ({TICKER}). You must
calculate ALL of these ratios:

1. DEBT SCREENING: Total Debt / Market Capitalization -- must be < 33%
   - Find total debt (short-term + long-term borrowings)
   - Find current market capitalization
   - Calculate ratio

2. CASH SCREENING: (Cash + Interest-bearing securities) / Market Cap -- must be < 33%
   - Find cash and cash equivalents + short-term investments + interest-bearing deposits
   - Calculate ratio

3. REVENUE SCREENING: Non-compliant revenue / Total revenue -- must be < 5%
   - Identify any revenue from: interest income, alcohol, gambling, tobacco,
     pork, weapons, adult entertainment, conventional banking/insurance
   - Calculate as percentage of total revenue

4. SECTOR CHECK: Company must NOT operate primarily in:
   - Conventional banking or insurance
   - Alcohol production or distribution
   - Gambling or casinos
   - Tobacco
   - Pork or pork products
   - Weapons or defense
   - Adult entertainment

5. PURIFICATION: If compliant, calculate the purification ratio:
   - Purification % = Non-compliant income / Total income
   - This is the percentage of dividends that must be donated to charity

Return JSON with:
{
  "compliant": true/false,
  "debt_ratio": 0.25,
  "cash_ratio": 0.15,
  "non_compliant_revenue_pct": 0.02,
  "sector_compliant": true,
  "purification_pct": 0.02,
  "details": "explanation...",
  "flags": ["GREEN: debt ratio well below 33%", ...]
}

Sources to check first:
  - https://stockanalysis.com/stocks/{TICKER}/balance-sheet/
  - https://stockanalysis.com/stocks/{TICKER}/financials/
  - Web search: {TICKER} shariah compliance screening
  - Web search: {TICKER} revenue breakdown segments
""",
)

# ─── Strategy-aware addons ────────────────────────────────────────
#
# These addons reference {PREVIOUS_ANALYSIS} which is resolved at
# runtime by run_addon() with the most recent saved analysis context.
# They also see the strategy name + description via the specialist
# runner's standard header, making them strategy-aware.

REVIEW_SPECIALIST = SpecialistConfig(
    name="quarterly_review",
    prompt_body="""Perform a LIGHT quarterly review for {COMPANY} ({TICKER}).

PURPOSE: Check whether the latest quarterly results confirm or challenge
the existing investment thesis — WITHOUT re-running a full analysis.
Think of this as the Buffett approach: "did the economics change?"

PREVIOUS ANALYSIS CONTEXT:
{PREVIOUS_ANALYSIS}

YOUR TASK:
1. Find the LATEST quarterly filing (10-Q, 6-K, or earnings release)
   published AFTER the previous analysis date shown above.
2. Extract these KEY METRICS and compare to the thesis assumptions:
   - Revenue growth rate (vs thesis expectation)
   - Operating margin / net margin trajectory
   - Free cash flow trend
   - Debt levels (any material change?)
   - Return on invested capital (ROIC)
   - Management guidance changes
   - Any segment revenue shifts
3. Check for MATERIAL EVENTS since last analysis:
   - Management or board changes
   - Acquisitions or divestitures
   - Regulatory actions
   - Share buybacks or dilution
   - Dividend changes
4. Score thesis alignment: does the quarter CONFIRM or CHALLENGE
   the bull case, bear case, and key risks from the previous analysis?

Sources to check:
  - https://stockanalysis.com/stocks/{TICKER}/financials/?p=quarterly
  - https://stockanalysis.com/stocks/{TICKER}/revenue/
  - Web search: "{TICKER} latest quarterly earnings results"
  - Web search: "{TICKER} 10-Q SEC filing"
  - Web search: "{TICKER} earnings call highlights"

Return JSON with:
{{
  "specialist_name": "quarterly_review",
  "ticker": "{TICKER}",
  "summary": "One paragraph: thesis status + key changes",
  "quarter_reviewed": "Q1 2026 (or whichever is latest)",
  "thesis_status": "intact|weakening|strengthening|broken",
  "key_findings": ["finding 1", "finding 2", ...],
  "metric_deltas": {{
    "revenue_growth": {{"previous": "12%", "current": "8%", "assessment": "below thesis"}},
    "operating_margin": {{"previous": "25%", "current": "26%", "assessment": "stable"}},
    "fcf": {{"previous": "$2.1B", "current": "$1.8B", "assessment": "declining"}},
    "roic": {{"previous": "18%", "current": "17%", "assessment": "stable"}}
  }},
  "material_events": ["event 1 if any"],
  "guidance_change": "raised|lowered|maintained|none",
  "data_sources": ["url1", "url2", ...],
  "confidence": 0.8,
  "flags": ["GREEN: revenue beat expectations", "RED: margin compression"]
}}
""",
)


NEWS_PULSE_SPECIALIST = SpecialistConfig(
    name="news_pulse",
    prompt_body="""Scan recent news for {COMPANY} ({TICKER}) to check for material
developments since the last saved analysis.

PURPOSE: Quick ~30 second check — "has anything happened that moves the
needle on my investment thesis?" This is NOT a full analysis. Focus
only on news that would change the investment decision.

PREVIOUS ANALYSIS CONTEXT:
{PREVIOUS_ANALYSIS}

YOUR TASK:
1. Search for news published AFTER the previous analysis date above
2. Focus ONLY on news that affects the investment thesis:
   - Earnings surprises (beat/miss vs expectations)
   - Management or board changes
   - Regulatory actions, investigations, lawsuits
   - Competitive threats or new market entrants
   - Product launches, pivots, or discontinuations
   - M&A activity (acquirer or target)
   - Macro/sector shifts affecting the business
   - Analyst upgrades/downgrades with reasoning
   - Insider buying/selling (significant only)
3. Score each finding against the SAVED thesis, bull case, bear case,
   and key risks from the previous analysis
4. Determine overall impact: does the news basket support, contradict,
   or have no effect on the thesis?

Search queries to run:
  - Web search: "{TICKER} news" (recent)
  - Web search: "{COMPANY} latest developments"
  - Web search: "{TICKER} analyst rating"
  - Web search: "{TICKER} SEC filing" (recent 8-K filings = material events)

Return JSON with:
{{
  "specialist_name": "news_pulse",
  "ticker": "{TICKER}",
  "summary": "1-2 sentences: material changes or 'no material changes since [date]'",
  "material_changes": true,
  "thesis_alignment": "supports|contradicts|neutral",
  "key_findings": ["finding 1", "finding 2", ...],
  "new_risks": ["risk not in previous analysis"],
  "new_catalysts": ["catalyst not in previous analysis"],
  "risk_updates": ["update on previously flagged risk"],
  "data_sources": ["url1", "url2", ...],
  "confidence": 0.8,
  "flags": ["RED: CEO departure", "GREEN: analyst upgrade on moat strength"]
}}
""",
)


# Future add-ons:
# ESG_SPECIALIST = SpecialistConfig(...)
# INSIDER_TRADES_SPECIALIST = SpecialistConfig(...)


# ─── Registry ──────────────────────────────────────────────────────
#
# Source of truth for which addons are runnable. The CLI's `shariah`
# command, the `--shariah` flag on `analyze`, the `run_addon` MCP tool,
# and the chat agent all dispatch through this registry. Add a new
# addon by registering it here — no other code changes needed.

ADDON_REGISTRY: dict[str, SpecialistConfig] = {
    "shariah": SHARIAH_SPECIALIST,
    "review": REVIEW_SPECIALIST,
    "news": NEWS_PULSE_SPECIALIST,
}

# Addons whose prompts contain {PREVIOUS_ANALYSIS} — run_addon()
# resolves this placeholder with the latest saved analysis for the
# ticker before handing the prompt to the specialist runner.
STRATEGY_AWARE_ADDONS: set[str] = {"review", "news"}


def get_addon(name: str) -> SpecialistConfig:
    """Look up an addon by its registry key. Raises KeyError with the
    full set of available names if the key isn't registered."""
    n = (name or "").strip().lower()
    if n not in ADDON_REGISTRY:
        raise KeyError(
            f"unknown addon {name!r} — available: "
            f"{sorted(ADDON_REGISTRY.keys())}"
        )
    return ADDON_REGISTRY[n]


def list_addons() -> list[str]:
    """Names of all registered addons (stable order)."""
    return sorted(ADDON_REGISTRY.keys())
