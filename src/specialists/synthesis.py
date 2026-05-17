"""Synthesis agent -- combines specialist findings into a final analysis.

Receives all specialist outputs + strategy context.
Owns the complete decision: valuation, quality scoring, thesis, BUY/WATCH/PASS.
"""

import logging

from src.specialists.schemas import SpecialistFindings, SynthesisResult
from src.strategy.loader import Strategy, build_strategy_context

logger = logging.getLogger("owlfolio.synthesis")


async def synthesize(
    ticker: str,
    company_name: str,
    specialist_outputs: list[SpecialistFindings],
    strategy: Strategy,
    previous_analysis: dict | None = None,
    is_holding: bool = False,
) -> SynthesisResult:
    """Run synthesis agent to produce the final analysis.

    Args:
        previous_analysis: If set, the compact summary from the most recent
            saved analysis (from get_previous_analysis_context). Enables the
            synthesis agent to detect material drift.
        is_holding: If True, the ticker is a current portfolio holding —
            material changes (score drift >= 2 or decision change) should
            be flagged prominently.
    """

    # Format specialist findings
    findings_text = _format_specialist_outputs(specialist_outputs)

    # Structured contract block (criteria/tiers/sizing) + prose synthesis
    # prompt from the strategy YAML (prompts.synthesis). The structured
    # block tells synthesis what JSON keys to fill; the prose tells it how
    # to score, classify tier, compute buy price, and decide BUY/WATCH/PASS.
    strategy_context = build_strategy_context(strategy)
    synthesis_prose = strategy.prompts.synthesis

    # Build optional drift context section
    drift_section = _build_drift_context(previous_analysis, is_holding)

    prompt = f"""You are the lead analyst for {company_name} ({ticker}).

{len(specialist_outputs)} specialists have independently researched this company \
under the {strategy.name} strategy.
{drift_section}
## Specialist Reports

{findings_text}

## Strategy Contract

{strategy_context}

## Strategy Synthesis Instructions

{synthesis_prose}

## Data Quality Gate (run BEFORE scoring)

Before synthesizing, audit each specialist report for data quality:
1. CHECK SOURCES: Each specialist must have >= 3 data_sources. If a specialist
   has < 3 sources, flag it as LOW CONFIDENCE in discrepancies and weight its
   findings less heavily in your scoring.
2. CHECK FRESHNESS: Look at each specialist's data_as_of field. If any specialist
   is citing data from > 2 quarters ago, flag as STALE DATA in discrepancies.
   Prefer findings from specialists with more recent data.
3. CHECK CONFLICTS: If two specialists cite conflicting numbers for the same metric,
   trust the one with: (a) more sources, (b) more recent data, (c) primary source
   (SEC filing > news article > blog post).
4. GROUND TRUTH: Your decision must be traceable to specialist findings which are
   themselves traceable to tool-fetched sources. No claim in your output should
   exist that cannot be traced back through this chain.
5. NO ADDON RECOMMENDATIONS: Do not suggest running any addons (news, shariah, etc.)
   in your output. Return only the analysis — addon usage is the user's choice.

## Cross-cutting Job (in addition to the strategy-specific instructions above)

1. RECONCILE: Flag any conflicting data between specialists in `discrepancies`
2. SCORE: Fill `criteria_scores` with one entry per criterion above (1-5 scale)
3. CLASSIFY: Pick a tier from the TIERS block; report it as `quality_tier`
4. THESIS / CASES / RISKS: Concise prose for `thesis`, `bull_case`, `bear_case`, `key_risks`
5. DECIDE: `decision` is BUY / WATCH / PASS with `confidence` (0-1) and `reasoning`
6. SOURCE AUDIT: If any specialist has < 3 sources or missing data_as_of, cap your
   overall confidence at 0.7 maximum and note it in reasoning

Return valid JSON:
{{
  "ticker": "{ticker}",
  "company_name": "{company_name}",
  "strategy": "{strategy.name}",
  "fair_value": 385.00,
  "current_price": 439.00,
  "valuation_reasoning": "...",
  "quality_tier": "wide",
  "weighted_score": 4.1,
  "criteria_scores": {{"switching_costs": 4.2}},
  "decision": "WATCH",
  "confidence": 0.75,
  "reasoning": "Great business, wrong price...",
  "thesis": "...",
  "bull_case": "...",
  "bear_case": "...",
  "key_risks": ["risk 1", "risk 2"],
  "catalysts": ["catalyst 1"],
  "recommended_position_pct": null,
  "tranche": null,
  "specialists_used": ["financial_analyst", "moat_analyst"],
  "data_sources": ["stockanalysis.com", "SEC EDGAR"],
  "discrepancies": ["financial_analyst says revenue $15B, moat_analyst found $14.8B"]
}}

Return ONLY valid JSON -- no markdown, no explanation."""

    from pathlib import Path

    from claude_agent_sdk import ClaudeAgentOptions, ResultMessage
    from claude_agent_sdk import query as sdk_query

    from src.llm.provider import _agent_sdk_model

    result_text = ""
    async for msg in sdk_query(
        prompt=prompt,
        options=ClaudeAgentOptions(
            model=_agent_sdk_model("claude-opus-4-7-20250507"),
            permission_mode="bypassPermissions",
            cwd=str(Path.home()),
            allowed_tools=["WebSearch", "WebFetch"],
            # Adaptive extended thinking — synthesis is the highest-judgment
            # step (reconcile conflicts, weigh evidence, decide). Let the
            # model size its own thinking budget.
            thinking={"type": "adaptive"},
        ),
    ):
        if isinstance(msg, ResultMessage) and msg.result:
            result_text = msg.result

    return _parse_synthesis_result(result_text, ticker, company_name, strategy, specialist_outputs)


def _build_drift_context(previous_analysis: dict | None, is_holding: bool) -> str:
    """Build the drift-context section for the synthesis prompt.

    Returns an empty string if there is no previous analysis, or a formatted
    block that tells the synthesis agent what the last analysis looked like
    so it can detect and flag material changes.
    """
    if not previous_analysis:
        return ""

    date = previous_analysis.get("analysis_date", "unknown")
    decision = previous_analysis.get("decision", "UNKNOWN")
    score = previous_analysis.get("weighted_score", 0.0)
    specialist_scores = previous_analysis.get("specialist_scores", {})

    scores_line = (
        ", ".join(f"{name} {val:.0%}" for name, val in specialist_scores.items())
        if specialist_scores
        else "(none recorded)"
    )

    lines = [
        "",
        "## Previous Analysis (Drift Detection)",
        "",
        f"Previous analysis ({date}): {decision}, score {score:.1f}",
        f"Specialist confidence: {scores_line}",
    ]

    if is_holding:
        lines.append("")
        lines.append(
            "**STATUS: CURRENT HOLDING** — Flag any material changes in your "
            "reasoning. A material change is a weighted_score shift of >= 2 "
            "points OR a decision change (e.g. BUY -> WATCH). If you detect "
            "a material change, start your `reasoning` field with "
            "'[MATERIAL CHANGE]' and explain what shifted and why."
        )
    lines.append("")

    return "\n".join(lines)


def _format_specialist_outputs(outputs: list[SpecialistFindings]) -> str:
    """Format specialist findings for the synthesis prompt.

    Includes source count and data_as_of for the Data Quality Gate to assess.
    """
    sections = []
    for output in outputs:
        flags_text = "\n".join(f"  - {f}" for f in output.flags) if output.flags else "  (none)"
        findings_text = (
            "\n".join(f"  - {f}" for f in output.key_findings)
            if output.key_findings
            else "  (none)"
        )
        sources_text = ", ".join(output.data_sources) if output.data_sources else "(none)"
        source_count = len(output.data_sources) if output.data_sources else 0
        data_as_of = getattr(output, "data_as_of", None) or "(not reported)"

        # Flag low-source specialists visually for synthesis
        source_warning = ""
        if source_count < 3:
            source_warning = " ⚠️ LOW SOURCE COUNT"

        section = f"""### {output.specialist_name} (confidence: {output.confidence:.0%}){source_warning}

Data as of: {data_as_of}

{output.summary}

Key findings:
{findings_text}

Flags:
{flags_text}

Sources ({source_count}): {sources_text}"""
        sections.append(section)

    return "\n\n".join(sections)


def _parse_synthesis_result(
    text: str,
    ticker: str,
    company_name: str,
    strategy: Strategy,
    specialist_outputs: list[SpecialistFindings],
) -> SynthesisResult:
    """Parse synthesis agent JSON response into SynthesisResult."""
    from src.specialists.runner import _parse_specialist_json

    data = _parse_specialist_json(text) or {}

    # Ensure required fields with defaults
    specialists_used = [o.specialist_name for o in specialist_outputs]
    all_sources = []
    for o in specialist_outputs:
        all_sources.extend(o.data_sources)

    return SynthesisResult(
        ticker=data.get("ticker", ticker),
        company_name=data.get("company_name", company_name),
        strategy=data.get("strategy", strategy.name),
        fair_value=data.get("fair_value"),
        current_price=data.get("current_price"),
        valuation_reasoning=data.get("valuation_reasoning", ""),
        quality_tier=data.get("quality_tier", "unknown"),
        weighted_score=data.get("weighted_score", 0.0),
        criteria_scores=data.get("criteria_scores", {}),
        decision=data.get("decision", "WATCH"),
        confidence=data.get("confidence", 0.5),
        reasoning=data.get("reasoning", ""),
        thesis=data.get("thesis", ""),
        bull_case=data.get("bull_case", ""),
        bear_case=data.get("bear_case", ""),
        key_risks=data.get("key_risks", []),
        catalysts=data.get("catalysts", []),
        recommended_position_pct=data.get("recommended_position_pct"),
        tranche=data.get("tranche"),
        specialists_used=data.get("specialists_used", specialists_used),
        data_sources=data.get("data_sources", list(set(all_sources))),
        discrepancies=data.get("discrepancies", []),
    )
