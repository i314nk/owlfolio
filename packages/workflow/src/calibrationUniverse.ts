// User-curated, versioned calibration universe (valuation-recalibration-spec §3.1).
//
// The calibration backtest's target is pre-stated, and the UNIVERSE is PART of that target. This module
// is the mechanism for the design decision that the universe is USER-OWNED + versioned, NOT auto-derived
// from "whatever has been analysed":
//   - `config/calibration_universe.json` is a TRACKED config the human edits (seeded with the 7 reference
//     names). A `calibration_run` records WHICH universe version it used so a run is reproducible.
//   - `parseCalibrationUniverse` validates the document fail-closed (a typo degrades, never poisons a run).
//   - `loadCalibrationUniverse` reads the tracked file (default config/calibration_universe.json).
//   - `suggestCalibrationUniverseAdditions` surfaces researched-case tickers + 13F-discovery candidates
//     that are NOT already in the universe, so the /calibration page can SUGGEST them — but the human
//     authors the list by editing the file. Suggestions are never auto-added.
//
// The `fundamentals_hint` (`edgar` | `local_manual`) is advisory provenance for the operator; the actual
// resolution at backtest time goes through the tiered `resolveFundamentalsForTicker` (local-manual ->
// EDGAR -> fail-closed), and the run's COVERAGE report records what actually resolved.

import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'

import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { projectDiscoveryCandidates } from '@owlfolio/ledger/projections/discoveryCandidateProjection'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'

/** Where the tracked calibration-universe config lives, relative to the repo root. */
export const DEFAULT_CALIBRATION_UNIVERSE_PATH = 'config/calibration_universe.json'

/** Market classification for a universe name. `intl` = non-US (EDGAR foreign filer or local-manual). */
export type CalibrationMarket = 'US' | 'intl'

/** Which fundamentals lane the operator expects to resolve this name (advisory; tiered resolver decides). */
export type FundamentalsHint = 'edgar' | 'local_manual'

/**
 * Whether a name is part of the active automated-fundamentals universe (`active`) or intentionally
 * `deferred` — a non-SEC filer with NO automated primary source. Deferred names are listed (so the
 * limitation is visible) but skipped by the backtest; they are NOT "needs manual entry": the owner has
 * decided not to manual-enter and we do not use a keyed aggregator. Defaults to `active` when omitted.
 */
export type CalibrationNameStatus = 'active' | 'deferred'

export type CalibrationUniverseName = {
  ticker: string
  company: string
  market: CalibrationMarket
  /** The automated lane the operator expects (active names only). Absent for deferred names. */
  fundamentals_hint?: FundamentalsHint
  /** Active (in the automated universe) or deferred (no automated source). Defaults to 'active'. */
  status: CalibrationNameStatus
  /** Why a deferred name is deferred (e.g. non-SEC filer, no automated fundamentals source). */
  defer_reason?: string
}

export type CalibrationUniverse = {
  version: string
  names: CalibrationUniverseName[]
}

const CalibrationUniverseNameSchema = z
  .object({
    ticker: z.string().min(1),
    company: z.string().min(1),
    market: z.enum(['US', 'intl']),
    // `fundamentals_hint` is the automated lane for active names; deferred names omit it (no lane).
    fundamentals_hint: z.enum(['edgar', 'local_manual']).optional(),
    // `status` defaults to 'active' when omitted (the automated SEC-filer universe).
    status: z.enum(['active', 'deferred']).optional(),
    defer_reason: z.string().min(1).optional(),
    // An optional human-facing per-name `note` is allowed in the tracked file (e.g. a coverage caveat)
    // but is not part of the typed model.
    note: z.string().optional(),
  })
  .strict()

const CalibrationUniverseSchema = z
  .object({
    version: z.string().min(1),
    // An optional human-facing `note` is allowed in the tracked file but not part of the typed model.
    note: z.string().optional(),
    names: z.array(CalibrationUniverseNameSchema).min(1),
  })
  .strict()

/**
 * Validate + normalize a parsed calibration-universe document. Fail-closed: returns undefined for any
 * shape violation (so a malformed tracked file degrades to "no universe" rather than poisoning a run).
 * Tickers are upper-cased for stable matching against discovery/research projections.
 */
export function parseCalibrationUniverse(raw: unknown): CalibrationUniverse | undefined {
  const parsed = CalibrationUniverseSchema.safeParse(raw)
  if (!parsed.success) return undefined
  return {
    version: parsed.data.version,
    names: parsed.data.names.map((name) => ({
      ticker: name.ticker.trim().toUpperCase(),
      company: name.company,
      market: name.market,
      ...(name.fundamentals_hint === undefined ? {} : { fundamentals_hint: name.fundamentals_hint }),
      status: name.status ?? 'active',
      ...(name.defer_reason === undefined ? {} : { defer_reason: name.defer_reason }),
    })),
  }
}

/**
 * Read the tracked calibration-universe config from disk. Fail-closed: a missing file, malformed JSON, or
 * a schema violation all resolve to undefined. An injected `readFile` keeps tests off the real filesystem.
 */
export function loadCalibrationUniverse(
  path: string = DEFAULT_CALIBRATION_UNIVERSE_PATH,
  readFile: (p: string) => string = (p) => readFileSync(p, 'utf8'),
): CalibrationUniverse | undefined {
  // Resolve a relative path against OWLFOLIO_PROJECT_DIR (else CWD) so the tracked config is found
  // regardless of where the server/worker process was started — mirrors the local-manual store resolution.
  const projectDir = process.env['OWLFOLIO_PROJECT_DIR']
  const resolved = isAbsolute(path) || projectDir === undefined ? path : join(projectDir, path)
  let rawText: string
  try {
    rawText = readFile(resolved)
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return undefined
  }
  return parseCalibrationUniverse(parsed)
}

// --- User-authored universe curation (Rule 1: the UI is a projection of the ledger) ---------------
//
// The current universe = the seed config (above) + user-authored ledger events layered on top. Curating
// the list is REVERSIBLE list-editing, so an add/remove is a DIRECT user-authored event (the owner IS
// authoring by clicking — not the irreversible "draft for confirmation" pattern). Removing a SEED name
// tombstones it (suppressed from the projection); re-adding it un-tombstones. A derived `version` changes
// on every edit so a calibration_run can record exactly which composed universe it used.

/** Payload of `calibration_universe_member_added` (user adds a ticker to the calibration universe). */
export type CalibrationUniverseMemberAddedPayload = {
  ticker: string
  company?: string
  market?: CalibrationMarket
}

/** Payload of `calibration_universe_member_removed` (user removes / tombstones a ticker). */
export type CalibrationUniverseMemberRemovedPayload = {
  ticker: string
}

const CALIBRATION_UNIVERSE_AGGREGATE_ID = 'buffett-munger'
const CALIBRATION_CURATION_ACTOR_ID = 'user_local'

function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase()
}

/**
 * Build a user-authored `calibration_universe_member_added` ledger event. The ticker is normalized
 * (trimmed + upper-cased); optional company/market are omitted when not supplied. The caller appends it.
 */
export function buildCalibrationUniverseMemberAddedEvent(args: {
  ticker: string
  company?: string
  market?: CalibrationMarket
  actor_id?: string
  created_at?: string
}): LedgerEventEnvelope<CalibrationUniverseMemberAddedPayload> {
  const ticker = normalizeTicker(args.ticker)
  const company = args.company?.trim()
  const createdAt = args.created_at ?? new Date().toISOString()
  return {
    event_id: `evt_calibration_universe_member_added_${ticker}_${createdAt}`,
    event_type: 'calibration_universe_member_added',
    aggregate_type: 'strategy',
    aggregate_id: CALIBRATION_UNIVERSE_AGGREGATE_ID,
    actor_type: 'user',
    actor_id: args.actor_id ?? CALIBRATION_CURATION_ACTOR_ID,
    payload: {
      ticker,
      ...(company === undefined || company.length === 0 ? {} : { company }),
      ...(args.market === undefined ? {} : { market: args.market }),
    },
    source_ids: [],
    created_at: createdAt,
    schema_version: 1,
    idempotency_key: `calibration-universe-add:${ticker}:${createdAt}`,
  }
}

/**
 * Build a user-authored `calibration_universe_member_removed` ledger event (tombstones the ticker — a seed
 * name is suppressed from the projection until re-added). The caller appends it.
 */
export function buildCalibrationUniverseMemberRemovedEvent(args: {
  ticker: string
  actor_id?: string
  created_at?: string
}): LedgerEventEnvelope<CalibrationUniverseMemberRemovedPayload> {
  const ticker = normalizeTicker(args.ticker)
  const createdAt = args.created_at ?? new Date().toISOString()
  return {
    event_id: `evt_calibration_universe_member_removed_${ticker}_${createdAt}`,
    event_type: 'calibration_universe_member_removed',
    aggregate_type: 'strategy',
    aggregate_id: CALIBRATION_UNIVERSE_AGGREGATE_ID,
    actor_type: 'user',
    actor_id: args.actor_id ?? CALIBRATION_CURATION_ACTOR_ID,
    payload: { ticker },
    source_ids: [],
    created_at: createdAt,
    schema_version: 1,
    idempotency_key: `calibration-universe-remove:${ticker}:${createdAt}`,
  }
}

function readPayloadString(payload: unknown, key: string): string | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Compose the CURRENT calibration universe from the seed config + user-authored member add/remove events,
 * applied in ledger order:
 *   - a seed name is present unless a later `member_removed` tombstones it (re-adding un-tombstones);
 *   - a `member_added` for a non-seed ticker inserts an `active` name (idempotent — re-adding an already
 *     active ticker is a no-op);
 *   - the derived `version` is `${seed.version}+N` where N counts the events that CHANGED the universe, so
 *     it advances on every effective edit and a run can record exactly which composed universe it used.
 * Tickers are normalized upper-case for matching. Seed metadata (company/market/status/defer_reason) is
 * preserved across a remove→re-add cycle.
 */
export function projectCalibrationUniverse(
  seed: CalibrationUniverse,
  events: ReadonlyArray<LedgerEventEnvelope<unknown>>,
): CalibrationUniverse {
  // Seed names keyed by normalized ticker, preserving insertion order.
  const order: string[] = []
  const byTicker = new Map<string, CalibrationUniverseName>()
  const tombstoned = new Set<string>()

  for (const name of seed.names) {
    const ticker = normalizeTicker(name.ticker)
    if (!byTicker.has(ticker)) order.push(ticker)
    byTicker.set(ticker, { ...name, ticker })
  }

  let appliedCount = 0
  for (const event of events) {
    if (event.event_type === 'calibration_universe_member_added') {
      const rawTicker = readPayloadString(event.payload, 'ticker')
      if (rawTicker === undefined) continue
      const ticker = normalizeTicker(rawTicker)
      if (ticker.length === 0) continue
      const isTombstoned = tombstoned.has(ticker)
      const existing = byTicker.get(ticker)
      // Idempotent: re-adding an already-present, non-tombstoned ticker changes nothing.
      if (existing !== undefined && !isTombstoned) continue
      tombstoned.delete(ticker)
      if (existing === undefined) {
        const company = readPayloadString(event.payload, 'company')
        const market = readPayloadString(event.payload, 'market')
        if (!order.includes(ticker)) order.push(ticker)
        byTicker.set(ticker, {
          ticker,
          company: company === undefined || company.length === 0 ? ticker : company,
          market: market === 'intl' ? 'intl' : 'US',
          status: 'active',
        })
      }
      appliedCount += 1
    } else if (event.event_type === 'calibration_universe_member_removed') {
      const rawTicker = readPayloadString(event.payload, 'ticker')
      if (rawTicker === undefined) continue
      const ticker = normalizeTicker(rawTicker)
      if (ticker.length === 0) continue
      // Idempotent: removing an already-absent ticker changes nothing.
      if (tombstoned.has(ticker) || !byTicker.has(ticker)) continue
      tombstoned.add(ticker)
      appliedCount += 1
    }
  }

  const names = order
    .filter((ticker) => !tombstoned.has(ticker))
    .map((ticker) => byTicker.get(ticker))
    .filter((name): name is CalibrationUniverseName => name !== undefined)

  return {
    version: `${seed.version}+${appliedCount}`,
    names,
  }
}

/** How a suggested ticker surfaced: from a research case, from 13F discovery, or both. */
export type SuggestionSource = 'researched' | '13f_discovered'

export type CalibrationUniverseSuggestion = {
  ticker: string
  company?: string
  sources: SuggestionSource[]
}

/**
 * Surface researched-case + 13F-discovered tickers that are NOT already in the universe, so the page can
 * SUGGEST them for the human to add (the human authors the list by editing the config; suggestions are
 * never auto-added). A ticker surfaced from both a research case and a discovery candidate is deduped into
 * one suggestion carrying both sources. Tickers already in the universe are excluded.
 */
export function suggestCalibrationUniverseAdditions(
  universe: CalibrationUniverse,
  events: ReadonlyArray<LedgerEventEnvelope<unknown>>,
): CalibrationUniverseSuggestion[] {
  const inUniverse = new Set(universe.names.map((n) => n.ticker.trim().toUpperCase()))
  const byTicker = new Map<string, CalibrationUniverseSuggestion>()

  const add = (rawTicker: string | undefined, company: string | undefined, source: SuggestionSource): void => {
    if (rawTicker === undefined) return
    const ticker = rawTicker.trim().toUpperCase()
    if (ticker.length === 0 || inUniverse.has(ticker)) return
    const existing = byTicker.get(ticker)
    if (existing === undefined) {
      byTicker.set(ticker, {
        ticker,
        ...(company === undefined || company.length === 0 ? {} : { company }),
        sources: [source],
      })
      return
    }
    if (!existing.sources.includes(source)) existing.sources.push(source)
    if (existing.company === undefined && company !== undefined && company.length > 0) existing.company = company
  }

  for (const candidate of projectDiscoveryCandidates(events as LedgerEventEnvelope<unknown>[])) {
    add(candidate.ticker, candidate.company_name, '13f_discovered')
  }
  for (const researchCase of projectResearchCases(events as LedgerEventEnvelope<unknown>[])) {
    add(researchCase.ticker, researchCase.company_id, 'researched')
  }

  return [...byTicker.values()].sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0))
}
