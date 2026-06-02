import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { defaultShariahDefaults } from '@owlfolio/shared'
import { createResearchCase, draftDecision } from '../researchWorkflow'
import { evaluateResearchCaseShariahGate, assertShariahGateAllowsTransition } from '../shariahGateWorkflow'

async function seedDecision(store: InMemoryEventStore, shariahStatus: 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'UNKNOWN' = 'COMPLIANT') {
  const researchCase = await createResearchCase(store, {
    research_case_id: `rc_${shariahStatus.toLowerCase()}_001`,
    company_id: `company_${shariahStatus.toLowerCase()}`,
    ticker: shariahStatus === 'UNKNOWN' ? 'UNK' : 'MSFT',
    strategy_id: 'buffett-munger',
    actor_id: 'user_local',
  })

  await store.append({
    event_id: `evt_analysis_${researchCase.research_case_id}`,
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: researchCase.research_case_id,
    correlation_id: researchCase.research_case_id,
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      research_case_id: researchCase.research_case_id,
      company_id: researchCase.company_id,
      ticker: researchCase.ticker,
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: shariahStatus,
      valuation_status: 'EXPENSIVE',
      next_required_action: 'Review source-backed evidence before promotion.',
    },
    source_ids: shariahStatus === 'UNKNOWN' ? [] : [`src_${researchCase.ticker.toLowerCase()}_10k_2025`, `src_${researchCase.ticker.toLowerCase()}_annual_2025`],
    created_at: '2026-06-01T00:00:00.000Z',
    schema_version: 1,
  })

  await draftDecision(store, {
    research_case_id: researchCase.research_case_id,
    decision_id: `decision_${researchCase.research_case_id}`,
    decision: 'WATCH',
    reason: 'Watch pending margin-of-safety and Shariah gate review.',
    causation_id: `evt_analysis_${researchCase.research_case_id}`,
  })

  return researchCase
}

describe('Shariah workflow gates', () => {
  it('allows compliant research promotion and records an auditable gate decision', async () => {
    const store = new InMemoryEventStore()
    const researchCase = await seedDecision(store, 'COMPLIANT')

    const decision = await evaluateResearchCaseShariahGate(store, {
      research_case_id: researchCase.research_case_id,
      target_transition: 'watchlist_promotion',
      target_id: 'watch_msft_001',
      shariah_defaults: defaultShariahDefaults(),
    })

    expect(decision).toMatchObject({
      target_transition: 'watchlist_promotion',
      target_id: 'watch_msft_001',
      research_case_id: researchCase.research_case_id,
      status: 'COMPLIANT',
      allowed: true,
      required_source_ids: ['src_msft_10k_2025', 'src_msft_annual_2025'],
      missing_evidence: [],
      conditional_allowed: true,
    })
    expect(assertShariahGateAllowsTransition(decision)).toBeUndefined()
    const events = await store.list()
    expect(events.at(-1)).toMatchObject({
      event_type: 'shariah_gate_decision_recorded',
      aggregate_type: 'decision',
      aggregate_id: decision.gate_decision_id,
      payload: expect.objectContaining({ allowed: true, status: 'COMPLIANT' }),
      source_ids: ['src_msft_10k_2025', 'src_msft_annual_2025'],
    })
  })

  it('allows conditional gates only when policy configuration allows conditional handling', async () => {
    const store = new InMemoryEventStore()
    const researchCase = await seedDecision(store, 'CONDITIONAL')

    const allowed = await evaluateResearchCaseShariahGate(store, {
      research_case_id: researchCase.research_case_id,
      target_transition: 'watchlist_confirmation',
      target_id: 'watch_conditional_001',
      shariah_defaults: { ...defaultShariahDefaults(), allow_conditional: true },
    })

    expect(allowed).toMatchObject({ status: 'CONDITIONAL', allowed: true, requires_user_confirmation: true })
    expect(allowed.reasons.join(' ')).toMatch(/conditional Shariah review|threshold/i)

    const blocked = await evaluateResearchCaseShariahGate(store, {
      research_case_id: researchCase.research_case_id,
      target_transition: 'holding_open',
      target_id: 'holding_conditional_001',
      shariah_defaults: { ...defaultShariahDefaults(), allow_conditional: false },
    })

    expect(blocked).toMatchObject({ status: 'PENDING', allowed: false, conditional_allowed: false })
    expect(() => assertShariahGateAllowsTransition(blocked)).toThrow(/Shariah gate blocked holding_open/)
  })

  it('blocks non-compliant or missing-evidence gates after recording user-facing reasons', async () => {
    const nonCompliantStore = new InMemoryEventStore()
    const nonCompliantCase = await seedDecision(nonCompliantStore, 'NON_COMPLIANT')
    const blocked = await evaluateResearchCaseShariahGate(nonCompliantStore, {
      research_case_id: nonCompliantCase.research_case_id,
      target_transition: 'holding_open',
      target_id: 'holding_blocked_001',
      shariah_defaults: defaultShariahDefaults(),
    })

    expect(blocked).toMatchObject({ status: 'NON_COMPLIANT', allowed: false })
    expect(blocked.reasons.join(' ')).toMatch(/prohibited|exceeds/i)
    await expect(nonCompliantStore.list()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'shariah_gate_decision_recorded', payload: expect.objectContaining({ allowed: false }) }),
    ]))

    const unknownStore = new InMemoryEventStore()
    const unknownCase = await seedDecision(unknownStore, 'UNKNOWN')
    const missing = await evaluateResearchCaseShariahGate(unknownStore, {
      research_case_id: unknownCase.research_case_id,
      target_transition: 'watchlist_promotion',
      target_id: 'watch_missing_001',
      shariah_defaults: defaultShariahDefaults(),
    })

    expect(missing).toMatchObject({ status: 'PENDING', allowed: false })
    expect(missing.missing_evidence).toEqual(['business_activity', 'non_compliant_income_ratio'])
    expect(missing.reasons.join(' ')).toMatch(/Missing sourced evidence/)
  })
})
