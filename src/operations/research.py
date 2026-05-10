"""Quick research — bounded WebSearch escape hatch for the chat agent.

The chat agent (the portfolio manager persona) is *deliberately* locked
off raw `WebSearch` and `WebFetch`. Its job is to apply the active
strategy via the analyze pipeline and the structured MCP tool surface
— not to freelance research a company by Googling. That discipline is
what makes the strategy-as-config architecture meaningful: every
analysis runs through the same specialist team and produces a `#NN`
audit row, instead of being a chatbot's hand-wavy take.

But there's a real category of *general-purpose* finance questions
that don't fit the company-analysis pipeline and shouldn't:

  * "Did the Fed move rates this week?"
  * "What's the latest on the SECURE 2.0 retirement-account changes?"
  * "Who's the current Treasury Secretary?"
  * "What's the 10-year Treasury yielding right now?"

For those, we expose `quick_research` as a typed MCP tool. Internally
it spins up a small, bounded Agent SDK query with `WebSearch` +
`WebFetch` (no other tools), gathers an answer, and returns a
structured summary. The chat agent never gets raw web access — it
just calls one typed function.

What this is NOT for:
  * Analyzing a specific company under the active strategy → use `analyze`
  * Looking at portfolio holdings → use `get_portfolio`
  * Pulling saved analyses → use `get_analysis(id)` / `get_latest_analysis(ticker)`

If the chat agent reaches for `quick_research` to research a stock, it's
violating the architecture. The CLAUDE.md guidance has explicit examples
of when to use this tool vs the analyze pipeline.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger("owlfolio.research")


async def quick_research(query: str) -> dict[str, Any]:
    """Run a bounded WebSearch query and return a structured answer.

    Args:
        query: a natural-language question (general-purpose finance only,
            not "analyze X" — see module docstring).

    Returns:
        {
          "query": <original>,
          "answer": <2-4 sentence summary>,
          "key_facts": [...],
          "sources": [<URL>, ...],
        }
    """
    if not isinstance(query, str) or not query.strip():
        raise ValueError("query must be a non-empty string")
    q = query.strip()
    if len(q) > 500:
        raise ValueError("query is too long (max 500 chars)")

    from claude_agent_sdk import (
        ClaudeAgentOptions,
        ResultMessage,
        query as sdk_query,
    )
    from src.llm.provider import _agent_sdk_model

    prompt = f"""Answer this general-purpose finance/markets question
using web search. Be concise and source-cited. This is NOT a stock
analysis — if the question is "should I buy X?" or "analyze X",
respond with: "This is a stock-analysis question — use the analyze
pipeline, not quick_research."

Question: {q!r}

Return JSON ONLY (no markdown, no preface):
{{
  "answer": "2-4 sentence direct answer to the question",
  "key_facts": ["concrete fact 1 with number/date", "concrete fact 2", ...],
  "sources": ["https://...", "https://..."]
}}
"""

    logger.info("quick_research: query=%r", q[:120])

    result_text = ""
    async for msg in sdk_query(
        prompt=prompt,
        options=ClaudeAgentOptions(
            model=_agent_sdk_model("claude-haiku-4-5-20250507"),
            permission_mode="bypassPermissions",
            cwd=str(Path.home()),
            allowed_tools=["WebSearch", "WebFetch"],
            thinking={"type": "adaptive"},
        ),
    ):
        if isinstance(msg, ResultMessage) and msg.result:
            result_text = msg.result

    parsed = _parse_research_json(result_text)
    return {
        "query": q,
        "answer": parsed.get("answer", "(no answer)"),
        "key_facts": parsed.get("key_facts") or [],
        "sources": parsed.get("sources") or [],
    }


def _parse_research_json(text: str) -> dict:
    """Extract JSON from the model's response, tolerating fences."""
    import json
    import re

    if not text:
        return {}
    # Try direct
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Code-fence
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # First { to last }
    s, e = text.find("{"), text.rfind("}")
    if s != -1 and e > s:
        try:
            return json.loads(text[s:e + 1])
        except json.JSONDecodeError:
            pass
    return {"answer": text[:500], "key_facts": [], "sources": []}


def quick_research_sync(query: str) -> dict[str, Any]:
    """Synchronous wrapper for callers outside an event loop."""
    try:
        return asyncio.run(quick_research(query))
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(quick_research(query))
        finally:
            loop.close()
