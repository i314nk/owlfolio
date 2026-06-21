// Versioned judgment-rubric provenance — the logged version string for the judgment-objectivity layer.
//
// HISTORY: judgment-objectivity-layer-spec Mechanism 1 once decomposed each judgment-heavy lane into a
// rubric of falsifiable, scored sub-questions, with the harness mapping the total score to a tier. That
// per-row rubric machinery (MOAT/MANAGEMENT/PREDICTABILITY/RUNWAY rubrics + the resolveRubricTier mapping)
// was RETIRED by the rubric→grounded-thesis migration: moat and runway now resolve from a grounded cited
// thesis (resolveMoatThesis / resolveRunwayThesis), corroborated by the deterministic quant anchors
// (computeMoatAnchor / computeRunwayAnchor in @owlfolio/workflow). Predictability folded into the circle
// judgment; management was never wired into a binding gate.
//
// What survives here:
//   - RubricTier — the tier-name string alias still used widely across the moat/runway resolution shapes.
//   - JUDGMENT_RUBRICS.version — the monotonic provenance string written to the ledger (rubric_version) and
//     projected. Bump it on a deliberate, logged change to the judgment scoring rules.

/** Ordered classification tier name (e.g. 'narrow' | 'moderate' | 'wide' | 'monopoly'). */
export type RubricTier = string

/**
 * Frozen provenance for the judgment-objectivity layer. Only `version` remains after the per-row rubric
 * machinery was retired; bump it on a deliberate, logged change and pair it with a config event.
 */
export const JUDGMENT_RUBRICS = Object.freeze({
  version: 'judgment-rubrics-2026-06-mechanism-1-2-v1',
})
