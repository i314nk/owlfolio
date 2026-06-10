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
// Mirrors the versioned-config pattern of valuationParams.ts / modelRegistry.ts (a frozen typed object
// + a version field). Changing the golden set — adding a name, restating a reference — is a deliberate,
// logged act: bump `version`.

/** Moat class tier order (most conservative → most aggressive). Shared with the scorer's tier rule. */
export const MOAT_CLASS_ORDER = ['narrow', 'moderate', 'wide', 'monopoly'] as const
export type GoldenMoatClass = (typeof MOAT_CLASS_ORDER)[number]

/** Reinvestment runway classes (a separate axis from moat). Referenced for context, not pass-scored. */
export type GoldenRunway = 'none' | 'limited' | 'proven'

/** Shariah sector status the eval scores for EXACT match. */
export type GoldenShariahStatus = 'compliant' | 'conditional' | 'non_compliant'

/** How firmly the analyst stands behind a given reference value. */
export type ReferenceConfidence = 'firm' | 'approximate'

/**
 * The owner-earnings bridge INPUTS (company totals, $MILLIONS; shares in MILLIONS) the eval scores at
 * ±10% of reference. `maintenance_capex_musd` is OPTIONAL (it is a judgment proxy off total capex, not
 * a single reported line) — omitted when we cannot ground it, so it is simply not scored.
 */
export type GoldenOeBridge = {
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
 *  COST (Costco Wholesale) — wide moat (membership-warehouse scale + renewal-rate flywheel). Shariah
 *    NON-COMPLIANT on a sector/segment basis: material alcohol, pork, and conventional-finance-adjacent
 *    revenue in the warehouse mix (it is routinely screened out by mainstream Shariah equity screens).
 *    OE bridge from the FY2025 (fiscal year ended Aug/Sep 2025) 10-K, EDGAR, $M: net income 8,099;
 *    D&A 2,426; total capex 5,498 (the maintenance fraction is a model JUDGMENT, so we do NOT freeze a
 *    maintenance_capex reference here); SBC 860; diluted weighted-average shares 444.8M. These five are
 *    FIRM (read off the FY2025 10-K cash-flow/income statements + share count).
 *
 *  CPRT (Copart) — wide moat (two-sided salvage-auction network + irreplaceable physical yard land
 *    bank + switching costs for insurers). Shariah sector status COMPLIANT/CONDITIONAL: a permissible
 *    core business (vehicle remarketing/auctions), with the usual conditional caveat on interest income
 *    from a large cash balance — i.e. clean on sector, conditional only on the financial-ratio overlay.
 *    We freeze it as 'conditional' (the more conservative of compliant/conditional given the cash pile).
 *    OE-bridge magnitudes are APPROXIMATE (recent-FY order-of-magnitude from memory, not re-pulled from
 *    the filing for this set) — net income ~1,500; D&A ~120; SBC ~70; diluted shares ~965M. Marked
 *    approximate; the scorer's ±10% band is tight, so a near-miss here is expected to be reviewed, not
 *    auto-failed-as-fabrication.
 *
 *  NVO (Novo Nordisk) — wide moat (GLP-1 / insulin franchise: patents, manufacturing scale,
 *    branded-script switching). Shariah sector status COMPLIANT (pharmaceuticals are a permissible
 *    sector; conditional financial-ratio overlay handled separately). Novo reports in DKK under IFRS
 *    (20-F filer), so we do NOT freeze precise USD OE-bridge figures we cannot ground cleanly here:
 *    the bridge inputs are left at conservative APPROXIMATE order-of-magnitude placeholders and the row
 *    is flagged approximate. Its PRIMARY qualification value is the moat + Shariah-sector exact match.
 */
export const GOLDEN_SET: GoldenSet = Object.freeze({
  version: 'golden-set-2026-06-1',
  companies: [
    {
      ticker: 'COST',
      company: 'Costco Wholesale Corporation',
      reference_fiscal_year: 2025,
      expected_moat_class: 'wide',
      expected_runway: 'limited',
      expected_oe_bridge: {
        net_income_musd: 8099,
        d_and_a_musd: 2426,
        // maintenance_capex omitted on purpose: the maintenance fraction of total capex (5,498) is a
        // model judgment, not a frozen reference line. We score NI/D&A/SBC/shares instead.
        sbc_musd: 860,
        diluted_shares_m: 444.8,
      },
      expected_shariah_status: 'non_compliant',
      reference_confidence: 'firm',
      basis_note:
        'COST FY2025 10-K (SEC EDGAR): NI 8,099 / D&A 2,426 / total capex 5,498 / SBC 860 / diluted '
        + 'shares 444.8M — FIRM. Moat wide (membership flywheel) — firm. Shariah NON_COMPLIANT on sector '
        + '(alcohol/pork/finance-adjacent segments routinely screened out) — firm.',
    },
    {
      ticker: 'CPRT',
      company: 'Copart, Inc.',
      reference_fiscal_year: 2024,
      expected_moat_class: 'wide',
      expected_runway: 'proven',
      expected_oe_bridge: {
        net_income_musd: 1500,
        d_and_a_musd: 120,
        sbc_musd: 70,
        diluted_shares_m: 965,
      },
      expected_shariah_status: 'conditional',
      reference_confidence: 'approximate',
      basis_note:
        'CPRT moat wide (salvage-auction two-sided network + yard land bank + insurer switching costs) '
        + '— firm. Shariah sector permissible; frozen CONDITIONAL given large interest-bearing cash '
        + '(the conservative of compliant/conditional) — firm on sector, conditional via financial overlay. '
        + 'OE-bridge magnitudes APPROXIMATE (recent-FY order-of-magnitude, not re-pulled for this set).',
    },
    {
      ticker: 'NVO',
      company: 'Novo Nordisk A/S',
      reference_fiscal_year: 2024,
      expected_moat_class: 'wide',
      expected_runway: 'proven',
      expected_oe_bridge: {
        // APPROXIMATE USD-equivalent placeholders — Novo reports in DKK under IFRS (20-F). Not frozen
        // as precise references; the row's qualification value is moat + Shariah-sector exact match.
        net_income_musd: 14000,
        d_and_a_musd: 1500,
        sbc_musd: 300,
        diluted_shares_m: 4460,
      },
      expected_shariah_status: 'compliant',
      reference_confidence: 'approximate',
      basis_note:
        'NVO moat wide (GLP-1/insulin franchise: patents, manufacturing scale, script switching) — firm. '
        + 'Shariah sector COMPLIANT (pharma permissible) — firm. OE-bridge USD figures APPROXIMATE (DKK/IFRS '
        + '20-F filer; not cleanly grounded in USD here) — review near-misses rather than auto-fail.',
    },
  ],
}) as GoldenSet

/** Look up a golden-set company by ticker (case-insensitive). */
export function goldenSetCompany(ticker: string, set: GoldenSet = GOLDEN_SET): GoldenSetCompany | undefined {
  const upper = ticker.trim().toUpperCase()
  return set.companies.find((c) => c.ticker.toUpperCase() === upper)
}
