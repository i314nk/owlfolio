import { describe, expect, it } from 'vitest'
import {
  clusterKeyForPosition,
  evaluateClusterCap,
  type ClusteredPosition,
} from '../correlatedClusters'
import { SIZING_PARAMS } from '../sizingParams'

// Phase 5 S4 — the permanent-loss cap binds across CORRELATED CLUSTERS, not just per-name (F.5
// generalized). Cluster keys are a COARSE SIC-2-digit proxy + a default-empty scenario-tag seam — NOT a
// guessed correlation matrix. Missing SIC + no tag → own cluster + a VISIBLE caveat (fail-open, surfaced).

const pos = (over: Partial<ClusteredPosition> & { ticker: string }): ClusteredPosition => ({
  entry_price_per_share: 100,
  position_value: 0,
  ...over,
})

describe('clusterKeyForPosition', () => {
  it('SIC present → 2-digit major-group prefix key (sic:NN), basis sic_proxy', () => {
    const { key, basis } = clusterKeyForPosition(pos({ ticker: 'AAA', sic: '7372' }))
    expect(key).toBe('sic:73')
    expect(basis).toBe('sic_proxy')
  })

  it('config cluster_sic_digits widens/narrows the prefix (acceptance-#7 analogue)', () => {
    const p = pos({ ticker: 'AAA', sic: '7372' })
    expect(clusterKeyForPosition(p, { ...SIZING_PARAMS, cluster_sic_digits: 1 }).key).toBe('sic:7')
    expect(clusterKeyForPosition(p, { ...SIZING_PARAMS, cluster_sic_digits: 3 }).key).toBe('sic:737')
  })

  it('no SIC but a scenario tag → tag key (tag:X), basis scenario_tag', () => {
    const { key, basis } = clusterKeyForPosition(pos({ ticker: 'AAA', scenario_tags: ['rates'] }))
    expect(key).toBe('tag:rates')
    expect(basis).toBe('scenario_tag')
  })

  it('neither SIC nor tag → own cluster (unclustered:TICKER), basis unclustered', () => {
    const { key, basis } = clusterKeyForPosition(pos({ ticker: 'AAA' }))
    expect(key).toBe('unclustered:AAA')
    expect(basis).toBe('unclustered')
  })
})

describe('evaluateClusterCap', () => {
  // F.5 BIND: two same-SIC-prefix names, each individually within the per-name threshold but JOINTLY over.
  it('two same-SIC names individually OK but jointly over → second buy is cluster-capped (binding)', () => {
    // entry 100, floor 10 → downside 90/share → downside-per-$ = 0.9. book_nav 100_000, threshold 0.05
    //   → cluster loss budget = 0.05 × 100_000 = 5_000 → cluster value budget = 5_000 / 0.9 = 5_555.56.
    // Held name AAA already occupies $4,000 (loss $3,600 → impairment 0.036, individually < 0.05).
    // Candidate BBB same SIC prefix, proposed $4,000 (individually 0.036 < 0.05) — but cluster aggregate
    //   ($8,000 × 0.9 = $7,200 = 0.072) > 0.05 → cluster-capped. Max sizeable for candidate = 5_555.56 −
    //   4_000 = 1_555.56.
    const held: ClusteredPosition[] = [
      pos({ ticker: 'AAA', sic: '7372', floor_per_share: 10, entry_price_per_share: 100, position_value: 4_000 }),
    ]
    const result = evaluateClusterCap({
      candidate: pos({ ticker: 'BBB', sic: '7389', floor_per_share: 10, entry_price_per_share: 100 }),
      held_book: held,
      book_nav: 100_000,
      proposed_value: 4_000,
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.binding).toBe(true)
    expect(result.max_sizeable_value).toBeLessThan(4_000)
    expect(result.max_sizeable_value).toBeCloseTo(1_555.5556, 3)
    expect(result.cluster.cluster_key).toBe('sic:73')
    expect(result.cluster.cluster_basis).toBe('sic_proxy')
    expect(result.cluster.within_threshold).toBe(false)
  })

  it('different SIC, no shared tag → each its own cluster → candidate sized in full (not aggregated)', () => {
    const held: ClusteredPosition[] = [
      pos({ ticker: 'AAA', sic: '2000', floor_per_share: 10, position_value: 4_000 }),
    ]
    const result = evaluateClusterCap({
      candidate: pos({ ticker: 'BBB', sic: '7372', floor_per_share: 10 }),
      held_book: held,
      book_nav: 100_000,
      proposed_value: 4_000,
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.binding).toBe(false)
    expect(result.max_sizeable_value).toBe(4_000)
    expect(result.cluster.cluster_key).toBe('sic:73')
    // AAA is in sic:20, not aggregated into the candidate's sic:73 cluster.
    expect(result.cluster.aggregate_impairment_fraction).toBeCloseTo(0.036, 6)
  })

  it('shared scenario tag across DIFFERENT SIC → clustered together (the tag seam works)', () => {
    // The candidate has a SIC, but it ALSO shares a scenario tag with a different-SIC held name. The shared
    // tag joins them: a held name sharing ANY scenario_tags entry with the candidate is in the cluster.
    const held: ClusteredPosition[] = [
      pos({ ticker: 'AAA', sic: '2000', scenario_tags: ['rates'], floor_per_share: 10, position_value: 4_000 }),
    ]
    const result = evaluateClusterCap({
      candidate: pos({ ticker: 'BBB', sic: '7372', scenario_tags: ['rates'], floor_per_share: 10 }),
      held_book: held,
      book_nav: 100_000,
      proposed_value: 4_000,
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    // AAA (different SIC) is pulled into the cluster via the shared 'rates' tag → joint $8,000 → binding.
    expect(result.binding).toBe(true)
    expect(result.max_sizeable_value).toBeCloseTo(1_555.5556, 3)
    expect(result.cluster.aggregate_impairment_fraction).toBeCloseTo(0.072, 6)
  })

  it('candidate missing SIC + no tag → own cluster + the VISIBLE caveat (not silently aggregated)', () => {
    const held: ClusteredPosition[] = [
      pos({ ticker: 'AAA', sic: '7372', floor_per_share: 10, position_value: 4_000 }),
    ]
    const result = evaluateClusterCap({
      candidate: pos({ ticker: 'BBB', floor_per_share: 10 }), // no sic, no tag
      held_book: held,
      book_nav: 100_000,
      proposed_value: 4_000,
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.cluster.cluster_basis).toBe('unclustered')
    expect(result.cluster.cluster_key).toBe('unclustered:BBB')
    // NOT aggregated with AAA → candidate sizeable in full ($4,000 → 0.036 < 0.05).
    expect(result.binding).toBe(false)
    // The gap is SURFACED, never a silent independence assumption.
    const caveat = result.cluster.caveats.join(' ').toLowerCase()
    expect(caveat).toContain('unclusterable')
    expect(caveat).toContain('sic missing')
    expect(caveat).toContain('not counted')
  })

  it('candidate cannot_floor (no floor) → cannot_size (fail-closed, ties to S3)', () => {
    const result = evaluateClusterCap({
      candidate: pos({ ticker: 'BBB', sic: '7372' }), // floor_per_share undefined
      held_book: [],
      book_nav: 100_000,
      proposed_value: 4_000,
    })
    expect(result.status).toBe('cannot_size')
    if (result.status !== 'cannot_size') return
    expect(result.reason.toLowerCase()).toContain('floor')
  })

  it('held member missing floor → caveat surfaced (conservative, NOT silent-zero)', () => {
    // AAA shares the candidate's cluster but has no floor → its impairment can't be aggregated. We must
    // FLAG it, not treat it as zero-loss.
    const held: ClusteredPosition[] = [
      pos({ ticker: 'AAA', sic: '7372', position_value: 4_000 }), // no floor_per_share
    ]
    const result = evaluateClusterCap({
      candidate: pos({ ticker: 'BBB', sic: '7389', floor_per_share: 10 }),
      held_book: held,
      book_nav: 100_000,
      proposed_value: 4_000,
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const caveat = result.cluster.caveats.join(' ').toLowerCase()
    expect(caveat).toContain('aaa')
    expect(caveat).toContain('floor')
    // It is in the cluster (same sic:73) but its loss is uncounted — flagged, not silent-zero.
    expect(result.cluster.cluster_key).toBe('sic:73')
  })

  it('book_recovery_threshold mutation changes the cluster bind (config-driven, acceptance-#7 analogue)', () => {
    const args = {
      candidate: pos({ ticker: 'BBB', sic: '7389', floor_per_share: 10 }),
      held_book: [pos({ ticker: 'AAA', sic: '7372', floor_per_share: 10, position_value: 4_000 })],
      book_nav: 100_000,
      proposed_value: 4_000,
    }
    // Loosen threshold to 0.10 → cluster aggregate 0.072 ≤ 0.10 → not binding.
    const loose = evaluateClusterCap({ ...args, params: { ...SIZING_PARAMS, book_recovery_threshold: 0.10 } })
    expect(loose.status).toBe('ok')
    if (loose.status === 'ok') expect(loose.binding).toBe(false)

    // Default 0.05 → 0.072 > 0.05 → binds.
    const tight = evaluateClusterCap(args)
    expect(tight.status).toBe('ok')
    if (tight.status === 'ok') expect(tight.binding).toBe(true)
  })

  it('cluster_sic_digits mutation re-groups: widening to 1 digit merges sic:73 and sic:74', () => {
    const args = {
      candidate: pos({ ticker: 'BBB', sic: '7400', floor_per_share: 10 }),
      held_book: [pos({ ticker: 'AAA', sic: '7300', floor_per_share: 10, position_value: 4_000 })],
      book_nav: 100_000,
      proposed_value: 4_000,
    }
    // 2-digit: candidate sic:74, held sic:73 → different clusters → not binding.
    const split = evaluateClusterCap(args)
    expect(split.status).toBe('ok')
    if (split.status === 'ok') expect(split.binding).toBe(false)

    // 1-digit: both sic:7 → one cluster → joint $8,000 → binding.
    const merged = evaluateClusterCap({ ...args, params: { ...SIZING_PARAMS, cluster_sic_digits: 1 } })
    expect(merged.status).toBe('ok')
    if (merged.status === 'ok') {
      expect(merged.binding).toBe(true)
      expect(merged.cluster.cluster_key).toBe('sic:7')
    }
  })

  it('fail-closed on non-positive book_nav → cannot_size', () => {
    const result = evaluateClusterCap({
      candidate: pos({ ticker: 'BBB', sic: '7372', floor_per_share: 10 }),
      held_book: [],
      book_nav: 0,
      proposed_value: 4_000,
    })
    expect(result.status).toBe('cannot_size')
  })
})
