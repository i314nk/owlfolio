"""SQLite schema and connection management for portfolio persistence."""

import sqlite3
from pathlib import Path

DB_PATH = Path("data/portfolio.db")


def get_db() -> sqlite3.Connection:
    """Get database connection, creating tables if needed."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    # ON DELETE CASCADE is a no-op in SQLite without this pragma — needed
    # so deleting a candidate_lists row drops its candidates rows.
    conn.execute("PRAGMA foreign_keys=ON")
    _create_tables(conn)
    _run_migrations(conn)
    return conn


def _create_tables(conn: sqlite3.Connection):
    """Create all tables if they don't exist."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS holdings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            shares REAL NOT NULL,
            cost_basis REAL NOT NULL,
            date_acquired TEXT NOT NULL,
            account TEXT DEFAULT 'default',
            strategy TEXT,
            notes TEXT,
            currency TEXT DEFAULT 'USD',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            action TEXT NOT NULL,
            price REAL,
            shares REAL,
            reasoning TEXT,
            strategy TEXT,
            analysis_id INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS watchlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            strategy TEXT,
            buy_price REAL,
            current_price REAL,
            last_checked TEXT,
            notes TEXT,
            currency TEXT DEFAULT 'USD',
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(ticker, strategy)
        );

        CREATE TABLE IF NOT EXISTS analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            strategy TEXT NOT NULL,
            decision TEXT,
            buy_price REAL,
            current_price REAL,
            quality_tier TEXT,
            weighted_score REAL,
            thesis TEXT,
            bull_case TEXT,
            bear_case TEXT,
            key_risks TEXT,
            overrides TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS scheduled_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            command TEXT NOT NULL,
            schedule TEXT NOT NULL,
            timezone TEXT DEFAULT 'UTC',
            enabled INTEGER DEFAULT 1,
            last_run TEXT,
            last_result TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            ticker TEXT,
            message TEXT NOT NULL,
            task_run_id INTEGER REFERENCES task_runs(id),
            read INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            total_value REAL NOT NULL,
            total_cost REAL NOT NULL,
            cash REAL DEFAULT 0,
            holdings_json TEXT,
            benchmark_value REAL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            content TEXT NOT NULL,
            ticker TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        -- Specialist findings: one row per specialist per analysis.
        -- Saved alongside the synthesized analysis so the audit tab can
        -- expand "why BUY?" into the underlying evidence, AND so a
        -- future synthesis-prompt change can re-synthesize against
        -- saved findings without re-paying for the (expensive)
        -- specialist research phase. extra_json is a catch-all for
        -- specialist-specific fields (margin numbers, moat scores,
        -- shariah ratios, etc.) that don't fit the common columns.
        CREATE TABLE IF NOT EXISTS specialist_findings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
            specialist_name TEXT NOT NULL,
            summary TEXT,
            key_findings TEXT,    -- JSON array
            data_sources TEXT,    -- JSON array
            flags TEXT,           -- JSON array
            confidence REAL,
            extra_json TEXT,      -- catch-all for specialist-specific fields
            created_at TEXT DEFAULT (datetime('now'))
        );

        -- Task runs: history of daemon-fired scheduled task executions.
        -- Without this, scheduled tasks silently succeed or fail with no
        -- audit trail (the `watchlist check` incident motivated both
        -- the command-validator AND this table — visible failure beats
        -- silent failure).
        CREATE TABLE IF NOT EXISTS task_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
            task_name TEXT NOT NULL,         -- denormalized so deletes don't lose history
            command TEXT NOT NULL,           -- denormalized for the same reason
            started_at TEXT NOT NULL,
            finished_at TEXT,
            exit_code INTEGER,               -- NULL while running; 0=success
            stdout_excerpt TEXT,             -- first ~2KB of stdout
            stderr_excerpt TEXT              -- first ~2KB of stderr
        );

        -- Candidate lists: transient ticker collections from agentic
        -- discovery (`owlfolio find`) or external imports (`owlfolio
        -- import`). The user picks a list, the analyze pipeline iterates
        -- it. Lists have no portfolio status — they're inputs to the
        -- decision flow, not investment positions.
        CREATE TABLE IF NOT EXISTS candidate_lists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            strategy TEXT,
            source TEXT NOT NULL,             -- 'agentic' | 'import'
            note TEXT,                        -- one-line description from creator
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id INTEGER NOT NULL REFERENCES candidate_lists(id) ON DELETE CASCADE,
            ticker TEXT NOT NULL,
            company_name TEXT,
            sector TEXT,
            market_cap REAL,
            current_price REAL,
            note TEXT,                        -- one-sentence rationale
            metrics_json TEXT,                -- strategy-specific metrics
            analyzed INTEGER DEFAULT 0,       -- 0=pending, 1=analyzed
            analysis_id INTEGER,              -- FK into analyses(id) once analyzed
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(list_id, ticker)
        );

        CREATE INDEX IF NOT EXISTS idx_holdings_ticker ON holdings(ticker);
        CREATE INDEX IF NOT EXISTS idx_decisions_ticker ON decisions(ticker);
        CREATE INDEX IF NOT EXISTS idx_analyses_ticker ON analyses(ticker);
        CREATE INDEX IF NOT EXISTS idx_alerts_read ON alerts(read);
        CREATE INDEX IF NOT EXISTS idx_memory_category ON memory(category);
        CREATE INDEX IF NOT EXISTS idx_candidates_list ON candidates(list_id);
        CREATE INDEX IF NOT EXISTS idx_candidates_ticker ON candidates(ticker);
        CREATE INDEX IF NOT EXISTS idx_findings_analysis ON specialist_findings(analysis_id);
        CREATE INDEX IF NOT EXISTS idx_findings_specialist ON specialist_findings(specialist_name);
        CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_runs_started ON task_runs(started_at);
    """)


def _run_migrations(conn: sqlite3.Connection):
    """Run schema migrations for existing databases.

    Each migration checks whether it's needed before executing, so
    calling this on every connection is safe (idempotent).
    """
    _migrate_watchlist_unique_constraint(conn)


def _migrate_watchlist_unique_constraint(conn: sqlite3.Connection):
    """Change watchlist UNIQUE(ticker) → UNIQUE(ticker, strategy).

    SQLite can't ALTER constraints, so we recreate the table.
    """
    # Check if migration is needed: inspect the existing unique index.
    # If the table already has the (ticker, strategy) constraint, skip.
    indexes = conn.execute("PRAGMA index_list(watchlist)").fetchall()
    for idx in indexes:
        cols = conn.execute(f"PRAGMA index_info({idx['name']})").fetchall()
        col_names = [c["name"] for c in cols]
        if col_names == ["ticker"] and idx["unique"]:
            # Old constraint found — migrate.
            break
    else:
        # No old single-column unique index on ticker — already migrated
        # or fresh table with the new schema.
        return

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS watchlist_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            strategy TEXT,
            buy_price REAL,
            current_price REAL,
            last_checked TEXT,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(ticker, strategy)
        );

        INSERT OR IGNORE INTO watchlist_new
            (id, ticker, strategy, buy_price, current_price, last_checked, notes, created_at)
        SELECT id, ticker, strategy, buy_price, current_price, last_checked, notes, created_at
        FROM watchlist;

        DROP TABLE watchlist;

        ALTER TABLE watchlist_new RENAME TO watchlist;
    """)
