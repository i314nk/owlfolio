"""Specialist runner -- spawns and manages parallel specialist subagents.

Each specialist is an independent Agent SDK query() call that:
1. Receives its role description and data sources from the strategy YAML
2. Uses WebSearch, WebFetch, and Bash tools to gather data
3. Returns structured findings as JSON
"""

import asyncio
import json
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date

from src.agents.discovery import accounting_context
from src.specialists.schemas import SpecialistFindings
from src.strategy.loader import Strategy

logger = logging.getLogger("owlfolio.specialists")

# Retry configuration for transient failures (rate limits, timeouts, network)
MAX_RETRIES = 2
RETRY_BASE_DELAY = 30  # seconds — matches Anthropic rate-limit retry-after
TRANSIENT_PATTERNS = (
    "rate limit",
    "rate_limit",
    "overloaded",
    "529",
    "timeout",
    "timed out",
    "connection",
    "temporarily unavailable",
    "server error",
    "500",
    "502",
    "503",
)

ProgressCallback = Callable[[dict], Awaitable[None]]


def build_specialist_prompt(
    ticker: str,
    company_name: str,
    config_name: str,
    prompt_body: str,
    strategy_name: str,
    strategy_description: str,
) -> str:
    """Build the specialist prompt. Shared by in-process and container runners.

    `prompt_body` is the strategy's prose for this specialist (from
    prompts.specialists.{config_name}). It already contains the role
    description and source URLs inline. We substitute {TICKER} and
    {COMPANY} placeholders, then wrap with the strategy header and
    JSON-output contract.
    """
    body = prompt_body.replace("{TICKER}", ticker).replace("{COMPANY}", company_name)
    acct_ctx = accounting_context(ticker)
    return f"""You are a {config_name} specialist analyzing {company_name} ({ticker}).

STRATEGY: {strategy_name}
{strategy_description}

ACCOUNTING CONTEXT: {acct_ctx}

YOUR JOB:
{body}

DATA FRESHNESS (mandatory):
- Today's date is {date.today().isoformat()}.
- Always fetch data relevant to your role from primary sources. Never cite facts,
  figures, or metrics from memory -- always verify via a live search.
- Use the most recent data available. For financial figures: latest fiscal year and
  most recent quarter. For risks/news: developments within the last 3-6 months.
  For competitive/moat data: most current market share and industry reports.
- When citing ANY figure, always note its period or date (e.g. "FY2025",
  "Q1 2026", "as of Mar 2026"). This is required for every data point you report.
- If you find conflicting data across sources, prefer the most recent publication.
- Do NOT report a "current stock price" -- the system fetches that separately.
  Focus on the fundamentals relevant to your specialist role.

INSTRUCTIONS:
1. Use WebSearch and WebFetch to gather data from the sources cited above
2. Cross-reference at least 2 sources when possible
3. Focus on what's relevant to your specific role -- don't try to cover everything
4. Be specific with numbers -- revenue, margins, growth rates, not vague statements

Return your findings as valid JSON with this structure:
{{
  "specialist_name": "{config_name}",
  "ticker": "{ticker}",
  "summary": "2-3 sentence summary",
  "key_findings": ["finding 1", "finding 2", ...],
  "data_sources": ["url1", "url2", ...],
  "confidence": 0.8,
  "flags": ["RED: concern", "GREEN: positive"]
}}

Include any additional fields relevant to your role
(revenue, margins, moat_scores, risks, etc.).
If you cannot find reliable data for a field, use null
rather than guessing or hallucinating a value.
Return ONLY valid JSON -- no markdown, no explanation."""


@dataclass
class SpecialistConfig:
    """Configuration for a single specialist.

    `prompt_body` is the self-contained prose block from
    strategy.prompts.specialists.{name} (or an add-on definition). Source
    URLs and role description live inside the prose — this is the new
    one-prompt-per-specialist contract.
    """

    name: str
    prompt_body: str


async def run_specialists(
    ticker: str,
    company_name: str,
    strategy: Strategy,
    addons: list[SpecialistConfig] | None = None,
    on_progress: ProgressCallback | None = None,
) -> list[SpecialistFindings]:
    """Run all specialists in parallel. Returns list of findings.

    If on_progress is provided, it receives events as the run unfolds:
      {"type": "specialists_init", "names": [...]}
      {"type": "specialist_start", "name": ...}
      {"type": "specialist_done",  "name": ..., "confidence": float}
      {"type": "specialist_error", "name": ..., "error": str}
    """

    configs = _get_specialist_configs(strategy)
    if addons:
        configs.extend(addons)
    if not configs:
        logger.warning("No specialists defined in strategy %s", strategy.name)
        return []

    logger.info("Running %d specialists for %s (parallel)", len(configs), ticker)

    if on_progress:
        await on_progress(
            {
                "type": "specialists_init",
                "names": [c.name for c in configs],
            }
        )

    async def _wrapped(config: SpecialistConfig):
        if on_progress:
            await on_progress({"type": "specialist_start", "name": config.name})
        try:
            result = await _run_single_specialist(ticker, company_name, config, strategy)
        except Exception as e:
            if on_progress:
                await on_progress(
                    {
                        "type": "specialist_error",
                        "name": config.name,
                        "error": str(e),
                    }
                )
            raise
        if on_progress:
            await on_progress(
                {
                    "type": "specialist_done",
                    "name": config.name,
                    "confidence": result.confidence if result else 0.0,
                }
            )
        return result

    tasks = [_wrapped(c) for c in configs]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    findings = []
    for config, result in zip(configs, results):
        if isinstance(result, Exception):
            logger.error("Specialist %s failed: %s", config.name, result)
        elif result:
            findings.append(result)

    logger.info("%d/%d specialists returned findings", len(findings), len(configs))
    return findings


def _get_specialist_configs(strategy: Strategy) -> list[SpecialistConfig]:
    """Extract specialist configs from strategy.prompts.specialists."""
    specialists = strategy.prompts.specialists
    if not specialists:
        return []
    return [
        SpecialistConfig(name=name, prompt_body=body)
        for name, body in specialists.items()
        if body and body.strip()
    ]


async def _run_single_specialist(
    ticker: str,
    company_name: str,
    config: SpecialistConfig,
    strategy: Strategy,
) -> SpecialistFindings | None:
    """Run a single specialist in-process."""
    return await _run_in_process(ticker, company_name, config, strategy)


def _is_transient(error: Exception) -> bool:
    """Classify whether an error is transient (worth retrying).

    Transient: rate limits, timeouts, network errors, server 5xx.
    Non-transient: auth failures, invalid requests, permission errors.
    """
    msg = str(error).lower()
    return any(p in msg for p in TRANSIENT_PATTERNS)


def _validate_specialist_data(data: dict, config_name: str) -> list[str]:
    """Validate specialist JSON output against the expected schema.

    Returns a list of validation issues (empty = valid).
    """
    issues = []
    if not isinstance(data.get("summary"), str) or not data.get("summary"):
        issues.append("'summary' must be a non-empty string")
    if not isinstance(data.get("key_findings"), list) or not data.get("key_findings"):
        issues.append("'key_findings' must be a non-empty list")
    if "confidence" in data:
        conf = data["confidence"]
        if not isinstance(conf, (int, float)) or not (0 <= conf <= 1):
            issues.append("'confidence' must be a number between 0 and 1")
    if "flags" in data and not isinstance(data["flags"], list):
        issues.append("'flags' must be a list")
    return issues


async def _run_in_process(
    ticker: str,
    company_name: str,
    config: SpecialistConfig,
    strategy: Strategy,
) -> SpecialistFindings | None:
    """Run a specialist in this Python process via the Agent SDK (default mode).

    Includes retry with exponential backoff for transient errors (rate limits,
    timeouts, network issues) and a single validation-retry if the JSON output
    doesn't match the expected schema.
    """
    from claude_agent_sdk import ClaudeAgentOptions, ResultMessage
    from claude_agent_sdk import query as sdk_query

    from src.llm.provider import _agent_sdk_model

    prompt = build_specialist_prompt(
        ticker,
        company_name,
        config.name,
        config.prompt_body,
        strategy.name,
        strategy.description,
    )

    last_error: Exception | None = None

    for attempt in range(1 + MAX_RETRIES):
        try:
            from pathlib import Path

            result_text = ""
            async for msg in sdk_query(
                prompt=prompt,
                options=ClaudeAgentOptions(
                    model=_agent_sdk_model("claude-opus-4-7-20250507"),
                    permission_mode="bypassPermissions",
                    cwd=str(Path.home()),
                    # Specialists only need the web. Bash/Read/Glob/Grep would
                    # be pure attack surface — a prompt-injection from a fetched
                    # page could escalate to host shell. Locked down on purpose.
                    allowed_tools=["WebSearch", "WebFetch"],
                    # Adaptive extended thinking — let the model size its own
                    # thinking budget per question. Applies to every specialist
                    # subagent, including add-ons (Shariah, future ESG/Insider).
                    thinking={"type": "adaptive"},
                ),
            ):
                if isinstance(msg, ResultMessage) and msg.result:
                    result_text = msg.result

            if not result_text:
                logger.warning("Specialist %s returned empty response", config.name)
                return None

            # Parse JSON response
            data = _parse_specialist_json(result_text)
            if not data:
                # JSON parse failed entirely — no point retrying, model gave bad format
                logger.warning("Specialist %s returned unparseable JSON", config.name)
                return None

            # Validate output schema
            issues = _validate_specialist_data(data, config.name)
            if issues:
                logger.warning(
                    "Specialist %s output has schema issues: %s",
                    config.name,
                    "; ".join(issues),
                )
                # Don't retry schema issues — use what we have with defaults

            # Ensure required fields with defaults (nullable-safe)
            data.setdefault("specialist_name", config.name)
            data.setdefault("ticker", ticker)
            data.setdefault("summary", "")
            data.setdefault("key_findings", [])
            data.setdefault("data_sources", [])
            data.setdefault("confidence", 0.5)
            data.setdefault("flags", [])

            return SpecialistFindings(**data)

        except Exception as e:
            last_error = e
            if attempt < MAX_RETRIES and _is_transient(e):
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                logger.warning(
                    "Specialist %s transient error (attempt %d/%d), retrying in %ds: %s",
                    config.name,
                    attempt + 1,
                    1 + MAX_RETRIES,
                    delay,
                    e,
                )
                await asyncio.sleep(delay)
                continue
            else:
                logger.error(
                    "Specialist %s error (non-transient or retries exhausted): %s",
                    config.name, e,
                )
                return None

    logger.error(
        "Specialist %s failed after %d attempts: %s",
        config.name, 1 + MAX_RETRIES, last_error,
    )
    return None


def _parse_specialist_json(text: str) -> dict | None:
    """Parse JSON from specialist response, handling common issues."""

    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try extracting JSON from markdown code blocks
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Try finding first { to last }
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass

    logger.warning("Could not parse specialist JSON response: %s", text[:200])
    return None
