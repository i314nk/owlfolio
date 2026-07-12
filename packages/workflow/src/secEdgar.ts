// SEC EDGAR fundamentals feed.
//
// Pulls PRIMARY-filing data (structured XBRL companyfacts + the latest annual-report filing URL) for a
// company so the research swarm can ground on raw filings instead of dropping when IR/news is
// blocked. Mirrors marketData.ts conventions: injectable fetch, SSRF guard (here narrowed to the
// two SEC hosts), explicit timeouts, and FAIL-CLOSED behaviour — any error returns undefined and
// never throws to the caller, so the swarm runs exactly as today when EDGAR is unavailable.
//
// Taxonomy + currency: a US domestic filer reports under the `us-gaap` taxonomy in USD on a 10-K; a
// foreign private issuer (e.g. Novo Nordisk) reports under `ifrs-full` in its functional currency
// (e.g. DKK) on a 20-F (or 40-F for Canadian filers). This adapter reads whichever taxonomy is
// populated, detects the reporting CURRENCY from the XBRL unit key (e.g. 'USD', 'DKK'), and surfaces it
// on the result so a caller never silently mixes a non-USD fundamental with a USD price.
//
// Values are converted to Owlfolio's owner-earnings-bridge convention: monetary amounts -> MILLIONS of
// the REPORTING CURRENCY (/1e6), shares -> MILLIONS (/1e6). The `currency` field carries the unit.

import { assertPublicHttpUrl } from './sourceGrounding'

const SEC_ALLOWED_HOSTS = new Set(['www.sec.gov', 'data.sec.gov'])
const SEC_DEFAULT_TIMEOUT_MS = 15_000
const SEC_DEFAULT_USER_AGENT = 'Owlfolio research (local)'

export type SecEdgarDeps = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  userAgent?: string
}

/**
 * Reporting currency ISO code as carried by the XBRL unit key (e.g. 'USD', 'DKK', 'EUR'). Kept as a
 * plain string (not a closed union) so any ISO code an EDGAR filer uses round-trips; common values are
 * 'USD' for us-gaap filers and the functional currency for ifrs-full foreign private issuers.
 */
export type ReportingCurrency = string

export type AnnualFacts = {
  fiscal_year: number
  /** Reporting currency for the monetary fields (e.g. 'USD', 'DKK'). Shares are always counts. */
  currency: ReportingCurrency
  /**
   * The date (YYYY-MM-DD) the 10-K reporting this fiscal year was filed with the SEC — i.e. the date
   * an analyst would first have had this annual data. Derived from the NetIncomeLoss filed date for the
   * fiscal year's period end (the canonical income-statement fact). Used by the calibration backtest to
   * pick the latest filing available as-of each historical month-end. May be absent if no filed date was
   * attached to the underlying fact.
   */
  filed?: string
  /** Period END date (YYYY-MM-DD) of the fiscal year, when derivable from the income-statement fact. */
  period_end?: string
  net_income_musd?: number
  revenue_musd?: number
  d_and_a_musd?: number
  capex_musd?: number
  /**
   * Gross property, plant & equipment (instant, balance-sheet), $millions — us-gaap
   * `PropertyPlantAndEquipmentGross`. Drives the Greenwald maintenance-capex proxy (Phase 1.2):
   * maintenance capex ≈ capex − avg(gross PP&E / sales) × Δsales$. May be absent for filers that tag
   * only net PP&E (the proxy then degrades to the D&A floor).
   */
  gross_ppe_musd?: number
  sbc_musd?: number
  diluted_shares_m?: number
  /**
   * OPTION C (owner call, 2026-07-12): where the diluted share count came from. Absent = the normal
   * companyfacts concepts; 'inline_xbrl_class_a' = recovered from the annual report's inline XBRL
   * (a per-class filer whose share facts are all dimensioned — V-class). Display labels it.
   */
  diluted_shares_source?: 'inline_xbrl_class_a'
  shares_outstanding_m?: number
  total_debt_musd?: number
  cash_and_securities_musd?: number
  interest_expense_musd?: number
  /**
   * Itemized impermissible-income components (annual flows), $millions — the deterministic AAOIFI
   * purification inputs for the Shariah recompute (no filing discloses an "impermissible income" line;
   * the computable components are disclosed interest income, dividend income, and cash-instrument
   * investment income). Each line carries its XBRL concept + human label so the dossier SHOWS the
   * composition. Selection never double-counts: pure interest + separate dividend are itemized when
   * tagged; the combined interest-and-dividend variant is used ONLY when the pure concept is absent.
   * May be absent — the recompute then stays fail-closed UNDETERMINED.
   */
  impermissible_income_lines?: ImpermissibleIncomeLine[]
  /** Stockholders' equity (instant), $millions — for the invested-capital proxy. */
  stockholders_equity_musd?: number
  /**
   * Gross profit (annual flow), $millions — direct `GrossProfit`, else derived revenue − COGS for
   * years where BOTH sides are tagged (never fabricated from one side). Drives the standout moat
   * test's company-side gross-margin series. Absent → the test degrades to not-computable.
   */
  gross_profit_musd?: number
  /** Dividends paid (cash outflow, annual flow), $millions — payout discipline + retained-earnings test. */
  dividends_paid_musd?: number
  /** Net cash provided by operating activities (annual flow), $millions — the book's FCF = CFO − capex. */
  cfo_musd?: number
  /** Total current assets (instant), $millions — the current-ratio talent check. */
  current_assets_musd?: number
  /** Total current liabilities (instant), $millions — the current-ratio talent check. */
  current_liabilities_musd?: number
  /** Common-stock repurchases (cash outflow, annual flow), $millions — payout discipline. */
  buybacks_musd?: number
  /** Operating income/loss (annual flow), $millions — for the NOPAT proxy. */
  operating_income_musd?: number
  /** Income tax expense/benefit (annual flow), $millions — for the effective-tax-rate NOPAT proxy. */
  income_tax_expense_musd?: number
}

/** One itemized impermissible-income component: the XBRL concept it resolved from, a human label, $M. */
export type ImpermissibleIncomeLine = {
  concept: string
  label: string
  amount_musd: number
}

export type FilingRef = {
  form: string
  filed: string
  url: string
  /**
   * 8-K item codes as EDGAR reports them ('2.02,9.01'), straight from the submissions index — the
   * deterministic material-vs-routine signal (2.06 impairment vs 2.02 scheduled earnings). Absent for
   * non-8-K forms and for filings whose metadata lacks it.
   */
  items?: string
}

export type Fundamentals = {
  cik: string
  entity_name: string
  /**
   * Reporting currency for all monetary fields in `latest_annual`/`annual_series` (e.g. 'USD' for a
   * us-gaap 10-K filer, 'DKK' for an ifrs-full 20-F filer like Novo Nordisk). A caller that values the
   * fundamentals against a market price MUST use a price quoted in the SAME currency (see backtest's
   * price_currency caveat) — never mix a non-USD fundamental with a USD ADR price.
   */
  currency: ReportingCurrency
  latest_annual: AnnualFacts
  annual_series: AnnualFacts[]
  filings: FilingRef[]
  /**
   * Recent NON-annual readable filings (8-K material events + 10-Q quarterly reports, incl. amendments),
   * newest-first — the interim-recency layer (Slice B). Grounded + read by NARRATIVE only; their numbers
   * never enter `annual_series`/the recompute (the XBRL parse is annual-form-gated). Empty when none.
   */
  recent_filings?: FilingRef[]
  /**
   * Definitive annual proxy statements (DEF 14A only — no supplements/preliminaries/third-party
   * solicitations), newest-first. Grounded + read by NARRATIVE only (executive comp structure,
   * governance, insider ownership, related-party transactions); proxy numbers never enter the
   * recompute. Empty when none.
   */
  proxy_filings?: FilingRef[]
  /**
   * Insider ownership filings (Form 4 / 4/A) from the submissions index, newest-first — the LIST only
   * (cheap; no XML fetched here). secForm4.ts fetches and deterministically parses the selected subset in
   * the deep-dive phase (avoiding the per-document fetch cost on the quick screen). Empty when none.
   */
  form4_filings?: FilingRef[]
  /**
   * SEC Standard Industrial Classification code from the submissions endpoint (e.g. '7372'), when
   * present. Best-effort/fail-open: undefined when submissions are unavailable or omit it — never
   * fabricated. Reported verbatim (trimmed); not coerced or zero-padded.
   */
  sic?: string
  /** Human-readable SIC sector/industry label (e.g. 'Services-Prepackaged Software'), when present. */
  sic_description?: string
}

/** One year's owner-earnings per share, derived from the annual facts (gap-closing Phase 1.1). */
export type OwnerEarningsPerSharePoint = { fiscal_year: number; oe_ps: number }

/**
 * Per-year owner-earnings-per-share series for the demonstrated-growth input (Phase 1.2/1.3).
 *   OE/share = (net income + D&A − maintenance capex − SBC) / diluted shares
 * Maintenance capex here is the simple-floor proxy min(D&A, capex) (the Greenwald proxy is a separate
 * input). SBC is subtracted and the share count is the year's CURRENT diluted count, held flat (no
 * forward dilution projected) — so the dilution cost is counted ONCE (D-SBC). A year missing any
 * required field (net income, D&A, capex, diluted shares) or with non-positive shares is skipped
 * (fail-closed). Order of the input series is preserved.
 */
export function ownerEarningsPerShareSeries(series: AnnualFacts[]): OwnerEarningsPerSharePoint[] {
  const out: OwnerEarningsPerSharePoint[] = []
  for (const a of series) {
    const { net_income_musd: ni, d_and_a_musd: da, capex_musd: capex, diluted_shares_m: shares } = a
    if (![ni, da, capex, shares].every((v) => typeof v === 'number' && Number.isFinite(v))) continue
    if (!(shares! > 0)) continue
    const sbc = typeof a.sbc_musd === 'number' && Number.isFinite(a.sbc_musd) ? a.sbc_musd : 0
    const maintenanceCapex = Math.min(da!, capex!)
    const ownerEarnings = ni! + da! - maintenanceCapex - sbc
    out.push({ fiscal_year: a.fiscal_year, oe_ps: ownerEarnings / shares! })
  }
  return out
}

/** Per-year FCF per diluted share (the book basis: CFO − capex). Years missing any input are skipped. */
export function fcfPerShareSeries(series: AnnualFacts[]): OwnerEarningsPerSharePoint[] {
  const out: OwnerEarningsPerSharePoint[] = []
  for (const a of series) {
    const { cfo_musd: cfo, capex_musd: capex, diluted_shares_m: shares } = a
    if (![cfo, capex, shares].every((v) => typeof v === 'number' && Number.isFinite(v))) continue
    if (!(shares! > 0)) continue
    out.push({ fiscal_year: a.fiscal_year, oe_ps: (cfo! - capex!) / shares! })
  }
  return out
}

/**
 * Demonstrated historical owner-earnings-per-share growth (CAGR) — the honest, falsifiable near-recent-
 * history growth-path input (Buffett-Munger gap-closing Phase 1.3 / Part D Step 2). Computed from the
 * `ownerEarningsPerShareSeries` over the last ~10 fiscal years (a 5–10yr window). Returns undefined when
 * fewer than two usable points exist or the endpoints are non-positive (CAGR undefined → fail-closed).
 * The caller feeds this into `creditedGrowth`, which applies the named cap + the above-GDP coupling flag.
 */
export function ownerEarningsCagr(series: OwnerEarningsPerSharePoint[]): number | undefined {
  const sorted = [...series].sort((a, b) => a.fiscal_year - b.fiscal_year)
  const window = sorted.slice(-10)
  if (window.length < 2) return undefined
  const first = window[0]!
  const last = window[window.length - 1]!
  if (!(first.oe_ps > 0) || !(last.oe_ps > 0)) return undefined
  const years = last.fiscal_year - first.fiscal_year
  const n = years > 0 ? years : window.length - 1
  if (n <= 0) return undefined
  return Math.pow(last.oe_ps / first.oe_ps, 1 / n) - 1
}

/**
 * Result of the robust demonstrated owner-earnings-per-share growth measure (gap-closing Part D Step 2 —
 * "durability-justified historical owner-earnings growth"). `growth` is undefined (fail-closed) whenever the
 * measure could not be computed honestly (insufficient positive points / non-finite inputs).
 */
export type DemonstratedGrowthResult = {
  /** Robust OE/share CAGR as a fraction (e.g. 0.15 = 15%/yr); undefined = fail-closed. */
  growth?: number
  /** Which estimator produced the result. `insufficient_data` ⇒ `growth` is undefined. */
  method: 'log_linear_regression' | 'insufficient_data'
  /** Span (in years) of the points actually used: last_fy − first_fy after split-adjustment. */
  window_years: number
  /** Count of positive OE/share points fed to the regression. */
  points_used: number
  /** Human-readable notes: split adjustments applied, residual discontinuities, high dispersion, etc. */
  flags: string[]
}

/** Known split factors a per-share/share-count step is matched against (and their reverse-split reciprocals). */
const KNOWN_SPLIT_FACTORS = [1.5, 2, 3, 4, 5, 7, 10, 20]
/** Relative tolerance (±) for matching an observed share-ratio to a known split factor. */
const SPLIT_MATCH_TOLERANCE = 0.12
/** Net income must be roughly continuous across a split step: |NI[t]/NI[t-1] − 1| below this is "continuous". */
const SPLIT_NI_CONTINUITY_TOLERANCE = 0.5
/** A remaining year-over-year OE/share ratio at/above this (or its reciprocal) is a residual discontinuity. */
const RESIDUAL_DISCONTINUITY_RATIO = 2.5
/** Theil–Sen vs regression divergence (in fractional growth) above which a high_dispersion flag is added. */
const HIGH_DISPERSION_THRESHOLD = 0.1

/**
 * Match an observed share-count ratio (shares[t]/shares[t-1]) to a known split factor within tolerance.
 * Returns the canonical factor (>1 for a forward split, the integer for the magnitude) and the direction,
 * or undefined when no known factor matches. A forward split RAISES the share count (ratio > 1); a reverse
 * split LOWERS it (ratio < 1, matched against a reciprocal).
 */
function matchSplitFactor(ratio: number): { factor: number; forward: boolean } | undefined {
  if (!Number.isFinite(ratio) || ratio <= 0) return undefined
  for (const f of KNOWN_SPLIT_FACTORS) {
    // Forward split: shares roughly multiply by f.
    if (Math.abs(ratio / f - 1) <= SPLIT_MATCH_TOLERANCE) return { factor: f, forward: true }
    // Reverse split: shares roughly divide by f.
    if (Math.abs(ratio * f - 1) <= SPLIT_MATCH_TOLERANCE) return { factor: f, forward: false }
  }
  return undefined
}

/** Format a split factor for the flag note, e.g. "2-for-1" (forward) or "1-for-5" (reverse). */
function formatSplitFactor(factor: number, forward: boolean): string {
  return forward ? `${factor}-for-1` : `1-for-${factor}`
}

/** Ordinary least-squares slope of y vs x. Returns undefined when fewer than 2 points or zero x-variance. */
function olsSlope(points: { x: number; y: number }[]): number | undefined {
  const n = points.length
  if (n < 2) return undefined
  const meanX = points.reduce((s, p) => s + p.x, 0) / n
  const meanY = points.reduce((s, p) => s + p.y, 0) / n
  let num = 0
  let den = 0
  for (const p of points) {
    const dx = p.x - meanX
    num += dx * (p.y - meanY)
    den += dx * dx
  }
  if (!(den > 0)) return undefined
  return num / den
}

/** Theil–Sen median pairwise slope of y vs x (robust dispersion cross-check). Undefined if no pair. */
function theilSenSlope(points: { x: number; y: number }[]): number | undefined {
  const slopes: number[] = []
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j]!.x - points[i]!.x
      if (dx === 0) continue
      slopes.push((points[j]!.y - points[i]!.y) / dx)
    }
  }
  if (slopes.length === 0) return undefined
  slopes.sort((a, b) => a - b)
  const mid = Math.floor(slopes.length / 2)
  return slopes.length % 2 === 0 ? (slopes[mid - 1]! + slopes[mid]!) / 2 : slopes[mid]!
}

/**
 * Robust demonstrated owner-earnings-per-share growth (gap-closing Part D Step 2). Unlike the legacy
 * endpoint `ownerEarningsCagr` — which compounds first-vs-last and is whipsawed by a single outlier year —
 * this fits a LOG-LINEAR regression of ln(OE/share) vs fiscal year over ALL positive points in the trailing
 * window, so no single year can dominate. Before fitting it back-adjusts SPLIT-LIKE per-share discontinuities
 * (a known share-count step with roughly continuous net income) so a stock split does not masquerade as a
 * collapse/spike in OE/share; a large per-share discontinuity that is NOT split-like is left in place but
 * FLAGGED (`residual_discontinuity`) rather than silently dropped.
 *
 * Pure / deterministic / no network. Fail-closed: returns `method: 'insufficient_data'` with `growth`
 * undefined when fewer than three positive points exist or the inputs are non-finite/empty. Reuses
 * `ownerEarningsPerShareSeries` for the owner-earnings formula (never re-derives it).
 */
export function demonstratedOwnerEarningsGrowth(
  series: AnnualFacts[],
  opts?: { windowYears?: number; metric?: 'owner_earnings' | 'fcf' },
): DemonstratedGrowthResult {
  const windowYears = opts?.windowYears ?? 10
  const metric = opts?.metric ?? 'owner_earnings'
  const flags: string[] = []

  // Trailing window of the underlying AnnualFacts, ascending by fiscal year. We keep the AnnualFacts (not
  // just OE/share points) so we can back-adjust the share count for splits and recompute OE/share.
  const sortedFacts = [...series].sort((a, b) => a.fiscal_year - b.fiscal_year).slice(-windowYears)

  // ---- Split / per-share discontinuity adjustment -------------------------------------------------
  // Walk diluted_shares_m year-over-year. A split-like step = the share ratio matches a known split factor
  // AND net income is roughly continuous across the step (earnings did not jump proportionally). When found,
  // back-adjust the PRE-step share counts by the cumulative factor so the per-share series is continuous.
  // cumulativeFactor multiplies each pre-step year's shares so they are stated on the LATEST split basis.
  const adjustedFacts: AnnualFacts[] = sortedFacts.map((a) => ({ ...a }))
  // Process from the LATEST step backward so earlier years accumulate every later split.
  for (let t = adjustedFacts.length - 1; t >= 1; t--) {
    const cur = adjustedFacts[t]!
    const prev = adjustedFacts[t - 1]!
    const sCur = cur.diluted_shares_m
    const sPrev = prev.diluted_shares_m
    if (
      typeof sCur !== 'number' || !Number.isFinite(sCur) || sCur <= 0
      || typeof sPrev !== 'number' || !Number.isFinite(sPrev) || sPrev <= 0
    ) continue
    const ratio = sCur / sPrev
    const match = matchSplitFactor(ratio)
    if (match === undefined) continue
    // Net-income continuity check across the step (a real proportional earnings jump is NOT a split).
    const niCur = cur.net_income_musd
    const niPrev = prev.net_income_musd
    if (
      typeof niCur === 'number' && Number.isFinite(niCur)
      && typeof niPrev === 'number' && Number.isFinite(niPrev) && niPrev !== 0
    ) {
      if (Math.abs(niCur / niPrev - 1) > SPLIT_NI_CONTINUITY_TOLERANCE) continue
    } else {
      // Without comparable NI on both sides we cannot confirm continuity; do not adjust (fail-closed).
      continue
    }
    // Back-adjust every year STRICTLY BEFORE the step onto the post-step share basis. For a forward split
    // (ratio > 1) pre-step shares are multiplied UP by the factor; for a reverse split (ratio < 1) they are
    // divided DOWN (multiplied by 1/factor) so the per-share series is continuous across the step.
    const stepMultiplier = match.forward ? match.factor : 1 / match.factor
    for (let k = t - 1; k >= 0; k--) {
      const s = adjustedFacts[k]!.diluted_shares_m
      if (typeof s === 'number' && Number.isFinite(s)) {
        adjustedFacts[k] = { ...adjustedFacts[k]!, diluted_shares_m: s * stepMultiplier }
      }
    }
    flags.push(`split-adjusted ${formatSplitFactor(match.factor, match.forward)} at FY${cur.fiscal_year}`)
  }

  // Recompute the per-share metric on the (possibly split-adjusted) facts. E2: the 'fcf' metric is the
  // book basis (CFO − capex, per diluted share) — no maintenance-capex proxy anywhere in it.
  const pts = (metric === 'fcf' ? fcfPerShareSeries(adjustedFacts) : ownerEarningsPerShareSeries(adjustedFacts))
    .sort((a, b) => a.fiscal_year - b.fiscal_year)

  // ---- Residual (non-split) per-share discontinuity flag ------------------------------------------
  // After split-adjustment, a remaining large year-over-year OE/share jump on positive points is a genuine
  // discontinuity (operational, restatement, or an unmatched per-share step). Flag it — never drop silently.
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!.oe_ps
    const b = pts[i]!.oe_ps
    if (a > 0 && b > 0) {
      const r = b / a
      if (r >= RESIDUAL_DISCONTINUITY_RATIO || r <= 1 / RESIDUAL_DISCONTINUITY_RATIO) {
        flags.push(`residual_discontinuity at FY${pts[i]!.fiscal_year} (OE/share x${r.toFixed(2)} year-over-year)`)
      }
    }
  }

  // ---- Robust slope: log-linear regression over positive points ----------------------------------
  const positive = pts.filter((p) => Number.isFinite(p.oe_ps) && p.oe_ps > 0)
  if (positive.length < 3) {
    return { method: 'insufficient_data', growth: undefined as number | undefined, window_years: 0, points_used: positive.length, flags } as DemonstratedGrowthResult
  }
  const regPoints = positive.map((p) => ({ x: p.fiscal_year, y: Math.log(p.oe_ps) }))
  const slope = olsSlope(regPoints)
  const windowSpan = positive[positive.length - 1]!.fiscal_year - positive[0]!.fiscal_year
  if (slope === undefined || !Number.isFinite(slope)) {
    return { method: 'insufficient_data', growth: undefined as number | undefined, window_years: windowSpan, points_used: positive.length, flags } as DemonstratedGrowthResult
  }
  const growth = Math.exp(slope) - 1
  if (!Number.isFinite(growth)) {
    return { method: 'insufficient_data', growth: undefined as number | undefined, window_years: windowSpan, points_used: positive.length, flags } as DemonstratedGrowthResult
  }

  // Optional Theil–Sen cross-check: a large divergence from the regression signals a dispersed/noisy series.
  const ts = theilSenSlope(regPoints)
  if (ts !== undefined && Number.isFinite(ts)) {
    const tsGrowth = Math.exp(ts) - 1
    if (Math.abs(tsGrowth - growth) > HIGH_DISPERSION_THRESHOLD) {
      flags.push(`high_dispersion: Theil–Sen growth ${(tsGrowth * 100).toFixed(1)}% diverges from regression ${(growth * 100).toFixed(1)}%`)
    }
  }

  return {
    method: 'log_linear_regression',
    growth,
    window_years: windowSpan,
    points_used: positive.length,
    flags,
  }
}

/** Maintenance-capex estimate: the value (in the series' currency, $millions) and which proxy supplied it. */
export type MaintenanceCapexEstimate = {
  /** Estimated maintenance capex, $millions; undefined when neither proxy is computable (fail-closed). */
  maintenance_capex?: number
  /** Which proxy the (more-conservative) default selected. */
  basis: 'greenwald' | 'd_and_a_floor' | 'not_computable'
  /** The Greenwald proxy value ($M), when computable (gross PP&E + sales history present). */
  greenwald?: number
  /** The D&A-floor proxy value ($M), when computable. */
  d_and_a_floor?: number
  /** True when BOTH proxies computed — the only case where estimation DISPERSION can be measured. */
  both_computable: boolean
}

export const GROWTH_CAPEX_HEAVY_CAPEX_TO_DA_RATIO = 1.25
export const GROWTH_CAPEX_HEAVY_CAPEX_TO_MAINT_RATIO = 1.25

export type OwnerEarningsVsFcfDiagnostic = {
  role: 'fast_screen_only_owner_earnings_is_authority'
  valuation_authority: 'owner_earnings'
  total_capex_musd?: number
  d_and_a_musd?: number
  maintenance_capex_musd?: number
  capex_to_d_and_a?: number
  capex_to_maintenance_capex?: number
  growth_capex_heavy: boolean
  fcf_likely_understates_owner_economics: boolean
  flags: string[]
}

/**
 * Relative gap between the two maint-capex proxies above which their disagreement counts as genuine
 * estimation DISPERSION (review, pre-1.9). Calibration-adjacent but not a frozen valuation knob.
 */
export const MAINT_CAPEX_DISPERSION_THRESHOLD = 0.25

/**
 * Does the maintenance-capex estimate warrant a LOW-CONFIDENCE margin-of-safety widening (Phase 1.6 /
 * review "bite once")? TRUE only when BOTH proxies computed AND they disagree materially (relative gap >
 * MAINT_CAPEX_DISPERSION_THRESHOLD) — i.e. genuine estimation dispersion. It is deliberately FALSE for the
 * D&A-floor fallback caused by missing gross PP&E: that data-availability event ALREADY made the cash flow
 * conservative (the floor is the higher maint capex → lower owner earnings), so widening the MoS on top
 * would haircut the same single cause twice — exactly the stacking the one-knob design forbids.
 */
export function maintenanceCapexLowConfidence(series: AnnualFacts[]): boolean {
  const m = estimateMaintenanceCapex(series)
  if (!m.both_computable || m.greenwald === undefined || m.d_and_a_floor === undefined) return false
  const hi = Math.max(m.greenwald, m.d_and_a_floor)
  const lo = Math.min(m.greenwald, m.d_and_a_floor)
  if (!(hi > 0)) return false
  return (hi - lo) / hi > MAINT_CAPEX_DISPERSION_THRESHOLD
}

/**
 * Dual maintenance-capex proxy (Buffett-Munger gap-closing Phase 1.2 / Part D Step 1).
 *
 *   - Greenwald: growthCapex = avg(gross PP&E / sales over the series) × Δsales$ (latest year);
 *                maintenance capex = total capex − growthCapex (floored at 0).
 *   - D&A floor: maintenance capex ≈ D&A (defensible when the asset base isn't growing in real terms).
 *
 * DEFAULT = the MORE CONSERVATIVE of the two (the HIGHER maintenance capex → the LOWER owner earnings).
 * The agent must argue to use less. When gross PP&E (or sales history) is missing the Greenwald proxy is
 * not computable and the estimate degrades to the D&A floor; when neither is computable it fails closed
 * (`maintenance_capex` undefined, `basis: 'not_computable'`). Pure / no network — `series` is the EDGAR
 * `AnnualFacts[]` (any order; the latest fiscal year supplies the current-year capex/D&A/Δsales).
 */
export function estimateMaintenanceCapex(series: AnnualFacts[]): MaintenanceCapexEstimate {
  const finite = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
  // Latest fiscal year supplies current-year capex / D&A / sales.
  const sorted = [...series].sort((a, b) => a.fiscal_year - b.fiscal_year)
  const latest = sorted[sorted.length - 1]
  const prior = sorted[sorted.length - 2]

  // D&A floor (current year).
  const daFloor = latest !== undefined && finite(latest.d_and_a_musd) ? Math.max(0, latest.d_and_a_musd!) : undefined

  // Greenwald: avg(gross PP&E / sales) across the series × Δsales$ (latest), subtracted from total capex.
  let greenwald: number | undefined
  if (
    latest !== undefined
    && prior !== undefined
    && finite(latest.capex_musd)
    && finite(latest.revenue_musd)
    && finite(prior.revenue_musd)
  ) {
    const ratios: number[] = []
    for (const a of sorted) {
      if (finite(a.gross_ppe_musd) && finite(a.revenue_musd) && a.revenue_musd! > 0) {
        ratios.push(a.gross_ppe_musd! / a.revenue_musd!)
      }
    }
    if (ratios.length > 0) {
      const avgRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length
      const deltaSales = latest.revenue_musd! - prior.revenue_musd!
      const growthCapex = avgRatio * deltaSales
      greenwald = Math.max(0, latest.capex_musd! - growthCapex)
    }
  }

  // Expose both proxy values so the caller can measure estimation dispersion (review: "bite once").
  const both = greenwald !== undefined && daFloor !== undefined
  const proxies = {
    ...(greenwald !== undefined ? { greenwald } : {}),
    ...(daFloor !== undefined ? { d_and_a_floor: daFloor } : {}),
    both_computable: both,
  }
  if (greenwald !== undefined && daFloor !== undefined) {
    // More conservative = higher maintenance capex.
    return greenwald >= daFloor
      ? { maintenance_capex: greenwald, basis: 'greenwald', ...proxies }
      : { maintenance_capex: daFloor, basis: 'd_and_a_floor', ...proxies }
  }
  if (daFloor !== undefined) return { maintenance_capex: daFloor, basis: 'd_and_a_floor', ...proxies }
  if (greenwald !== undefined) return { maintenance_capex: greenwald, basis: 'greenwald', ...proxies }
  return { basis: 'not_computable', both_computable: false }
}

/**
 * FCF-vs-owner-earnings diagnostic for the automated fast screen.
 *
 * Owlfolio's valuation authority is owner earnings. This helper does NOT replace the OE bridge; it surfaces
 * when a reported-FCF/P-FCF calculator is probably conservative because total capex includes growth capex.
 */
/** E2 survivor: the purely FACTUAL capex-vs-D&A read — no maintenance-capex proxy, no assumptions. */
export type CapexVsDandANote = {
  total_capex_musd?: number
  d_and_a_musd?: number
  capex_to_d_and_a?: number
  /** capex ≥ 1.5× D&A — reported FCF likely understates steady-state owner economics for a grower. */
  growth_capex_heavy: boolean
  note: string
}

export function capexVsDandANote(latest: AnnualFacts | undefined): CapexVsDandANote {
  const finite = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
  const capex = finite(latest?.capex_musd) ? latest!.capex_musd : undefined
  const da = finite(latest?.d_and_a_musd) ? latest!.d_and_a_musd : undefined
  const ratio = capex !== undefined && da !== undefined && da > 0 ? capex / da : undefined
  const heavy = ratio !== undefined && ratio >= GROWTH_CAPEX_HEAVY_CAPEX_TO_DA_RATIO
  return {
    ...(capex !== undefined ? { total_capex_musd: capex } : {}),
    ...(da !== undefined ? { d_and_a_musd: da } : {}),
    ...(ratio !== undefined ? { capex_to_d_and_a: ratio } : {}),
    growth_capex_heavy: heavy,
    note: ratio === undefined
      ? 'capex vs D&A not computable (capex or D&A untagged) — cannot read the reinvestment mix.'
      : heavy
        ? `FACT: total capex is ${ratio.toFixed(1)}x D&A — a heavy reinvestment mix; reported FCF likely understates steady-state owner economics for a grower. Advisory only.`
        : `FACT: total capex is ${ratio.toFixed(1)}x D&A — a maintenance-weighted reinvestment mix.`,
  }
}

export function ownerEarningsVsFcfDiagnostic(
  latest: AnnualFacts | undefined,
  maintenanceCapex?: number,
): OwnerEarningsVsFcfDiagnostic {
  const flags: string[] = []
  const finite = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
  if (latest === undefined) {
    return {
      role: 'fast_screen_only_owner_earnings_is_authority',
      valuation_authority: 'owner_earnings',
      growth_capex_heavy: false,
      fcf_likely_understates_owner_economics: false,
      flags: ['fcf_screen_not_computable: no latest annual facts available; owner earnings remains authority'],
    }
  }

  const capex = finite(latest.capex_musd) ? latest.capex_musd : undefined
  const da = finite(latest.d_and_a_musd) ? latest.d_and_a_musd : undefined
  const maint = finite(maintenanceCapex) ? maintenanceCapex : undefined
  const capexToDa = capex !== undefined && da !== undefined && da > 0 ? capex / da : undefined
  const capexToMaint = capex !== undefined && maint !== undefined && maint > 0 ? capex / maint : undefined
  const growthCapexHeavy = Boolean(
    (capexToDa !== undefined && capexToDa >= GROWTH_CAPEX_HEAVY_CAPEX_TO_DA_RATIO)
    || (capexToMaint !== undefined && capexToMaint >= GROWTH_CAPEX_HEAVY_CAPEX_TO_MAINT_RATIO),
  )

  if (growthCapexHeavy) {
    flags.push(
      'growth_capex_heavy: total capex materially exceeds D&A and/or estimated maintenance capex; '
      + 'reported FCF/P-FCF likely understates owner economics and biases reverse-FCF implied growth high',
    )
  }
  if (capex === undefined || da === undefined) {
    flags.push('fcf_screen_incomplete: capex or D&A missing; cannot test whether total-capex FCF is a fair OE proxy')
  }

  return {
    role: 'fast_screen_only_owner_earnings_is_authority',
    valuation_authority: 'owner_earnings',
    ...(capex !== undefined ? { total_capex_musd: capex } : {}),
    ...(da !== undefined ? { d_and_a_musd: da } : {}),
    ...(maint !== undefined ? { maintenance_capex_musd: maint } : {}),
    ...(capexToDa !== undefined ? { capex_to_d_and_a: capexToDa } : {}),
    ...(capexToMaint !== undefined ? { capex_to_maintenance_capex: capexToMaint } : {}),
    growth_capex_heavy: growthCapexHeavy,
    fcf_likely_understates_owner_economics: growthCapexHeavy,
    flags,
  }
}

// ---------------------------------------------------------------------------
// SSRF guard narrowed to SEC hosts
// ---------------------------------------------------------------------------

function assertSecUrl(rawUrl: string): URL {
  const url = assertPublicHttpUrl(rawUrl)
  if (!SEC_ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`SEC URL host not allowed: ${url.hostname}`)
  }
  return url
}

function resolveUserAgent(deps?: SecEdgarDeps): string {
  return deps?.userAgent
    ?? process.env['OWLFOLIO_SEC_USER_AGENT']
    ?? SEC_DEFAULT_USER_AGENT
}

/**
 * Fetch a SEC JSON document. Returns undefined fail-closed on any guard/timeout/HTTP/parse error.
 */
async function fetchSecJson<T>(rawUrl: string, deps?: SecEdgarDeps): Promise<T | undefined> {
  let url: URL
  try {
    url = assertSecUrl(rawUrl)
  } catch {
    return undefined
  }
  const fetchFn = deps?.fetchImpl ?? fetch
  const timeoutMs = deps?.timeoutMs ?? SEC_DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const response = await fetchFn(url.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': resolveUserAgent(deps),
        'Accept': 'application/json',
      },
    })
    if (!response.ok) return undefined
    return (await response.json()) as T
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// 8-K exhibit discovery (the exhibit arc)
// ---------------------------------------------------------------------------

type AccessionIndex = { directory?: { item?: { name?: string }[] } }

/** An EX-99 exhibit document: 'costex9918-k121125.htm', 'ex99-1.htm', 'pressex991.htm', … */
const EXHIBIT_NAME = /ex.?-?99/i

/**
 * Discover the EX-99 press-release exhibits of an 8-K from its accession directory's index.json. The
 * 8-K PRIMARY document is usually an announcement cover — the earnings data (renewal rates,
 * comparable sales, margins) lives in the exhibits (live re-review find on COST). Returns up to two
 * absolute Archives URLs, 99.1-style names first (lexicographic on the ex-number region ≈ 99.1 before
 * 99.2). FAIL-CLOSED to [] on any guard/fetch/parse problem — the re-review then reads what it has.
 */
export async function discoverEightKExhibits(primaryDocUrl: string, deps?: SecEdgarDeps): Promise<string[]> {
  let dirUrl: string
  try {
    const url = assertSecUrl(primaryDocUrl)
    dirUrl = url.toString().replace(/\/[^/]*$/, '/')
  } catch {
    return []
  }
  const index = await fetchSecJson<AccessionIndex>(`${dirUrl}index.json`, deps)
  const items = index?.directory?.item
  if (!Array.isArray(items)) return []
  const primaryName = primaryDocUrl.slice(primaryDocUrl.lastIndexOf('/') + 1)
  return items
    .map((item) => item?.name)
    .filter((name): name is string => typeof name === 'string'
      && name !== primaryName
      && /\.html?$/i.test(name)
      && EXHIBIT_NAME.test(name))
    .sort()
    .slice(0, 2)
    .map((name) => `${dirUrl}${name}`)
}

// ---------------------------------------------------------------------------
// Ticker -> CIK
// ---------------------------------------------------------------------------

type CompanyTickersEntry = { cik_str?: number; ticker?: string; title?: string }
type CompanyTickers = Record<string, CompanyTickersEntry>

// Module-level cache for the (large-ish, slow-changing) ticker map. Keyed only by user agent so a
// test injecting a custom UA does not collide with the default. The injected fetch in tests bypasses
// the cache benefit but correctness is unaffected.
let tickerCache: CompanyTickers | undefined

function padCik(cik: number | string): string {
  const digits = String(cik).replace(/\D/g, '')
  return digits.padStart(10, '0')
}

/**
 * Resolve a ticker to a zero-padded 10-digit CIK using SEC's company_tickers.json.
 * Fail-closed: returns undefined for an unknown/non-US ticker or any fetch error.
 */
export async function resolveCik(ticker: string, deps?: SecEdgarDeps): Promise<string | undefined> {
  const wanted = ticker.trim().toUpperCase()
  if (wanted.length === 0) return undefined

  let map = tickerCache
  if (map === undefined) {
    map = await fetchSecJson<CompanyTickers>('https://www.sec.gov/files/company_tickers.json', deps)
    if (map === undefined) return undefined
    tickerCache = map
  }

  for (const entry of Object.values(map)) {
    if (typeof entry?.ticker === 'string' && entry.ticker.toUpperCase() === wanted && entry.cik_str !== undefined) {
      return padCik(entry.cik_str)
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// companyfacts parsing
// ---------------------------------------------------------------------------

type XbrlFact = {
  start?: string
  end?: string
  val?: number
  fy?: number
  fp?: string
  form?: string
  filed?: string
}

type TaxonomyConcepts = Record<string, { units?: Record<string, XbrlFact[]> }>

type CompanyFacts = {
  cik?: number
  entityName?: string
  facts?: {
    'us-gaap'?: TaxonomyConcepts
    'ifrs-full'?: TaxonomyConcepts
  }
}

/**
 * SEC XBRL taxonomies this adapter reads. A US domestic filer populates `us-gaap`; a foreign private
 * issuer populates `ifrs-full`. We prefer whichever is non-empty.
 */
type Taxonomy = 'us-gaap' | 'ifrs-full'

/** Annual-report form types we treat as the primary annual filing (10-K US, 20-F / 40-F foreign). */
const ANNUAL_FORMS = new Set(['10-K', '20-F', '40-F'])

function isAnnualForm(form: string | undefined): boolean {
  return typeof form === 'string' && ANNUAL_FORMS.has(form)
}

/** Non-annual filings whose NARRATIVE is grounded + readable for interim recency (Slice B). 6-K is the
 * foreign-private-issuer interim/material-event equivalent of 8-K/10-Q — a heavy foreign filer emits
 * many 6-Ks, but the filed-after-latest-annual anchor + the selection cap bound the grounding cost. */
const RECENT_READABLE_FORMS = new Set(['8-K', '8-K/A', '10-Q', '10-Q/A', '6-K', '6-K/A'])

function isRecentReadableForm(form: string | undefined): boolean {
  return typeof form === 'string' && RECENT_READABLE_FORMS.has(form)
}

/**
 * The definitive annual proxy statement — EXACTLY 'DEF 14A'. Deliberately excluded: DEFA14A
 * (supplemental soliciting material/ads, not the proxy), PRE 14A (preliminary, superseded by the DEF),
 * PX14A6G (THIRD-PARTY exempt solicitations — activist letters; grounding those as "the company's
 * proxy" would poison the management lane with adversarial outside material), DEFM14A (merger
 * proxies — special-purpose) and DEFR14A (revised; rare). A miss fails closed to "no proxy grounded".
 */
const PROXY_FORMS = new Set(['DEF 14A'])

function isProxyForm(form: string | undefined): boolean {
  return typeof form === 'string' && PROXY_FORMS.has(form)
}

/** Insider ownership statements of changes — Form 4 (and its amendment 4/A). Section 16 officers,
 * directors, and 10% owners must file within two business days of a transaction; the XML is parsed
 * deterministically by secForm4.ts (never grounded as narrative). A miss fails closed to "no insider data". */
const FORM_4_FORMS = new Set(['4', '4/A'])

function isForm4(form: string | undefined): boolean {
  return typeof form === 'string' && FORM_4_FORMS.has(form)
}

/** True when a taxonomy bucket has at least one concept with data. */
function taxonomyPopulated(t: TaxonomyConcepts | undefined): boolean {
  return t !== undefined && Object.keys(t).length > 0
}

/**
 * Latest annual-form (10-K/20-F/40-F) period-END date carried by ANY concept in a taxonomy bucket — used
 * to decide which taxonomy is the filer's CURRENT reporting basis. Returns '' when the bucket has no annual
 * fact. (A filer that converted reporting bases — e.g. Toyota, whose us-gaap facts freeze at FY2020 while its
 * ifrs-full facts run to FY2025 — must be read from the taxonomy with the more recent data, not whichever is
 * merely non-empty.)
 */
function latestAnnualEnd(bucket: TaxonomyConcepts | undefined): string {
  if (bucket === undefined) return ''
  let latest = ''
  for (const concept of Object.values(bucket)) {
    for (const facts of Object.values(concept.units ?? {})) {
      if (!Array.isArray(facts)) continue
      for (const f of facts) {
        if (isAnnualForm(f.form) && typeof f.end === 'string' && f.end > latest) latest = f.end
      }
    }
  }
  return latest
}

/**
 * Pick the filer's CURRENT reporting taxonomy. us-gaap is canonical for US domestic filers (who may carry a
 * few stray ifrs-full tags), so prefer it when its annual data is at least as RECENT as ifrs-full's. But when
 * ifrs-full carries materially newer annual data (the filer converted bases — Toyota's us-gaap froze at FY2020,
 * ifrs-full runs to FY2025), pick ifrs-full so the latest-annual is current rather than five years stale.
 * Returns undefined when neither taxonomy has data.
 */
function pickTaxonomy(facts: CompanyFacts): Taxonomy | undefined {
  const usGaap = facts.facts?.['us-gaap']
  const ifrs = facts.facts?.['ifrs-full']
  const usPopulated = taxonomyPopulated(usGaap)
  const ifrsPopulated = taxonomyPopulated(ifrs)
  if (usPopulated && ifrsPopulated) {
    // Prefer the taxonomy with the more recent annual data; ties (or us-gaap newer) keep us-gaap.
    return latestAnnualEnd(ifrs) > latestAnnualEnd(usGaap) ? 'ifrs-full' : 'us-gaap'
  }
  if (usPopulated) return 'us-gaap'
  if (ifrsPopulated) return 'ifrs-full'
  return undefined
}

const NON_CURRENCY_UNITS = new Set(['shares', 'pure'])

/**
 * Detect the reporting currency from a concept's unit map: the first unit key that is not a count/ratio
 * unit (e.g. 'USD', 'DKK', 'EUR'). Returns undefined when only share/pure units are present.
 */
function currencyFromUnitMap(unitMap: Record<string, XbrlFact[]> | undefined): ReportingCurrency | undefined {
  if (unitMap === undefined) return undefined
  for (const unit of Object.keys(unitMap)) {
    if (!NON_CURRENCY_UNITS.has(unit)) return unit
  }
  return undefined
}

/**
 * Detect the filer's reporting currency by scanning the income/revenue concepts of the chosen taxonomy
 * for the first monetary unit key. Fail-closed: defaults to 'USD' only as a last resort so a us-gaap
 * filer with an oddly-shaped facts blob still behaves as today.
 */
function detectCurrency(facts: CompanyFacts, taxonomy: Taxonomy): ReportingCurrency {
  const concepts = taxonomy === 'us-gaap'
    ? ['NetIncomeLoss', 'Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax']
    : ['ProfitLoss', 'Revenue']
  const bucket = facts.facts?.[taxonomy]
  for (const c of concepts) {
    const cur = currencyFromUnitMap(bucket?.[c]?.units)
    if (cur !== undefined) return cur
  }
  return 'USD'
}

const ONE_DAY_MS = 86_400_000
// An annual flow period must span ~a year. Comparative income statements in a single 10-K are tagged
// with the FILING's fy/fp (e.g. fy:2025, fp:FY) for all three years shown, so we cannot trust fy/fp to
// identify the period — we derive the fiscal year from the period END date and use the START→END
// duration to keep only full-year (not quarterly/YTD) flow entries. Instant (balance-sheet) facts
// have no `start` and are kept as-is, keyed by their `end` date.
const ANNUAL_MIN_DAYS = 300
const ANNUAL_MAX_DAYS = 400

function periodDays(start: string, end: string): number | undefined {
  const s = Date.parse(start)
  const e = Date.parse(end)
  if (!Number.isFinite(s) || !Number.isFinite(e)) return undefined
  return (e - s) / ONE_DAY_MS
}

/**
 * For a us-gaap concept, return a map of fiscal_year -> raw value. The fiscal year is derived from the
 * period END date's calendar year (SEC reports the period a fact covers via `end`); flow concepts are
 * filtered to ~annual durations so quarterly/YTD comparatives are excluded. When multiple filings
 * report the same period END (restatements / re-filings), the entry with the LATEST `filed` date wins.
 */
function annualByFiscalYear(facts: CompanyFacts, taxonomy: Taxonomy, concept: string): Map<number, number> {
  const out = new Map<number, number>()
  const unitMap = facts.facts?.[taxonomy]?.[concept]?.units
  if (unitMap === undefined) return out
  // pick the first unit bucket (the reporting currency or shares — each concept has a single relevant unit)
  const entries: XbrlFact[] = []
  for (const bucket of Object.values(unitMap)) {
    if (Array.isArray(bucket)) entries.push(...bucket)
  }

  // end-date -> {val, filed}; latest filed wins for a given period end.
  const byEnd = new Map<string, { val: number; filed: string }>()
  for (const e of entries) {
    if (!isAnnualForm(e.form)) continue
    if (typeof e.end !== 'string' || typeof e.val !== 'number' || !Number.isFinite(e.val)) continue
    // Flow facts have a start; require an annual duration. Instant facts have no start; keep them.
    if (typeof e.start === 'string') {
      const days = periodDays(e.start, e.end)
      if (days === undefined || days < ANNUAL_MIN_DAYS || days > ANNUAL_MAX_DAYS) continue
    }
    const filed = typeof e.filed === 'string' ? e.filed : ''
    const prior = byEnd.get(e.end)
    if (prior === undefined || filed > prior.filed) {
      byEnd.set(e.end, { val: e.val, filed })
    }
  }

  // Collapse period ends to fiscal years (year of the END date). If two period ends fall in the same
  // calendar year (rare — fiscal-period shifts), keep the later end date.
  const latestEndForYear = new Map<number, string>()
  for (const end of byEnd.keys()) {
    const fy = new Date(end).getUTCFullYear()
    const prior = latestEndForYear.get(fy)
    if (prior === undefined || end > prior) latestEndForYear.set(fy, end)
  }
  for (const [fy, end] of latestEndForYear) {
    const v = byEnd.get(end)
    if (v !== undefined) out.set(fy, v.val)
  }
  return out
}

/**
 * For a us-gaap flow concept, return a map of fiscal_year -> { filed, period_end } — the FIRST-disclosure
 * filing date and period END for that fiscal year. The availability date must be when an analyst FIRST had
 * the annual number (the original 10-K/20-F), NOT the latest comparative: a 10-K restates 2–3 prior years
 * as comparatives, so latest-filed-wins would tag every fiscal year with a filing ~2–3 years too late and
 * make the as-of backtest value each month on stale fundamentals. So we take the EARLIEST annual-form filed
 * date per period end (first disclosure). (The VALUE in annualByFiscalYear still takes latest-filed = the
 * most-restated number; only the availability DATE is first-disclosure.)
 */
function annualFiledMetaByFiscalYear(
  facts: CompanyFacts,
  taxonomy: Taxonomy,
  concept: string,
): Map<number, { filed: string; period_end: string }> {
  const out = new Map<number, { filed: string; period_end: string }>()
  const unitMap = facts.facts?.[taxonomy]?.[concept]?.units
  if (unitMap === undefined) return out
  const entries: XbrlFact[] = []
  for (const bucket of Object.values(unitMap)) {
    if (Array.isArray(bucket)) entries.push(...bucket)
  }

  const byEnd = new Map<string, { filed: string }>()
  for (const e of entries) {
    if (!isAnnualForm(e.form)) continue
    if (typeof e.end !== 'string' || typeof e.val !== 'number' || !Number.isFinite(e.val)) continue
    if (typeof e.start === 'string') {
      const days = periodDays(e.start, e.end)
      if (days === undefined || days < ANNUAL_MIN_DAYS || days > ANNUAL_MAX_DAYS) continue
    }
    const filed = typeof e.filed === 'string' ? e.filed : ''
    if (filed === '') continue // need a real first-disclosure date
    const prior = byEnd.get(e.end)
    if (prior === undefined || filed < prior.filed) {
      byEnd.set(e.end, { filed }) // EARLIEST annual-form filing that reported this period end (first disclosure)
    }
  }

  const latestEndForYear = new Map<number, string>()
  for (const end of byEnd.keys()) {
    const fy = new Date(end).getUTCFullYear()
    const prior = latestEndForYear.get(fy)
    if (prior === undefined || end > prior) latestEndForYear.set(fy, end)
  }
  for (const [fy, end] of latestEndForYear) {
    const v = byEnd.get(end)
    if (v !== undefined && v.filed !== '') out.set(fy, { filed: v.filed, period_end: end })
  }
  return out
}

const CURRENCY_TO_MILLIONS = 1e6
const SHARES_TO_M = 1e6

function toMusd(raw: number | undefined): number | undefined {
  return raw === undefined ? undefined : raw / CURRENCY_TO_MILLIONS
}

function toMshares(raw: number | undefined): number | undefined {
  return raw === undefined ? undefined : raw / SHARES_TO_M
}

/**
 * Sum two optional raw-$ concepts, returning undefined only if BOTH are absent.
 * (e.g. total debt = long-term noncurrent + long-term current; either may be missing.)
 */
function sumOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined
  return (a ?? 0) + (b ?? 0)
}

/**
 * Per-taxonomy concept name mapping. Each OE-bridge / incremental-ROIC input maps to a list of candidate
 * concept names tried in order (first populated wins). Some inputs are summed across multiple concepts
 * (handled explicitly in buildAnnualSeries, not here): total debt, cash+securities, capex (PPE + intangibles).
 */
type ConceptMap = {
  /**
   * Net income, PRECEDENCE-ORDERED then latest-fiscal-year-preferring. `NetIncomeLoss` (income attributable
   * to the PARENT for a us-gaap filer) is tried first so a filer reporting both it and `ProfitLoss` (which
   * INCLUDES noncontrolling interest — e.g. Exxon) keeps the parent figure. Filers that froze `NetIncomeLoss`
   * mid-history and now tag the bottom line only under `ProfitLoss`/`...AvailableToCommonStockholdersBasic`
   * (e.g. Mastercard, Caterpillar) resolve via the later-year fallback.
   */
  netIncome: ConceptGroup[]
  revenue: ConceptGroup[]
  dAndA: ConceptGroup[]
  /** Capex candidate groups (PPE purchases, or summed PPE + intangible purchases for IFRS). */
  capex: ConceptGroup[]
  sbc: ConceptGroup[]
  dilutedShares: ConceptGroup[]
  /**
   * Diluted EPS candidate groups: used ONLY to DERIVE the weighted-average diluted-share count
   * (net_income / diluted_EPS) for years the weighted-average concept omits — recovering the per-share
   * denominator across a concept transition without overwriting a genuinely tagged share count.
   */
  dilutedEps: ConceptGroup[]
  sharesOut: string[]
  /** Total interest-bearing debt: prefer the first combined concept; else sum the rest. */
  debtCombined: string[]
  debtComponents: string[]
  /**
   * Last-resort interest-bearing debt when neither the combined rollup nor the LT/ST components are
   * present (e.g. a filer that repaid its term loan and carries only finance-lease liabilities). Tried
   * in order, first populated wins — kept SEPARATE from debtComponents so it is never summed on top of a
   * real debt figure (no double-count). Used only when debtCombined and debtComponents are both empty.
   */
  debtFallback: string[]
  cash: string[]
  shortTermInvestments: string[]
  /**
   * Impermissible-income components (Shariah purification inputs), each PRECEDENCE-ORDERED per year.
   * `interest` (pure interest income) and `dividend` are itemized side by side when tagged; `combined`
   * (interest-and-dividend rollups) is used ONLY for years the pure interest concept does not report —
   * it already contains dividends, so it is never stacked on the itemized lines (no double-count).
   * Absent per year degrades gracefully (recompute stays fail-closed UNDETERMINED).
   */
  impermissibleIncome: { interest: string[]; dividend: string[]; combined: string[] }
  interest: string
  stockholdersEquity: string[]
  operatingIncome: string
  incomeTax: string
  /** Gross PP&E (instant) — for the Greenwald maintenance-capex proxy (Phase 1.2). Empty when unmapped. */
  grossPpe: string[]
  /** Gross profit (annual flow) — direct concept; per-year fallback derives revenue − COGS. */
  grossProfit: string[]
  /** Cost of revenue/goods-sold variants, for the derived gross-profit fallback ONLY. */
  costOfRevenue: string[]
  /** Dividends paid (cash outflow), per-year precedence: common-stock concept first, combined fills gaps. */
  dividendsPaid: string[]
  /** Common-stock repurchases (cash outflow). */
  buybacks: string[]
  /** Net cash from operating activities (annual flow) — precedence-ordered per year. */
  cfo: string[]
  /** Total current assets (instant). */
  currentAssets: string[]
  /** Total current liabilities (instant). */
  currentLiabilities: string[]
}

const US_GAAP_CONCEPTS: ConceptMap = {
  // Net income attributable to the parent first (`NetIncomeLoss`); `ProfitLoss` / the available-to-common
  // variants are per-year fallbacks for filers that froze `NetIncomeLoss` (Mastercard's stops FY2013,
  // Caterpillar's FY2010) — the frozen concept drops out of later years, so per-year precedence keeps Exxon
  // (which reports both) on the parent figure while resolving the frozen filers' current years from the fallback.
  netIncome: [
    'NetIncomeLoss',
    'NetIncomeLossAvailableToCommonStockholdersBasic',
    'ProfitLoss',
  ],
  // Revenue is PRECEDENCE-ORDERED and resolved PER YEAR. Many filers (e.g. Copart) report the full-company
  // top line under RevenueFromContractWithCustomer*AssessedTax and tag `Revenues` only with a disaggregated
  // sub-line (Copart's `Revenues` carries a 525M Q4 partial — filtered out by the annual-duration guard).
  // Trying the ASC-606 contract-revenue concepts FIRST — Excluding (Costco's variant) then Including
  // (Copart's) — lands on the canonical full-year figure for those filers' years; but where the contract
  // concept was DISCONTINUED and only `Revenues` carries the later years (Alphabet/NVIDIA/Exxon/Mastercard
  // tag the consolidated total under `Revenues` and froze the contract concept years ago), per-year
  // precedence resolves those later years from `Revenues` while the contract concept still supplies the
  // EARLIER years — so the annual series spans the full union across the concept transition (the GOOGL fix).
  // (For Costco where Excluding and Revenues both report the same year+value, precedence keeps Excluding.)
  revenue: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
    'SalesRevenueServicesNet',
    'SalesRevenueGoodsNet',
  ],
  // D&A: the canonical combined cash-flow concepts first; then the split (Depreciation + amortization of
  // intangibles) SUMMED, for filers (Microsoft, Alphabet) that tag only the components. Latest-year
  // preference fixes Walmart, whose `DepreciationDepletionAndAmortization` froze FY2019 and is superseded by
  // `DepreciationAmortizationAndAccretionNet`.
  dAndA: [
    'DepreciationDepletionAndAmortization',
    'DepreciationAmortizationAndAccretionNet',
    'DepreciationAndAmortization',
    { sum: ['Depreciation', 'AmortizationOfIntangibleAssets'] },
  ],
  // Capex: PP&E purchases first; then `PaymentsToAcquireProductiveAssets` (NVIDIA/Visa tag capex here, not
  // under the PP&E concept); then REIT real-estate-acquisition variants (Realty Income) summed with capital
  // improvements. Latest-year preference keeps Exxon on the PP&E concept (current) over stale alternatives.
  capex: [
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'PaymentsToAcquireProductiveAssets',
    { sum: ['PaymentsToAcquireCommercialRealEstate', 'PaymentsForCapitalImprovements'], requireFirst: true },
    'PaymentsToAcquireRealEstate',
  ],
  // SBC: `ShareBasedCompensation` first; `AllocatedShareBasedCompensationExpense` is the variant Walmart and
  // Caterpillar tag (the bare concept is absent for them). Both carry the same full-company expense.
  sbc: [
    'ShareBasedCompensation',
    'AllocatedShareBasedCompensationExpense',
  ],
  // Diluted weighted-average shares first; basic is a latest-year fallback for filers that stopped tagging the
  // diluted count (Exxon tags only the basic concept in recent years; basic ≈ diluted for a low-dilution filer).
  dilutedShares: [
    'WeightedAverageNumberOfDilutedSharesOutstanding',
    'WeightedAverageNumberOfSharesOutstandingBasic',
  ],
  // Diluted EPS, to derive the weighted-average diluted share count for years the share concept omits
  // (Alphabet tags weighted-average shares only from FY2022 but diluted EPS spans the full 10-K history).
  dilutedEps: ['EarningsPerShareDiluted', 'EarningsPerShareBasic'],
  sharesOut: ['CommonStockSharesOutstanding'],
  // Debt: prefer the combined rollup (LongTermDebt = total carrying amount, or the LT+ST combined amount);
  // else sum the noncurrent + current components; else fall back to lease/short-term-borrowing concepts for
  // a filer carrying no traditional notes (Copart's only interest-bearing liability is a finance lease).
  debtCombined: ['LongTermDebt', 'DebtLongtermAndShorttermCombinedAmount'],
  debtComponents: ['LongTermDebtNoncurrent', 'LongTermDebtCurrent'],
  debtFallback: ['LongTermDebtAndCapitalLeaseObligations', 'FinanceLeaseLiability', 'ShortTermBorrowings'],
  // Cash: the canonical balance-sheet line first; then the GAAP cash-flow total (cash + restricted cash),
  // which is the only instant cash fact some filers tag in recent years (Copart discontinued the carrying-
  // value tag after FY2019). Restricted cash is immaterial for these filers, so the total is a safe proxy.
  cash: [
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
  ],
  // Short-term securities added to cash: current marketable instruments, plus held-to-maturity / available-
  // for-sale securities for filers (e.g. Copart) that park near-cash in HTM/AFS rather than ShortTermInvestments.
  shortTermInvestments: [
    'ShortTermInvestments',
    'MarketableSecuritiesCurrent',
    'AvailableForSaleSecuritiesCurrent',
    'DebtSecuritiesHeldToMaturityAmortizedCostAfterAllowanceForCreditLoss',
  ],
  // Impermissible-income components: pure interest + separate dividend itemized when tagged; MSFT tags
  // the combined interest-and-dividend variant (dividends included = conservative overcount, accepted)
  // — used only when the pure concept is absent; the operating variant is a last-resort (financials-
  // adjacent filers). InterestIncomeOther covers GOOGL-class filers that tag gross interest separately.
  // Broadened combined set covers SPGI (InvestmentIncomeNet), COST (InvestmentIncomeNonoperating),
  // V (InterestAndDividendIncomeSecurities). Excluded concepts (never added here):
  //   - Nets like InterestIncomeExpenseNet / InterestIncomeExpenseNonoperatingNet: income minus expense,
  //     can be negative, would understate purification obligation.
  //   - Over-broad blends like InterestAndOtherIncome / OtherIncome / OtherNonoperatingIncomeExpense:
  //     mix permissible income → overstate purification (Shariah accuracy principle).
  impermissibleIncome: {
    interest: ['InvestmentIncomeInterest', 'InterestIncomeOther'],
    dividend: ['InvestmentIncomeDividend'],
    combined: [
      'InvestmentIncomeInterestAndDividend',
      'InterestAndDividendIncomeOperating',
      'InterestAndDividendIncomeSecurities',
      'InvestmentIncomeNet',
      'InvestmentIncomeNonoperating',
    ],
  },
  interest: 'InterestExpense',
  // Equity: parent-only preferred; the NCI-inclusive variant is the fallback for filers that stopped
  // tagging the parent-only concept (V's last parent-only year is FY2011 — without the fallback the
  // ROIC series is empty and the capital-efficiency test + talent T0 die on a 16-year-tagged filer).
  stockholdersEquity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  operatingIncome: 'OperatingIncomeLoss',
  incomeTax: 'IncomeTaxExpenseBenefit',
  // Gross PP&E (instant): the canonical gross carrying amount first; then the gross-before-accumulated-
  // depreciation variant some filers tag. Net PP&E is intentionally NOT used (the Greenwald proxy needs
  // gross). Absent → Greenwald degrades to the D&A floor.
  grossPpe: ['PropertyPlantAndEquipmentGross', 'PropertyPlantAndEquipmentGrossExcludingCapitalizedComputerSoftwareCosts'],
  // Gross profit: the direct income-statement concept; filers that tag only revenue + COGS resolve via
  // the derived revenue − COGS fallback in buildAnnualSeries (both sides required per year).
  grossProfit: ['GrossProfit'],
  costOfRevenue: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'],
  // Dividends: the common-stock concept first (parent-only); the combined `PaymentsOfDividends`
  // (may include preferred/NCI — a documented conservative overcount for the payout view) fills
  // years the specific concept omits.
  dividendsPaid: ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends'],
  buybacks: ['PaymentsForRepurchaseOfCommonStock'],
  // CFO: the canonical total first; the continuing-operations variant fills years for filers that
  // tag only it (mirrors the debt-rollup precedence pattern).
  cfo: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  currentAssets: ['AssetsCurrent'],
  currentLiabilities: ['LiabilitiesCurrent'],
}

// IFRS (ifrs-full) equivalents for a foreign private issuer's 20-F/40-F. Mapped per the probe of Novo
// Nordisk's companyfacts; concepts that may be absent for other filers degrade gracefully (-> undefined).
const IFRS_CONCEPTS: ConceptMap = {
  netIncome: ['ProfitLoss'],
  revenue: ['Revenue', 'RevenueFromContractsWithCustomers'],
  // prefer the combined D&A expense; then the cash-flow add-back (`AdjustmentsFor...`, which SAP/Toyota tag);
  // then the impairment-inclusive combined concept.
  dAndA: [
    'DepreciationAndAmortisationExpense',
    'AdjustmentsForDepreciationAndAmortisationExpense',
    'DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss',
  ],
  // capex: Novo-style PP&E + intangible purchases SUMMED first; then SAP's single combined PP&E+intangibles+
  // other-noncurrent-assets concept. (Toyota tags no clean PP&E-purchase cash-flow concept under ifrs-full —
  // an honest miss rather than mislabelling `AdditionsToNoncurrentAssets`, which folds in leased vehicles.)
  capex: [
    { sum: ['PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', 'PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities'], requireFirst: true },
    'PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets',
  ],
  // SBC: Novo's employee-share-payment expense first; SAP tags the bottom-line share-based expense under the
  // longer `ExpenseFromSharebasedPaymentTransactionsInWhichGoodsOrServicesReceivedDidNotQualifyForRecognitionAsAssets`
  // (and the equivalent cash-flow add-back `AdjustmentsForSharebasedPayments`). Latest-year preference fixes SAP.
  sbc: [
    'ExpenseFromSharebasedPaymentTransactionsWithEmployees',
    'ExpenseFromSharebasedPaymentTransactionsInWhichGoodsOrServicesReceivedDidNotQualifyForRecognitionAsAssets',
    'AdjustmentsForSharebasedPayments',
  ],
  // IFRS reports a basic (WeightedAverageShares) and a diluted (AdjustedWeightedAverageShares) count.
  dilutedShares: ['AdjustedWeightedAverageShares', 'WeightedAverageShares'],
  // IFRS diluted EPS, to derive the diluted-share count for years the weighted-average concept omits.
  dilutedEps: ['DilutedEarningsLossPerShare', 'BasicEarningsLossPerShare'],
  sharesOut: ['NumberOfSharesOutstanding'],
  // Total interest-bearing debt: prefer the single Borrowings rollup; else sum the LT/ST components.
  debtCombined: ['Borrowings'],
  debtComponents: ['LongtermBorrowings', 'ShorttermBorrowings'],
  // IFRS filers in scope report borrowings explicitly; no lease-only fallback needed yet.
  debtFallback: [],
  cash: ['CashAndCashEquivalents'],
  shortTermInvestments: [],
  // IFRS impermissible-income best-effort: pure interest concepts only (no reliable dividend/combined
  // concepts mapped yet — `FinanceIncome` folds in FX gains and would overcount noisily). Absent for a
  // given filer → degrades to fail-closed UNDETERMINED, exactly like a missing us-gaap tag.
  impermissibleIncome: {
    interest: ['InterestIncome', 'InterestRevenueCalculatedUsingEffectiveInterestMethod'],
    dividend: [],
    combined: [],
  },
  interest: 'InterestExpense',
  stockholdersEquity: ['Equity'],
  operatingIncome: 'ProfitLossFromOperatingActivities',
  incomeTax: 'IncomeTaxExpenseContinuingOperations',
  // IFRS gross PP&E (instant) best-effort: the gross cost-model carrying amount. Absent for many IFRS
  // filers (they disclose only net PP&E on the face) → Greenwald degrades to the D&A floor.
  grossPpe: ['PropertyPlantAndEquipmentGrossCarryingAmount', 'GrossCarryingAmountPropertyPlantAndEquipment'],
  // IFRS payout/gross-profit best-effort (per the ifrs-full taxonomy's cash-flow examples); absent
  // for a given filer → undefined, downstream degrades to not-computable exactly like grossPpe.
  grossProfit: ['GrossProfit'],
  costOfRevenue: ['CostOfSales'],
  dividendsPaid: ['DividendsPaidClassifiedAsFinancingActivities', 'DividendsPaid'],
  buybacks: ['PaymentsToAcquireOrRedeemEntitysShares'],
  cfo: ['CashFlowsFromUsedInOperatingActivities'],
  currentAssets: ['CurrentAssets'],
  currentLiabilities: ['CurrentLiabilities'],
}

function conceptMapFor(taxonomy: Taxonomy): ConceptMap {
  return taxonomy === 'ifrs-full' ? IFRS_CONCEPTS : US_GAAP_CONCEPTS
}

/** First concept in the candidate list whose annual map is non-empty (else an empty map). */
function firstPopulated(facts: CompanyFacts, taxonomy: Taxonomy, concepts: string[]): Map<number, number> {
  for (const c of concepts) {
    const m = annualByFiscalYear(facts, taxonomy, c)
    if (m.size > 0) return m
  }
  return new Map<number, number>()
}

/**
 * A candidate "group" for an OE-bridge flow field: either a single XBRL concept name, or a SUM of
 * several concepts (e.g. split D&A = Depreciation + AmortizationOfIntangibleAssets; IFRS capex =
 * PP&E + intangible purchases). A string is shorthand for a single-concept group.
 */
type ConceptGroup = string | { sum: string[]; requireFirst?: boolean }

function groupAnnualMap(facts: CompanyFacts, taxonomy: Taxonomy, group: ConceptGroup): Map<number, number> {
  if (typeof group === 'string') return annualByFiscalYear(facts, taxonomy, group)
  // requireFirst: only sum YEARS where the FIRST (primary) concept reports — prevents a wrong-magnitude
  // fill from a secondary-only component (e.g. an IFRS capex group whose PP&E-purchase concept is absent
  // must NOT resolve to intangibles alone — Toyota — rather than mislabel intangibles as total capex).
  if (group.requireFirst) {
    const primary = annualByFiscalYear(facts, taxonomy, group.sum[0]!)
    if (primary.size === 0) return new Map<number, number>()
    const rest = sumConcepts(facts, taxonomy, group.sum.slice(1))
    const out = new Map<number, number>()
    for (const [fy, v] of primary) out.set(fy, v + (rest.get(fy) ?? 0))
    return out
  }
  return sumConcepts(facts, taxonomy, group.sum)
}

/** Flatten a candidate-group list to the underlying concept names (for filing-date metadata lookups). */
function groupNames(groups: ConceptGroup[]): string[] {
  const out: string[] = []
  for (const g of groups) {
    if (typeof g === 'string') out.push(g)
    else out.push(...g.sum)
  }
  return out
}

/**
 * Per-fiscal-year fallback across a candidate list: for EACH year, take the value from the first concept
 * (in list order) that reports that year. Unlike firstPopulated (which picks a single concept for ALL years
 * by whole-concept population), this resolves year-by-year — needed when a filer SWITCHES tags mid-history
 * (e.g. Copart tags CashAndCashEquivalentsAtCarryingValue through FY2019 then the restricted-cash total
 * thereafter): the latest year must still resolve via the later tag while older years keep the original one.
 */
function firstPopulatedByYear(facts: CompanyFacts, taxonomy: Taxonomy, concepts: string[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const c of concepts) {
    const m = annualByFiscalYear(facts, taxonomy, c)
    for (const [fy, v] of m) {
      if (!out.has(fy)) out.set(fy, v)
    }
  }
  return out
}

/** firstPopulatedByYear, but each year also remembers WHICH concept won — so an itemized line can cite it. */
function firstPopulatedByYearWithConcept(
  facts: CompanyFacts,
  taxonomy: Taxonomy,
  concepts: string[],
): Map<number, { concept: string; value: number }> {
  const out = new Map<number, { concept: string; value: number }>()
  for (const c of concepts) {
    const m = annualByFiscalYear(facts, taxonomy, c)
    for (const [fy, v] of m) {
      if (!out.has(fy)) out.set(fy, { concept: c, value: v })
    }
  }
  return out
}

/** Human labels for the impermissible-income concepts (shown as itemized dossier lines). */
const IMPERMISSIBLE_INCOME_LABELS: Record<string, string> = {
  InvestmentIncomeInterest: 'interest income',
  InvestmentIncomeDividend: 'dividend income',
  InvestmentIncomeInterestAndDividend: 'interest and dividend income (combined)',
  InterestAndDividendIncomeOperating: 'interest and dividend income (operating)',
  InterestIncome: 'interest income',
  InterestRevenueCalculatedUsingEffectiveInterestMethod: 'interest revenue (effective interest method)',
  InterestIncomeOther: 'interest income (other)',
  InterestAndDividendIncomeSecurities: 'interest and dividend income (securities)',
  InvestmentIncomeNet: 'net investment income',
  InvestmentIncomeNonoperating: 'nonoperating investment income',
}

/**
 * Itemized impermissible-income lines for one fiscal year, non-overlapping: the pure interest concept +
 * a separate dividend concept are itemized side by side; the combined interest-and-dividend rollup is
 * used ONLY when the pure interest concept is absent (it already contains dividends, so the separate
 * dividend line is then skipped too — never stacked). Returns undefined when nothing is tagged.
 */
function impermissibleIncomeLinesFor(
  fy: number,
  impInterest: Map<number, { concept: string; value: number }>,
  impDividend: Map<number, { concept: string; value: number }>,
  impCombined: Map<number, { concept: string; value: number }>,
): ImpermissibleIncomeLine[] | undefined {
  const line = (hit: { concept: string; value: number }): ImpermissibleIncomeLine | undefined => {
    const amount = toMusd(hit.value)
    return amount === undefined ? undefined : {
      concept: hit.concept,
      label: IMPERMISSIBLE_INCOME_LABELS[hit.concept] ?? hit.concept,
      amount_musd: amount,
    }
  }
  const interestHit = impInterest.get(fy)
  const lines: ImpermissibleIncomeLine[] = []
  if (interestHit !== undefined) {
    const interestLine = line(interestHit)
    if (interestLine !== undefined) lines.push(interestLine)
    const dividendHit = impDividend.get(fy)
    const dividendLine = dividendHit !== undefined ? line(dividendHit) : undefined
    if (dividendLine !== undefined) lines.push(dividendLine)
  } else {
    const combinedHit = impCombined.get(fy)
    const combinedLine = combinedHit !== undefined ? line(combinedHit) : undefined
    if (combinedLine !== undefined) {
      lines.push(combinedLine)
    } else {
      // No interest, no combined: a lone dividend line is still an itemizable component.
      const dividendHit = impDividend.get(fy)
      const dividendLine = dividendHit !== undefined ? line(dividendHit) : undefined
      if (dividendLine !== undefined) lines.push(dividendLine)
    }
  }
  return lines.length > 0 ? lines : undefined
}

/**
 * Group-aware per-fiscal-year resolution across PRECEDENCE-ORDERED candidate GROUPS (a group is a single
 * concept or a SUM of concepts). For EACH year, the value comes from the FIRST group (in precedence order)
 * that reports that year — so the returned map spans the UNION of years across all candidates.
 *
 * This is the series-correct counterpart to resolveLatestYearGroup (which picks ONE group's whole map by
 * recency). resolveLatestYearGroup truncated the annual series whenever a filer SWITCHED its concept and the
 * recency-winning concept had a SHORT history: e.g. Alphabet tags FY2023+ revenue under `Revenues` while the
 * older ASC-606 contract concept carries the earlier years — picking the `Revenues` group for ALL years
 * dropped the pre-2023 history (the GOOGL 16-month-of-history bug). Resolving per-year keeps each year on the
 * canonical (first-precedence) concept that actually reports it, spanning the full union.
 *
 * Consistency note: precedence order is hand-tuned so the FIRST concept that reports a year is the canonical
 * consolidated annual figure, and discontinued concepts simply drop out of later years — so a year resolved
 * from concept A and the next year from concept B are both the consolidated annual figure (never a mix of a
 * consolidated total with a disaggregated sub-line). latest_annual therefore still reads the most-recent
 * year's value from whichever concept currently reports it.
 */
function firstPopulatedGroupByYear(facts: CompanyFacts, taxonomy: Taxonomy, groups: ConceptGroup[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const group of groups) {
    const m = groupAnnualMap(facts, taxonomy, group)
    for (const [fy, v] of m) {
      if (!out.has(fy)) out.set(fy, v)
    }
  }
  return out
}

/**
 * Normalize a raw share-count series against power-of-ten UNITS restatements. Some filers re-tag the
 * weighted-average share count in MILLIONS (e.g. val=751.8) in recent 10-Ks for periods they previously
 * tagged as an ABSOLUTE count (val=751,800,000) — a 1e6 scale discontinuity within the same concept+unit.
 * "Latest filed wins" then picks the mis-scaled value, which after /1e6 becomes ≈0.00075 shares and makes
 * owner-earnings-per-share explode (the MCD backtest bug: a $109M buy price, BUY every month).
 *
 * Fix: anchor on the MEDIAN of the series (robust to a minority of mis-scaled years), and rescale only
 * values that are a GROSS power-of-ten outlier — at least a factor of ~100 away from the median, snapped to
 * the nearest clean power of ten. A real buyback never moves a share count by 100× in a year, so only a
 * units artifact lands that far off; legitimate year-to-year drift (even across a 750M–1,200M power-of-ten
 * boundary, ratio ~1.6) is well under the threshold and left untouched. Returns a new map.
 */
const SHARE_SCALE_OUTLIER_FACTOR = 100
function normalizeShareScale(raw: Map<number, number>): Map<number, number> {
  const positives = [...raw.values()].filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  if (positives.length < 2) return raw
  const median = positives[Math.floor(positives.length / 2)]!
  if (!(median > 0)) return raw
  const out = new Map<number, number>()
  for (const [fy, v] of raw) {
    if (!Number.isFinite(v) || v <= 0) {
      out.set(fy, v)
      continue
    }
    const ratio = median / v
    // Only a gross (≥100×) power-of-ten gap is a units artifact; snap the outlier onto the median's scale.
    if (ratio >= SHARE_SCALE_OUTLIER_FACTOR || ratio <= 1 / SHARE_SCALE_OUTLIER_FACTOR) {
      const exp = Math.round(Math.log10(median / v))
      out.set(fy, v * Math.pow(10, exp))
    } else {
      out.set(fy, v)
    }
  }
  return out
}

/** Sum, per fiscal year, the annual maps of every concept in the list (capex PPE + intangibles). */
function sumConcepts(facts: CompanyFacts, taxonomy: Taxonomy, concepts: string[]): Map<number, number> {
  const out = new Map<number, number>()
  let any = false
  for (const c of concepts) {
    const m = annualByFiscalYear(facts, taxonomy, c)
    if (m.size > 0) any = true
    for (const [fy, v] of m) out.set(fy, (out.get(fy) ?? 0) + v)
  }
  return any ? out : new Map<number, number>()
}

function buildAnnualSeries(facts: CompanyFacts, taxonomy: Taxonomy, currency: ReportingCurrency): AnnualFacts[] {
  const cm = conceptMapFor(taxonomy)
  // OE-bridge flow fields resolve across precedence-ordered candidate GROUPS, PER YEAR: each fiscal year
  // takes its value from the first (highest-precedence) group that reports it, so the series spans the UNION
  // of years across candidates. This handles discontinued/superseded tags + segment-vs-consolidated
  // disambiguation (the canonical concept is first in precedence; frozen concepts simply drop out of later
  // years) WITHOUT truncating the history when a filer SWITCHED concepts and the current-year tag has a short
  // history (the GOOGL 16-month bug — see firstPopulatedGroupByYear). latest_annual stays the most-recent
  // year's value from whichever concept currently reports it.
  const netIncome = firstPopulatedGroupByYear(facts, taxonomy, cm.netIncome)
  const revenue = firstPopulatedGroupByYear(facts, taxonomy, cm.revenue)
  const dAndA = firstPopulatedGroupByYear(facts, taxonomy, cm.dAndA)
  const capex = firstPopulatedGroupByYear(facts, taxonomy, cm.capex)
  const sbc = firstPopulatedGroupByYear(facts, taxonomy, cm.sbc)
  // Normalize the tagged weighted-average share series against power-of-ten UNITS restatements (MCD re-tags
  // recent years in millions, e.g. 751.8, for periods it previously tagged as 751,800,000 — a 1e6 scale
  // discontinuity that "latest filed wins" would otherwise propagate into a near-zero share count).
  const dilutedSharesTagged = normalizeShareScale(firstPopulatedGroupByYear(facts, taxonomy, cm.dilutedShares))
  // Diluted-share fallback: for any year the weighted-average diluted-share concept omits, derive the count
  // from net income / diluted EPS (both consolidated annual figures — a consistent per-year fill). This
  // recovers the per-share owner-earnings denominator for filers (e.g. Alphabet) that began tagging the
  // weighted-average count only in recent years while diluted EPS spans the full history. A genuinely tagged
  // year is never overwritten.
  const dilutedEps = firstPopulatedGroupByYear(facts, taxonomy, cm.dilutedEps)
  const dilutedShares = new Map<number, number>(dilutedSharesTagged)
  for (const [fy, ni] of netIncome) {
    if (dilutedShares.has(fy)) continue
    const eps = dilutedEps.get(fy)
    if (eps !== undefined && Number.isFinite(eps) && eps !== 0) {
      dilutedShares.set(fy, ni / eps)
    }
  }
  const sharesOut = firstPopulated(facts, taxonomy, cm.sharesOut)
  // Per-YEAR fallback for tags a filer may switch mid-history (debt rollup, lease fallback, cash, securities):
  // each year resolves to the first candidate that reports it, so the latest year still resolves even when an
  // earlier tag was discontinued.
  const debtCombined = firstPopulatedByYear(facts, taxonomy, cm.debtCombined)
  const debtComponents = sumConcepts(facts, taxonomy, cm.debtComponents)
  const debtFallback = firstPopulatedByYear(facts, taxonomy, cm.debtFallback)
  const cash = firstPopulatedByYear(facts, taxonomy, cm.cash)
  const shortTermInv = firstPopulatedByYear(facts, taxonomy, cm.shortTermInvestments)
  const interest = annualByFiscalYear(facts, taxonomy, cm.interest)
  // Impermissible-income components (flows) per fiscal year, each resolved with its winning concept so
  // the itemized line can cite it.
  const impInterest = firstPopulatedByYearWithConcept(facts, taxonomy, cm.impermissibleIncome.interest)
  const impDividend = firstPopulatedByYearWithConcept(facts, taxonomy, cm.impermissibleIncome.dividend)
  const impCombined = firstPopulatedByYearWithConcept(facts, taxonomy, cm.impermissibleIncome.combined)
  // Gross PP&E (instant) per fiscal year — first populated candidate wins; absent → Greenwald proxy degrades.
  const grossPpe = firstPopulatedByYear(facts, taxonomy, cm.grossPpe)
  // Gross profit: the direct concept per year; for years it omits, derive revenue − COGS ONLY when
  // both sides report that year (never fabricated from one side). A tagged year is never overwritten.
  const grossProfit = firstPopulatedByYear(facts, taxonomy, cm.grossProfit)
  const costOfRevenue = firstPopulatedByYear(facts, taxonomy, cm.costOfRevenue)
  for (const [fy, rev] of revenue) {
    if (grossProfit.has(fy)) continue
    const cogs = costOfRevenue.get(fy)
    if (cogs !== undefined) grossProfit.set(fy, rev - cogs)
  }
  // Payout flows (cash outflows, positive magnitudes as tagged), per-year precedence.
  const dividendsPaid = firstPopulatedByYear(facts, taxonomy, cm.dividendsPaid)
  const buybacks = firstPopulatedByYear(facts, taxonomy, cm.buybacks)
  // B1 (book alignment): CFO (flow) + current assets/liabilities (instant) for FCF + the current ratio.
  const cfo = firstPopulatedByYear(facts, taxonomy, cm.cfo)
  const currentAssets = firstPopulatedByYear(facts, taxonomy, cm.currentAssets)
  const currentLiabilities = firstPopulatedByYear(facts, taxonomy, cm.currentLiabilities)
  const stockholdersEquity = firstPopulatedByYear(facts, taxonomy, cm.stockholdersEquity)
  const operatingIncome = annualByFiscalYear(facts, taxonomy, cm.operatingIncome)
  const incomeTax = annualByFiscalYear(facts, taxonomy, cm.incomeTax)
  // Filing metadata (filed date + period end) per fiscal year. Prefer the income-statement fact; fall
  // back to revenue/D&A so a year still carries a filed date if the income fact was tagged differently.
  const filedMetaNi = groupNames(cm.netIncome).map((c) => annualFiledMetaByFiscalYear(facts, taxonomy, c))
  const filedMetaRev = groupNames(cm.revenue).map((c) => annualFiledMetaByFiscalYear(facts, taxonomy, c))
  const filedMetaDa = groupNames(cm.dAndA).map((c) => annualFiledMetaByFiscalYear(facts, taxonomy, c))

  // Union of all fiscal years observed across the OE-bridge concepts.
  const allYears = new Set<number>()
  for (const m of [netIncome, revenue, dAndA, capex, sbc, dilutedShares]) {
    for (const fy of m.keys()) allYears.add(fy)
  }

  const series: AnnualFacts[] = []
  for (const fy of [...allYears].sort((a, b) => b - a)) {
    // total debt: prefer the combined rollup; else the summed long-term/short-term components; else the
    // lease/short-term-borrowing fallback. Each branch is a COMPLETE total — never summed across branches —
    // so a filer whose only interest-bearing liability is a finance lease still resolves without double-count.
    const totalDebtRaw = debtCombined.get(fy) ?? debtComponents.get(fy) ?? debtFallback.get(fy)
    // cash + securities: cash plus whichever short-term-securities concept is present.
    const cashRaw = sumOptional(cash.get(fy), shortTermInv.get(fy))
    const filedMeta = filedMetaNi.map((m) => m.get(fy)).find((v) => v !== undefined)
      ?? filedMetaRev.map((m) => m.get(fy)).find((v) => v !== undefined)
      ?? filedMetaDa.map((m) => m.get(fy)).find((v) => v !== undefined)

    // Imperative conditional assignment (not chained `...optional(...)` spreads): 17 optional spreads
    // exceed tsc's union-complexity limit (TS2590 — each spread doubles the candidate union), and
    // exactOptionalPropertyTypes permits assigning a checked-defined value directly.
    const row: AnnualFacts = { fiscal_year: fy, currency }
    const set = <K extends keyof AnnualFacts>(key: K, value: AnnualFacts[K] | undefined): void => {
      if (value !== undefined) row[key] = value
    }
    set('filed', filedMeta?.filed)
    set('period_end', filedMeta?.period_end)
    set('net_income_musd', toMusd(netIncome.get(fy)))
    set('revenue_musd', toMusd(revenue.get(fy)))
    set('d_and_a_musd', toMusd(dAndA.get(fy)))
    set('capex_musd', toMusd(capex.get(fy)))
    set('gross_ppe_musd', toMusd(grossPpe.get(fy)))
    set('sbc_musd', toMusd(sbc.get(fy)))
    set('diluted_shares_m', toMshares(dilutedShares.get(fy)))
    set('shares_outstanding_m', toMshares(sharesOut.get(fy)))
    set('total_debt_musd', toMusd(totalDebtRaw))
    set('cash_and_securities_musd', toMusd(cashRaw))
    set('interest_expense_musd', toMusd(interest.get(fy)))
    set('impermissible_income_lines', impermissibleIncomeLinesFor(fy, impInterest, impDividend, impCombined))
    set('stockholders_equity_musd', toMusd(stockholdersEquity.get(fy)))
    set('operating_income_musd', toMusd(operatingIncome.get(fy)))
    set('income_tax_expense_musd', toMusd(incomeTax.get(fy)))
    set('gross_profit_musd', toMusd(grossProfit.get(fy)))
    set('dividends_paid_musd', toMusd(dividendsPaid.get(fy)))
    set('buybacks_musd', toMusd(buybacks.get(fy)))
    set('cfo_musd', toMusd(cfo.get(fy)))
    set('current_assets_musd', toMusd(currentAssets.get(fy)))
    set('current_liabilities_musd', toMusd(currentLiabilities.get(fy)))
    series.push(row)
  }
  return series
}

// exactOptionalPropertyTypes helper: only spread the key when the value is defined.
function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
}

// ---------------------------------------------------------------------------
// submissions -> 10-K URL
// ---------------------------------------------------------------------------

type Submissions = {
  cik?: string | number
  name?: string
  sic?: string
  sicDescription?: string
  filings?: {
    recent?: {
      form?: string[]
      filingDate?: string[]
      accessionNumber?: string[]
      primaryDocument?: string[]
      /** Parallel array of 8-K item-code strings ('2.02,9.01'); empty string for non-8-K rows. */
      items?: string[]
    }
  }
}

/** Build FilingRefs from the submissions index for forms matching `formMatches`, newest-first. */
function buildFilingsWhere(
  subs: Submissions | undefined,
  cik10: string,
  formMatches: (form: string | undefined) => boolean,
): FilingRef[] {
  const recent = subs?.filings?.recent
  if (recent === undefined) return []
  const forms = recent.form ?? []
  const dates = recent.filingDate ?? []
  const accessions = recent.accessionNumber ?? []
  const docs = recent.primaryDocument ?? []
  const itemsList = recent.items ?? []
  const cikInt = String(parseInt(cik10, 10))

  const filings: FilingRef[] = []
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i]
    if (!formMatches(form)) continue
    const accession = accessions[i]
    const doc = docs[i]
    const filed = dates[i]
    const items = itemsList[i]
    if (typeof accession !== 'string' || typeof doc !== 'string') continue
    const accNoDashes = accession.replace(/-/g, '')
    filings.push({
      form: form as string,
      filed: typeof filed === 'string' ? filed : '',
      url: `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}/${doc}`,
      ...(typeof items === 'string' && items.length > 0 ? { items } : {}),
    })
  }
  // newest first
  filings.sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0))
  return filings
}

/** Annual primary filings (10-K/20-F/40-F), newest-first. Unchanged behavior. */
function buildFilings(subs: Submissions | undefined, cik10: string): FilingRef[] {
  return buildFilingsWhere(subs, cik10, isAnnualForm)
}

/** Recent non-annual readable filings (8-K / 10-Q + amendments), newest-first (Slice B). */
export function buildReadableRecentFilings(subs: Submissions | undefined, cik10: string): FilingRef[] {
  return buildFilingsWhere(subs, cik10, isRecentReadableForm)
}

/** Definitive annual proxy statements (DEF 14A only — see PROXY_FORMS), newest-first. */
export function buildProxyFilings(subs: Submissions | undefined, cik10: string): FilingRef[] {
  return buildFilingsWhere(subs, cik10, isProxyForm)
}

/**
 * Insider ownership filings (Form 4 / 4/A — see FORM_4_FORMS), newest-first. EDGAR's `primaryDocument`
 * for a Form 4 is the XSL-RENDERED HTML (e.g. `xslF345X06/form4.xml`); the machine-readable ownership XML
 * is the same filename with that render-prefix stripped. We rewrite the URL to the raw XML so secForm4's
 * parser reads the structured document, not the HTML rendering.
 */
export function buildForm4Filings(subs: Submissions | undefined, cik10: string): FilingRef[] {
  return buildFilingsWhere(subs, cik10, isForm4).map((f) => ({
    ...f,
    url: f.url.replace(/\/xsl[^/]*\/(?=[^/]+\.xml$)/i, '/'),
  }))
}

/**
 * The latest definitive proxy statement to ground for the management lane. LATEST-ONLY contract — no
 * recency anchor, unlike the interim selector: proxies file ~annually (typically AFTER the 10-K), so
 * the latest DEF 14A legitimately may predate the latest annual filing and is still the current proxy.
 * Pure / fail-closed: undefined when none.
 */
export function selectLatestProxyFiling(f: { proxy_filings?: FilingRef[] }): FilingRef | undefined {
  const proxies = f.proxy_filings ?? []
  if (proxies.length === 0) return undefined
  return [...proxies].sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0))[0]
}

/**
 * Select the recent readable filings to ground for interim recency: those filed AFTER the latest annual
 * filing (the recency anchor), newest-first, capped. Pure / fail-closed: returns [] when there are no
 * recent filings. A staler-than-the-annual filing is rejected (it predates the grounded floor).
 */
/**
 * The latest PRIMARY ANNUAL filing across all annual forms (10-K US, 20-F/40-F foreign) — the document
 * the deep dive grounds as the readable primary source. `filings` is already annual-filtered and
 * newest-first, so the first annual match is the latest; the predicate is belt-and-braces. Pure /
 * fail-closed: undefined when no annual filing exists (non-US-listed name, submissions unavailable).
 */
export function selectLatestAnnualFiling(f: { filings?: FilingRef[] }): FilingRef | undefined {
  return f.filings?.find((x) => isAnnualForm(x.form))
}

export function selectRecentReadableFilings(
  f: { filings?: FilingRef[]; recent_filings?: FilingRef[] },
  opts?: { max?: number; afterFiled?: string },
): FilingRef[] {
  const recent = f.recent_filings ?? []
  const anchor = opts?.afterFiled ?? f.filings?.find((x) => isAnnualForm(x.form))?.filed
  const filtered = anchor === undefined || anchor.length === 0 ? recent : recent.filter((x) => x.filed > anchor)
  const sorted = [...filtered].sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0))
  return sorted.slice(0, opts?.max ?? 6)
}

// ---------------------------------------------------------------------------
// Inline-XBRL share recovery (per-class filers — OPTION C, owner call 2026-07-12)
// ---------------------------------------------------------------------------
// LIVE FIND (V): Visa tags EVERY share/EPS concept with a StatementClassOfStockAxis member, and the
// companyfacts API drops dimensioned facts — a per-class filer extracts NO share count and goes
// honestly unpriced despite a fully tagged filing. Recovery: read the annual report primary document
// (inline XBRL) and take the Class-A-member weighted-average DILUTED share fact whose full-year
// duration matches the requested fiscal year. For a multi-class filer the LISTED class's diluted
// count is the as-converted total (V FY2025: 1,966M — matches the published market-cap denominator).
// FAIL-CLOSED: exactly ONE distinct candidate value, ≥300-day duration, shares-scaled and sane;
// any ambiguity returns undefined and the dossier stays unpriced.

const INLINE_SHARE_CONCEPT = /name="us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding"/i
const CLASS_A_MEMBER = /us-gaap:CommonClassAMember/i

export type InlineXbrlShareRecovery = {
  shares_m: number
  fiscal_year: number
}

export function recoverDilutedSharesFromInlineXbrl(html: string, fiscalYear: number): InlineXbrlShareRecovery | undefined {
  // Every inline fact tag for the diluted-shares concept, with its context ref, scale, and text value.
  const factRe = /<ix:nonfraction\b[^>]*>/gi
  const candidates = new Map<string, number>() // `${contextRef}` → value (deduped; the EPS note repeats the income-statement fact)
  for (const m of html.matchAll(factRe)) {
    const tag = m[0]
    if (!INLINE_SHARE_CONCEPT.test(tag)) continue
    const ctxMatch = /contextref="([^"]+)"/i.exec(tag)
    if (ctxMatch === null) continue
    const contextRef = ctxMatch[1]!
    // The context must be a full-year duration for the requested fiscal year with the Class-A member.
    const ctxBody = new RegExp(`<xbrli:context id="${contextRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</xbrli:context>`, 'i').exec(html)?.[1]
    if (ctxBody === undefined) continue
    if (!/StatementClassOfStockAxis/i.test(ctxBody) || !CLASS_A_MEMBER.test(ctxBody)) continue
    const start = /<xbrli:startdate>([^<]+)</i.exec(ctxBody)?.[1]
    const end = /<xbrli:enddate>([^<]+)</i.exec(ctxBody)?.[1]
    if (start === undefined || end === undefined) continue
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000
    if (!(days >= 300 && days <= 400)) continue
    const endYear = Number(end.slice(0, 4))
    const endMonth = Number(end.slice(5, 7))
    // The fiscal-year label of an annual period: calendar/late-year ends carry the end year; an
    // early-calendar end (Jan–Jun) labels the PRIOR year's fiscal year on some filers — accept both.
    if (endYear !== fiscalYear && !(endMonth <= 6 && endYear === fiscalYear + 1)) continue
    // The value: tag text up to the closing '<', de-formatted; em-dash/empty facts are skipped.
    const valueStart = (m.index ?? 0) + tag.length
    const valueEnd = html.indexOf('<', valueStart)
    if (valueEnd < 0) continue
    const raw = html.slice(valueStart, valueEnd).replace(/[,\s]/g, '')
    if (raw.length === 0 || raw.includes('&#8212;') || raw === '—') continue
    const scale = Number(/scale="([^"]+)"/i.exec(tag)?.[1] ?? '0')
    const numeric = Number(raw)
    if (!Number.isFinite(numeric) || !Number.isFinite(scale)) continue
    const sharesM = (numeric * Math.pow(10, scale)) / 1_000_000
    if (!(sharesM >= 1 && sharesM <= 100_000)) continue
    const existing = candidates.get(contextRef)
    if (existing !== undefined && Math.abs(existing - sharesM) > 0.5) return undefined // conflicting repeats → fail closed
    candidates.set(contextRef, sharesM)
  }
  // Exactly ONE distinct value across contexts (two contexts with the same FY + different counts is ambiguous).
  const values = [...new Set([...candidates.values()].map((v) => Math.round(v * 10) / 10))]
  if (values.length !== 1) return undefined
  return { shares_m: values[0]!, fiscal_year: fiscalYear }
}

/** Fetch a raw EDGAR document (Archives HTML) with the same politeness/timeout conventions as fetchSecJson. */
async function fetchSecText(rawUrl: string, deps?: SecEdgarDeps): Promise<string | undefined> {
  let url: URL
  try {
    url = assertSecUrl(rawUrl)
  } catch {
    return undefined
  }
  const fetchFn = deps?.fetchImpl ?? fetch
  const timeoutMs = deps?.timeoutMs ?? SEC_DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const response = await fetchFn(url.toString(), {
      signal: controller.signal,
      headers: { 'User-Agent': resolveUserAgent(deps), 'Accept': 'text/html' },
    })
    if (!response.ok) return undefined
    return await response.text()
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Fetch structured fundamentals for a US company by ticker OR a 10-digit (or paddable) CIK.
 * FAIL-CLOSED: returns undefined on an unknown ticker, missing structured facts, or any fetch error.
 * A submissions failure degrades gracefully (no 10-K URL) but does not discard the XBRL facts.
 */
export async function fetchCompanyFundamentals(
  tickerOrCik: string,
  deps?: SecEdgarDeps,
): Promise<Fundamentals | undefined> {
  const trimmed = tickerOrCik.trim()
  if (trimmed.length === 0) return undefined

  // A pure-digit input is treated as a CIK; otherwise resolve the ticker.
  const isCik = /^\d+$/.test(trimmed)
  const cik10 = isCik ? padCik(trimmed) : await resolveCik(trimmed, deps)
  if (cik10 === undefined) return undefined

  const facts = await fetchSecJson<CompanyFacts>(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10}.json`,
    deps,
  )
  if (facts === undefined) return undefined

  // Choose the populated taxonomy (us-gaap for US filers, ifrs-full for foreign private issuers) and
  // detect the reporting currency from the XBRL unit key. Fail-closed when neither taxonomy has data.
  const taxonomy = pickTaxonomy(facts)
  if (taxonomy === undefined) return undefined
  const currency = detectCurrency(facts, taxonomy)

  const annual_series = buildAnnualSeries(facts, taxonomy, currency)
  const latest_annual = annual_series[0]
  if (latest_annual === undefined) return undefined

  // submissions are best-effort: a failure must not lose the structured facts.
  const subs = await fetchSecJson<Submissions>(
    `https://data.sec.gov/submissions/CIK${cik10}.json`,
    deps,
  )
  const filings = buildFilings(subs, cik10)

  // OPTION C: a per-class filer with NO extractable share count (all share facts dimensioned) —
  // recover the latest year's diluted count from the annual report's inline XBRL (fail-closed).
  if (latest_annual.diluted_shares_m === undefined) {
    const annualFiling = filings.find((x) => isAnnualForm(x.form))
    if (annualFiling !== undefined) {
      const doc = await fetchSecText(annualFiling.url, deps)
      const recovered = doc !== undefined
        ? recoverDilutedSharesFromInlineXbrl(doc, latest_annual.fiscal_year)
        : undefined
      if (recovered !== undefined) {
        latest_annual.diluted_shares_m = recovered.shares_m
        latest_annual.diluted_shares_source = 'inline_xbrl_class_a'
      }
    }
  }

  const recent_filings = buildReadableRecentFilings(subs, cik10)
  const proxy_filings = buildProxyFilings(subs, cik10)
  const form4_filings = buildForm4Filings(subs, cik10)

  return {
    cik: cik10,
    entity_name: typeof facts.entityName === 'string' ? facts.entityName : trimmed.toUpperCase(),
    currency,
    latest_annual,
    annual_series,
    filings,
    recent_filings,
    proxy_filings,
    form4_filings,
    // SIC sector/industry is best-effort/fail-open: present only when submissions carry it, trimmed
    // but not coerced/padded, and omitted (undefined) otherwise so it is never fabricated.
    ...optional('sic', trimmedString(subs?.sic)),
    ...optional('sic_description', trimmedString(subs?.sicDescription)),
  }
}

/** Trim a candidate string, returning undefined for non-strings or empty/whitespace-only values. */
function trimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

// ---------------------------------------------------------------------------
// Incremental ROIC from the multi-year EDGAR series
// ---------------------------------------------------------------------------

export type IncrementalRoicResult =
  | {
      computable: true
      /** Normalized incremental ROIC (fraction), e.g. 0.20. */
      incremental_roic: number
      /** ΔNOPAT over the window ($millions). */
      delta_nopat_musd: number
      /** ΔInvested capital over the window ($millions). */
      delta_invested_capital_musd: number
      /** Fiscal years of the earliest and latest observation actually used. */
      from_fiscal_year: number
      to_fiscal_year: number
    }
  | { computable: false; reason: string }

/**
 * NOPAT proxy for one year: operating income × (1 − effective tax rate). Falls back to
 * net income + after-tax interest when operating income is unavailable. Returns undefined when the
 * inputs needed for any proxy are missing.
 *
 *   effective tax rate = income_tax / (operating_income)  clamped to [0, 0.5]; default 0.21 when
 *   operating income or tax is missing/odd.
 */
function nopatProxy(a: AnnualFacts): number | undefined {
  const op = a.operating_income_musd
  const tax = a.income_tax_expense_musd
  if (op !== undefined && Number.isFinite(op)) {
    let rate = 0.21
    if (tax !== undefined && Number.isFinite(tax) && op > 0) {
      const implied = tax / op
      if (implied >= 0 && implied <= 0.5) rate = implied
    }
    return op * (1 - rate)
  }
  // Fallback: NI + after-tax interest (interest × (1 − 0.21)).
  const ni = a.net_income_musd
  if (ni !== undefined && Number.isFinite(ni)) {
    const interest = a.interest_expense_musd ?? 0
    return ni + (Number.isFinite(interest) ? interest * (1 - 0.21) : 0)
  }
  return undefined
}

/** Invested-capital proxy: equity + total debt − cash. Returns undefined when equity is missing. */
function investedCapitalProxy(a: AnnualFacts): number | undefined {
  const equity = a.stockholders_equity_musd
  if (equity === undefined || !Number.isFinite(equity)) return undefined
  const debt = a.total_debt_musd ?? 0
  const cash = a.cash_and_securities_musd ?? 0
  return equity + (Number.isFinite(debt) ? debt : 0) - (Number.isFinite(cash) ? cash : 0)
}

/**
 * Compute a normalized INCREMENTAL ROIC from the EDGAR multi-year series over ~`lookbackYears` years
 * (buffett-valuation-method-v2 Step 3 raw growth capacity = reinvestment_rate × incremental_roic).
 *
 *   incremental ROIC ≈ Δ(NOPAT) / Δ(invested capital)   from the earliest to the latest year in the
 *   window for which both the NOPAT and invested-capital proxies are computable.
 *
 * Honest fail-closed: returns { computable: false } when fewer than two usable years exist, when the
 * change in invested capital is non-positive (incremental ROIC undefined / nonsensical), or when the
 * result is negative or wildly large (> 1.0). The caller falls back to the lane's proposed value.
 */
export function computeIncrementalRoic(
  series: AnnualFacts[],
  opts?: { lookbackYears?: number },
): IncrementalRoicResult {
  const lookback = opts?.lookbackYears ?? 5
  // Series is newest-first; build an ascending list of years that have BOTH proxies.
  const usable = [...series]
    .map((a) => ({ fy: a.fiscal_year, nopat: nopatProxy(a), ic: investedCapitalProxy(a) }))
    .filter((x): x is { fy: number; nopat: number; ic: number } => x.nopat !== undefined && x.ic !== undefined)
    .sort((a, b) => a.fy - b.fy)

  if (usable.length < 2) {
    return { computable: false, reason: 'fewer than two years with computable NOPAT + invested-capital proxies' }
  }

  const latest = usable[usable.length - 1]!
  // Earliest within the lookback window (prefer ~lookback years back, else the oldest usable year).
  const earliest = usable.find((x) => x.fy >= latest.fy - lookback) ?? usable[0]!

  if (earliest.fy === latest.fy) {
    return { computable: false, reason: 'no distinct earlier year within the lookback window' }
  }

  const delta_nopat = latest.nopat - earliest.nopat
  const delta_ic = latest.ic - earliest.ic

  if (!(delta_ic > 0)) {
    return { computable: false, reason: 'change in invested capital is non-positive — incremental ROIC undefined' }
  }

  const incremental_roic = delta_nopat / delta_ic
  // Reject implausible proxies (negative or > 100%) — prefer the lane value + a note (caller decides).
  if (!Number.isFinite(incremental_roic) || incremental_roic < 0 || incremental_roic > 1) {
    return { computable: false, reason: `incremental ROIC proxy out of plausible range (${incremental_roic})` }
  }

  return {
    computable: true,
    incremental_roic,
    delta_nopat_musd: delta_nopat,
    delta_invested_capital_musd: delta_ic,
    from_fiscal_year: earliest.fy,
    to_fiscal_year: latest.fy,
  }
}

/** Test-only hook to reset the module-level ticker cache. */
export function __resetTickerCacheForTests(): void {
  tickerCache = undefined
}
