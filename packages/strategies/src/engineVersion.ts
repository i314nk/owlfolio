// Engine-version marker — the at-a-glance reasoning-vintage stamp for research dossiers.
//
// WHY THIS EXISTS (the POOL episode): a post-F.2 run whose valuation lane still free-lanced the retired
// Treasury methodology required a manual investigation to determine its reasoning vintage, because the
// engine version was nowhere visible on the dossier. ENGINE_VERSION makes that vintage diagnosable at a
// glance: it is stamped on the analysis event, projected onto the case, and surfaced in the dossier + run
// list so a stale run is visibly flagged rather than silently trusted.
//
// WHY IT IS DERIVED (not a hand-bumped constant): the WHOLE point of the marker is that it cannot silently
// fail to reflect a methodology change. A hand-maintained constant could drift out of sync with the
// methodology it claims to describe — the exact failure this marker is meant to prevent. So ENGINE_VERSION
// is COMPOSED from the existing methodology version strings; it AUTO-CHANGES whenever either the valuation
// parameter set or the judgment-rubric provenance is bumped. No separate bump step exists or is needed.

import { JUDGMENT_RUBRICS } from './judgmentRubrics'
import { VALUATION_PARAMS } from './valuationParams'

/**
 * The composite engine-version marker, derived from the live methodology version strings. It changes
 * automatically the moment VALUATION_PARAMS.version or JUDGMENT_RUBRICS.version is bumped — there is
 * deliberately nothing to hand-maintain here.
 */
export const ENGINE_VERSION = `${VALUATION_PARAMS.version} / ${JUDGMENT_RUBRICS.version}`
