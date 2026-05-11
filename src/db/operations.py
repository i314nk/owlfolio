"""CRUD operations for portfolio database."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime

from src.agents.discovery import ticker_currency
from src.db.schema import get_db


def _fmt_price(value: float, ticker: str = "") -> str:
    """Format a price with correct currency symbol for the ticker's market."""
    code, symbol = ticker_currency(ticker) if ticker else ("USD", "$")
    if code == "JPY":
        return f"{symbol}{value:,.0f}"
    return f"{symbol}{value:,.2f}"


# ── Holdings ────────────────────────────────────────────────────────


def add_holding(
    conn: sqlite3.Connection,
    ticker: str,
    shares: float,
    cost_basis: float,
    date_acquired: str,
    account: str = "default",
    strategy: str | None = None,
    notes: str | None = None,
) -> int:
    """Add a new holding. Returns the holding ID."""
    cursor = conn.execute(
        """INSERT INTO holdings
           (ticker, shares, cost_basis, date_acquired, account, strategy, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (ticker, shares, cost_basis, date_acquired, account, strategy, notes),
    )
    conn.commit()
    return cursor.lastrowid


def get_holdings(conn: sqlite3.Connection, ticker: str | None = None) -> list[dict]:
    """Retrieve holdings, optionally filtered by ticker."""
    if ticker:
        rows = conn.execute(
            "SELECT * FROM holdings WHERE ticker = ? ORDER BY date_acquired", (ticker,)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM holdings ORDER BY ticker, date_acquired").fetchall()
    return [dict(row) for row in rows]


def update_holding(
    conn: sqlite3.Connection,
    holding_id: int,
    shares: float | None = None,
    cost_basis: float | None = None,
    notes: str | None = None,
):
    """Update specific fields of a holding."""
    updates = []
    params = []
    if shares is not None:
        updates.append("shares = ?")
        params.append(shares)
    if cost_basis is not None:
        updates.append("cost_basis = ?")
        params.append(cost_basis)
    if notes is not None:
        updates.append("notes = ?")
        params.append(notes)

    if not updates:
        return

    params.append(holding_id)
    conn.execute(f"UPDATE holdings SET {', '.join(updates)} WHERE id = ?", params)
    conn.commit()


def sell_holding(
    conn: sqlite3.Connection,
    ticker: str,
    shares: float,
    price: float,
    account: str = "default",
) -> dict:
    """Sell shares of a holding. Full sell removes the holding. Returns the decision record."""
    # Find the holding
    row = conn.execute(
        "SELECT * FROM holdings WHERE ticker = ? AND account = ? LIMIT 1",
        (ticker, account),
    ).fetchone()

    if row is None:
        raise ValueError(f"No holding found for {ticker} in account {account}")

    remaining = row["shares"] - shares
    if remaining < 0:
        raise ValueError(f"Cannot sell {shares} shares of {ticker} — only {row['shares']} held")

    if remaining == 0:
        conn.execute("DELETE FROM holdings WHERE id = ?", (row["id"],))
    else:
        conn.execute("UPDATE holdings SET shares = ? WHERE id = ?", (remaining, row["id"]))

    # Log the decision
    decision_id = log_decision(
        conn,
        ticker=ticker,
        action="SELL",
        price=price,
        shares=shares,
        reasoning=f"Sold {shares} shares at {_fmt_price(price, ticker)}",
    )

    conn.commit()

    decision = conn.execute("SELECT * FROM decisions WHERE id = ?", (decision_id,)).fetchone()
    return dict(decision)


# ── Decisions ───────────────────────────────────────────────────────


def log_decision(
    conn: sqlite3.Connection,
    ticker: str,
    action: str,
    price: float | None = None,
    shares: float | None = None,
    reasoning: str | None = None,
    strategy: str | None = None,
    analysis_id: int | None = None,
) -> int:
    """Log a buy/sell/watch/pass decision. Returns the decision ID."""
    cursor = conn.execute(
        """INSERT INTO decisions (ticker, action, price, shares, reasoning, strategy, analysis_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (ticker, action, price, shares, reasoning, strategy, analysis_id),
    )
    conn.commit()
    return cursor.lastrowid


def get_decisions(
    conn: sqlite3.Connection,
    ticker: str | None = None,
    limit: int = 20,
) -> list[dict]:
    """Retrieve decisions, optionally filtered by ticker. Most recent first."""
    if ticker:
        rows = conn.execute(
            "SELECT * FROM decisions WHERE ticker = ? ORDER BY id DESC LIMIT ?",
            (ticker, limit),
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM decisions ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(row) for row in rows]


# ── Watchlist ───────────────────────────────────────────────────────


def add_to_watchlist(
    conn: sqlite3.Connection,
    ticker: str,
    strategy: str | None = None,
    buy_price: float | None = None,
    notes: str | None = None,
) -> int:
    """Add a ticker to the watchlist. Returns the watchlist entry ID."""
    cursor = conn.execute(
        """INSERT INTO watchlist (ticker, strategy, buy_price, notes)
           VALUES (?, ?, ?, ?)""",
        (ticker, strategy, buy_price, notes),
    )
    conn.commit()
    return cursor.lastrowid


def remove_from_watchlist(conn: sqlite3.Connection, ticker: str):
    """Remove a ticker from the watchlist."""
    conn.execute("DELETE FROM watchlist WHERE ticker = ?", (ticker,))
    conn.commit()


def get_watchlist(conn: sqlite3.Connection) -> list[dict]:
    """Retrieve the full watchlist."""
    rows = conn.execute("SELECT * FROM watchlist ORDER BY ticker").fetchall()
    return [dict(row) for row in rows]


def update_watchlist_price(conn: sqlite3.Connection, ticker: str, current_price: float):
    """Update the current price and last_checked timestamp for a watchlist entry."""
    conn.execute(
        "UPDATE watchlist SET current_price = ?, last_checked = datetime('now') WHERE ticker = ?",
        (current_price, ticker),
    )
    conn.commit()


def update_analysis_price(conn: sqlite3.Connection, analysis_id: int, current_price: float):
    """Update the current_price on an analysis record (e.g. after a fresh price fetch)."""
    conn.execute(
        "UPDATE analyses SET current_price = ? WHERE id = ?",
        (current_price, analysis_id),
    )
    conn.commit()


def update_latest_analysis_price(
    conn: sqlite3.Connection, ticker: str, current_price: float
) -> bool:
    """Update current_price on the most recent analysis for a ticker.

    Returns True if a row was updated, False if no analysis exists.
    """
    row = conn.execute(
        "SELECT id FROM analyses WHERE ticker = ? ORDER BY id DESC LIMIT 1",
        (ticker,),
    ).fetchone()
    if row is None:
        return False
    conn.execute(
        "UPDATE analyses SET current_price = ? WHERE id = ?",
        (current_price, row["id"]),
    )
    conn.commit()
    return True


def update_watchlist_buy_price(conn: sqlite3.Connection, ticker: str, buy_price: float):
    """Update the buy_price for a watchlist entry."""
    conn.execute(
        "UPDATE watchlist SET buy_price = ? WHERE ticker = ?",
        (buy_price, ticker),
    )
    conn.commit()


# ── Analyses ────────────────────────────────────────────────────────


def save_analysis(
    conn: sqlite3.Connection,
    ticker: str,
    strategy: str,
    decision: str,
    buy_price: float,
    current_price: float,
    quality_tier: str,
    weighted_score: float,
    thesis: str,
    bull_case: str,
    bear_case: str,
    key_risks: list,
    overrides: dict,
) -> int:
    """Save an analysis result. JSON-encodes key_risks and overrides. Returns the analysis ID."""
    cursor = conn.execute(
        """INSERT INTO analyses
           (ticker, strategy, decision, buy_price, current_price, quality_tier,
            weighted_score, thesis, bull_case, bear_case, key_risks, overrides)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            ticker,
            strategy,
            decision,
            buy_price,
            current_price,
            quality_tier,
            weighted_score,
            thesis,
            bull_case,
            bear_case,
            json.dumps(key_risks),
            json.dumps(overrides),
        ),
    )
    conn.commit()
    return cursor.lastrowid


def get_latest_analysis(conn: sqlite3.Connection, ticker: str) -> dict | None:
    """Retrieve the most recent analysis for a ticker. Deserializes JSON fields."""
    row = conn.execute(
        "SELECT * FROM analyses WHERE ticker = ? ORDER BY id DESC LIMIT 1",
        (ticker,),
    ).fetchone()

    if row is None:
        return None

    result = dict(row)
    result["key_risks"] = json.loads(result["key_risks"]) if result["key_risks"] else []
    result["overrides"] = json.loads(result["overrides"]) if result["overrides"] else {}
    return result


def get_analyses(
    conn: sqlite3.Connection,
    ticker: str | None = None,
    limit: int = 10,
) -> list[dict]:
    """Retrieve analyses, optionally filtered by ticker. Most recent first."""
    if ticker:
        rows = conn.execute(
            "SELECT * FROM analyses WHERE ticker = ? ORDER BY id DESC LIMIT ?",
            (ticker, limit),
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM analyses ORDER BY id DESC LIMIT ?", (limit,)).fetchall()

    results = []
    for row in rows:
        r = dict(row)
        r["key_risks"] = json.loads(r["key_risks"]) if r["key_risks"] else []
        r["overrides"] = json.loads(r["overrides"]) if r["overrides"] else {}
        results.append(r)
    return results


def delete_analysis(conn: sqlite3.Connection, analysis_id: int) -> bool:
    """Delete an analysis and (via FK cascade) its specialist_findings.

    Returns True if a row was actually deleted; False if no analysis with
    that id existed. Cascade is enforced by `PRAGMA foreign_keys=ON` in
    get_db() — without it SQLite ignores ON DELETE CASCADE.
    """
    cur = conn.execute("DELETE FROM analyses WHERE id = ?", (analysis_id,))
    conn.commit()
    return cur.rowcount > 0


def delete_decision(conn: sqlite3.Connection, decision_id: int) -> bool:
    """Delete a recorded buy/sell/watch decision row."""
    cur = conn.execute("DELETE FROM decisions WHERE id = ?", (decision_id,))
    conn.commit()
    return cur.rowcount > 0


def delete_task_run(conn: sqlite3.Connection, run_id: int) -> bool:
    """Delete a single task_runs history row.

    Does NOT delete the parent scheduled_tasks row — that's a separate
    op (`unschedule_task`). Useful when a particular run-history row is
    spammy or sensitive and should be removed without touching the
    schedule itself.
    """
    cur = conn.execute("DELETE FROM task_runs WHERE id = ?", (run_id,))
    conn.commit()
    return cur.rowcount > 0


def get_analysis_by_id(
    conn: sqlite3.Connection,
    analysis_id: int,
    with_findings: bool = True,
) -> dict | None:
    """Look up a saved analysis by primary-key id (the `#NN` token the
    user can quote in chat). Optionally inlines the per-specialist
    findings rows so the audit card has everything in one fetch.
    """
    row = conn.execute("SELECT * FROM analyses WHERE id = ?", (analysis_id,)).fetchone()
    if row is None:
        return None
    result = dict(row)
    result["key_risks"] = json.loads(result["key_risks"]) if result["key_risks"] else []
    result["overrides"] = json.loads(result["overrides"]) if result["overrides"] else {}
    if with_findings:
        result["specialist_findings"] = get_specialist_findings(conn, analysis_id)
    return result


# ── Specialist findings ────────────────────────────────────────────


def save_specialist_findings(
    conn: sqlite3.Connection,
    analysis_id: int,
    findings: list,
) -> int:
    """Persist a batch of SpecialistFindings under one analysis_id.

    `findings` is the in-memory list of SpecialistFindings objects (or
    dicts) returned by run_specialists(). Common fields go into typed
    columns; everything else (margin numbers, moat scores, shariah
    ratios) is JSON-encoded into extra_json.
    """
    common = {
        "specialist_name",
        "ticker",
        "summary",
        "key_findings",
        "data_sources",
        "flags",
        "confidence",
    }
    inserted = 0
    for f in findings:
        # Accept either pydantic SpecialistFindings or plain dict
        d = f.model_dump() if hasattr(f, "model_dump") else dict(f)
        extra = {k: v for k, v in d.items() if k not in common}
        conn.execute(
            """INSERT INTO specialist_findings
               (analysis_id, specialist_name, summary, key_findings,
                data_sources, flags, confidence, extra_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                analysis_id,
                d.get("specialist_name", ""),
                d.get("summary", ""),
                json.dumps(d.get("key_findings") or []),
                json.dumps(d.get("data_sources") or []),
                json.dumps(d.get("flags") or []),
                d.get("confidence"),
                json.dumps(extra) if extra else None,
            ),
        )
        inserted += 1
    conn.commit()
    return inserted


def get_specialist_findings(
    conn: sqlite3.Connection,
    analysis_id: int,
) -> list[dict]:
    """Return all per-specialist findings for one analysis, JSON parsed."""
    rows = conn.execute(
        "SELECT * FROM specialist_findings WHERE analysis_id = ? ORDER BY id",
        (analysis_id,),
    ).fetchall()
    out = []
    for row in rows:
        d = dict(row)
        d["key_findings"] = json.loads(d["key_findings"]) if d["key_findings"] else []
        d["data_sources"] = json.loads(d["data_sources"]) if d["data_sources"] else []
        d["flags"] = json.loads(d["flags"]) if d["flags"] else []
        d["extra"] = json.loads(d["extra_json"]) if d.get("extra_json") else {}
        out.append(d)
    return out


# ── Task runs (daemon-fired scheduled task history) ────────────────


def record_task_run_start(
    conn: sqlite3.Connection,
    task_id: int,
    task_name: str,
    command: str,
    started_at: str | None = None,
) -> int:
    """Open a task-run row when the daemon kicks off an execution.

    Returns the run id; the daemon should call record_task_run_end with
    that id once the subprocess finishes (so we capture exit_code +
    stdout/stderr excerpts, not just the start).
    """
    cursor = conn.execute(
        """INSERT INTO task_runs
           (task_id, task_name, command, started_at)
           VALUES (?, ?, ?, COALESCE(?, datetime('now')))""",
        (task_id, task_name, command, started_at),
    )
    conn.commit()
    return cursor.lastrowid


def record_task_run_end(
    conn: sqlite3.Connection,
    run_id: int,
    exit_code: int,
    stdout: str = "",
    stderr: str = "",
) -> None:
    """Close out a task-run row with the subprocess result."""
    excerpt_len = 2048
    conn.execute(
        """UPDATE task_runs
           SET finished_at = datetime('now'),
               exit_code = ?,
               stdout_excerpt = ?,
               stderr_excerpt = ?
           WHERE id = ?""",
        (exit_code, (stdout or "")[:excerpt_len], (stderr or "")[:excerpt_len], run_id),
    )
    conn.commit()


def get_task_runs(
    conn: sqlite3.Connection,
    task_id: int | None = None,
    limit: int = 50,
) -> list[dict]:
    """Recent task-run history, optionally filtered to one task."""
    if task_id is not None:
        rows = conn.execute(
            """SELECT * FROM task_runs WHERE task_id = ?
               ORDER BY id DESC LIMIT ?""",
            (task_id, limit),
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM task_runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


# ── Scheduled Tasks ────────────────────────────────────────────────


def add_scheduled_task(
    conn: sqlite3.Connection,
    name: str,
    command: str,
    schedule: str,
    timezone: str = "UTC",
    description: str = "",
) -> int:
    """Add a scheduled task. Returns the task ID."""
    cursor = conn.execute(
        """INSERT INTO scheduled_tasks (name, command, schedule, timezone, description)
           VALUES (?, ?, ?, ?, ?)""",
        (name, command, schedule, timezone, description),
    )
    conn.commit()
    return cursor.lastrowid


def get_scheduled_tasks(conn: sqlite3.Connection, enabled_only: bool = False) -> list[dict]:
    """Retrieve scheduled tasks."""
    if enabled_only:
        rows = conn.execute(
            "SELECT * FROM scheduled_tasks WHERE enabled = 1 ORDER BY name"
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM scheduled_tasks ORDER BY name").fetchall()
    return [dict(row) for row in rows]


def delete_scheduled_task(conn: sqlite3.Connection, task_id: int):
    """Delete a scheduled task by ID."""
    conn.execute("DELETE FROM scheduled_tasks WHERE id = ?", (task_id,))
    conn.commit()


def toggle_task(conn: sqlite3.Connection, task_id: int, enabled: bool):
    """Enable or disable a scheduled task."""
    conn.execute(
        "UPDATE scheduled_tasks SET enabled = ? WHERE id = ?",
        (1 if enabled else 0, task_id),
    )
    conn.commit()


def update_scheduled_task(
    conn: sqlite3.Connection,
    task_id: int,
    schedule: str | None = None,
    command: str | None = None,
    name: str | None = None,
    description: str | None = None,
    timezone: str | None = None,
):
    """Update mutable fields of a scheduled task."""
    updates, params = [], []
    for col, val in [
        ("schedule", schedule),
        ("command", command),
        ("name", name),
        ("description", description),
        ("timezone", timezone),
    ]:
        if val is not None:
            updates.append(f"{col} = ?")
            params.append(val)
    if not updates:
        return
    params.append(task_id)
    conn.execute(f"UPDATE scheduled_tasks SET {', '.join(updates)} WHERE id = ?", params)
    conn.commit()


def log_task_run(conn: sqlite3.Connection, task_id: int, status: str, output: str = ""):
    """Log a task execution result and update last_run timestamp."""
    now = datetime.now().isoformat()
    conn.execute(
        "UPDATE scheduled_tasks SET last_run = ?, last_result = ? WHERE id = ?",
        (now, f"{status}: {output[:500]}", task_id),
    )
    conn.commit()


# ── Alerts ─────────────────────────────────────────────────────────


def add_alert(
    conn: sqlite3.Connection,
    alert_type: str,
    message: str,
    ticker: str | None = None,
    task_run_id: int | None = None,
) -> int:
    """Create a new alert. Returns the alert ID."""
    cursor = conn.execute(
        "INSERT INTO alerts (type, ticker, message, task_run_id) VALUES (?, ?, ?, ?)",
        (alert_type, ticker, message, task_run_id),
    )
    conn.commit()
    return cursor.lastrowid


def get_unread_alerts(conn: sqlite3.Connection) -> list[dict]:
    """Retrieve all unread alerts, most recent first."""
    rows = conn.execute("SELECT * FROM alerts WHERE read = 0 ORDER BY id DESC").fetchall()
    return [dict(row) for row in rows]


def mark_alerts_read(conn: sqlite3.Connection):
    """Mark all unread alerts as read."""
    conn.execute("UPDATE alerts SET read = 1 WHERE read = 0")
    conn.commit()


# ── Snapshots ─────────────────────────────────────────────


def save_snapshot(
    conn: sqlite3.Connection,
    total_value: float,
    total_cost: float,
    cash: float,
    holdings_json: str,
    benchmark_value: float | None = None,
) -> int:
    """Save a portfolio snapshot. Returns the snapshot ID."""
    cursor = conn.execute(
        """INSERT INTO snapshots (total_value, total_cost, cash, holdings_json, benchmark_value)
           VALUES (?, ?, ?, ?, ?)""",
        (total_value, total_cost, cash, holdings_json, benchmark_value),
    )
    conn.commit()
    return cursor.lastrowid


def get_snapshots(conn: sqlite3.Connection, limit: int = 12) -> list[dict]:
    """Retrieve recent snapshots, most recent first."""
    rows = conn.execute("SELECT * FROM snapshots ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(row) for row in rows]


# ── Memory ──────────────────────────────────────────────────────────

MEMORY_CATEGORIES = ("preference", "context", "observation", "decision_context")


def add_memory(category: str, content: str, ticker: str = None) -> int:
    """Store a memory entry. Returns the memory ID."""
    if category not in MEMORY_CATEGORIES:
        raise ValueError(
            f"Invalid category '{category}'. Must be one of: {', '.join(MEMORY_CATEGORIES)}"
        )
    conn = get_db()
    cursor = conn.execute(
        "INSERT INTO memory (category, content, ticker) VALUES (?, ?, ?)",
        (category, content, ticker),
    )
    conn.commit()
    return cursor.lastrowid


def get_memories(category: str = None, ticker: str = None, limit: int = 50) -> list[dict]:
    """Get memory entries, optionally filtered by category or ticker."""
    conn = get_db()
    query = "SELECT * FROM memory"
    conditions = []
    params = []
    if category:
        conditions.append("category = ?")
        params.append(category)
    if ticker:
        conditions.append("ticker = ?")
        params.append(ticker)
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(query, params).fetchall()
    return [dict(row) for row in rows]


def delete_memory(memory_id: int):
    """Delete a memory entry."""
    conn = get_db()
    conn.execute("DELETE FROM memory WHERE id = ?", (memory_id,))
    conn.commit()


def get_memory_context() -> str:
    """Get formatted memory context for chat injection.

    Returns a string with relevant memories grouped by category.
    """
    memories = get_memories(limit=100)
    if not memories:
        return ""

    category_labels = {
        "preference": "User Preferences",
        "context": "Context",
        "observation": "Recent Observations",
        "decision_context": "Decision Context",
    }

    grouped: dict[str, list[str]] = {}
    for m in memories:
        cat = m["category"]
        label = category_labels.get(cat, cat.title())
        if label not in grouped:
            grouped[label] = []
        entry = f"- {m['content']}"
        if m.get("ticker"):
            entry += f" [{m['ticker']}]"
        grouped[label].append(entry)

    sections = []
    for label, entries in grouped.items():
        sections.append(f"## {label}")
        sections.extend(entries)
        sections.append("")

    return "\n".join(sections).strip()


# ── Candidate lists ─────────────────────────────────────────────────


def create_candidate_list(
    conn: sqlite3.Connection,
    name: str,
    source: str,
    strategy: str | None = None,
    note: str | None = None,
) -> int:
    """Create a new candidate list. Returns the list ID.

    `source` is 'agentic' (from `owlfolio find`) or 'import' (from
    `owlfolio import`). Names are unique — re-creating an existing name
    raises sqlite3.IntegrityError.
    """
    if source not in ("agentic", "import"):
        raise ValueError(f"source must be 'agentic' or 'import', got {source!r}")
    cursor = conn.execute(
        """INSERT INTO candidate_lists (name, strategy, source, note)
           VALUES (?, ?, ?, ?)""",
        (name, strategy, source, note),
    )
    conn.commit()
    return cursor.lastrowid


def add_candidate(
    conn: sqlite3.Connection,
    list_id: int,
    ticker: str,
    company_name: str = "",
    sector: str = "",
    market_cap: float | None = None,
    current_price: float | None = None,
    note: str = "",
    metrics: dict | None = None,
) -> int:
    """Add a single candidate to a list. Returns the candidate ID.

    Duplicate (list_id, ticker) pairs raise sqlite3.IntegrityError —
    callers should de-dup upstream.
    """
    cursor = conn.execute(
        """INSERT INTO candidates
           (list_id, ticker, company_name, sector, market_cap, current_price, note, metrics_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            list_id,
            ticker.upper(),
            company_name,
            sector,
            market_cap,
            current_price,
            note,
            json.dumps(metrics) if metrics else None,
        ),
    )
    conn.commit()
    return cursor.lastrowid


def add_candidates_bulk(
    conn: sqlite3.Connection,
    list_id: int,
    candidates: list[dict],
) -> int:
    """Insert many candidates at once. Skips duplicates silently.

    Each candidate dict may contain: ticker (required), company_name,
    sector, market_cap, current_price, note, metrics.
    Returns the count actually inserted (after skipping dupes).
    """
    inserted = 0
    for c in candidates:
        ticker = (c.get("ticker") or "").strip().upper()
        if not ticker:
            continue
        try:
            conn.execute(
                """INSERT INTO candidates
                   (list_id, ticker, company_name, sector,
                    market_cap, current_price, note, metrics_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    list_id,
                    ticker,
                    c.get("company_name", "") or "",
                    c.get("sector", "") or "",
                    c.get("market_cap"),
                    c.get("current_price"),
                    c.get("note", "") or "",
                    json.dumps(c.get("metrics")) if c.get("metrics") else None,
                ),
            )
            inserted += 1
        except sqlite3.IntegrityError:
            continue
    conn.commit()
    return inserted


def list_candidate_lists(conn: sqlite3.Connection) -> list[dict]:
    """List all candidate lists with item counts."""
    rows = conn.execute(
        """SELECT cl.id, cl.name, cl.strategy, cl.source, cl.note, cl.created_at,
                  COUNT(c.id) AS total,
                  SUM(CASE WHEN c.analyzed = 1 THEN 1 ELSE 0 END) AS analyzed
           FROM candidate_lists cl
           LEFT JOIN candidates c ON c.list_id = cl.id
           GROUP BY cl.id
           ORDER BY cl.created_at DESC"""
    ).fetchall()
    return [dict(r) for r in rows]


def get_candidate_list(conn: sqlite3.Connection, name: str) -> dict | None:
    """Look up a candidate list by name. Returns None if not found."""
    row = conn.execute("SELECT * FROM candidate_lists WHERE name = ?", (name,)).fetchone()
    return dict(row) if row else None


def get_candidates(conn: sqlite3.Connection, list_id: int) -> list[dict]:
    """Get all candidates for a list, with metrics_json parsed."""
    rows = conn.execute(
        "SELECT * FROM candidates WHERE list_id = ? ORDER BY id", (list_id,)
    ).fetchall()
    out = []
    for row in rows:
        d = dict(row)
        if d.get("metrics_json"):
            try:
                d["metrics"] = json.loads(d["metrics_json"])
            except (json.JSONDecodeError, TypeError):
                d["metrics"] = {}
        else:
            d["metrics"] = {}
        out.append(d)
    return out


def mark_candidate_analyzed(
    conn: sqlite3.Connection,
    candidate_id: int,
    analysis_id: int,
) -> None:
    """Link a candidate to its analysis result."""
    conn.execute(
        "UPDATE candidates SET analyzed = 1, analysis_id = ? WHERE id = ?",
        (analysis_id, candidate_id),
    )
    conn.commit()


def delete_candidate_list(conn: sqlite3.Connection, name: str) -> bool:
    """Delete a candidate list (and its candidates via cascade). True if found."""
    cursor = conn.execute("DELETE FROM candidate_lists WHERE name = ?", (name,))
    conn.commit()
    return cursor.rowcount > 0
