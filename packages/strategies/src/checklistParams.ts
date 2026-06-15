// Versioned, data-defined hygiene-checklist item set (Phase 7 S1) — the SINGLE source of truth for
// the TWO decision-NEUTRAL review checklists. Sibling of sellParams.ts/sizingParams.ts: a frozen,
// versioned object. Adding/editing/removing a checklist item is a DATA edit here (bump `version`),
// never an engine change — the evaluator (checklist.ts) iterates this list, so a newly-added item is
// automatically required.
//
// There are two checklists, both defined here, distinguished only by `category`:
//   - 'business' (11 items): guards the INVESTMENT. Groundable — later slices marshal the named
//     projection field (`reads`) beside each item as evidence; the human still affirms.
//   - 'cognitive' (6 items): guards the HUMAN'S REASONING. Introspective and HUMAN-ONLY — these carry
//     NO `reads` field and later slices forbid any agent pre-fill.
//
// LOAD-BEARING DISCIPLINE: there is NO scoring/weight/priority field on an item, ever. The checklists
// FORCE the question; they never answer or rank it. (Mirrors the no-Kelly discipline in
// convictionFactor.ts — the structure makes scoring unrepresentable.)

/** Which checklist an item belongs to. Same item shape; different posture (groundable vs. human-only). */
export type ChecklistCategory = 'business' | 'cognitive'

/** One checklist item. NO scoring/weight field — the checklist forces the question, never scores it. */
export type ChecklistItemDefinition = {
  /** Stable kebab/snake id, e.g. 'overpaying_for_quality'. Stable across versions. */
  id: string
  /** Which checklist this item belongs to. */
  category: ChecklistCategory
  /** The exact question the human must address (verbatim from the Phase 7 spec). */
  prompt: string
  /**
   * business-only: a hint naming the persisted projection field a later slice (S4) will marshal as
   * evidence beside this item. Omitted for business items with no groundable value, and for ALL
   * cognitive items (introspective, human-only). NEVER a scoring/weight field.
   */
  reads?: string
}

/** The full versioned checklist set. Bump `version` on any change to the items. */
export type ChecklistParams = {
  /** Monotonic version string. Bump on every change to the item set. */
  version: string
  /** All checklist items (both categories). The evaluator iterates this list. */
  items: readonly ChecklistItemDefinition[]
}

/**
 * The frozen DEFAULT checklist set: 11 business items + 6 cognitive items.
 *
 * Extensibility contract: add a new item to this array (and bump `version`) and it is automatically
 * required by `evaluateChecklistCompletion` — no evaluator change. Removing a scoring lever is
 * impossible because no item-level scoring field exists.
 */
export const CHECKLIST_PARAMS: ChecklistParams = Object.freeze({
  version: 'checklist-2026-06-phase7-2',
  items: [
    // --- business (11): guards the investment; groundable (most carry a `reads` evidence hint). ---
    {
      id: 'overpaying_for_quality',
      category: 'business',
      prompt: "Am I paying for growth that's already priced in?",
      reads: 'valuation.market_implied_growth',
    },
    {
      id: 'moat_erosion',
      category: 'business',
      prompt: "What would erode this moat, and is there evidence it's beginning?",
      reads: 'valuation.moat_class',
    },
    {
      id: 'terminal_value_optimism',
      category: 'business',
      prompt: 'How much of IV is terminal, and am I comfortable underwriting that tail?',
      reads: 'valuation.terminal_value_pct_of_iv',
    },
    {
      id: 'cyclical_peak',
      category: 'business',
      prompt: 'Are these earnings mid-cycle or peak?',
      reads: 'owner_earnings_valuation.confidence',
    },
    {
      id: 'capital_allocation',
      category: 'business',
      prompt: 'Is management allocating capital well and honestly?',
    },
    {
      id: 'quality_of_earnings',
      category: 'business',
      prompt: 'Are the reported numbers trustworthy as owner earnings?',
      reads: 'valuation.owner_earnings_bridge',
    },
    {
      id: 'secular_disruption',
      category: 'business',
      prompt: 'Is the whole category at risk, not just the competitive position?',
    },
    {
      id: 'concentration_correlation',
      category: 'business',
      prompt: 'How does this correlate with what I already hold?',
      // S4: the per-name cluster key/basis (which correlated bucket, on what proxy) — persist-only carry of
      // the same evaluateClusterCap result that produced the aggregate downside fraction.
      reads: 'sizing_recommendation.worst_case.cluster_key',
    },
    {
      id: 'thesis_drift',
      category: 'business',
      prompt: 'Have I relaxed any criterion to make this fit?',
    },
    {
      id: 'shariah_drift',
      category: 'business',
      prompt:
        'Is this still compliant, or has the financial-ratio / revenue mix drifted since admission?',
      reads: 'shariah_status',
    },
    {
      id: 'data_completeness',
      category: 'business',
      prompt:
        'Is my owner-earnings history complete enough to trust, or am I extrapolating from a '
        + 'short/gappy series?',
      // S4: the OE-history depth actually used (span in years) — persist-only carry of the demonstrated-growth
      // measure's own window the valuation already consumed. A thin/gappy window reads as low completeness.
      reads: 'valuation.growth_window_years',
    },
    // --- cognitive (6): guards the human's reasoning; introspective, HUMAN-ONLY (NO `reads`). ---
    {
      id: 'anchoring',
      category: 'cognitive',
      prompt: 'Am I anchored to the purchase price, a past price, or my first estimate?',
    },
    {
      id: 'rationalization_commitment',
      category: 'cognitive',
      prompt: "Am I defending a conclusion I've already emotionally committed to?",
    },
    {
      id: 'pattern_match',
      category: 'cognitive',
      prompt: 'Am I assuming this resembles a prior success without testing it?',
    },
    {
      id: 'social_proof',
      category: 'cognitive',
      prompt:
        'Am I leaning on the fact that investors I respect hold it (clone the idea, not the '
        + 'conviction)?',
    },
    {
      id: 'disposition',
      category: 'cognitive',
      prompt:
        'Am I holding a loser to avoid realizing the loss, or selling a winner for the comfort of '
        + 'a gain?',
    },
    {
      id: 'recency_vividness',
      category: 'cognitive',
      prompt: 'Am I over-weighting recent or vivid information?',
    },
  ],
}) as ChecklistParams
