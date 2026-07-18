import { appendFileSync, closeSync, mkdirSync, openSync, readdirSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Per-spawn worker run logs (owner-approved 2026-07-18): the research/deep-dive/discovery worker
 * spawns used to discard stdout/stderr (`stdio: 'ignore'`) — a failed run's real error vanished with
 * the process. Each spawn appends its journal to a file here for TERMINAL debugging (the in-app log
 * view was removed by owner decision 2026-07-18 — the pipeline timeline is the in-app live feed).
 * Runtime artifacts only (data/ is git-ignored); the ledger stays the source of truth.
 */

const RETENTION_MS = 14 * 24 * 60 * 60 * 1000

export function resolveRunLogDir(): string {
  return process.env['OWLFOLIO_RUN_LOG_DIR']
    ?? join(process.env['OWLFOLIO_PROJECT_DIR'] ?? process.cwd(), 'data', 'run-logs')
}

/**
 * Open an append fd for one worker spawn (the caller passes it as the child's stdout+stderr and
 * closes its own copy). Returns undefined on ANY failure — logging must never block a run.
 * Also prunes logs older than the retention window (best-effort).
 */
export function openRunLog(taskKind: string): { fd: number; path: string } | undefined {
  // Test hygiene: under vitest (mocked children, real fs) a log write would pollute the developer's
  // real data/run-logs with header-only files — the "empty log" mystery. Tests that WANT files set
  // OWLFOLIO_RUN_LOG_DIR explicitly; playwright isolates the same way via its web-server env.
  if (process.env['VITEST'] !== undefined && process.env['OWLFOLIO_RUN_LOG_DIR'] === undefined) {
    return undefined
  }
  try {
    const dir = resolveRunLogDir()
    mkdirSync(dir, { recursive: true })
    pruneOldLogs(dir)
    const now = new Date().toISOString()
    const stamp = now.replace(/[:.]/g, '-')
    const path = join(dir, `${taskKind}-${stamp}.log`)
    const fd = openSync(path, 'a')
    // Header from the PARENT, before the child exists: a spawn attempt can never leave a 0-byte
    // mystery, and an exec failure (noteSpawnFailure) lands in a file that names its attempt.
    writeSync(fd, `[owlfolio] ${taskKind} spawn requested at ${now}\n`)
    return { fd, path }
  } catch {
    return undefined
  }
}

/** Append a child-process exec failure to its run log (spawn 'error' event) — best-effort. */
export function noteSpawnFailure(path: string, error: unknown): void {
  try {
    const message = error instanceof Error ? error.message : String(error)
    appendFileSync(path, `[owlfolio] spawn FAILED before the worker ran: ${message}\n`)
  } catch {
    // Best-effort only.
  }
}

export function closeRunLog(fd: number): void {
  try {
    closeSync(fd)
  } catch {
    // Already closed / never opened — nothing to do.
  }
}

function pruneOldLogs(dir: string): void {
  try {
    const cutoff = Date.now() - RETENTION_MS
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.log')) continue
      const full = join(dir, name)
      try {
        if (statSync(full).mtimeMs < cutoff) unlinkSync(full)
      } catch {
        // Skip an unreadable entry; retention is best-effort.
      }
    }
  } catch {
    // Retention is best-effort.
  }
}
