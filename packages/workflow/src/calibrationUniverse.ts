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

export type CalibrationUniverseName = {
  ticker: string
  company: string
  market: CalibrationMarket
  fundamentals_hint: FundamentalsHint
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
    fundamentals_hint: z.enum(['edgar', 'local_manual']),
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
      fundamentals_hint: name.fundamentals_hint,
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
