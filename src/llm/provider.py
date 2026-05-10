"""LLM provider — thin wrapper around Claude.

Provides a simple interface for the research and decision modules.
Handles token counting, retries, model selection, and extended thinking.

Authentication priority:
  1. ANTHROPIC_API_KEY env var → uses raw Anthropic SDK (api.anthropic.com)
  2. Otherwise → uses Claude Agent SDK (subscription auth via Claude Code)
     Works with Claude Pro/Team subscriptions without an API key.
"""

import asyncio
import json
import logging
import os
import time
import warnings
from pathlib import Path

import anthropic

logger = logging.getLogger("investment_agent.llm")


# Default model — Sonnet for speed/cost, Opus for deep analysis
DEFAULT_MODEL = "claude-sonnet-4-6-20250514"
DEEP_MODEL = "claude-opus-4-7-20250507"

# Lightweight model for high-volume calls (section summaries)
LIGHT_MODEL = "claude-haiku-4-5-20251001"

# Token limits by model
MODEL_LIMITS = {
    "claude-sonnet-4-6-20250514": 200_000,
    "claude-opus-4-7-20250507": 200_000,
}

# Agent SDK uses short model names, raw SDK uses full IDs
_AGENT_SDK_MODEL_MAP = {
    "claude-sonnet-4-6-20250514": "claude-sonnet-4-6",
    "claude-opus-4-7-20250507": "claude-opus-4-7",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
}


def _agent_sdk_model(model: str) -> str:
    """Convert full model ID to Agent SDK short name."""
    return _AGENT_SDK_MODEL_MAP.get(model, model)


def _use_raw_sdk() -> bool:
    """Return True if we should use the raw Anthropic SDK (API key is set)."""
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


# ---------------------------------------------------------------------------
# Agent SDK helpers (subscription auth)
# ---------------------------------------------------------------------------

# Suppress the async generator cleanup warning from the Agent SDK
warnings.filterwarnings("ignore", message=".*asynchronous generator.*")


def _run_async(coro):
    """Run an async coroutine from sync code, handling event loop edge cases."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # We're inside an already-running loop (e.g. Jupyter, uvicorn).
        # Create a new loop in a thread.
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, coro).result()
    else:
        return asyncio.run(coro)


async def _agent_sdk_complete(prompt: str, system: str, model: str) -> str:
    """Call Claude via Agent SDK (uses subscription auth)."""
    from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage

    full_prompt = f"{system}\n\n{prompt}" if system else prompt
    for attempt in range(2):
        try:
            result_text = ""
            async for msg in query(
                prompt=full_prompt,
                options=ClaudeAgentOptions(
                    model=_agent_sdk_model(model),
                    permission_mode="bypassPermissions",
                    cwd=str(Path.home()),
                ),
            ):
                if isinstance(msg, ResultMessage) and msg.result:
                    result_text = msg.result
            return result_text
        except Exception as e:
            if attempt == 0:
                logger.warning("Agent SDK call failed, retrying: %s", e)
                continue
            raise


async def _agent_sdk_complete_messages(messages: list[dict[str, str]], system: str, model: str) -> str:
    """Call Claude via Agent SDK with a multi-turn conversation."""
    from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage

    # Flatten message list into a single prompt string
    parts = []
    if system:
        parts.append(system)
    for m in messages:
        role_label = "User" if m["role"] == "user" else "Assistant"
        parts.append(f"{role_label}: {m['content']}")
    full_prompt = "\n\n".join(parts)

    result_text = ""
    async for msg in query(
        prompt=full_prompt,
        options=ClaudeAgentOptions(
            model=_agent_sdk_model(model),
            permission_mode="bypassPermissions",
            cwd=str(Path.home()),
        ),
    ):
        if isinstance(msg, ResultMessage) and msg.result:
            result_text = msg.result
    return result_text


# ---------------------------------------------------------------------------
# Raw Anthropic SDK helpers (API key auth)
# ---------------------------------------------------------------------------

def _load_oauth_token() -> str | None:
    """Try to load OAuth token from Claude Code's credentials file."""
    creds_path = Path.home() / ".claude" / ".credentials.json"
    if not creds_path.exists():
        return None
    try:
        data = json.loads(creds_path.read_text())
        oauth = data.get("claudeAiOauth", {})
        return oauth.get("accessToken")
    except (json.JSONDecodeError, KeyError):
        return None


def get_client() -> anthropic.Anthropic:
    """Get an Anthropic client with automatic credential resolution.

    Tries in order:
      1. ANTHROPIC_API_KEY env var (direct API key)
      2. CLAUDE_CODE_OAUTH_TOKEN env var (Claude Pro/Team subscription)
      3. OneCLI proxy (ONECLI_URL env var) — uses proxy base URL
      4. Claude OAuth token from ~/.claude/.credentials.json

    Raises:
        ValueError: If no credentials are found.
    """
    # Option 1: Direct API key
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        return anthropic.Anthropic(api_key=api_key)

    # Option 2: Claude Code OAuth token (Claude Pro subscription)
    oauth_env = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")
    if oauth_env:
        return anthropic.Anthropic(auth_token=oauth_env)

    # Option 3: Claude OAuth token from credentials file
    oauth_token = _load_oauth_token()
    if oauth_token:
        return anthropic.Anthropic(auth_token=oauth_token)

    raise ValueError(
        "No Anthropic credentials found. Set one of:\n"
        "  1. ANTHROPIC_API_KEY env var\n"
        "  2. CLAUDE_CODE_OAUTH_TOKEN env var (Claude Pro subscription)\n"
        "  3. Log in with Claude Code (creates ~/.claude/.credentials.json)"
    )


MAX_RETRIES = 3
RETRY_BASE_DELAY = 30  # seconds — rate limits on Pro are per-minute


def _call_with_retry(client: anthropic.Anthropic, kwargs: dict) -> anthropic.types.Message:
    """Call the API with exponential backoff on rate limit errors."""
    for attempt in range(MAX_RETRIES):
        try:
            return client.messages.create(**kwargs)
        except anthropic.RateLimitError:
            if attempt == MAX_RETRIES - 1:
                raise
            delay = RETRY_BASE_DELAY * (2 ** attempt)
            logger.warning("Rate limited — retrying in %ds", delay)
            time.sleep(delay)
    raise RuntimeError("Unreachable")


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def complete(
    prompt: str,
    system: str = "",
    model: str = DEFAULT_MODEL,
    max_tokens: int = 4096,
    temperature: float = 0.0,
    thinking: bool = False,
    thinking_budget: int = 10000,
) -> str:
    """Send a single prompt to Claude and return the response text.

    Args:
        prompt: User message content.
        system: System prompt (methodology context, instructions).
        model: Model ID to use.
        max_tokens: Maximum response tokens.
        temperature: 0.0 for deterministic, higher for creative.
            Ignored when thinking=True (API requires temperature=1).
        thinking: Enable extended thinking for deeper reasoning.
        thinking_budget: Max tokens for internal reasoning (when thinking=True).

    Returns:
        Response text content (thinking output is not returned,
        but influences the quality of the response).
    """
    if not _use_raw_sdk():
        # --- Agent SDK path (subscription auth) ---
        logger.debug(
            "LLM call (agent-sdk): model=%s, system_prompt_length=%d, prompt_length=%d",
            model, len(system or ""), len(prompt),
        )
        result = _run_async(_agent_sdk_complete(prompt, system, model))
        logger.debug(
            "LLM response (agent-sdk): model=%s, response_length=%d",
            model, len(result),
        )
        return result

    # --- Raw SDK path (API key auth) ---
    client = get_client()

    kwargs: dict = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
    }

    if system:
        kwargs["system"] = system

    if thinking:
        kwargs["temperature"] = 1
        kwargs["max_tokens"] = thinking_budget + max_tokens
        kwargs["thinking"] = {
            "type": "enabled",
            "budget_tokens": thinking_budget,
        }
    else:
        kwargs["temperature"] = temperature
        kwargs["max_tokens"] = max_tokens

    logger.debug("LLM call: model=%s, system_prompt_length=%d, prompt_length=%d", model, len(system or ""), len(prompt))
    message = _call_with_retry(client, kwargs)
    logger.debug(
        "LLM response: model=%s, tokens_in=%d, tokens_out=%d, response_length=%d",
        model,
        message.usage.input_tokens,
        message.usage.output_tokens,
        sum(len(block.text) for block in message.content if block.type == "text"),
    )

    for block in message.content:
        if block.type == "text":
            return block.text

    return message.content[-1].text


def complete_with_thinking(
    prompt: str,
    system: str = "",
    model: str = DEFAULT_MODEL,
    max_tokens: int = 4096,
    thinking_budget: int = 10000,
) -> tuple[str, str]:
    """Send a prompt and return BOTH the thinking and response.

    Useful when you want to log or display the reasoning chain
    (e.g., for decision transparency).

    Args:
        prompt: User message content.
        system: System prompt.
        model: Model ID.
        max_tokens: Max response tokens.
        thinking_budget: Max thinking tokens.

    Returns:
        Tuple of (thinking_text, response_text).
    """
    if not _use_raw_sdk():
        # --- Agent SDK path ---
        # The Agent SDK handles thinking internally (adaptive thinking).
        # We return empty thinking text; reasoning quality is preserved.
        logger.debug(
            "LLM call (agent-sdk, thinking): model=%s, system_prompt_length=%d, prompt_length=%d",
            model, len(system or ""), len(prompt),
        )
        result = _run_async(_agent_sdk_complete(prompt, system, model))
        logger.debug(
            "LLM response (agent-sdk, thinking): model=%s, response_length=%d",
            model, len(result),
        )
        return "", result

    # --- Raw SDK path ---
    client = get_client()

    kwargs: dict = {
        "model": model,
        "temperature": 1,
        "max_tokens": thinking_budget + max_tokens,
        "thinking": {
            "type": "enabled",
            "budget_tokens": thinking_budget,
        },
        "messages": [{"role": "user", "content": prompt}],
    }

    if system:
        kwargs["system"] = system

    logger.debug("LLM call: model=%s, system_prompt_length=%d, prompt_length=%d", model, len(system or ""), len(prompt))
    message = _call_with_retry(client, kwargs)

    thinking_text = ""
    response_text = ""

    for block in message.content:
        if block.type == "thinking":
            thinking_text = block.thinking
        elif block.type == "text":
            response_text = block.text

    logger.debug(
        "LLM response: model=%s, tokens_in=%d, tokens_out=%d, response_length=%d",
        model,
        message.usage.input_tokens,
        message.usage.output_tokens,
        len(response_text),
    )

    return thinking_text, response_text


def complete_structured(
    prompt: str,
    system: str = "",
    model: str = DEFAULT_MODEL,
    max_tokens: int = 4096,
    temperature: float = 0.0,
    thinking: bool = False,
    thinking_budget: int = 10000,
) -> str:
    """Like complete(), but encourages JSON output.

    When using the raw SDK without thinking, uses Claude's response
    prefill trick (start assistant response with '{').

    When using the Agent SDK or thinking mode, adds a JSON instruction
    to the prompt instead (prefill is not available).

    Returns:
        JSON string (caller should parse).
    """
    if not _use_raw_sdk():
        # --- Agent SDK path ---
        json_instruction = "\n\nIMPORTANT: Return valid JSON only. No markdown fences, no explanation outside the JSON."
        full_system = (system + json_instruction) if system else json_instruction.strip()
        logger.debug(
            "LLM call (agent-sdk, structured): model=%s, system_prompt_length=%d, prompt_length=%d",
            model, len(full_system), len(prompt),
        )
        result = _run_async(_agent_sdk_complete(prompt, full_system, model))
        logger.debug(
            "LLM response (agent-sdk, structured): model=%s, response_length=%d",
            model, len(result),
        )
        return result

    # --- Raw SDK path ---
    client = get_client()

    if thinking:
        json_instruction = "\n\nIMPORTANT: Return valid JSON only. No markdown fences, no explanation outside the JSON."
        full_system = (system + json_instruction) if system else json_instruction.strip()

        return complete(
            prompt,
            system=full_system,
            model=_agent_sdk_model(model),
            max_tokens=max_tokens,
            thinking=True,
            thinking_budget=thinking_budget,
        )

    # Non-thinking mode: use prefill trick
    kwargs: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": "{"},
        ],
    }

    if system:
        kwargs["system"] = system

    logger.debug("LLM call: model=%s, system_prompt_length=%d, prompt_length=%d", model, len(system or ""), len(prompt))
    message = _call_with_retry(client, kwargs)
    logger.debug(
        "LLM response: model=%s, tokens_in=%d, tokens_out=%d, response_length=%d",
        model,
        message.usage.input_tokens,
        message.usage.output_tokens,
        len(message.content[0].text) + 1,
    )

    # Prepend the '{' we used as prefill
    return "{" + message.content[0].text


def complete_messages(
    messages: list[dict[str, str]],
    system: str = "",
    model: str = DEFAULT_MODEL,
    max_tokens: int = 4096,
    temperature: float = 0.7,
) -> str:
    """Send a multi-turn conversation to Claude and return the response.

    Used for conversational agents (e.g., onboarding) where context
    builds across multiple user/assistant exchanges.

    Args:
        messages: List of message dicts with 'role' and 'content' keys.
            Roles: 'user' and 'assistant'.
        system: System prompt.
        model: Model ID to use.
        max_tokens: Maximum response tokens.
        temperature: Higher for conversational creativity.

    Returns:
        Response text content.
    """
    if not _use_raw_sdk():
        # --- Agent SDK path ---
        total_prompt_length = sum(len(m.get("content", "")) for m in messages)
        logger.debug(
            "LLM call (agent-sdk, messages): model=%s, system_prompt_length=%d, prompt_length=%d",
            model, len(system or ""), total_prompt_length,
        )
        result = _run_async(_agent_sdk_complete_messages(messages, system, model))
        logger.debug(
            "LLM response (agent-sdk, messages): model=%s, response_length=%d",
            model, len(result),
        )
        return result

    # --- Raw SDK path ---
    client = get_client()

    kwargs: dict = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    if system:
        kwargs["system"] = system

    total_prompt_length = sum(len(m.get("content", "")) for m in messages)
    logger.debug("LLM call: model=%s, system_prompt_length=%d, prompt_length=%d", model, len(system or ""), total_prompt_length)
    message = _call_with_retry(client, kwargs)
    logger.debug(
        "LLM response: model=%s, tokens_in=%d, tokens_out=%d, response_length=%d",
        model,
        message.usage.input_tokens,
        message.usage.output_tokens,
        sum(len(block.text) for block in message.content if block.type == "text"),
    )

    for block in message.content:
        if block.type == "text":
            return block.text

    return message.content[-1].text


def estimate_tokens(text: str) -> int:
    """Rough token estimate (4 chars per token for English).

    Good enough for chunking decisions. Not a billing estimate.
    """
    return len(text) // 4
