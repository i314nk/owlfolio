// Pluggable fundamentals-provider abstraction.
//
// Owlfolio's calibration backtest + research swarm need PRIMARY annual fundamentals (the owner-earnings
// bridge inputs) for a name. For US filers and foreign private issuers that file with the SEC (10-K /
// 20-F / 40-F), the EDGAR adapter (secEdgar.ts) is the source. But many names — notably GCC issuers on
// the DFM / ADX (e.g. DEWA, TABREED, EMPOWER, TALABAT) — have NO SEC filing and NO free, reliable
// structured API. Adding a keyed third-party API for them would violate the fail-closed / local-first
// ethos and rest on uncertain coverage. Instead, those names get a LOCAL-MANUAL adapter: the operator
// enters the figures from the audited annual report into a tracked, typed JSON file with provenance, and
// the system uses them deterministically.
//
// This module defines:
//   - FundamentalsProvider — `resolve(ticker) => Promise<Fundamentals | undefined>` (fail-closed).
//   - EdgarFundamentalsProvider — wraps the extended EDGAR adapter.
//   - LocalManualFundamentalsProvider — reads operator-entered JSON from a tracked store dir.
//   - resolveFundamentalsForTicker — the single resolver: local-manual store (operator override wins) ->
//     EDGAR -> undefined (fail-closed). The backtest + swarm resolve through this one entry.
//
// HONESTY: the local-manual store is the *mechanism* for non-EDGAR names. The actual GCC figures are an
// operator data-entry step from the issuer's audited annual report — this module never fabricates them.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { fetchCompanyFundamentals, type AnnualFacts, type Fundamentals, type SecEdgarDeps } from './secEdgar'

/**
 * A source of primary annual fundamentals for a ticker. Implementations MUST be fail-closed: any
 * unknown ticker, missing data, or error resolves to undefined (never throws) so callers degrade to
 * exactly today's behaviour.
 */
export interface FundamentalsProvider {
  resolve(ticker: string): Promise<Fundamentals | undefined>
}

// ---------------------------------------------------------------------------
// EDGAR provider (wraps the extended secEdgar adapter)
// ---------------------------------------------------------------------------

export type EdgarFetcher = (ticker: string, deps?: SecEdgarDeps) => Promise<Fundamentals | undefined>

/**
 * Wraps the EDGAR adapter (us-gaap/USD + ifrs-full/non-USD, 10-K/20-F/40-F). Live by default; an
 * injected fetcher keeps tests offline + deterministic.
 */
export class EdgarFundamentalsProvider implements FundamentalsProvider {
  constructor(
    private readonly fetcher: EdgarFetcher = fetchCompanyFundamentals,
    private readonly deps?: SecEdgarDeps,
  ) {}

  async resolve(ticker: string): Promise<Fundamentals | undefined> {
    try {
      return await this.fetcher(ticker, this.deps)
    } catch {
      return undefined
    }
  }
}

// ---------------------------------------------------------------------------
// Local-manual provider (operator-entered JSON from the audited annual report)
// ---------------------------------------------------------------------------

/**
 * Default tracked store directory for local-manual fundamentals, relative to the repo root. Operators
 * drop one `{TICKER}.json` per name here (see config/fundamentals/_TEMPLATE.json + the README JSDoc
 * below). This is intentionally NOT under the gitignored `data/` tree — these files are checked in.
 */
export const DEFAULT_LOCAL_FUNDAMENTALS_DIR = 'config/fundamentals'

/**
 * Zod schema for a local-manual annual-facts row. All monetary fields are in MILLIONS of the document's
 * reporting `currency`; share counts are in MILLIONS. Mirrors AnnualFacts (minus the per-row `currency`,
 * which is taken from the document-level `currency`). Every field except `fiscal_year` is optional so an
 * operator can enter only what the annual report discloses; the OE bridge fails closed on missing inputs.
 */
const AnnualRowSchema = z
  .object({
    fiscal_year: z.number().int(),
    filed: z.string().optional(),
    period_end: z.string().optional(),
    net_income_musd: z.number().optional(),
    revenue_musd: z.number().optional(),
    d_and_a_musd: z.number().optional(),
    capex_musd: z.number().optional(),
    sbc_musd: z.number().optional(),
    diluted_shares_m: z.number().optional(),
    shares_outstanding_m: z.number().optional(),
    total_debt_musd: z.number().optional(),
    cash_and_securities_musd: z.number().optional(),
    interest_expense_musd: z.number().optional(),
    stockholders_equity_musd: z.number().optional(),
    operating_income_musd: z.number().optional(),
    income_tax_expense_musd: z.number().optional(),
  })
  .strict()

/**
 * Zod schema for a local-manual fundamentals document. `source` is REQUIRED provenance: where the figures
 * came from (audited annual report URL, the filing/publication date the operator used as the as-of date,
 * and a free-text note). This is how a non-EDGAR name (GCC/DFM/ADX) gets primary data — entered by the
 * operator, not scraped or invented.
 */
export const LocalManualFundamentalsSchema = z
  .object({
    ticker: z.string().min(1),
    entity_name: z.string().min(1),
    /** Reporting currency ISO code (e.g. 'AED', 'SAR', 'QAR') — the units of every *_musd field. */
    currency: z.string().min(1),
    source: z
      .object({
        annual_report_url: z.string().min(1),
        filed: z.string().optional(),
        note: z.string().optional(),
      })
      .strict(),
    latest_annual: AnnualRowSchema,
    annual_series: z.array(AnnualRowSchema).min(1),
  })
  .strict()

export type LocalManualFundamentalsDoc = z.infer<typeof LocalManualFundamentalsSchema>

function rowToAnnualFacts(row: z.infer<typeof AnnualRowSchema>, currency: string): AnnualFacts {
  // Spread only defined keys to respect exactOptionalPropertyTypes; zod already dropped absent keys.
  return { ...row, currency } as AnnualFacts
}

/**
 * Validate + convert a parsed local-manual document into Fundamentals. Fail-closed: returns undefined for
 * any shape violation (so a typo in an operator file degrades gracefully rather than poisoning a backtest).
 * The provenance `source` becomes a synthetic FilingRef pointing at the annual report.
 */
export function parseLocalManualFundamentals(raw: unknown): Fundamentals | undefined {
  const parsed = LocalManualFundamentalsSchema.safeParse(raw)
  if (!parsed.success) return undefined
  const doc = parsed.data
  return {
    cik: '',
    entity_name: doc.entity_name,
    currency: doc.currency,
    latest_annual: rowToAnnualFacts(doc.latest_annual, doc.currency),
    annual_series: doc.annual_series
      .map((r) => rowToAnnualFacts(r, doc.currency))
      .sort((a, b) => b.fiscal_year - a.fiscal_year),
    filings: [
      {
        form: 'annual-report',
        filed: doc.source.filed ?? doc.latest_annual.filed ?? '',
        url: doc.source.annual_report_url,
      },
    ],
  }
}

/** A ticker must look like a real symbol (not the template placeholder, not a path traversal). */
function isResolvableTicker(ticker: string): boolean {
  const t = ticker.trim().toUpperCase()
  if (t.length === 0) return false
  if (t.startsWith('_')) return false // _TEMPLATE and any other placeholder
  return /^[A-Z0-9.\-]+$/.test(t)
}

/**
 * Reads operator-entered fundamentals from a tracked store directory: one `{TICKER}.json` per name.
 * Fail-closed: a missing file, malformed JSON, schema violation, or the `_TEMPLATE` placeholder all
 * resolve to undefined. An injected `readFile` keeps tests off the real filesystem when desired.
 */
export class LocalManualFundamentalsProvider implements FundamentalsProvider {
  constructor(
    private readonly storeDir: string = DEFAULT_LOCAL_FUNDAMENTALS_DIR,
    private readonly readFile: (path: string) => string = (p) => readFileSync(p, 'utf8'),
  ) {}

  async resolve(ticker: string): Promise<Fundamentals | undefined> {
    const wanted = ticker.trim().toUpperCase()
    if (!isResolvableTicker(wanted)) return undefined
    let rawText: string
    try {
      rawText = this.readFile(join(this.storeDir, `${wanted}.json`))
    } catch {
      return undefined // no file for this ticker
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(rawText)
    } catch {
      return undefined // malformed JSON
    }
    return parseLocalManualFundamentals(parsed)
  }
}

// ---------------------------------------------------------------------------
// Resolver — the single entry point (local-manual override -> EDGAR -> undefined)
// ---------------------------------------------------------------------------

export type ResolveFundamentalsDeps = {
  /** Directory of local-manual {TICKER}.json files (default config/fundamentals). */
  localStoreDir?: string
  /** Override the EDGAR fetcher (tests inject an offline fixture fetcher). */
  fetchEdgar?: EdgarFetcher
  /** Pre-built local provider (tests). Takes precedence over localStoreDir. */
  localProvider?: FundamentalsProvider
  /** Pre-built EDGAR provider (tests). Takes precedence over fetchEdgar. */
  edgarProvider?: FundamentalsProvider
  secDeps?: SecEdgarDeps
}

/**
 * Resolve primary annual fundamentals for a ticker, fail-closed, trying in order:
 *   1. the LOCAL-MANUAL store (operator override wins — lets an operator correct/supply a name EDGAR
 *      covers poorly, and is the only source for non-EDGAR GCC/DFM/ADX names),
 *   2. EDGAR (us-gaap/USD + ifrs-full/non-USD, 10-K/20-F/40-F),
 *   3. undefined.
 * Never throws: any error in either lane degrades to the next lane / undefined.
 */
export async function resolveFundamentalsForTicker(
  ticker: string,
  deps: ResolveFundamentalsDeps = {},
): Promise<Fundamentals | undefined> {
  const local = deps.localProvider
    ?? new LocalManualFundamentalsProvider(deps.localStoreDir ?? DEFAULT_LOCAL_FUNDAMENTALS_DIR)
  try {
    const fromLocal = await local.resolve(ticker)
    if (fromLocal !== undefined) return fromLocal
  } catch {
    // fall through to EDGAR
  }

  const edgar = deps.edgarProvider
    ?? new EdgarFundamentalsProvider(deps.fetchEdgar ?? fetchCompanyFundamentals, deps.secDeps)
  try {
    return await edgar.resolve(ticker)
  } catch {
    return undefined
  }
}
