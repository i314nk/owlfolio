import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import type { Provider } from '@owlfolio/providers'
import { groundProposedSourcesDeterministic } from '../sourceGrounding'
import type { GroundFn } from '../groundedAgent'
import { openHoldingFromWatchlist, recordHoldingValuationSnapshot } from '../holdingWorkflow'
import { confirmHoldingReviewDraft, draftHoldingReview } from '../holdingReviewWorkflow'
import { CHECKLIST_PARAMS, listBusinessItems, type ChecklistAudit } from '@owlfolio/strategies/checklistParams'

// The holding review is a HELD-position thesis-health judgment. It MUST run through the grounding harness
// (cite-verified against the content_hash-confirmed corpus) and FAIL CLOSED when the model grounds nothing
// — a confident "thesis intact" on ungrounded input must never be presented as grounded. These tests are
// the regression guard against the old `provider.structured(...)` ungrounded path.

const EDGAR_SRC = (id: string) => ({
  source_id: id,
  title: 'Test 10-K',
  url: 'https://www.sec.gov/Archives/edgar/data/0/test-10k.htm',
  excerpt: 'Durable moat, aligned management, conservative balance sheet.',
})

async function openHolding(store: InMemoryEventStore) {
  const holding = await openHoldingFromWatchlist(store, {
    holding_id: 'holding_cost_001',
    watchlist_item_id: 'watch_cost_001',
    research_case_id: 'rc_cost_001',
    company_id: 'company_cost',
    ticker: 'COST',
    strategy_id: 'buffett-munger',
    thesis_summary: 'Durable quality compounder.',
    shares: 3,
    cost_basis_per_share: 800,
    opened_at: '2026-05-31',
    currency: 'USD',
    causation_id: 'evt_watchlist_confirmed',
    actor_id: 'user_local',
  })
  await recordHoldingValuationSnapshot(store, {
    snapshot_id: 'valuation_holding_cost_001_2026_06_01',
    holding_id: holding.holding_id,
    price_per_share: 900,
    currency: 'USD',
    valued_at: '2026-06-01',
    causation_id: holding.event_id,
    actor_id: 'user_local',
  })
  return holding
}

/** A fake provider whose holding-review payload proposes + cites the SAME (verifiable) primary source. */
function groundedFakeProvider(): Provider {
  return {
    provider_id: 'fake-grounded',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async () => ({
      thesis_health: 'HEALTHY',
      action_stance: 'HOLD',
      rationale: 'Thesis intact: durable moat, aligned management, no drift.',
      evidence_summary: 'Reviewed the latest 10-K and the valuation snapshot.',
      uncertainty: 'Refresh after the next quarterly filing.',
      next_review_at: '2026-09-30',
      source_ids: ['src_review_1'],
      proposed_sources: [EDGAR_SRC('src_review_1')],
    })),
  } as unknown as Provider
}

/** A fake provider emitting a CONFIDENT thesis but proposing sources nothing will verify. */
function ungroundedFakeProvider(): Provider {
  return {
    provider_id: 'fake-ungrounded',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async () => ({
      thesis_health: 'HEALTHY',
      action_stance: 'HOLD',
      rationale: 'Thesis intact (model claim, ungrounded).',
      evidence_summary: 'No real sources.',
      uncertainty: 'None.',
      next_review_at: '2026-09-30',
      source_ids: ['src_phantom_1'],
      proposed_sources: [EDGAR_SRC('src_phantom_1')],
    })),
  } as unknown as Provider
}

/** A ground fn that verifies NOTHING (the model grounded nothing — empty verified_ids). */
const groundNothing: GroundFn = async () => ({ captured: [], verified_ids: [] })

function completeChecklistAudit(): ChecklistAudit {
  const business_findings: Record<string, string> = {}
  for (const item of listBusinessItems()) {
    business_findings[item.id] = `Marshaled finding for ${item.id} at re-underwrite.`
  }
  return { version: CHECKLIST_PARAMS.version, business_findings, cognitive_acknowledged: true }
}

describe('holding review grounding harness (fail-closed)', () => {
  it('emits the confident thesis_health/action_stance when the judgment cite-verifies', async () => {
    const store = new InMemoryEventStore()
    const holding = await openHolding(store)

    const draft = await draftHoldingReview(
      store,
      groundedFakeProvider(),
      {
        review_id: 'review_grounded',
        holding_id: holding.holding_id,
        model_id: 'fake-model',
        causation_id: holding.event_id,
      },
      { ground: groundProposedSourcesDeterministic as unknown as GroundFn },
    )

    expect(draft.thesis_health).toBe('HEALTHY')
    expect(draft.action_stance).toBe('HOLD')
    expect(draft.payload.holding_review_ungrounded).toBeUndefined()
    // The cited corpus = the verified citation(s).
    expect(draft.source_ids).toContain('src_review_1')
  })

  it('FAILS CLOSED when the model grounds nothing — flag + abstain, not a confident "thesis intact"', async () => {
    const store = new InMemoryEventStore()
    const holding = await openHolding(store)

    const draft = await draftHoldingReview(
      store,
      ungroundedFakeProvider(),
      {
        review_id: 'review_ungrounded',
        holding_id: holding.holding_id,
        model_id: 'fake-model',
        causation_id: holding.event_id,
      },
      { ground: groundNothing },
    )

    // Visible fail-closed flag.
    expect(draft.payload.holding_review_ungrounded).toBe(true)
    expect(draft.payload.ungrounded_reason).toMatch(/holding_review_ungrounded/)
    // NOT the model's confident judgment — a conservative abstain.
    expect(draft.thesis_health).not.toBe('HEALTHY')
    expect(draft.thesis_health).toBe('WATCH')
    expect(draft.action_stance).toBe('RESEARCH_MORE')
    // No verified citations leaked into the cited corpus.
    expect(draft.source_ids).toEqual([])
  })

  it('the degraded draft still requires human approval (the signed-close boundary is unchanged)', async () => {
    const store = new InMemoryEventStore()
    const holding = await openHolding(store)

    const draft = await draftHoldingReview(
      store,
      ungroundedFakeProvider(),
      {
        review_id: 'review_still_human',
        holding_id: holding.holding_id,
        model_id: 'fake-model',
        causation_id: holding.event_id,
      },
      { ground: groundNothing },
    )

    expect(draft.user_approved).toBe(false)
    expect(draft.reviewed_by_actor_type).toBe('provider')

    // The human can still confirm it (advisory draft → human-signed close), and the close stays
    // completion-blocked on the audit exactly as before.
    const confirmation = await confirmHoldingReviewDraft(store, {
      review_id: draft.review_id,
      holding_id: draft.holding_id,
      causation_id: draft.event_id,
      actor_id: 'user_local',
      checklist_audit: completeChecklistAudit(),
    })
    expect(confirmation.event_type).toBe('holding_review_confirmed')
    expect(confirmation.confirmed_by_actor_type).toBe('user')
    // The confirmed thesis carries the conservative degraded stance, not a confident one.
    expect(confirmation.thesis_health).toBe('WATCH')
  })
})
