"""Tests for the activity feed + specialist findings + task_runs persistence.

Pins the Phase-3c audit story:
  * specialist_findings cascade-delete with their parent analysis
  * task_runs round-trip start → end with exit_code + excerpts
  * get_activity unifies analyses, lists, decisions, task_runs into
    one chronologically-sorted feed with type filtering
  * get_analysis(id) returns the analysis with its findings inlined
"""

import pytest


@pytest.fixture
def tmp_workdir(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "data").mkdir()
    yield tmp_path


@pytest.fixture
def tmp_workdir_with_strategies(tmp_path, monkeypatch):
    """Workdir with the strategies/ presets copied in so anything that
    needs to load a strategy (e.g. run_addon) can find one."""
    import shutil
    from pathlib import Path

    monkeypatch.chdir(tmp_path)
    (tmp_path / "data").mkdir()
    src = Path(__file__).parent.parent / "strategies"
    shutil.copytree(src, tmp_path / "strategies")
    yield tmp_path


# ─── specialist_findings persistence ────────────────────────────────


def test_save_specialist_findings_with_extras(tmp_workdir):
    """Common columns get typed cells; specialist-specific fields land in extra_json."""
    from src.db.operations import (
        get_analysis_by_id,
        get_specialist_findings,
        save_analysis,
        save_specialist_findings,
    )
    from src.db.schema import get_db

    conn = get_db()
    try:
        aid = save_analysis(
            conn,
            ticker="AAPL",
            strategy="buffett-munger",
            decision="WATCH",
            buy_price=350,
            current_price=400,
            quality_tier="wide",
            weighted_score=4.2,
            thesis="",
            bull_case="",
            bear_case="",
            key_risks=[],
            overrides={},
        )
        save_specialist_findings(
            conn,
            aid,
            [
                {
                    "specialist_name": "moat_analyst",
                    "ticker": "AAPL",
                    "summary": "wide moat from ecosystem",
                    "key_findings": ["80% gross margin", "switching costs high"],
                    "data_sources": ["stockanalysis.com"],
                    "flags": ["GREEN: pricing power"],
                    "confidence": 0.85,
                    # Specialist-specific extras
                    "moat_score_breakdown": {"switching": 5, "network": 3},
                    "industry_position": "dominant",
                },
            ],
        )
        rows = get_specialist_findings(conn, aid)
        assert len(rows) == 1
        r = rows[0]
        assert r["specialist_name"] == "moat_analyst"
        assert r["confidence"] == 0.85
        # JSON arrays parsed back
        assert r["key_findings"] == ["80% gross margin", "switching costs high"]
        assert r["flags"] == ["GREEN: pricing power"]
        # Extras land in `extra` (parsed) not lost
        assert r["extra"]["moat_score_breakdown"] == {"switching": 5, "network": 3}
        assert r["extra"]["industry_position"] == "dominant"

        # get_analysis_by_id inlines findings
        full = get_analysis_by_id(conn, aid)
        assert full["id"] == aid
        assert len(full["specialist_findings"]) == 1
    finally:
        conn.close()


def test_specialist_findings_cascade_on_analysis_delete(tmp_workdir):
    """Deleting an analysis drops its findings (FK cascade with PRAGMA on)."""
    from src.db.operations import save_analysis, save_specialist_findings
    from src.db.schema import get_db

    conn = get_db()
    try:
        aid = save_analysis(
            conn,
            ticker="MSFT",
            strategy="quality-compounder",
            decision="BUY",
            buy_price=300,
            current_price=290,
            quality_tier="generational",
            weighted_score=4.8,
            thesis="",
            bull_case="",
            bear_case="",
            key_risks=[],
            overrides={},
        )
        save_specialist_findings(
            conn,
            aid,
            [
                {"specialist_name": "a", "ticker": "MSFT", "summary": "x"},
                {"specialist_name": "b", "ticker": "MSFT", "summary": "y"},
            ],
        )
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM specialist_findings WHERE analysis_id = ?", (aid,)
            ).fetchone()[0]
            == 2
        )

        conn.execute("DELETE FROM analyses WHERE id = ?", (aid,))
        conn.commit()
        remaining = conn.execute(
            "SELECT COUNT(*) FROM specialist_findings WHERE analysis_id = ?", (aid,)
        ).fetchone()[0]
        assert remaining == 0, "cascade should have dropped findings"
    finally:
        conn.close()


def test_get_analysis_by_id_returns_none_for_missing(tmp_workdir):
    from src.db.operations import get_analysis_by_id
    from src.db.schema import get_db

    conn = get_db()
    try:
        assert get_analysis_by_id(conn, 9999) is None
    finally:
        conn.close()


def test_get_analysis_op_validates_id(tmp_workdir):
    from src.operations.analyses import get_analysis

    with pytest.raises(ValueError, match="positive int"):
        get_analysis(0)
    with pytest.raises(ValueError, match="positive int"):
        get_analysis(-1)


# ─── task_runs ─────────────────────────────────────────────────────


def test_task_run_lifecycle(tmp_workdir):
    """record_task_run_start opens a row; record_task_run_end closes it."""
    from src.db.operations import (
        add_scheduled_task,
        get_task_runs,
        record_task_run_end,
        record_task_run_start,
    )
    from src.db.schema import get_db

    conn = get_db()
    try:
        task_id = add_scheduled_task(
            conn,
            name="daily-watch",
            command="owlfolio analyze AAPL",
            schedule="0 7 * * *",
        )
        run_id = record_task_run_start(
            conn,
            task_id,
            "daily-watch",
            "owlfolio analyze AAPL",
        )
        # Mid-flight: exit_code is NULL
        runs = get_task_runs(conn)
        assert runs[0]["exit_code"] is None
        assert runs[0]["finished_at"] is None

        record_task_run_end(
            conn,
            run_id,
            exit_code=0,
            stdout="Analysis complete.",
            stderr="",
        )
        runs = get_task_runs(conn)
        assert runs[0]["exit_code"] == 0
        assert runs[0]["finished_at"] is not None
        assert runs[0]["stdout_excerpt"] == "Analysis complete."
    finally:
        conn.close()


def test_task_run_excerpts_capped_at_2kb(tmp_workdir):
    """Long stdout/stderr are truncated to ~2KB so the table doesn't bloat."""
    from src.db.operations import (
        add_scheduled_task,
        get_task_runs,
        record_task_run_end,
        record_task_run_start,
    )
    from src.db.schema import get_db

    conn = get_db()
    try:
        task_id = add_scheduled_task(
            conn,
            name="t",
            command="owlfolio analyze AAPL",
            schedule="* * * * *",
        )
        run_id = record_task_run_start(conn, task_id, "t", "owlfolio analyze AAPL")
        record_task_run_end(conn, run_id, exit_code=1, stdout="x" * 5000, stderr="y" * 5000)
        runs = get_task_runs(conn)
        assert len(runs[0]["stdout_excerpt"]) == 2048
        assert len(runs[0]["stderr_excerpt"]) == 2048
    finally:
        conn.close()


def test_task_runs_cascade_on_task_delete(tmp_workdir):
    from src.db.operations import (
        add_scheduled_task,
        record_task_run_start,
    )
    from src.db.schema import get_db

    conn = get_db()
    try:
        task_id = add_scheduled_task(
            conn,
            name="t",
            command="owlfolio analyze AAPL",
            schedule="* * * * *",
        )
        record_task_run_start(conn, task_id, "t", "owlfolio analyze AAPL")
        record_task_run_start(conn, task_id, "t", "owlfolio analyze AAPL")
        conn.execute("DELETE FROM scheduled_tasks WHERE id = ?", (task_id,))
        conn.commit()
        remaining = conn.execute(
            "SELECT COUNT(*) FROM task_runs WHERE task_id = ?", (task_id,)
        ).fetchone()[0]
        assert remaining == 0
    finally:
        conn.close()


# ─── activity feed ──────────────────────────────────────────────────


def _seed_one_of_each(tmp_path):
    """Populate one analysis + one list + one decision + one task_run."""
    from src.db.operations import (
        add_scheduled_task,
        create_candidate_list,
        log_decision,
        record_task_run_end,
        record_task_run_start,
        save_analysis,
    )
    from src.db.schema import get_db

    conn = get_db()
    try:
        aid = save_analysis(
            conn,
            ticker="AAPL",
            strategy="buffett-munger",
            decision="WATCH",
            buy_price=350,
            current_price=400,
            quality_tier="wide",
            weighted_score=4.2,
            thesis="t",
            bull_case="b",
            bear_case="",
            key_risks=[],
            overrides={},
        )
        log_decision(
            conn,
            ticker="AAPL",
            action="buy",
            price=395,
            shares=10,
            reasoning="t",
            strategy="buffett-munger",
            analysis_id=aid,
        )
        create_candidate_list(
            conn,
            name="my-import",
            source="import",
            strategy="garp",
        )
        task_id = add_scheduled_task(
            conn,
            name="daily",
            command="owlfolio analyze AAPL",
            schedule="0 7 * * *",
        )
        run_id = record_task_run_start(
            conn,
            task_id,
            "daily",
            "owlfolio analyze AAPL",
        )
        record_task_run_end(conn, run_id, exit_code=0)
    finally:
        conn.close()


def test_get_activity_unifies_all_sources(tmp_workdir):
    from src.operations.activity import get_activity

    _seed_one_of_each(tmp_workdir)

    events = get_activity()
    types = sorted({e["type"] for e in events})
    assert types == ["analysis", "decision", "list", "task_run"]
    # Every row has the contract fields
    for e in events:
        assert "type" in e and "title" in e and "summary" in e
        assert "reference" in e and "timestamp" in e


def test_get_activity_filters_by_type(tmp_workdir):
    from src.operations.activity import get_activity

    _seed_one_of_each(tmp_workdir)

    only_analyses = get_activity(type_filter="analysis")
    assert all(e["type"] == "analysis" for e in only_analyses)
    assert len(only_analyses) == 1

    only_lists = get_activity(type_filter="list")
    assert all(e["type"] == "list" for e in only_lists)
    assert only_lists[0]["reference"] == "my-import"  # lists referenced by name


def test_get_activity_rejects_unknown_filter(tmp_workdir):
    from src.operations.activity import get_activity

    with pytest.raises(ValueError, match="unknown type_filter"):
        get_activity(type_filter="nonsense")


def test_analysis_event_distinguishes_addon_runs(tmp_workdir):
    """Shariah-style addon runs have decision='N/A' — they should render
    as informational, not as a buy/sell signal."""
    from src.db.operations import save_analysis
    from src.db.schema import get_db
    from src.operations.activity import get_activity

    conn = get_db()
    try:
        save_analysis(
            conn,
            ticker="AAPL",
            strategy="shariah-addon",
            decision="N/A",
            buy_price=0,
            current_price=0,
            quality_tier="addon",
            weighted_score=0,
            thesis="compliant",
            bull_case="",
            bear_case="",
            key_risks=[],
            overrides={},
        )
    finally:
        conn.close()

    events = get_activity(type_filter="analysis")
    assert len(events) == 1
    # Title should signal it's an addon, not a BUY/WATCH/PASS pill
    assert "addon" in events[0]["title"].lower()
    assert events[0]["decision"] == "N/A"


# ─── MCP tool wiring ────────────────────────────────────────────────


def test_get_analysis_and_get_activity_registered():
    """Both new MCP tools are registered + on the chat-agent allowlist."""
    from src.mcp_server import ALL_TOOLS, allowed_tool_names

    names = {t.name for t in ALL_TOOLS}
    assert "get_analysis" in names
    assert "get_activity" in names

    allowed = allowed_tool_names()
    assert "mcp__owlfolio__get_analysis" in allowed
    assert "mcp__owlfolio__get_activity" in allowed


def test_activity_action_tools_registered():
    """delete_activity_event + run_addon + list_addons are registered."""
    from src.mcp_server import ALL_TOOLS, allowed_tool_names

    names = {t.name for t in ALL_TOOLS}
    for required in ("delete_activity_event", "run_addon", "list_addons"):
        assert required in names, f"MCP tool {required!r} missing"
        assert f"mcp__owlfolio__{required}" in allowed_tool_names()


# ─── Activity-row delete (Phase 3d row actions) ─────────────────────


def test_delete_analysis_cascades_to_findings(tmp_workdir):
    """Deleting an analysis drops its specialist_findings via FK cascade."""
    from src.db.operations import save_analysis, save_specialist_findings
    from src.db.schema import get_db
    from src.operations.activity import delete_event

    conn = get_db()
    try:
        aid = save_analysis(
            conn,
            ticker="AAPL",
            strategy="buffett-munger",
            decision="BUY",
            buy_price=350,
            current_price=300,
            quality_tier="wide",
            weighted_score=4.5,
            thesis="",
            bull_case="",
            bear_case="",
            key_risks=[],
            overrides={},
        )
        save_specialist_findings(
            conn,
            aid,
            [
                {"specialist_name": "a", "ticker": "AAPL", "summary": "x"},
                {"specialist_name": "b", "ticker": "AAPL", "summary": "y"},
            ],
        )
    finally:
        conn.close()

    assert delete_event("analysis", aid) is True

    conn = get_db()
    try:
        assert conn.execute("SELECT COUNT(*) FROM analyses WHERE id = ?", (aid,)).fetchone()[0] == 0
        # FK cascade dropped the findings rows
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM specialist_findings WHERE analysis_id = ?", (aid,)
            ).fetchone()[0]
            == 0
        )
    finally:
        conn.close()


def test_delete_event_returns_false_for_missing(tmp_workdir):
    from src.operations.activity import delete_event

    assert delete_event("analysis", 99999) is False
    assert delete_event("decision", 99999) is False
    assert delete_event("task_run", 99999) is False
    assert delete_event("list", "does-not-exist") is False


def test_delete_event_rejects_bad_inputs(tmp_workdir):
    from src.operations.activity import delete_event

    with pytest.raises(ValueError, match="unknown event_type"):
        delete_event("nonsense", 1)
    with pytest.raises(ValueError, match="must be an integer id"):
        delete_event("analysis", "not-a-number")
    with pytest.raises(ValueError, match="must be a non-empty string"):
        delete_event("list", "")


def test_delete_decision_does_not_touch_analyses(tmp_workdir):
    """Deleting a decision row shouldn't cascade to its parent analysis."""
    from src.db.operations import log_decision, save_analysis
    from src.db.schema import get_db
    from src.operations.activity import delete_event

    conn = get_db()
    try:
        aid = save_analysis(
            conn,
            ticker="MSFT",
            strategy="garp",
            decision="WATCH",
            buy_price=300,
            current_price=400,
            quality_tier="steady_grower",
            weighted_score=3.5,
            thesis="",
            bull_case="",
            bear_case="",
            key_risks=[],
            overrides={},
        )
        log_decision(
            conn,
            ticker="MSFT",
            action="watch",
            price=400,
            shares=0,
            reasoning="",
            strategy="garp",
            analysis_id=aid,
        )
        decision_id = conn.execute(
            "SELECT id FROM decisions WHERE analysis_id = ?", (aid,)
        ).fetchone()[0]
    finally:
        conn.close()

    assert delete_event("decision", decision_id) is True

    conn = get_db()
    try:
        # Analysis still there
        assert conn.execute("SELECT COUNT(*) FROM analyses WHERE id = ?", (aid,)).fetchone()[0] == 1
        # Decision gone
        assert (
            conn.execute("SELECT COUNT(*) FROM decisions WHERE id = ?", (decision_id,)).fetchone()[
                0
            ]
            == 0
        )
    finally:
        conn.close()


def test_delete_task_run_does_not_touch_schedule(tmp_workdir):
    """Deleting a task_run row shouldn't drop the parent scheduled_tasks row."""
    from src.db.operations import (
        add_scheduled_task,
        record_task_run_end,
        record_task_run_start,
    )
    from src.db.schema import get_db
    from src.operations.activity import delete_event

    conn = get_db()
    try:
        task_id = add_scheduled_task(
            conn,
            name="daily",
            command="owlfolio analyze AAPL",
            schedule="0 7 * * *",
        )
        run_id = record_task_run_start(
            conn,
            task_id,
            "daily",
            "owlfolio analyze AAPL",
        )
        record_task_run_end(conn, run_id, exit_code=0)
    finally:
        conn.close()

    assert delete_event("task_run", run_id) is True

    conn = get_db()
    try:
        # Scheduled task survived
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM scheduled_tasks WHERE id = ?", (task_id,)
            ).fetchone()[0]
            == 1
        )
        # Run history row gone
        assert (
            conn.execute("SELECT COUNT(*) FROM task_runs WHERE id = ?", (run_id,)).fetchone()[0]
            == 0
        )
    finally:
        conn.close()


# ─── Addon registry + standalone runs ───────────────────────────────


def test_addon_registry_exposes_shariah():
    """The addon registry is the source of truth for available addons."""
    from src.specialists.addons import (
        ADDON_REGISTRY,
        SHARIAH_SPECIALIST,
        get_addon,
        list_addons,
    )

    assert "shariah" in ADDON_REGISTRY
    assert ADDON_REGISTRY["shariah"] is SHARIAH_SPECIALIST
    assert "shariah" in list_addons()
    assert get_addon("shariah") is SHARIAH_SPECIALIST
    # Case-insensitive
    assert get_addon("SHARIAH") is SHARIAH_SPECIALIST


def test_addon_registry_rejects_unknown():
    from src.specialists.addons import get_addon

    with pytest.raises(KeyError, match="unknown addon"):
        get_addon("esg-not-yet-implemented")
    # Error message lists what IS available
    try:
        get_addon("nope")
    except KeyError as e:
        assert "shariah" in str(e)


def test_run_addon_persists_as_degenerate_analysis(tmp_workdir_with_strategies, monkeypatch):
    """run_addon dispatches to the addon specialist and persists the
    result as an analysis row with `decision='N/A'` so the Activity
    feed renders it consistently with full pipeline runs.

    We mock the specialist runner — this test pins the *persistence
    contract*, not the LLM call.
    """
    import asyncio

    from src.db.schema import get_db
    from src.operations import analysis as op_analysis
    from src.specialists import runner as runner_mod
    from src.specialists.schemas import SpecialistFindings

    async def fake_single(ticker, name, config, strategy):
        return SpecialistFindings(
            specialist_name=config.name,
            ticker=ticker,
            summary="compliant",
            key_findings=["debt 25%", "cash 12%"],
            data_sources=["stockanalysis.com"],
            confidence=0.9,
            flags=["GREEN: under thresholds"],
        )

    monkeypatch.setattr(runner_mod, "_run_single_specialist", fake_single)

    result = asyncio.run(op_analysis.run_addon("shariah", "AAPL"))

    # Returned shape
    assert result["addon"] == "shariah"
    assert result["ticker"] == "AAPL"
    assert result["analysis_id"] >= 1
    assert "GREEN" in result["flags"][0]

    # Persistence — degenerate analysis with decision='N/A'
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM analyses WHERE id = ?", (result["analysis_id"],)
        ).fetchone()
        assert row["decision"] == "N/A"
        assert row["quality_tier"] == "addon"
        assert row["strategy"] == "shariah-addon"
        # Findings persisted too
        n_findings = conn.execute(
            "SELECT COUNT(*) FROM specialist_findings WHERE analysis_id = ?",
            (result["analysis_id"],),
        ).fetchone()[0]
        assert n_findings == 1
    finally:
        conn.close()


def test_run_addon_unknown_addon_raises(tmp_workdir):
    import asyncio

    from src.operations import analysis as op_analysis

    with pytest.raises(KeyError, match="unknown addon"):
        asyncio.run(op_analysis.run_addon("not-a-real-addon", "AAPL"))


def test_addon_runs_appear_in_activity_feed(tmp_workdir_with_strategies, monkeypatch):
    """An addon-only run shows up in the Activity feed as an `analysis`
    event with the addon-specific title format."""
    import asyncio

    from src.operations import analysis as op_analysis
    from src.operations.activity import get_activity
    from src.specialists import runner as runner_mod
    from src.specialists.schemas import SpecialistFindings

    async def fake_single(ticker, name, config, strategy):
        return SpecialistFindings(
            specialist_name=config.name,
            ticker=ticker,
            summary="ok",
            key_findings=[],
            data_sources=[],
            confidence=0.8,
            flags=[],
        )

    monkeypatch.setattr(runner_mod, "_run_single_specialist", fake_single)
    asyncio.run(op_analysis.run_addon("shariah", "MSFT"))

    events = get_activity(type_filter="analysis")
    assert len(events) == 1
    e = events[0]
    assert e["decision"] == "N/A"
    # The Activity feed renders addon runs differently from BUY/WATCH/PASS
    assert "addon" in e["title"].lower()
