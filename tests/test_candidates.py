"""Tests for the candidate-list operations layer.

Covers schema (FK cascade, dedup), DB CRUD, and the operations
wrappers (import_candidates, list_lists, show_list, delete_list).
The agentic-discovery path is exercised in test_discovery.py.
"""

import os
import tempfile

import pytest


@pytest.fixture
def tmp_workdir(tmp_path, monkeypatch):
    """Each test gets its own working directory with a fresh data/ dir."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / "data").mkdir()
    yield tmp_path


# ─── Schema + DB CRUD ───────────────────────────────────────────────


def test_schema_creates_candidate_tables(tmp_workdir):
    from src.db.schema import get_db
    conn = get_db()
    try:
        cl_table = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='candidate_lists'"
        ).fetchone()
        c_table = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='candidates'"
        ).fetchone()
        assert cl_table is not None
        assert c_table is not None
    finally:
        conn.close()


def test_create_and_lookup_candidate_list(tmp_workdir):
    from src.db.operations import create_candidate_list, get_candidate_list
    from src.db.schema import get_db

    conn = get_db()
    try:
        list_id = create_candidate_list(
            conn, name="my-list", source="import",
            strategy="deep-value", note="test",
        )
        assert list_id > 0
        got = get_candidate_list(conn, "my-list")
        assert got is not None
        assert got["name"] == "my-list"
        assert got["source"] == "import"
        assert got["strategy"] == "deep-value"
    finally:
        conn.close()


def test_create_candidate_list_rejects_bad_source(tmp_workdir):
    from src.db.operations import create_candidate_list
    from src.db.schema import get_db

    conn = get_db()
    try:
        with pytest.raises(ValueError, match="source must be"):
            create_candidate_list(conn, name="x", source="wrong")
    finally:
        conn.close()


def test_add_candidates_bulk_dedupes(tmp_workdir):
    """Bulk insert silently skips dupes within the list."""
    from src.db.operations import add_candidates_bulk, create_candidate_list
    from src.db.schema import get_db

    conn = get_db()
    try:
        list_id = create_candidate_list(conn, name="dup-test", source="import")
        inserted = add_candidates_bulk(conn, list_id, [
            {"ticker": "AAPL", "company_name": "Apple"},
            {"ticker": "MSFT"},
            {"ticker": "AAPL", "note": "dup"},  # silently skipped
            {"ticker": "", "note": "blank"},     # silently skipped
        ])
        assert inserted == 2
    finally:
        conn.close()


def test_get_candidates_parses_metrics_json(tmp_workdir):
    from src.db.operations import (
        add_candidates_bulk,
        create_candidate_list,
        get_candidates,
    )
    from src.db.schema import get_db

    conn = get_db()
    try:
        list_id = create_candidate_list(conn, name="m", source="import")
        add_candidates_bulk(conn, list_id, [
            {"ticker": "AAPL", "metrics": {"pe": 30, "fcf_yield": 0.04}},
        ])
        cands = get_candidates(conn, list_id)
        assert len(cands) == 1
        assert cands[0]["metrics"] == {"pe": 30, "fcf_yield": 0.04}
    finally:
        conn.close()


def test_mark_candidate_analyzed(tmp_workdir):
    from src.db.operations import (
        add_candidates_bulk,
        create_candidate_list,
        get_candidates,
        mark_candidate_analyzed,
    )
    from src.db.schema import get_db

    conn = get_db()
    try:
        list_id = create_candidate_list(conn, name="a", source="import")
        add_candidates_bulk(conn, list_id, [{"ticker": "AAPL"}])
        cand_id = get_candidates(conn, list_id)[0]["id"]
        mark_candidate_analyzed(conn, cand_id, analysis_id=42)
        c = get_candidates(conn, list_id)[0]
        assert c["analyzed"] == 1
        assert c["analysis_id"] == 42
    finally:
        conn.close()


def test_delete_candidate_list_cascades(tmp_workdir):
    """Deleting a list drops its candidates via SQLite FK cascade.

    SQLite ignores ON DELETE CASCADE unless `PRAGMA foreign_keys=ON` is
    set — this test pins that we set it in get_db().
    """
    from src.db.operations import (
        add_candidates_bulk,
        create_candidate_list,
        delete_candidate_list,
    )
    from src.db.schema import get_db

    conn = get_db()
    try:
        list_id = create_candidate_list(conn, name="cascade", source="import")
        add_candidates_bulk(conn, list_id, [{"ticker": "A"}, {"ticker": "B"}])
        assert conn.execute("SELECT COUNT(*) FROM candidates").fetchone()[0] == 2
        deleted = delete_candidate_list(conn, "cascade")
        assert deleted is True
        # Cascade fires on PRAGMA foreign_keys=ON
        remaining = conn.execute("SELECT COUNT(*) FROM candidates").fetchone()[0]
        assert remaining == 0, "FK cascade did not drop candidates"
    finally:
        conn.close()


def test_list_candidate_lists_includes_counts(tmp_workdir):
    from src.db.operations import (
        add_candidates_bulk,
        create_candidate_list,
        list_candidate_lists,
        mark_candidate_analyzed,
        get_candidates,
    )
    from src.db.schema import get_db

    conn = get_db()
    try:
        l1 = create_candidate_list(conn, name="L1", source="import")
        add_candidates_bulk(conn, l1, [{"ticker": "AAPL"}, {"ticker": "MSFT"}])
        cand_id = get_candidates(conn, l1)[0]["id"]
        mark_candidate_analyzed(conn, cand_id, analysis_id=99)

        lists = list_candidate_lists(conn)
        assert len(lists) == 1
        assert lists[0]["total"] == 2
        assert lists[0]["analyzed"] == 1
    finally:
        conn.close()


# ─── operations.candidates: parsing helpers ─────────────────────────


def test_split_tokens_handles_common_separators():
    from src.operations.candidates import _split_tokens
    assert _split_tokens("AAPL, MSFT GOOGL\nNVDA;TSLA") == [
        "AAPL", "MSFT", "GOOGL", "NVDA", "TSLA",
    ]
    assert _split_tokens("") == []
    assert _split_tokens("   ") == []


def test_validate_list_name_accepts_safe_names():
    from src.operations.candidates import _validate_list_name
    for name in ("watch-q2", "list_2026", "deep.value.1", "A"):
        assert _validate_list_name(name) == name


@pytest.mark.parametrize("bad", ["", "--bad", "../etc", "name with spaces", "x" * 65])
def test_validate_list_name_rejects_unsafe(bad):
    from src.operations.candidates import _validate_list_name
    with pytest.raises(ValueError):
        _validate_list_name(bad)


def test_extract_csv_tickers_with_header(tmp_workdir):
    """CSV with a 'ticker' column extracts that column."""
    from src.operations.candidates import _extract_csv_tickers
    csv = "ticker,note\nAAPL,big tech\nMSFT,cloud\n"
    assert _extract_csv_tickers(csv) == ["AAPL", "MSFT"]


def test_extract_csv_tickers_without_header(tmp_workdir):
    """CSV without recognized header takes column 0 as tickers."""
    from src.operations.candidates import _extract_csv_tickers
    csv = "AAPL\nMSFT\nGOOGL\n"
    assert _extract_csv_tickers(csv) == ["AAPL", "MSFT", "GOOGL"]


def test_parse_ticker_source_reads_file(tmp_workdir):
    """A file path is read; non-CSV files are token-split."""
    from src.operations.candidates import _parse_ticker_source

    p = tmp_workdir / "tickers.txt"
    p.write_text("AAPL MSFT GOOGL\nNVDA, TSLA")
    assert _parse_ticker_source(str(p)) == ["AAPL", "MSFT", "GOOGL", "NVDA", "TSLA"]


# ─── operations.candidates: end-to-end (offline) ────────────────────


def test_import_candidates_inline(tmp_workdir):
    """Inline import with skip_validation persists tickers to a new list."""
    from src.operations.candidates import (
        import_candidates,
        list_lists,
        show_list,
    )

    result = import_candidates(
        source="AAPL, MSFT, NVDA",
        list_name="inline-test",
        skip_validation=True,
    )
    assert result["inserted"] == 3
    assert result["tickers"] == ["AAPL", "MSFT", "NVDA"]

    # Visible via list_lists / show_list
    lists = list_lists()
    assert any(l["name"] == "inline-test" for l in lists)
    shown = show_list("inline-test")
    assert [c["ticker"] for c in shown["candidates"]] == ["AAPL", "MSFT", "NVDA"]


def test_import_candidates_drops_invalid_tickers(tmp_workdir):
    """validate_ticker rejection drops the candidate but doesn't fail the import."""
    from src.operations.candidates import import_candidates

    result = import_candidates(
        source="AAPL, BAD!@#TICKER, MSFT, !@#",
        list_name="reject-test",
        skip_validation=True,
    )
    assert "AAPL" in result["tickers"]
    assert "MSFT" in result["tickers"]
    # The malformed entries land in 'rejected'
    assert any("!" in r for r in result["rejected"])


def test_import_candidates_rejects_duplicate_list_name(tmp_workdir):
    from src.operations.candidates import import_candidates

    import_candidates(source="AAPL", list_name="dup", skip_validation=True)
    with pytest.raises(ValueError, match="already exists"):
        import_candidates(source="MSFT", list_name="dup", skip_validation=True)


def test_delete_list_returns_false_for_missing(tmp_workdir):
    from src.operations.candidates import delete_list
    assert delete_list("does-not-exist") is False


def test_show_list_raises_on_missing(tmp_workdir):
    from src.operations.candidates import show_list
    with pytest.raises(FileNotFoundError):
        show_list("does-not-exist")
