"""Activity feed — unified chronological view across the whole system.

Reads from four source tables and stitches them into one event stream:

  * analyses          — every full pipeline run (incl. shariah-addon
                         degenerate analyses with decision='N/A')
  * decisions         — every recorded buy/sell/watchlist mutation
  * candidate_lists   — every `find` (agentic discovery) and `import`
                         event
  * task_runs         — every daemon-fired scheduled-task execution

The agent uses this through the `get_activity` MCP tool. The Web UI's
Activity tab consumes the same operation. Read-only plumbing calls
(get_portfolio, list_strategies, etc.) deliberately don't show up here
— if it doesn't change state or produce a structured artifact, it's
not an activity.
"""

from __future__ import annotations

from typing import Any

from src.db.schema import get_db


# Type filter values. Mirrors the Activity-tab pill row.
ACTIVITY_TYPES = ("analysis", "list", "decision", "task_run")


def get_activity(
    type_filter: str | None = None,
    strategy: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Return the chronological activity feed, newest first.

    Args:
        type_filter: one of ACTIVITY_TYPES, or None for "all"
        strategy: when provided, filter analyses and decisions by strategy.
            Lists and task_runs don't have a strategy column — they are
            included only when strategy is None (showing all).
        limit: max events returned per source table (so a single noisy
            source can't drown out the others)

    Each row is a dict with at least:
        type        — one of ACTIVITY_TYPES
        timestamp   — ISO timestamp (sortable)
        title       — one-line human label
        summary     — one-sentence detail
        reference   — the `#NN` token the user can quote
        link_to     — optional MCP-tool name + args the UI can wire
                      into a "view detail" affordance
    """
    if type_filter and type_filter not in ACTIVITY_TYPES and type_filter != "all":
        raise ValueError(
            f"unknown type_filter {type_filter!r}; "
            f"expected one of {ACTIVITY_TYPES + ('all',)}"
        )
    if limit < 1:
        raise ValueError(f"limit must be >= 1, got {limit}")

    events: list[dict[str, Any]] = []
    conn = get_db()
    try:
        if not type_filter or type_filter in ("all", "analysis"):
            events.extend(_analyses_to_events(conn, limit, strategy=strategy))
        if not type_filter or type_filter in ("all", "list"):
            # Lists don't have a strategy column — include only when
            # no strategy filter is active.
            if not strategy:
                events.extend(_lists_to_events(conn, limit))
        if not type_filter or type_filter in ("all", "decision"):
            events.extend(_decisions_to_events(conn, limit, strategy=strategy))
        if not type_filter or type_filter in ("all", "task_run"):
            # Task runs don't have a strategy column — include only
            # when no strategy filter is active.
            if not strategy:
                events.extend(_task_runs_to_events(conn, limit))
    finally:
        conn.close()

    # Sort by timestamp DESC (most recent first). Falls back to id-based
    # ordering inside each source table.
    events.sort(key=lambda e: e.get("timestamp") or "", reverse=True)
    return events[:limit] if not type_filter or type_filter == "all" else events


# ─── per-source projections ─────────────────────────────────────────


def _analyses_to_events(conn, limit: int, strategy: str | None = None) -> list[dict[str, Any]]:
    if strategy:
        rows = conn.execute(
            """SELECT id, ticker, strategy, decision, quality_tier,
                      weighted_score, current_price, buy_price, created_at
               FROM analyses
               WHERE strategy = ?
               ORDER BY id DESC LIMIT ?""",
            (strategy, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT id, ticker, strategy, decision, quality_tier,
                      weighted_score, current_price, buy_price, created_at
               FROM analyses
               ORDER BY id DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        is_addon = d["decision"] == "N/A"
        title = (
            f"{d['ticker']} — {d['strategy']} addon"
            if is_addon
            else f"{d['ticker']} — {d['decision']} ({d['strategy']})"
        )
        if is_addon:
            summary = f"Specialist run (informational only)."
        else:
            from src.agents.discovery import ticker_currency
            from src.data.prices import get_price_data
            _, csym = ticker_currency(d["ticker"])
            buy = f"{csym}{d['buy_price']:.2f}" if d['buy_price'] else "—"
            live = get_price_data(d["ticker"])
            live_price = live.price if live.price and live.price > 0 else d["current_price"]
            cur = f"{csym}{live_price:.2f}" if live_price else "—"
            summary = (
                f"{d['quality_tier']} {d['weighted_score']:.1f}/5 | "
                f"fair {buy} vs {cur}"
            )
        out.append({
            "type": "analysis",
            "timestamp": d["created_at"],
            "title": title,
            "summary": summary,
            "reference": f"#{d['id']}",
            "link_to": {"tool": "get_analysis", "args": {"id": d["id"]}},
            "decision": d["decision"],
            "ticker": d["ticker"],
        })
    return out


def _lists_to_events(conn, limit: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        """SELECT cl.id, cl.name, cl.source, cl.strategy, cl.note, cl.created_at,
                  COUNT(c.id) AS total,
                  SUM(CASE WHEN c.analyzed = 1 THEN 1 ELSE 0 END) AS analyzed
           FROM candidate_lists cl
           LEFT JOIN candidates c ON c.list_id = cl.id
           GROUP BY cl.id
           ORDER BY cl.id DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        verb = "Discovered" if d["source"] == "agentic" else "Imported"
        title = f"{verb} list: {d['name']}"
        analyzed = int(d["analyzed"] or 0)
        summary = (
            f"{d['total']} candidates ({analyzed} analyzed)"
            f" | strategy: {d['strategy'] or '—'}"
        )
        out.append({
            "type": "list",
            "timestamp": d["created_at"],
            "title": title,
            "summary": summary,
            "reference": d["name"],   # lists are referenced by name, not id
            "link_to": {"tool": "get_candidate_list", "args": {"name": d["name"]}},
            "list_name": d["name"],
        })
    return out


def _decisions_to_events(conn, limit: int, strategy: str | None = None) -> list[dict[str, Any]]:
    if strategy:
        rows = conn.execute(
            """SELECT id, ticker, action, price, shares, reasoning, strategy,
                      analysis_id, created_at
               FROM decisions
               WHERE strategy = ?
               ORDER BY id DESC LIMIT ?""",
            (strategy, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT id, ticker, action, price, shares, reasoning, strategy,
                      analysis_id, created_at
               FROM decisions
               ORDER BY id DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        action = (d["action"] or "").upper()
        title = f"{action} {d['ticker']}"
        bits = []
        if d["shares"]:
            bits.append(f"{d['shares']:g} sh")
        if d["price"]:
            from src.agents.discovery import ticker_currency
            _, csym = ticker_currency(d["ticker"])
            bits.append(f"@ {csym}{d['price']:.2f}")
        if d["strategy"]:
            bits.append(f"({d['strategy']})")
        summary = " ".join(bits) if bits else (d["reasoning"] or "—")[:120]
        out.append({
            "type": "decision",
            "timestamp": d["created_at"],
            "title": title,
            "summary": summary,
            "reference": f"d#{d['id']}",
            "link_to": (
                {"tool": "get_analysis", "args": {"id": d["analysis_id"]}}
                if d.get("analysis_id") else None
            ),
            "ticker": d["ticker"],
        })
    return out


# ─── deletes (one entry point per type, plus a unified delete) ─────


def delete_event(event_type: str, reference: str | int) -> bool:
    """Delete an activity row by type + reference.

    `reference` is either:
      * an integer id (for `analysis`, `decision`, `task_run`)
      * a list name string (for `list`)

    Mirrors the structure of the activity feed itself — one MCP tool
    surface, dispatch internally. Returns True if a row was deleted.
    Cascade behavior:
      * analysis  → deletes all linked specialist_findings (FK cascade)
      * list      → deletes all candidates in the list (FK cascade)
      * decision  → no children
      * task_run  → no children (does NOT touch the parent schedule)
    """
    from src.db.operations import (
        delete_analysis,
        delete_candidate_list,
        delete_decision,
        delete_task_run,
    )

    if event_type not in ACTIVITY_TYPES:
        raise ValueError(
            f"unknown event_type {event_type!r}; "
            f"expected one of {ACTIVITY_TYPES}"
        )

    conn = get_db()
    try:
        if event_type == "list":
            if not isinstance(reference, str) or not reference:
                raise ValueError("list reference must be a non-empty string (name)")
            return delete_candidate_list(conn, reference)
        # All other types use integer ids
        try:
            ref_id = int(reference)
        except (TypeError, ValueError) as e:
            raise ValueError(
                f"{event_type} reference must be an integer id, got {reference!r}"
            ) from e
        if ref_id < 1:
            raise ValueError(f"{event_type} id must be positive, got {ref_id}")
        if event_type == "analysis":
            return delete_analysis(conn, ref_id)
        if event_type == "decision":
            return delete_decision(conn, ref_id)
        if event_type == "task_run":
            return delete_task_run(conn, ref_id)
        return False
    finally:
        conn.close()


# ─── per-source projections ────────────────────────────────────────


def _task_runs_to_events(conn, limit: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        """SELECT id, task_id, task_name, command, started_at, finished_at,
                  exit_code
           FROM task_runs
           ORDER BY id DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        ec = d["exit_code"]
        if ec is None:
            status = "running"
        elif ec == 0:
            status = "ok"
        else:
            status = f"failed (exit {ec})"
        out.append({
            "type": "task_run",
            "timestamp": d["started_at"],
            "title": f"Task: {d['task_name']}",
            "summary": f"{d['command']} — {status}",
            "reference": f"r#{d['id']}",
            "link_to": None,
            "exit_code": ec,
            "status": status,
        })
    return out
