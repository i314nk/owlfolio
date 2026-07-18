import { closeSync, mkdirSync, openSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Per-spawn worker run logs (owner-approved 2026-07-18): the research/deep-dive/discovery worker
 * spawns used to discard stdout/stderr (`stdio: 'ignore'`) — a failed run's real error vanished with
 * the process. Each spawn now appends to a log file here; the pipeline page serves a REDACTED tail.
 * Runtime artifacts only (data/ is git-ignored); the ledger stays the source of truth.
 */

const RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const DEFAULT_TAIL_BYTES = 8_192

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
  try {
    const dir = resolveRunLogDir()
    mkdirSync(dir, { recursive: true })
    pruneOldLogs(dir)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = join(dir, `${taskKind}-${stamp}.log`)
    return { fd: openSync(path, 'a'), path }
  } catch {
    return undefined
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

/**
 * Secret hygiene: the tail goes to the browser, so anything key-shaped is struck before it leaves
 * the server — both bare `sk-…` tokens and `*_API_KEY=…`-style assignments.
 */
function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, '[redacted]')
    .replace(/((?:API_KEY|APIKEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*[=:]\s*)[^\s'"]+/gi, '$1[redacted]')
}

/**
 * The newest run log's tail (redacted), or undefined when no log matches. The optional filter
 * matches a log to a SELECTED run (its task kinds + a not-before timestamp) so the diagnostics pane
 * shows the process that ran the case, not merely the newest spawn; callers fall back to the
 * unfiltered call when nothing matches.
 */
export async function latestRunLogTail(
  maxBytes = DEFAULT_TAIL_BYTES,
  filter?: { sinceMs?: number; taskKinds?: readonly string[] },
): Promise<{ file: string; tail: string } | undefined> {
  try {
    const dir = resolveRunLogDir()
    const names = (await readdir(dir)).filter((name) => name.endsWith('.log'))
    if (names.length === 0) return undefined

    let newest: { name: string; mtimeMs: number; size: number } | undefined
    for (const name of names) {
      if (filter?.taskKinds !== undefined && !filter.taskKinds.some((kind) => name.startsWith(`${kind}-`))) continue
      const s = await stat(join(dir, name))
      if (filter?.sinceMs !== undefined && s.mtimeMs < filter.sinceMs) continue
      if (newest === undefined || s.mtimeMs > newest.mtimeMs) {
        newest = { name, mtimeMs: s.mtimeMs, size: s.size }
      }
    }
    if (newest === undefined) return undefined

    const handle = await open(join(dir, newest.name), 'r')
    try {
      const start = Math.max(0, newest.size - maxBytes)
      const length = newest.size - start
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, start)
      return { file: newest.name, tail: redactSecrets(buffer.toString('utf8')) }
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}
