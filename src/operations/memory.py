"""Chat memory CRUD operations."""

from __future__ import annotations

from typing import Any

from src.db.operations import add_memory as db_add_memory
from src.db.schema import get_db
from src.operations import validate_ticker


def list_memories(category: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    """List memory entries, optionally filtered by category."""
    conn = get_db()
    try:
        if category:
            rows = conn.execute(
                "SELECT * FROM memory WHERE category = ? ORDER BY id DESC LIMIT ?",
                (category, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM memory ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def remember(content: str, category: str = "observation", ticker: str | None = None) -> dict[str, Any]:
    """Save a memory entry. Returns the inserted row info."""
    if not isinstance(content, str) or not content.strip():
        raise ValueError("content is required")
    if not isinstance(category, str) or not category.strip():
        raise ValueError("category is required")
    t = validate_ticker(ticker) if ticker else None
    mem_id = db_add_memory(category, content.strip(), ticker=t)
    return {"id": mem_id, "category": category, "ticker": t, "content": content.strip()}


def forget(memory_id: int) -> dict[str, Any]:
    """Delete a memory entry by ID."""
    if not isinstance(memory_id, int):
        raise ValueError(f"memory_id must be int, got {type(memory_id).__name__}")
    conn = get_db()
    try:
        cur = conn.execute("DELETE FROM memory WHERE id = ?", (memory_id,))
        conn.commit()
        return {"deleted": cur.rowcount, "id": memory_id}
    finally:
        conn.close()
