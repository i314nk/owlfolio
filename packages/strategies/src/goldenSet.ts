// model-tiering-spec "Qualification Eval (certify before production)" — the GOLDEN SET.
//
// "A model touches production only after passing the golden set": a versioned set of companies the
// analyst has already analyzed deeply, with FROZEN reference answers. The qualification eval runs the
// research lanes against each name and scores the lane output against these references (the scoring
// lives in qualificationEval.ts). Quality is verified by the harness, not assumed from the provider.
//
// HONESTY: every reference value below is grounded where possible (EDGAR FY figures, public Shariah
// screening posture). Values the analyst is less sure of are marked `reference_confidence:
// 'approximate'`; firmly-grounded ones are `'firm'`. We do NOT fabricate precise numbers we cannot
// ground — optional OE-bridge inputs are omitted rather than invented, and approximate values carry a
// wider real-world margin than the ±10% scoring tolerance (the scorer's tolerance is a fixed band; the
// confidence tag tells the operator how much to trust a near-miss).
//
// Mirrors the versioned-config pattern of valuationParams.ts (a frozen typed object
// + a version field). Changing the golden set — adding a name, restating a reference — is a deliberate,
// logged act: bump `version`.

/** Moat class tier order (most conservative → most aggressive). Shared with the scorer's tier rule. */
export const MOAT_CLASS_ORDER = ['narrow', 'moderate', 'wide', 'monopoly'] as const
export type GoldenMoatClass = (typeof MOAT_CLASS_ORDER)[number]

/** Reinvestment runway classes (a separate axis from moat). Referenced for context, not pass-scored. */
export type GoldenRunway = 'none' | 'limited' | 'proven'

/**
 * Shariah status the eval scores on PERMISSIBILITY: `compliant`/`conditional` are a matched pair (both
 * holdable; differ only in purification), and the criterion fails only on permissible↔`non_compliant`.
 */
export type GoldenShariahStatus = 'compliant' | 'conditional' | 'non_compliant'

/** How firmly the analyst stands behind a given reference value. */
export type ReferenceConfidence = 'firm' | 'approximate'

/**
 * The owner-earnings bridge INPUTS (company totals, $MILLIONS; shares in MILLIONS) the eval scores at
 * ±10% of reference. `maintenance_capex_musd` is OPTIONAL (it is a judgment proxy off total capex, not
 * a single reported line) — omitted when we cannot ground it, so it is simply not scored.
 */
export type GoldenOeBridge = {
  /**
   * Reporting currency of the monetary OE-bridge fields (ISO code, e.g. 'USD', 'DKK'). OPTIONAL: an
   * absent value means USD (the default for US 10-K filers). The qualification scorer compares ONLY in
   * a matching currency — a foreign filer (e.g. Novo Nordisk, DKK/IFRS 20-F) must freeze its references
   * in the REPORTING currency, never a USD-scaled placeholder, so the ±10% band measures judgment, not FX.
   */
  reporting_currency?: string
  net_income_musd: number
  d_and_a_musd: number
  maintenance_capex_musd?: number
  sbc_musd: number
  diluted_shares_m: number
}

export type GoldenSetCompany = {
  ticker: string
  company: string
  /** Fiscal year the OE-bridge figures are drawn from (provenance). */
  reference_fiscal_year: number
  expected_moat_class: GoldenMoatClass
  expected_runway: GoldenRunway
  expected_oe_bridge: GoldenOeBridge
  expected_shariah_status: GoldenShariahStatus
  /** Overall confidence in this row's reference answers (most-uncertain field governs). */
  reference_confidence: ReferenceConfidence
  /** Per-field confidence notes — which numbers are firmly grounded vs. approximate. */
  basis_note: string
}

export type GoldenSet = {
  /** Monotonic version string. Bump on every change to a reference answer. */
  version: string
  companies: GoldenSetCompany[]
}

/**
 * The frozen golden set. Names chosen for grounded analyst knowledge with public primary filings.
 *
 * Provenance per row (the analyst's reference basis — cited so a reviewer can re-verify):
 *
 *  MSFT (Microsoft) — wide moat (Morningstar-rated wide: Windows/Office/Azure platform lock-in + switching
 *    costs + scale). Shariah COMPLIANT and UNAMBIGUOUS: permissible software sector, no prohibited-income
 *    story, debt/market-cap ~1% and cash+securities/market-cap ~3% both far under the 30% AAOIFI ceilings;
 *    a top holding in mainstream halal funds (SP Funds SPUS, Wahed). OE bridge FIRM from the FY2025 10-K
 *    (fiscal year ended 2025-06-30), EDGAR us-gaap, $M: net income 101,832; D&A 28,000 (Depreciation 22,000
 *    + intangible amortization 6,000); SBC 11,974; diluted weighted-average shares 7,465M. (Replaced COST,
 *    2026-06-14: COST's non_compliant status was a contested owner ruling that structurally blocked
 *    qualification — capable models compute it conditional/compliant — so the gate now uses a clean-Shariah
 *    name instead. The non_compliant path is still validated via sector-rejection, e.g. tobacco/banks.)
 *
 *  CPRT (Copart) — wide moat (two-sided salvage-auction network + irreplaceable physical yard land
 *    bank + switching costs for insurers). Shariah sector status COMPLIANT/CONDITIONAL: a permissible
 *    core business (vehicle remarketing/auctions), with the usual conditional caveat on interest income
 *    from a large cash balance — i.e. clean on sector, conditional only on the financial-ratio overlay.
 *    Shariah COMPLIANT (owner decision 2026-06-14): permissible sector, no prohibited income, financial
 *    ratios pass — the earlier 'conditional' was an analyst-conservative hunch, not a ratio breach; both
 *    qualified models independently returned compliant.
 *    OE bridge RE-PULLED FIRM from the FY2025 10-K (fiscal year ended 2025-07-31) via SEC EDGAR XBRL
 *    (us-gaap), $M: net income 1,552.449; D&A (DepreciationDepletionAndAmortization) 215.849; SBC
 *    (ShareBasedCompensation) 38.004; diluted weighted-average shares 977.563M. NOTE the prior frozen
 *    values (D&A ~120 / SBC ~70, pinned to FY2024) were APPROXIMATE-from-memory and WRONG by ~80%/~46%;
 *    the swarm correctly read the primary filing and the gate was failing a correct model on a bad
 *    reference. Now pinned to the LATEST filed fiscal year the harness actually pulls (drift note: when a
 *    newer 10-K lands, the harness pulls it — re-pull + re-pin this row at the annual golden-set review).
 *
 *  NVO (Novo Nordisk) — wide moat (GLP-1 / insulin franchise: patents, manufacturing scale,
 *    branded-script switching). Shariah sector status COMPLIANT (pharmaceuticals are a permissible
 *    sector; conditional financial-ratio overlay handled separately). Novo reports in DKK under IFRS
 *    (20-F filer). The OE bridge is FROZEN IN DKK (the reporting currency) from the FY2025 20-F via SEC
 *    EDGAR (ifrs-full): NI 102,434 / D&A 14,666 / SBC 1,435 / diluted shares 4,447.7M (DKK millions).
 *    The qualification scorer currency-matches before comparing, so a DKK-reporting lane bridge is scored
 *    against these DKK references — never against a USD-scaled placeholder (the old ~375% FX-scale miss).
 */
export const GOLDEN_SET: GoldenSet = Object.freeze({
  version: 'golden-set-2026-06-4',
  companies: [
    {
      ticker: 'MSFT',
      company: 'Microsoft Corporation',
      reference_fiscal_year: 2025,
      expected_moat_class: 'wide',
      expected_runway: 'proven',
      expected_oe_bridge: {
        // FIRM from the FY2025 10-K (FY ended 2025-06-30), SEC EDGAR XBRL us-gaap, $M. D&A = Depreciation
        // 22,000 + AmortizationOfIntangibleAssets 6,000 = 28,000 (Microsoft reports these as the cash-flow
        // D&A components; the harness sums them). maintenance_capex omitted (a model judgment off capex).
        net_income_musd: 101832,
        d_and_a_musd: 28000,
        sbc_musd: 11974,
        diluted_shares_m: 7465,
      },
      expected_shariah_status: 'compliant',
      reference_confidence: 'firm',
      basis_note:
        'MSFT FY2025 10-K (FY ended 2025-06-30, SEC EDGAR us-gaap): NI 101,832 / D&A 28,000 (Depreciation '
        + '22,000 + intangible amortization 6,000) / SBC 11,974 / diluted shares 7,465M — FIRM, re-pulled '
        + '2026-06-14. Moat WIDE (Morningstar-rated; Windows/Office/Azure lock-in) — firm. Shariah COMPLIANT '
        + '— firm and UNAMBIGUOUS: permissible software sector, no prohibited income, debt/market-cap ~1% '
        + 'and cash+securities/market-cap ~3% both far under the 30% AAOIFI ceilings; a top holding in '
        + 'mainstream halal funds (SP Funds SPUS, Wahed). Replaced COST (whose contested non_compliant '
        + 'ruling structurally blocked qualification) as a clean-Shariah golden-set name.',
    },
    {
      ticker: 'CPRT',
      company: 'Copart, Inc.',
      reference_fiscal_year: 2025,
      expected_moat_class: 'wide',
      expected_runway: 'proven',
      expected_oe_bridge: {
        // FIRM from the FY2025 10-K (FY ended 2025-07-31), SEC EDGAR XBRL us-gaap, $M. The prior values
        // (D&A 120 / SBC 70, pinned to FY2024) were approximate-from-memory and wrong by ~80%/~46% — the
        // gate was failing a CORRECT model on a bad reference. Re-pinned to the latest filed FY.
        net_income_musd: 1552.449,
        d_and_a_musd: 215.849,
        sbc_musd: 38.004,
        diluted_shares_m: 977.563,
      },
      expected_shariah_status: 'compliant',
      reference_confidence: 'firm',
      basis_note:
        'CPRT moat wide (salvage-auction two-sided network + yard land bank + insurer switching costs) '
        + '— firm. Shariah COMPLIANT (owner decision 2026-06-14): permissible salvage-auction sector, NO '
        + 'prohibited-income story, debt/cash financial ratios pass — the earlier `conditional` was an '
        + 'analyst-conservative hunch (interest income on the cash pile), not a ratio breach; both qualified '
        + 'models independently returned compliant. OE bridge FIRM from the FY2025 10-K (FY ended 2025-07-31, '
        + 'SEC EDGAR us-gaap): NI 1,552.449 / D&A 215.849 / SBC 38.004 / diluted shares 977.563M (re-pulled '
        + '2026-06-13; prior D&A 120 / SBC 70 were approximate-from-memory and wrong).',
    },
    {
      ticker: 'NVO',
      company: 'Novo Nordisk A/S',
      reference_fiscal_year: 2025,
      expected_moat_class: 'wide',
      expected_runway: 'proven',
      expected_oe_bridge: {
        // FROZEN IN DKK (the REPORTING currency) from the FY2025 20-F via SEC EDGAR XBRL (ifrs-full
        // taxonomy). Novo Nordisk reports in DKK; the prior USD placeholders made the bridge look ~375%
        // off purely from the FX scale. The scorer now compares in the reporting currency, so these are
        // firm references read off the same EDGAR series the lane consumes — DKK MILLIONS.
        reporting_currency: 'DKK',
        net_income_musd: 102434,
        d_and_a_musd: 14666,
        sbc_musd: 1435,
        diluted_shares_m: 4447.7,
      },
      expected_shariah_status: 'compliant',
      reference_confidence: 'firm',
      basis_note:
        'NVO moat wide (GLP-1/insulin franchise: patents, manufacturing scale, script switching) — firm. '
        + 'Shariah sector COMPLIANT (pharma permissible) — firm. OE-bridge FROZEN IN DKK (FY2025 20-F, SEC '
        + 'EDGAR ifrs-full): NI 102,434 / D&A 14,666 / SBC 1,435 / diluted shares 4,447.7M (DKK millions). '
        + 'The scorer currency-matches, so DKK references are compared against the DKK-reporting lane bridge.',
    },
  ],
}) as GoldenSet

/** Look up a golden-set company by ticker (case-insensitive). */
export function goldenSetCompany(ticker: string, set: GoldenSet = GOLDEN_SET): GoldenSetCompany | undefined {
  const upper = ticker.trim().toUpperCase()
  return set.companies.find((c) => c.ticker.toUpperCase() === upper)
}
