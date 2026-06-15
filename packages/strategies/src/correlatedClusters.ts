// Phase 5 S4 — the permanent-loss CAP binds across CORRELATED CLUSTERS, not just per-name (F.5 generalized).
//
// Names that break in the SAME scenario are one bet. A new buy must keep BOTH its own per-name
// permanent-loss (S3) AND its cluster's AGGREGATE permanent-loss within the book-recovery threshold.
//
// CLUSTER KEYS ARE A COARSE PROXY, NOT A CORRELATION MODEL. The primary key is the SIC 2-digit major-group
// prefix (`Fundamentals.sic`, width = `cluster_sic_digits`); the secondary seam is a SHARED scenario tag
// (DEFAULT-EMPTY — never populated speculatively). This SIC-prefix proxy is deliberately crude:
//   - it OVER-clusters: different businesses can share one broad sector code;
//   - it UNDER-clusters: a supplier and its customer sit in different SIC codes, and a shared macro driver
//     (rates, oil, FX) crosses sectors entirely.
// Nobody should trust it as more than a coarse grouping. To keep that coarseness travelling WITH the output,
// every result carries `cluster_basis` ('sic_proxy' | 'scenario_tag' | 'unclustered') and the unclustered
// path emits a VISIBLE caveat — we never silently assume independence.
//
// FAIL-OPEN + SURFACED: a name with neither a SIC nor a shared tag becomes its OWN cluster, and we attach a
// caveat saying its correlation with the book is NOT counted (the gap is made visible, not hidden).
// FAIL-CLOSED where S3 does: a CANDIDATE with no floor → cannot_size (ties to S2/S3). A HELD member with no
// floor is flagged via caveat and its loss left UNCOUNTED — never silently treated as zero-loss.
//
// ISLAND: pure, deterministic, no I/O, no LLM, no probability, no guessed correlation matrix. Same per-name
// impairment math as S3, summed across the cluster. Every constant is read from SizingParams.

import { SIZING_PARAMS, type SizingParams } from './sizingParams'

export type ClusteredPosition = {
  ticker: string
  /** From `Fundamentals.sic` (may be missing). 2-digit prefix → the primary cluster key. */
  sic?: string
  /** Optional named scenario tags — the DEFAULT-EMPTY secondary seam. Never populated speculatively. */
  scenario_tags?: string[]
  entry_price_per_share: number
  /** From S2; undefined when `cannot_floor`. */
  floor_per_share?: number
  /** Current $ exposure. */
  position_value: number
}

export type ClusterBasis = 'sic_proxy' | 'scenario_tag' | 'unclustered'

export type ClusterAggregateResult = {
  /** e.g. 'sic:73' | 'tag:rates' | 'unclustered:TICKER'. */
  cluster_key: string
  cluster_basis: ClusterBasis
  /** Σ over cluster members [ (value/entry) × max(entry − floor, 0) ] / book_nav (incl. the candidate). */
  aggregate_impairment_fraction: number
  within_threshold: boolean
  /** Surfaced gaps: an unclusterable candidate, or a held member whose missing floor left it uncounted. */
  caveats: string[]
}

export type ClusterCapResult =
  | {
      status: 'ok'
      /** The max candidate value ($) that keeps the CLUSTER aggregate ≤ book_recovery_threshold. */
      max_sizeable_value: number
      /** True when the proposed value would push the cluster over the threshold. */
      binding: boolean
      cluster: ClusterAggregateResult
      reason: string
    }
  | { status: 'cannot_size'; reason: string }

const finite = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/** Deterministic per-$invested loss-to-floor: max(entry − floor, 0) / entry. Same shape as S3. */
const downsidePerDollar = (entry: number, floor: number): number =>
  entry > 0 ? Math.max(entry - floor, 0) / entry : 0

/** The dollar loss-to-floor of a position at a given exposure value (S3 math). */
const positionLossAtFloor = (value: number, entry: number, floor: number): number =>
  value * downsidePerDollar(entry, floor)

/**
 * Compute the cluster key for one position.
 *   primary:   SIC present → `sic:` + the leading `cluster_sic_digits` digits (sic_proxy).
 *   secondary: no SIC but ≥1 scenario tag → `tag:` + the first tag (scenario_tag).
 *   fallback:  neither → `unclustered:` + ticker (its OWN cluster — independence assumed, surfaced upstream).
 *
 * NOTE: a position can both have a SIC key AND share a tag with the candidate; cluster MEMBERSHIP (in
 * evaluateClusterCap) is the union of "same SIC key" and "shares a tag", so the tag seam can pull a
 * different-SIC name into the cluster. This function returns the position's OWN primary key.
 */
export function clusterKeyForPosition(
  pos: ClusteredPosition,
  params: SizingParams = SIZING_PARAMS,
): { key: string; basis: ClusterBasis } {
  const digits = params.cluster_sic_digits
  const sic = typeof pos.sic === 'string' ? pos.sic.trim() : ''
  if (sic.length > 0 && finite(digits) && digits > 0) {
    return { key: `sic:${sic.slice(0, digits)}`, basis: 'sic_proxy' }
  }
  const firstTag = pos.scenario_tags?.find((t) => typeof t === 'string' && t.trim().length > 0)
  if (firstTag) {
    return { key: `tag:${firstTag.trim()}`, basis: 'scenario_tag' }
  }
  return { key: `unclustered:${pos.ticker}`, basis: 'unclustered' }
}

const sharesAnyTag = (a: ClusteredPosition, b: ClusteredPosition): boolean => {
  const at = a.scenario_tags ?? []
  const bt = b.scenario_tags ?? []
  if (at.length === 0 || bt.length === 0) return false
  const set = new Set(at.map((t) => t.trim()).filter((t) => t.length > 0))
  return bt.some((t) => set.has(t.trim()))
}

/**
 * Evaluate the correlated-cluster permanent-loss cap for a proposed candidate value.
 *
 * Cluster membership = the candidate, plus every held name that EITHER shares the candidate's primary
 * cluster key (same SIC 2-digit prefix / same tag key) OR shares any scenario tag with the candidate.
 *
 *   aggregate_loss(candidate_value) = candidate_loss_at_floor(candidate_value)
 *                                   + Σ held-member loss_at_floor (those with a floor)
 *   aggregate_impairment_fraction   = aggregate_loss / book_nav
 *
 * ALLOWED iff aggregate_impairment_fraction ≤ book_recovery_threshold. When the proposed value would push
 * the CLUSTER over, return the max candidate value that keeps the cluster ≤ threshold, binding: true.
 *
 * Fail-closed: candidate with no floor (S2 cannot_floor), or non-finite/non-positive entry/book_nav →
 * cannot_size. Fail-open + surfaced: an unclusterable candidate (no SIC, no tag) is its own cluster with a
 * visible caveat; a held member with no floor is flagged and left UNCOUNTED (never silent-zero).
 */
export function evaluateClusterCap(args: {
  candidate: ClusteredPosition
  held_book: ClusteredPosition[]
  book_nav: number
  proposed_value: number
  params?: SizingParams
}): ClusterCapResult {
  const params = args.params ?? SIZING_PARAMS
  const threshold = params.book_recovery_threshold
  const { candidate, held_book, book_nav, proposed_value } = args

  const entry = candidate.entry_price_per_share
  if (!finite(entry) || entry <= 0) {
    return { status: 'cannot_size', reason: 'candidate entry_price_per_share missing/non-positive — cannot size on the floor.' }
  }
  // Fail-closed, ties to S3: a candidate with no concrete floor (S2 cannot_floor) NEVER sizes on a guess.
  if (!finite(candidate.floor_per_share)) {
    return {
      status: 'cannot_size',
      reason:
        'candidate downside floor unavailable (S2 cannot_floor) — the permanent-loss cap binds on the '
        + 'concrete floor (a number), never on a quality re-judgment; fail-closed, no size.',
    }
  }
  if (!finite(book_nav) || book_nav <= 0) {
    return { status: 'cannot_size', reason: 'book_nav missing/non-positive — cannot compute cluster impairment.' }
  }
  if (!finite(proposed_value) || proposed_value < 0) {
    return { status: 'cannot_size', reason: 'proposed_value missing/negative — nothing to size.' }
  }
  if (!finite(threshold) || threshold <= 0) {
    return { status: 'cannot_size', reason: 'book_recovery_threshold missing/non-positive — fail-closed.' }
  }

  const candidateFloor = candidate.floor_per_share
  const { key: cluster_key, basis: cluster_basis } = clusterKeyForPosition(candidate, params)

  const caveats: string[] = []
  if (cluster_basis === 'unclustered') {
    // FAIL-OPEN + SURFACED: never silently assume independence — make the gap visible.
    caveats.push(
      `unclusterable (SIC missing): treated as its own cluster — correlation with the book is NOT counted`,
    )
  }

  // Cluster membership: a held name joins the candidate's cluster if it shares the candidate's primary key
  // OR shares any scenario tag with the candidate (the tag seam crosses SIC).
  const members = held_book.filter((h) => {
    const sameKey = clusterKeyForPosition(h, params).key === cluster_key
    return sameKey || sharesAnyTag(candidate, h)
  })

  // Σ held-member loss-to-floor. A member missing a floor is FLAGGED and its loss UNCOUNTED (conservative —
  // not silently zero; the caveat says its impairment could not be aggregated).
  let heldLoss = 0
  for (const m of members) {
    if (!finite(m.floor_per_share)) {
      caveats.push(
        `held member ${m.ticker} has no concrete floor (S2 cannot_floor) — its permanent-loss could NOT be `
        + `aggregated into the cluster; treat the cluster aggregate as an UNDER-estimate.`,
      )
      continue
    }
    if (!finite(m.entry_price_per_share) || m.entry_price_per_share <= 0 || !finite(m.position_value)) {
      caveats.push(`held member ${m.ticker} has a non-finite entry/value — excluded from the aggregate.`)
      continue
    }
    heldLoss += positionLossAtFloor(m.position_value, m.entry_price_per_share, m.floor_per_share)
  }

  const candidateDownsidePerDollar = downsidePerDollar(entry, candidateFloor)
  const lossBudget = threshold * book_nav

  // Max candidate value keeping the CLUSTER aggregate ≤ threshold: candidateLoss ≤ lossBudget − heldLoss.
  // candidateLoss(value) = value × candidateDownsidePerDollar. With zero candidate downside → no cap.
  const candidateLossBudget = lossBudget - heldLoss
  const maxSizeableValue =
    candidateDownsidePerDollar <= 0
      ? Number.POSITIVE_INFINITY
      : Math.max(candidateLossBudget, 0) / candidateDownsidePerDollar

  const candidateLossAtFloor = positionLossAtFloor(proposed_value, entry, candidateFloor)
  const aggregateLoss = heldLoss + candidateLossAtFloor
  const aggregate_impairment_fraction = aggregateLoss / book_nav
  const within_threshold = aggregate_impairment_fraction <= threshold

  const binding = proposed_value > maxSizeableValue
  const allowedValue = binding ? maxSizeableValue : proposed_value
  const pct = (n: number): string => `${(n * 100).toFixed(2)}%`

  const basisLabel =
    cluster_basis === 'sic_proxy'
      ? 'COARSE SIC-2-digit proxy (NOT a correlation model)'
      : cluster_basis === 'scenario_tag'
        ? 'shared scenario-tag seam'
        : 'unclustered (own bet — correlation with the book NOT counted)'

  const reason = binding
    ? `correlated-cluster cap binds: cluster ${cluster_key} (${basisLabel}) aggregate permanent-loss at the `
      + `concrete floors would impair ${pct(aggregate_impairment_fraction)} of book NAV > the `
      + `${pct(threshold)} recovery threshold; max sizeable for ${candidate.ticker} is $`
      + `${maxSizeableValue.toFixed(2)} (the rest of the cluster already uses $${heldLoss.toFixed(2)} of the `
      + `$${lossBudget.toFixed(2)} loss budget).`
    : `correlated-cluster cap clear: cluster ${cluster_key} (${basisLabel}) aggregate permanent-loss at the `
      + `concrete floors impairs ${pct(aggregate_impairment_fraction)} of book NAV ≤ the ${pct(threshold)} `
      + `recovery threshold.`

  return {
    status: 'ok',
    max_sizeable_value: allowedValue,
    binding,
    cluster: {
      cluster_key,
      cluster_basis,
      aggregate_impairment_fraction,
      within_threshold,
      caveats,
    },
    reason,
  }
}
