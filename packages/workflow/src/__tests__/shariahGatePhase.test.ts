import { describe, expect, it, vi } from 'vitest'

import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'

import { runShariahGatePhase } from '../shariahGatePhase'

// ---------------------------------------------------------------------------
// Restructure Phase 1 / S1 — the FRONT Shariah gate: the grounded sector judgment (the reasoning
// pass, moved forward and seeded with the pre-verified filing corpus) plus the deterministic AAOIFI
// ratio verdict when market cap is available. Runs BEFORE any lane spend. NON_COMPLIANT (sector or
// ratio FAIL) → gate closed (the caller emits the set-aside dossier); a FAILED pass or missing
// market cap degrades VISIBLY to undetermined and lets the run proceed (the post-lane machinery
// still fails closed later) — the gate must never fabricate compliance NOR block on its own outage.
// ---------------------------------------------------------------------------

const COMMAND = {
  research_case_id: 'rc_test_1',
  company_id: 'company_test',
  ticker: 'TST',
  model_id: 'test-model',
  causation_event_id: 'evt_case_created',
}

function passOutcome(sector: 'compliant' | 'conditional' | 'non_compliant', impermissible: number | null) {
  return {
    status: 'ok' as const,
    shariah_judgment: { sector_reasoning: 'Grounded sector basis (test fixture).', sector_status: sector, impermissible_income: impermissible, sector_citation: 'src_10k' },
  }
}

async function run(over: Partial<Parameters<typeof runShariahGatePhase>[2]> = {}, pass = passOutcome('compliant', 10)) {
  const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
  const reasoningPass = vi.fn(async () => pass)
  const result = await runShariahGatePhase(store, COMMAND, {
    reasoningPass: reasoningPass as never,
    corpusSourceIds: ['src_10k'],
    ...over,
  })
  return { store, result, reasoningPass }
}

describe('runShariahGatePhase (the front gate)', () => {
  it('compliant sector → gate OPEN, shariah_gate_judged event recorded with the judgment', async () => {
    const { store, result } = await run()
    expect(result.allowed).toBe(true)
    expect(result.judgment?.sector_status).toBe('compliant')
    const events = await store.list()
    const gate = events.find((e) => e.event_type === 'shariah_gate_judged')!
    expect(gate).toBeDefined()
    expect(gate.aggregate_id).toBe('rc_test_1')
    const payload = gate.payload as Record<string, unknown>
    expect(payload.allowed).toBe(true)
    expect(payload.sector_status).toBe('compliant')
  })

  it('NON_COMPLIANT sector → gate CLOSED with a legible reason (dies before any lane spend)', async () => {
    const { result, store } = await run({}, passOutcome('non_compliant', null))
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/non.compliant|sector/i)
    // Dogfood pin: the model's grounded WHY rides the event AND the human-facing reason string.
    expect(result.reason).toContain('Grounded sector basis (test fixture).')
    const gate = (await store.list()).find((e) => e.event_type === 'shariah_gate_judged')!
    expect((gate.payload as Record<string, unknown>).allowed).toBe(false)
    expect((gate.payload as Record<string, unknown>).sector_reasoning).toBe('Grounded sector basis (test fixture).')
  })

  it('deterministic AAOIFI ratio FAIL → gate CLOSED even when the sector is compliant', async () => {
    const { result } = await run({
      ratioInputs: {
        interest_bearing_debt: 900, // 90% of market cap — far over the AAOIFI ceiling
        cash_and_securities: 50,
        total_revenue: 400,
        market_cap: 1000,
      },
    }, passOutcome('compliant', 5))
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/ratio/i)
  })

  it('ratio inputs absent (no market cap yet) → ratios undetermined, gate decides on sector alone', async () => {
    const { result } = await run({}, passOutcome('conditional', null))
    expect(result.allowed).toBe(true)
    expect(result.judgment?.sector_status).toBe('conditional')
  })

  it('FAILED reasoning pass → gate OPEN but VISIBLY undetermined (never fabricated compliance, never a self-outage block)', async () => {
    const { result, store } = await run({}, { status: 'failed' } as never)
    expect(result.allowed).toBe(true)
    const payload = (await store.list()).find((e) => e.event_type === 'shariah_gate_judged')!.payload as Record<string, unknown>
    expect(payload.sector_status).toBe('undetermined')
    expect(payload.gate_incomplete).toBe(true)
  })
})

describe('runShariahGatePhase — entity-mention guard (live contamination find, 2026-07-10)', () => {
  const GUARDED_COMMAND = { ...COMMAND, entity_name: 'TESTCO INDUSTRIES INC' }

  it('discards a wrong-company narrative → gate_incomplete (open, undetermined), never a trusted verdict', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    const result = await runShariahGatePhase(store, GUARDED_COMMAND, {
      reasoningPass: (async () => ({
        status: 'ok' as const,
        // The narrative describes ANOTHER company — mentions neither the ticker nor the entity.
        shariah_judgment: { sector_status: 'compliant', sector_reasoning: 'MegaBank Corp derives revenue from interest-based lending.', impermissible_income: 5, sector_citation: 'src_10k' },
      })) as never,
      corpusSourceIds: ['src_10k'],
    })
    expect(result.allowed).toBe(true) // open — never a self-inflicted block
    expect(result.judgment).toBeUndefined() // the contaminated judgment is NOT trusted
    const payload = (await store.list()).find((e) => e.event_type === 'shariah_gate_judged')!.payload as Record<string, unknown>
    expect(payload.sector_status).toBe('undetermined')
    expect(payload.gate_incomplete).toBe(true)
    expect(payload.entity_mismatch_discarded).toBe(true)
    expect(result.reason).toMatch(/wrong-company/)
  })

  it('accepts a narrative that names the entity (or ticker) — judged normally', async () => {
    const store = new InMemoryEventStore<LedgerEventEnvelope<unknown>>()
    const result = await runShariahGatePhase(store, GUARDED_COMMAND, {
      reasoningPass: (async () => ({
        status: 'ok' as const,
        shariah_judgment: { sector_status: 'non_compliant', sector_reasoning: 'Testco Industries derives core revenue from prohibited activities.', impermissible_income: 100, sector_citation: 'src_10k' },
      })) as never,
      corpusSourceIds: ['src_10k'],
    })
    expect(result.allowed).toBe(false)
    const payload = (await store.list()).find((e) => e.event_type === 'shariah_gate_judged')!.payload as Record<string, unknown>
    expect(payload.sector_status).toBe('non_compliant')
    expect(payload.entity_mismatch_discarded).toBeUndefined()
  })
})
