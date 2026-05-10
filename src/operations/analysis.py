"""Analysis operations — wrap the specialist pipeline + persistence.

This is the heavyweight operation: it spawns specialists, runs synthesis,
persists results, and returns the structured decision. Used by both the
CLI `owlfolio analyze` command and the MCP `analyze` tool.
"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

from src.operations import validate_ticker

if TYPE_CHECKING:
    from src.specialists.runner import SpecialistConfig

logger = logging.getLogger("owlfolio.run")


def _inject_previous_analysis(
    addon: "SpecialistConfig",
    ticker: str,
) -> "SpecialistConfig":
    """Resolve {PREVIOUS_ANALYSIS} in a strategy-aware addon's prompt.

    Fetches the most recent saved analysis for *ticker* and formats it
    as a compact text block the specialist can reference. If no previous
    analysis exists, the placeholder is replaced with a note telling the
    specialist to treat this as a first-time check.

    Returns a *new* SpecialistConfig (the registry original is not mutated).
    """
    from src.specialists.runner import SpecialistConfig

    ctx = _build_previous_analysis_text(ticker)
    new_body = addon.prompt_body.replace("{PREVIOUS_ANALYSIS}", ctx)
    return SpecialistConfig(name=addon.name, prompt_body=new_body)


def _build_previous_analysis_text(ticker: str) -> str:
    """Build a compact text summary of the latest saved analysis."""
    from src.db.operations import get_analyses as db_get_analyses
    from src.db.operations import get_specialist_findings
    from src.db.schema import get_db

    conn = get_db()
    try:
        rows = db_get_analyses(conn, ticker=ticker, limit=1)
        if not rows:
            return (
                "No previous analysis found for this ticker. "
                "Treat this as a first-time review — report absolute "
                "findings without comparison to prior thesis."
            )
        analysis = rows[0]
        parts = [
            f"Analysis date: {analysis.get('created_at', 'unknown')}",
            f"Decision: {analysis.get('decision', 'N/A')}",
            f"Quality tier: {analysis.get('quality_tier', 'unknown')}",
            f"Score: {analysis.get('weighted_score', 0)}/5",
        ]
        if analysis.get("thesis"):
            parts.append(f"Thesis: {analysis['thesis']}")
        if analysis.get("bull_case"):
            parts.append(f"Bull case: {analysis['bull_case']}")
        if analysis.get("bear_case"):
            parts.append(f"Bear case: {analysis['bear_case']}")
        if analysis.get("key_risks"):
            risks = analysis["key_risks"]
            if isinstance(risks, list):
                parts.append("Key risks: " + "; ".join(str(r) for r in risks))
            else:
                parts.append(f"Key risks: {risks}")
        if analysis.get("catalysts"):
            catalysts = analysis["catalysts"]
            if isinstance(catalysts, list):
                parts.append("Catalysts: " + "; ".join(str(c) for c in catalysts))

        # Include per-specialist confidence scores for context
        aid = analysis.get("id")
        if aid:
            findings = get_specialist_findings(conn, aid)
            if findings:
                scores = [
                    f"{f.get('specialist_name', '?')}: {f.get('confidence', 0):.0%}"
                    for f in findings
                    if f.get("specialist_name") and f.get("confidence") is not None
                ]
                if scores:
                    parts.append("Specialist confidence: " + ", ".join(scores))

        return "\n".join(parts)
    finally:
        conn.close()


async def analyze(
    ticker: str,
    company_name: str | None = None,
    strategy_path: str | None = None,
    shariah: bool = False,
) -> dict[str, Any]:
    """Run the full specialist + synthesis pipeline on a ticker.

    Args:
        ticker: Validated ticker symbol.
        company_name: Optional human-readable name; defaults to ticker.
        strategy_path: Optional path to a specific strategy YAML; defaults
            to the active strategy (methodology.yaml or buffett-munger.yaml).
        shariah: If True, attaches the Shariah compliance specialist as
            an add-on alongside the strategy roster.

    Returns:
        {
          "ticker", "company_name", "strategy",
          "decision", "confidence", "fair_value", "current_price",
          "quality_tier", "weighted_score",
          "thesis", "bull_case", "bear_case",
          "key_risks", "specialists_used", "data_sources",
          "analysis_id", "duration_s",
        }
    """
    from src.db.operations import add_memory, save_analysis, save_specialist_findings
    from src.db.schema import get_db
    from src.operations.strategies import METHODOLOGY_PATH, STRATEGIES_DIR
    from src.specialists.runner import run_specialists
    from src.specialists.synthesis import synthesize
    from src.strategy.loader import load_strategy

    t = validate_ticker(ticker)
    name = company_name or t

    if strategy_path:
        from pathlib import Path as _Path

        path = _Path(strategy_path)
    else:
        path = (
            METHODOLOGY_PATH
            if METHODOLOGY_PATH.exists()
            else STRATEGIES_DIR / "buffett-munger.yaml"
        )

    strategy = load_strategy(path)

    addons = []
    if shariah:
        from src.specialists.addons import SHARIAH_SPECIALIST

        addons.append(SHARIAH_SPECIALIST)

    # Fetch previous analysis context for drift detection
    from src.operations.analyses import get_previous_analysis_context
    from src.operations.portfolio import is_current_holding

    previous_analysis = get_previous_analysis_context(t)
    holding = is_current_holding(t)

    t_start = time.monotonic()
    findings = await run_specialists(t, name, strategy, addons=addons)
    result = await synthesize(
        t,
        name,
        findings,
        strategy,
        previous_analysis=previous_analysis,
        is_holding=holding,
    )
    duration_s = time.monotonic() - t_start

    conn = get_db()
    try:
        analysis_id = save_analysis(
            conn,
            ticker=t,
            strategy=strategy.name,
            decision=result.decision,
            buy_price=result.fair_value or 0,
            current_price=result.current_price or 0,
            quality_tier=result.quality_tier,
            weighted_score=result.weighted_score,
            thesis=result.thesis,
            bull_case=result.bull_case,
            bear_case=result.bear_case,
            key_risks=result.key_risks,
            overrides={},
        )
        # Persist the per-specialist findings so the audit tab can
        # expand "why BUY?" into the underlying evidence, and so a
        # future synthesis-prompt change can re-synthesize against
        # saved data without re-paying for the research phase.
        if findings:
            save_specialist_findings(conn, analysis_id, findings)
    finally:
        conn.close()

    # Post-analysis price refresh: fetch a fresh price and update both
    # the analysis record and the watchlist entry (if the ticker is watched).
    try:
        from src.data.prices import get_price_data
        from src.db.operations import update_analysis_price, update_watchlist_price

        fresh = get_price_data(t)
        if fresh.price and fresh.price > 0:
            conn2 = get_db()
            try:
                update_analysis_price(conn2, analysis_id, fresh.price)
                update_watchlist_price(conn2, t, fresh.price)
            finally:
                conn2.close()
            logger.info("Post-analysis price refresh: %s @ %.2f", t, fresh.price)
    except Exception as e:
        logger.warning("Post-analysis price refresh failed for %s: %s", t, e)

    from src.agents.discovery import ticker_currency

    currency_code, currency_sym = ticker_currency(t)

    fair_value_str = f"{currency_sym}{result.fair_value:.2f}" if result.fair_value else "N/A"
    add_memory(
        "observation",
        f"{t}: {result.decision} at {fair_value_str} fair value, "
        f"{result.quality_tier} {result.weighted_score:.1f}/5",
        ticker=t,
    )

    addon_str = ",".join(a.name for a in addons) if addons else "-"
    logger.info(
        "ticker=%s strategy=%s addons=%s decision=%s confidence=%.2f "
        "score=%.1f/5 specialists=%d/%d duration=%.1fs analysis_id=%d",
        t,
        strategy.name,
        addon_str,
        result.decision,
        result.confidence,
        result.weighted_score,
        len(findings),
        len(strategy.prompts.specialists) + len(addons),
        duration_s,
        analysis_id,
    )

    return {
        "ticker": t,
        "company_name": name,
        "strategy": strategy.name,
        "decision": result.decision,
        "confidence": result.confidence,
        "fair_value": result.fair_value,
        "current_price": result.current_price,
        "quality_tier": result.quality_tier,
        "weighted_score": result.weighted_score,
        "thesis": result.thesis,
        "bull_case": result.bull_case,
        "bear_case": result.bear_case,
        "key_risks": result.key_risks,
        "catalysts": result.catalysts,
        "specialists_used": result.specialists_used,
        "data_sources": result.data_sources,
        "discrepancies": result.discrepancies,
        "valuation_reasoning": result.valuation_reasoning,
        "reasoning": result.reasoning,
        "analysis_id": analysis_id,
        "duration_s": duration_s,
        "currency": currency_code,
    }


async def run_addon(
    addon_name: str,
    ticker: str,
    company_name: str | None = None,
) -> dict[str, Any]:
    """Run a single addon specialist on a ticker — no full pipeline.

    Cheap path (~1 min, one specialist subagent) for the case where the
    user just wants an addon verdict on a ticker (e.g. "is X
    Shariah-compliant?") without re-running the full strategy
    pipeline. Persists as a degenerate analysis with `decision='N/A'`
    so it lands in the Activity feed alongside full analyses, gets a
    `#NN` reference, and the saved findings can be drilled into later.

    Args:
        addon_name: registry key (e.g. "shariah") — see addons.ADDON_REGISTRY
        ticker: validated ticker symbol
        company_name: optional human-readable name (defaults to ticker)

    Returns:
        Same shape as `analyze()`'s result dict, with `decision='N/A'`
        and `quality_tier='addon'` to mark it as informational.
    """
    from src.db.operations import save_analysis, save_specialist_findings
    from src.db.schema import get_db
    from src.operations.strategies import METHODOLOGY_PATH, STRATEGIES_DIR
    from src.specialists.addons import get_addon
    from src.specialists.runner import _run_single_specialist
    from src.strategy.loader import load_strategy

    t = validate_ticker(ticker)
    name = company_name or t
    addon = get_addon(addon_name)

    # Strategy context — used by all addons for the runner header, and
    # strategy-aware addons (review, news) reference strategy criteria
    # in their prompts to evaluate findings against the user's framework.
    path = METHODOLOGY_PATH if METHODOLOGY_PATH.exists() else STRATEGIES_DIR / "buffett-munger.yaml"
    strategy = load_strategy(path)

    # Strategy-aware addons need previous analysis context injected
    # into their prompt_body before the specialist runs.
    from src.specialists.addons import STRATEGY_AWARE_ADDONS

    if addon_name in STRATEGY_AWARE_ADDONS:
        addon = _inject_previous_analysis(addon, t)

    t_start = time.monotonic()
    findings = await _run_single_specialist(t, name, addon, strategy)
    duration_s = time.monotonic() - t_start

    if findings is None:
        raise RuntimeError(f"addon {addon_name!r} returned no findings for {t}")

    conn = get_db()
    try:
        analysis_id = save_analysis(
            conn,
            ticker=t,
            strategy=f"{addon_name}-addon",
            decision="N/A",
            buy_price=0,
            current_price=0,
            quality_tier="addon",
            weighted_score=0.0,
            thesis=findings.summary or "",
            bull_case="",
            bear_case="",
            key_risks=findings.flags or [],
            overrides={},
        )
        save_specialist_findings(conn, analysis_id, [findings])
    finally:
        conn.close()

    logger.info(
        "addon=%s ticker=%s analysis_id=%d duration=%.1fs",
        addon_name,
        t,
        analysis_id,
        duration_s,
    )

    from src.agents.discovery import ticker_currency

    currency_code, _ = ticker_currency(t)

    return {
        "ticker": t,
        "company_name": name,
        "addon": addon_name,
        "analysis_id": analysis_id,
        "summary": findings.summary,
        "key_findings": findings.key_findings,
        "flags": findings.flags,
        "data_sources": findings.data_sources,
        "confidence": findings.confidence,
        "duration_s": duration_s,
        "currency": currency_code,
    }


def get_price(ticker: str) -> dict[str, Any]:
    """Quick spot-price lookup. No analysis pipeline."""
    from src.data.prices import get_price_data

    t = validate_ticker(ticker)
    data = get_price_data(t)
    return {
        "ticker": t,
        "name": getattr(data, "name", t),
        "price": data.price,
        "market_cap": getattr(data, "market_cap", None),
        "currency": getattr(data, "currency", "USD"),
    }
