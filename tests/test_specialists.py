"""Tests for specialist subagent infrastructure (non-LLM parts)."""

import json
import os
from pathlib import Path

from src.specialists.runner import _get_specialist_configs, _parse_specialist_json
from src.specialists.schemas import SpecialistFindings, SynthesisResult
from src.specialists.synthesis import _format_specialist_outputs
from src.strategy.loader import load_strategy

STRATEGIES_DIR = Path(__file__).parent.parent / "strategies"


# ─── JSON Parsing ───────────────────────────────────────


def test_parse_specialist_json_valid():
    """Valid JSON parses correctly."""
    text = '{"specialist_name": "financial", "ticker": "AAPL", "summary": "ok"}'
    result = _parse_specialist_json(text)
    assert result is not None
    assert result["specialist_name"] == "financial"
    assert result["ticker"] == "AAPL"


def test_parse_specialist_json_markdown_fence():
    """JSON in markdown code block parses correctly."""
    text = '```json\n{"specialist_name": "moat", "ticker": "MSFT"}\n```'
    result = _parse_specialist_json(text)
    assert result is not None
    assert result["specialist_name"] == "moat"
    assert result["ticker"] == "MSFT"


def test_parse_specialist_json_markdown_fence_no_lang():
    """JSON in markdown code block without language tag parses correctly."""
    text = '```\n{"specialist_name": "risk", "ticker": "GOOG"}\n```'
    result = _parse_specialist_json(text)
    assert result is not None
    assert result["specialist_name"] == "risk"


def test_parse_specialist_json_surrounded_by_text():
    """JSON surrounded by explanation text parses correctly."""
    text = 'Here are my findings:\n{"specialist_name": "mgmt", "ticker": "AMZN"}\nHope this helps!'
    result = _parse_specialist_json(text)
    assert result is not None
    assert result["specialist_name"] == "mgmt"


def test_parse_specialist_json_garbage():
    """Non-JSON returns None."""
    result = _parse_specialist_json("This is not JSON at all.")
    assert result is None


def test_parse_specialist_json_empty():
    """Empty string returns None."""
    result = _parse_specialist_json("")
    assert result is None


# ─── Specialist Config Extraction ───────────────────────


def test_specialist_config_from_strategy():
    """Specialist configs extracted from strategy.prompts.specialists correctly."""
    strategy = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")

    configs = _get_specialist_configs(strategy)
    assert len(configs) == 5
    names = [c.name for c in configs]
    assert "financial_analyst" in names
    assert "moat_analyst" in names
    assert "risk_analyst" in names
    assert "management_analyst" in names
    assert "mental_models" in names

    # Each config has the strategy's prompt body (sources folded inline)
    fa = next(c for c in configs if c.name == "financial_analyst")
    assert fa.prompt_body
    assert "stockanalysis" in fa.prompt_body  # source URLs inline in prose


def test_specialist_config_empty_strategy():
    """Strategy with no specialists returns empty configs list."""
    from src.strategy.loader import Strategy
    strategy = Strategy(
        name="test-empty",
        criteria=[],
        prompts={"synthesis": "x" * 100},
    )
    configs = _get_specialist_configs(strategy)
    assert configs == []


# ─── SynthesisResult Defaults ───────────────────────────


def test_synthesis_result_defaults():
    """SynthesisResult has sensible defaults."""
    result = SynthesisResult(
        ticker="AAPL",
        company_name="Apple Inc.",
        strategy="buffett-munger",
    )
    assert result.decision == "WATCH"
    assert result.confidence == 0.5
    assert result.quality_tier == "unknown"
    assert result.weighted_score == 0.0
    assert result.fair_value is None
    assert result.current_price is None
    assert result.key_risks == []
    assert result.catalysts == []
    assert result.specialists_used == []
    assert result.data_sources == []
    assert result.discrepancies == []
    assert result.recommended_position_pct is None
    assert result.tranche is None


def test_synthesis_result_full():
    """SynthesisResult accepts all fields."""
    result = SynthesisResult(
        ticker="MSFT",
        company_name="Microsoft",
        strategy="buffett-munger",
        fair_value=385.0,
        current_price=439.0,
        decision="WATCH",
        confidence=0.75,
        reasoning="Great business, wrong price.",
        thesis="Cloud dominance.",
        key_risks=["AI competition", "Regulation"],
        specialists_used=["financial_analyst", "moat_analyst"],
    )
    assert result.fair_value == 385.0
    assert result.decision == "WATCH"
    assert len(result.key_risks) == 2


# ─── Specialist Findings Defaults ───────────────────────


def test_specialist_findings_defaults():
    """SpecialistFindings has sensible defaults."""
    findings = SpecialistFindings(
        specialist_name="test",
        ticker="AAPL",
        summary="Test summary",
        key_findings=["finding 1"],
        data_sources=["source1"],
    )
    assert findings.confidence == 0.7
    assert findings.flags == []


# ─── Format Specialist Outputs ──────────────────────────


def test_format_specialist_outputs():
    """Specialist findings format correctly for synthesis prompt."""
    outputs = [
        SpecialistFindings(
            specialist_name="financial_analyst",
            ticker="AAPL",
            summary="Strong financials with growing revenue.",
            key_findings=["Revenue up 15%", "Margins expanding"],
            data_sources=["stockanalysis.com", "sec.gov"],
            confidence=0.85,
            flags=["GREEN: Revenue growth"],
        ),
        SpecialistFindings(
            specialist_name="risk_analyst",
            ticker="AAPL",
            summary="Moderate risk profile.",
            key_findings=["China supply chain risk"],
            data_sources=["reuters.com"],
            confidence=0.7,
            flags=["RED: Geographic concentration"],
        ),
    ]

    formatted = _format_specialist_outputs(outputs)
    assert "financial_analyst" in formatted
    assert "85%" in formatted  # confidence formatted as percentage
    assert "Revenue up 15%" in formatted
    assert "GREEN: Revenue growth" in formatted
    assert "risk_analyst" in formatted
    assert "70%" in formatted
    assert "China supply chain risk" in formatted
    assert "stockanalysis.com" in formatted


def test_format_specialist_outputs_empty():
    """Empty outputs list produces empty string."""
    formatted = _format_specialist_outputs([])
    assert formatted == ""


def test_format_specialist_outputs_no_flags():
    """Outputs with no flags show (none)."""
    outputs = [
        SpecialistFindings(
            specialist_name="test",
            ticker="AAPL",
            summary="Summary.",
            key_findings=[],
            data_sources=[],
            confidence=0.5,
            flags=[],
        ),
    ]
    formatted = _format_specialist_outputs(outputs)
    assert "(none)" in formatted


# ─── Strategy Loader Specialists Field ──────────────────


def test_strategy_specialists_field_default():
    """A Strategy without specialists has prompts.specialists == {} by default."""
    from src.strategy.loader import Strategy
    strategy_no_spec = Strategy(
        name="test-no-spec",
        criteria=[],
        prompts={"synthesis": "x" * 100},
    )
    assert strategy_no_spec.prompts.specialists == {}

    strategy_with_spec = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")
    assert len(strategy_with_spec.prompts.specialists) == 5
    assert "financial_analyst" in strategy_with_spec.prompts.specialists


# ─── run_specialists with on_progress callback ──────────


def test_run_specialists_emits_progress_events(monkeypatch):
    """Progress callback receives init/start/done events for every specialist."""
    import asyncio
    from src.specialists import runner as runner_mod
    from src.specialists.runner import SpecialistConfig, run_specialists

    strategy = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")

    async def fake_run_single(ticker, company_name, config, _strategy):
        return SpecialistFindings(
            specialist_name=config.name,
            ticker=ticker,
            summary="x",
            key_findings=[],
            data_sources=[],
            confidence=0.5,
        )

    monkeypatch.setattr(runner_mod, "_run_single_specialist", fake_run_single)

    events: list[dict] = []

    async def on_progress(evt):
        events.append(evt)

    addons = [SpecialistConfig(name="extra", prompt_body="extra role body")]
    findings = asyncio.run(
        run_specialists("AAPL", "Apple", strategy, addons=addons, on_progress=on_progress)
    )

    # Every specialist (5 from strategy + 1 add-on) returned findings
    assert len(findings) == 6

    # init event lists all specialist names in declaration order
    assert events[0]["type"] == "specialists_init"
    expected_names = list(strategy.prompts.specialists.keys()) + ["extra"]
    assert events[0]["names"] == expected_names

    starts = [e for e in events if e["type"] == "specialist_start"]
    dones = [e for e in events if e["type"] == "specialist_done"]
    assert {e["name"] for e in starts} == set(expected_names)
    assert {e["name"] for e in dones} == set(expected_names)
    for e in dones:
        assert "confidence" in e


def test_run_specialists_emits_error_event_on_failure(monkeypatch):
    """If a specialist raises, the callback receives a specialist_error event."""
    import asyncio
    from src.specialists import runner as runner_mod
    from src.specialists.runner import run_specialists

    strategy = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")

    async def fake_run_single(ticker, company_name, config, _strategy):
        raise RuntimeError(f"boom in {config.name}")

    monkeypatch.setattr(runner_mod, "_run_single_specialist", fake_run_single)

    events: list[dict] = []

    async def on_progress(evt):
        events.append(evt)

    findings = asyncio.run(
        run_specialists("AAPL", "Apple", strategy, on_progress=on_progress)
    )
    # All specialists failed — no findings, but pipeline did not crash
    assert findings == []

    error_events = [e for e in events if e["type"] == "specialist_error"]
    assert len(error_events) == len(strategy.prompts.specialists)
    assert all("boom" in e["error"] for e in error_events)


def test_run_specialists_no_callback_still_works(monkeypatch):
    """Pipeline must continue to work when no on_progress is supplied (backwards-compatible)."""
    import asyncio
    from src.specialists import runner as runner_mod
    from src.specialists.runner import run_specialists

    strategy = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")

    async def fake_run_single(ticker, company_name, config, _strategy):
        return SpecialistFindings(
            specialist_name=config.name,
            ticker=ticker,
            summary="x",
            key_findings=[],
            data_sources=[],
            confidence=0.5,
        )

    monkeypatch.setattr(runner_mod, "_run_single_specialist", fake_run_single)
    findings = asyncio.run(run_specialists("AAPL", "Apple", strategy))
    assert len(findings) == 5


# ─── Add-on injection ──────────────────────────────────


def test_shariah_addon_appends_to_roster(monkeypatch):
    """The Shariah add-on specialist runs alongside the strategy roster, not replacing it."""
    import asyncio
    from src.specialists import runner as runner_mod
    from src.specialists.addons import SHARIAH_SPECIALIST
    from src.specialists.runner import run_specialists

    strategy = load_strategy(STRATEGIES_DIR / "buffett-munger.yaml")

    seen: list[str] = []

    async def fake_run_single(ticker, company_name, config, _strategy):
        seen.append(config.name)
        return SpecialistFindings(
            specialist_name=config.name,
            ticker=ticker,
            summary="x",
            key_findings=[],
            data_sources=[],
            confidence=0.5,
        )

    monkeypatch.setattr(runner_mod, "_run_single_specialist", fake_run_single)

    asyncio.run(
        run_specialists("AAPL", "Apple", strategy, addons=[SHARIAH_SPECIALIST])
    )
    assert "shariah_compliance" in seen
    assert "financial_analyst" in seen
    assert len(seen) == len(strategy.prompts.specialists) + 1


# ─── Synthesis agent has web tools (Flag 5) ────────────


def test_synthesis_agent_uses_web_tools(monkeypatch):
    """Synthesis agent must request WebSearch/WebFetch so it can verify discrepancies."""
    import asyncio
    from src.specialists import synthesis as synth_mod

    captured_options = {}

    async def fake_query(prompt, options):
        captured_options["options"] = options
        if False:  # pragma: no cover - make this an async generator
            yield None
        return

    monkeypatch.setattr(synth_mod, "sdk_query", fake_query, raising=False)

    # We can't actually run synthesize() without the Agent SDK runtime, but we can
    # at least verify the option assembly by inspecting the source intent.
    # The hard guarantee: the file must include WebSearch + WebFetch for synthesis.
    src = (Path(__file__).parent.parent / "src" / "specialists" / "synthesis.py").read_text()
    assert 'allowed_tools=["WebSearch", "WebFetch"]' in src


# ─── Adaptive extended thinking ────────────────────────


def test_specialist_runner_uses_adaptive_thinking():
    """Every specialist subagent must run with adaptive extended thinking."""
    src = (Path(__file__).parent.parent / "src" / "specialists" / "runner.py").read_text()
    assert 'thinking={"type": "adaptive"}' in src


def test_synthesis_uses_adaptive_thinking():
    """Synthesis agent must run with adaptive extended thinking."""
    src = (Path(__file__).parent.parent / "src" / "specialists" / "synthesis.py").read_text()
    assert 'thinking={"type": "adaptive"}' in src


def test_web_chat_uses_adaptive_thinking():
    """Web WebSocket chat agent must run with adaptive extended thinking."""
    src = (Path(__file__).parent.parent / "src" / "web" / "app.py").read_text()
    assert 'thinking={"type": "adaptive"}' in src


def test_cli_chat_uses_adaptive_thinking():
    """CLI chat agent must run with adaptive extended thinking."""
    src = (Path(__file__).parent.parent / "src" / "agent" / "core.py").read_text()
    assert 'thinking={"type": "adaptive"}' in src


# ─── Specialist prompt and runner ─────────────────────


def test_build_specialist_prompt():
    """Both in-process and container runners must produce the same prompt for
    the same inputs, so swapping modes can't change analysis behavior."""
    from src.specialists.runner import build_specialist_prompt
    body = (
        "Score competitive advantages for {COMPANY} ({TICKER}).\n"
        "Sources to check first:\n  - https://x.com/{TICKER}"
    )
    p1 = build_specialist_prompt(
        ticker="AAPL", company_name="Apple", config_name="moat_analyst",
        prompt_body=body,
        strategy_name="buffett-munger", strategy_description="Concentrated value.",
    )
    assert "AAPL" in p1
    assert "Apple" in p1
    assert "https://x.com/AAPL" in p1   # {TICKER} substitution applied
    assert "Apple (AAPL)" in p1          # {COMPANY} substitution applied
    assert "Score competitive advantages" in p1
    # Same call with same args — deterministic
    p2 = build_specialist_prompt(
        ticker="AAPL", company_name="Apple", config_name="moat_analyst",
        prompt_body=body,
        strategy_name="buffett-munger", strategy_description="Concentrated value.",
    )
    assert p1 == p2


def test_specialists_have_only_web_tools():
    """Specialists and the synthesis agent must only enable WebSearch +
    WebFetch. Bash/Read/Glob/Grep would expand the blast radius of a
    prompt-injection attack from web content for no functional benefit —
    specialists never use them.
    """
    surfaces = {
        "in-process runner": Path(__file__).parent.parent / "src" / "specialists" / "runner.py",
        "synthesis agent": Path(__file__).parent.parent / "src" / "specialists" / "synthesis.py",
    }
    forbidden = ('"Bash"', '"Read"', '"Glob"', '"Grep"', '"Edit"', '"Write"')
    for label, path in surfaces.items():
        text = path.read_text()
        # Find the allowed_tools lines explicitly so a mention in a comment
        # doesn't trip the assertion.
        tool_lines = [l for l in text.splitlines() if "allowed_tools=" in l and "#" not in l.split("allowed_tools=")[0]]
        assert tool_lines, f"{label}: no allowed_tools= line found"
        for line in tool_lines:
            for f in forbidden:
                assert f not in line, (
                    f"{label}: allowed_tools contains forbidden tool {f}: {line.strip()}"
                )
            assert '"WebSearch"' in line and '"WebFetch"' in line, (
                f"{label}: allowed_tools missing WebSearch/WebFetch: {line.strip()}"
            )


# ─── Strategy-aware addons (review, news) ────────────


def test_addon_registry_contains_review_and_news():
    """Review and news pulse addons are registered and discoverable."""
    from src.specialists.addons import ADDON_REGISTRY, list_addons
    assert "review" in ADDON_REGISTRY
    assert "news" in ADDON_REGISTRY
    assert "review" in list_addons()
    assert "news" in list_addons()


def test_review_addon_has_previous_analysis_placeholder():
    """Review addon prompt must contain {PREVIOUS_ANALYSIS} for context injection."""
    from src.specialists.addons import REVIEW_SPECIALIST
    assert "{PREVIOUS_ANALYSIS}" in REVIEW_SPECIALIST.prompt_body


def test_news_addon_has_previous_analysis_placeholder():
    """News pulse addon prompt must contain {PREVIOUS_ANALYSIS} for context injection."""
    from src.specialists.addons import NEWS_PULSE_SPECIALIST
    assert "{PREVIOUS_ANALYSIS}" in NEWS_PULSE_SPECIALIST.prompt_body


def test_strategy_aware_addons_set_matches_registry():
    """Every addon in STRATEGY_AWARE_ADDONS must exist in the registry."""
    from src.specialists.addons import ADDON_REGISTRY, STRATEGY_AWARE_ADDONS
    for name in STRATEGY_AWARE_ADDONS:
        assert name in ADDON_REGISTRY, f"{name} in STRATEGY_AWARE_ADDONS but not in ADDON_REGISTRY"


def test_shariah_is_not_strategy_aware():
    """Shariah is strategy-agnostic — must NOT be in STRATEGY_AWARE_ADDONS."""
    from src.specialists.addons import STRATEGY_AWARE_ADDONS
    assert "shariah" not in STRATEGY_AWARE_ADDONS


def test_inject_previous_analysis_no_saved_analysis(tmp_path, monkeypatch):
    """When no previous analysis exists, placeholder is replaced with first-time note."""
    from src.operations.analysis import _inject_previous_analysis
    from src.specialists.runner import SpecialistConfig

    # Empty DB
    import sqlite3
    import src.db.schema as schema_mod
    db_path = tmp_path / "empty.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("""CREATE TABLE analyses (
        id INTEGER PRIMARY KEY, ticker TEXT, strategy TEXT, decision TEXT,
        buy_price REAL, current_price REAL, quality_tier TEXT, weighted_score REAL,
        thesis TEXT, bull_case TEXT, bear_case TEXT, key_risks TEXT,
        catalysts TEXT, overrides TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""")
    conn.execute("""CREATE TABLE specialist_findings (
        id INTEGER PRIMARY KEY, analysis_id INTEGER, specialist_name TEXT,
        summary TEXT, key_findings TEXT, data_sources TEXT, flags TEXT,
        confidence REAL, extra_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""")
    conn.commit()
    conn.close()
    monkeypatch.setattr(schema_mod, "get_db", lambda: sqlite3.connect(str(db_path)))

    addon = SpecialistConfig(
        name="test_addon",
        prompt_body="Before.\n{PREVIOUS_ANALYSIS}\nAfter.",
    )
    result = _inject_previous_analysis(addon, "AAPL")
    assert "{PREVIOUS_ANALYSIS}" not in result.prompt_body
    assert "Before." in result.prompt_body
    assert "After." in result.prompt_body
    assert "No previous analysis" in result.prompt_body
    # Original addon is NOT mutated
    assert "{PREVIOUS_ANALYSIS}" in addon.prompt_body


def test_inject_previous_analysis_with_saved_analysis(tmp_path, monkeypatch):
    """When a previous analysis exists, context is injected with thesis and risks."""
    from src.operations.analysis import _inject_previous_analysis
    from src.specialists.runner import SpecialistConfig

    # Create a temp DB with a saved analysis
    import sqlite3
    db_path = tmp_path / "test.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("""CREATE TABLE analyses (
        id INTEGER PRIMARY KEY, ticker TEXT, strategy TEXT, decision TEXT,
        buy_price REAL, current_price REAL, quality_tier TEXT, weighted_score REAL,
        thesis TEXT, bull_case TEXT, bear_case TEXT, key_risks TEXT,
        catalysts TEXT, overrides TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""")
    conn.execute("""CREATE TABLE specialist_findings (
        id INTEGER PRIMARY KEY, analysis_id INTEGER, specialist_name TEXT,
        summary TEXT, key_findings TEXT, data_sources TEXT, flags TEXT,
        confidence REAL, extra_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""")
    conn.execute(
        "INSERT INTO analyses (ticker, strategy, decision, buy_price, current_price, "
        "quality_tier, weighted_score, thesis, bull_case, bear_case, key_risks, catalysts, overrides) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("AAPL", "buffett", "BUY", 150.0, 175.0, "wide", 4.2,
         "Apple has dominant ecosystem", "Services growth", "China risk",
         '["Regulatory pressure", "China revenue"]', '["AI integration"]', '{}'),
    )
    conn.commit()
    conn.close()

    # Monkeypatch get_db to return our temp DB
    import src.db.schema as schema_mod
    def _make_conn():
        c = sqlite3.connect(str(db_path))
        c.row_factory = sqlite3.Row
        return c
    monkeypatch.setattr(schema_mod, "get_db", _make_conn)

    addon = SpecialistConfig(
        name="test_addon",
        prompt_body="Review: {PREVIOUS_ANALYSIS}",
    )
    result = _inject_previous_analysis(addon, "AAPL")
    assert "Apple has dominant ecosystem" in result.prompt_body
    assert "BUY" in result.prompt_body
    assert "Regulatory pressure" in result.prompt_body
    assert "{PREVIOUS_ANALYSIS}" not in result.prompt_body


def test_review_addon_prompt_is_strategy_aware():
    """Review prompt references strategy context via standard runner substitution."""
    from src.specialists.addons import REVIEW_SPECIALIST
    # The runner substitutes {TICKER} and {COMPANY} and wraps with STRATEGY header
    assert "{TICKER}" in REVIEW_SPECIALIST.prompt_body
    assert "{COMPANY}" in REVIEW_SPECIALIST.prompt_body
    assert "quarterly" in REVIEW_SPECIALIST.prompt_body.lower()
    assert "thesis_status" in REVIEW_SPECIALIST.prompt_body


def test_news_addon_prompt_is_strategy_aware():
    """News pulse prompt references strategy context."""
    from src.specialists.addons import NEWS_PULSE_SPECIALIST
    assert "{TICKER}" in NEWS_PULSE_SPECIALIST.prompt_body
    assert "{COMPANY}" in NEWS_PULSE_SPECIALIST.prompt_body
    assert "thesis_alignment" in NEWS_PULSE_SPECIALIST.prompt_body
    assert "material_changes" in NEWS_PULSE_SPECIALIST.prompt_body


