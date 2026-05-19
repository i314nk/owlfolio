"""Quick screening — lightweight single-agent evaluation of candidates.

Sits between discovery and deep analysis in the pipeline:
  Discovery (Mon) → Quick Screen (Thu) → Deep Dive (Wed)

Uses a single Haiku agent to evaluate each candidate from the active
strategy's perspective. Much cheaper than the full specialist pipeline.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("owlfolio.screening")


async def screen_candidate(
    ticker: str,
    strategy_brief: str,
    strategy_name: str,
) -> dict[str, Any]:
    """Run a quick screen on a single candidate.

    Returns:
        {"pass": bool, "score": 1-5, "reasoning": str,
         "key_strengths": [...], "key_concerns": [...]}
    """
    from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

    from src.llm.provider import _agent_sdk_model

    prompt = (
        f"You are evaluating {ticker} for the {strategy_name} "
        f"investment strategy.\n\n"
        f"Strategy criteria:\n{strategy_brief}\n\n"
        f"Based on publicly available information, evaluate this "
        f"company on these dimensions:\n"
        f"1. Durable competitive advantage / economic moat\n"
        f"2. Business model simplicity and understandability\n"
        f"3. Consistent earnings and good returns on equity\n"
        f"4. Shareholder-friendly management\n"
        f"5. Reasonable valuation relative to intrinsic value\n\n"
        f"Return ONLY valid JSON (no markdown, no explanation):\n"
        f'{{"pass": true, "score": 4, "reasoning": "One paragraph", '
        f'"key_strengths": ["..."], "key_concerns": ["..."]}}'
    )

    result_text = ""
    try:
        async for msg in query(
            prompt=prompt,
            options=ClaudeAgentOptions(
                model=_agent_sdk_model("claude-haiku-4-5-20251001"),
                permission_mode="bypassPermissions",
                cwd="/tmp",
                allowed_tools=["WebSearch"],
            ),
        ):
            if isinstance(msg, ResultMessage) and msg.result:
                result_text = msg.result
    except Exception as e:
        logger.error("screen_candidate %s failed: %s", ticker, e)
        return {
            "pass": False,
            "score": 0,
            "reasoning": f"Screen failed: {e}",
            "key_strengths": [],
            "key_concerns": [],
            "error": "AGENT_ERROR",
            "error_detail": str(e),
        }

    parsed = _parse_screen_json(result_text)
    if not parsed:
        return {
            "pass": False,
            "score": 0,
            "reasoning": f"Could not parse response: {result_text[:200]}",
            "key_strengths": [],
            "key_concerns": [],
            "error": "PARSE_ERROR",
            "error_detail": "Agent response was not valid JSON",
        }

    return parsed


def _parse_screen_json(text: str) -> dict | None:
    """Extract JSON from agent response, tolerating code fences."""
    import re

    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    return None


async def screen_list(
    list_name: str | None = None,
    list_id: int | None = None,
    concurrency: int = 3,
) -> dict[str, Any]:
    """Screen all unscreened candidates in a list.

    Args:
        list_name: candidate list name (or use list_id).
        list_id: candidate list ID.
        concurrency: max concurrent screens (Haiku is cheap, 3 is fine).

    Returns:
        {"list_name", "screened": int, "passed": int, "failed": int,
         "results": [{"ticker", "pass", "score", "reasoning"}, ...]}
    """
    from src.db.schema import get_db
    from src.operations.strategies import get_active_strategy

    conn = get_db()
    try:
        if list_name:
            row = conn.execute(
                "SELECT id, name, strategy FROM candidate_lists "
                "WHERE name = ? ORDER BY created_at DESC LIMIT 1",
                (list_name,),
            ).fetchone()
        elif list_id:
            row = conn.execute(
                "SELECT id, name, strategy FROM candidate_lists WHERE id = ?",
                (list_id,),
            ).fetchone()
        else:
            # Auto-select most recent list
            row = conn.execute(
                "SELECT id, name, strategy FROM candidate_lists ORDER BY created_at DESC LIMIT 1",
            ).fetchone()

        if not row:
            return {
                "error": "NOT_FOUND",
                "error_detail": "No candidate list found",
            }

        lid = row[0] if isinstance(row, (tuple, list)) else row["id"]
        lname = row[1] if isinstance(row, (tuple, list)) else row["name"]
        lstrategy = row[2] if isinstance(row, (tuple, list)) else row["strategy"]

        # Get unscreened candidates
        candidates = conn.execute(
            "SELECT id, ticker, company_name FROM candidates "
            "WHERE list_id = ? AND screen_status = 'UNSCREENED'",
            (lid,),
        ).fetchall()
    finally:
        conn.close()

    if not candidates:
        return {
            "list_name": lname,
            "screened": 0,
            "passed": 0,
            "failed": 0,
            "results": [],
            "message": "No unscreened candidates",
        }

    # Load strategy brief
    strategy = get_active_strategy()
    strategy_name = lstrategy or strategy.get("name", "unknown")
    strategy_brief = strategy.get("description", "")
    if not strategy_brief:
        # Try to build a brief from strategy fields
        criteria = strategy.get("criteria", {})
        strategy_brief = (
            json.dumps(criteria, indent=2)
            if criteria
            else "Value investing with focus on moats and quality."
        )

    logger.info(
        "Screening %d candidates from list %r (strategy: %s)",
        len(candidates),
        lname,
        strategy_name,
    )

    semaphore = asyncio.Semaphore(concurrency)
    results: list[dict[str, Any]] = []

    async def _one(cand: Any) -> None:
        async with semaphore:
            cid = cand[0] if isinstance(cand, (tuple, list)) else cand["id"]
            ticker = cand[1] if isinstance(cand, (tuple, list)) else cand["ticker"]

            logger.info("Screening %s...", ticker)
            result = await screen_candidate(
                ticker,
                strategy_brief,
                strategy_name,
            )

            # Save to DB
            status = "PASS" if result.get("pass") else "FAIL"
            score = result.get("score", 0)
            reasoning = result.get("reasoning", "")
            now = datetime.now(timezone.utc).isoformat()

            conn2 = get_db()
            try:
                conn2.execute(
                    "UPDATE candidates SET screen_status = ?, "
                    "screen_score = ?, screen_reasoning = ?, "
                    "screen_date = ? WHERE id = ?",
                    (status, score, reasoning, now, cid),
                )
                conn2.commit()
            finally:
                conn2.close()

            results.append(
                {
                    "ticker": ticker,
                    "pass": result.get("pass", False),
                    "score": score,
                    "reasoning": reasoning,
                }
            )
            logger.info(
                "  ✓ %s: %s (score %d/5)",
                ticker,
                status,
                score,
            )

    tasks = [_one(c) for c in candidates]
    await asyncio.gather(*tasks)

    passed = sum(1 for r in results if r["pass"])
    failed = len(results) - passed

    return {
        "list_name": lname,
        "screened": len(results),
        "passed": passed,
        "failed": failed,
        "results": results,
    }
