import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import { createResearchCase, draftDecision } from '@owlfolio/workflow'
import { afterEach, describe, expect, it } from 'vitest'

import { promoteResearchCaseToWatchlist } from '../workflow'

// ---------------------------------------------------------------------------
// scope-reframe — lightening the sell/freeze. The band/gap decision engine was removed, so the sign-off
// freeze no longer records a sustainable-growth BAND. promoteResearchCaseToWatchlist (the admit/sign-off
// path) now freezes a frozen REFERENCE fair value (`frozen_reference_fair_value`) + the normalized
// owner-earnings/share (`frozen_oe_ps`) — and drops `frozen_band_low` / `frozen_band_high`. The reference
// is the forward two-stage fair value off the frozen oe_ps + the sign-off assumed growth (a reference,
// NOT a band). Don't-move-the-number (F.9/F.10): the freeze with its valuation-version provenance.
// FAIL-CLOSED: a case with no oe_ps freezes the reference ABSENT.
//
// Sibling file (NOT workflow.test.ts) per the slice's test-placement guidance.
// ---------------------------------------------------------------------------



function makeState(ledgerPath: string, sourceLedgerPath: string) {
  return {
    config: {
      ...defaultPersonalLocalAppConfig(),
      provider: {
        provider_id: 'mock-provider' as const,
        support_level: 'certified' as const,
        model_id: 'mock-buffett-munger-demo',
      },
      initialized_at: '2026-06-09T12:00:00.000Z',
      ledger_path: ledgerPath,
      source_ledger_path: sourceLedgerPath,
    },
    is_initialized: true,
  }
}

/**
 * Seed a research case whose `buffett_munger_analysis_drafted` carries a `valuation` payload, then a drafted
 * WATCH decision so the case is ready for promotion.
 */
async function seedCase(
  ledgerPath: string,
  valuation: Record<string, unknown> | undefined,
): Promise<{ research_case_id: string }> {
  const researchCaseId = `rc_iv_${Date.now()}`
  const decisionId = `decision_iv_${Date.now()}`
  const sourceIds = ['src_iv_10k_2025', 'src_iv_proxy_2025', 'src_iv_q1_2026']
  const store = new SQLiteEventStore(ledgerPath)
  try {
    const researchCase = await createResearchCase(store, {
      research_case_id: researchCaseId,
      company_id: 'company_iv',
      ticker: 'IVCO',
      strategy_id: 'buffett-munger',
      actor_id: 'user_local',
    })
    await store.append({
      event_id: `evt_buffett_munger_analysis_drafted_${researchCaseId}`,
      event_type: 'buffett_munger_analysis_drafted',
      aggregate_type: 'research_case',
      aggregate_id: researchCaseId,
      correlation_id: researchCaseId,
      actor_type: 'provider',
      actor_id: 'mock-provider',
      payload: {
        research_case_id: researchCaseId,
        company_id: 'company_iv',
        ticker: 'IVCO',
        investment_verdict: 'WATCH',
        shariah_status: 'COMPLIANT',
        ...(valuation === undefined ? {} : { valuation }),
      },
      source_ids: sourceIds,
      created_at: new Date().toISOString(),
      schema_version: 1,
    })
    await draftDecision(store, {
      research_case_id: researchCaseId,
      decision_id: decisionId,
      decision: 'WATCH',
      reason: 'Durable business; wait for a wider margin of safety.',
      causation_id: researchCase.event_id,
      source_ids: sourceIds,
    })
  } finally {
    store.close()
  }
  return { research_case_id: researchCaseId }
}


describe('promoteResearchCaseToWatchlist — freeze a REFERENCE fair value at sign-off (scope-reframe; not a band)', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  it('E2: freezes the BOOK intrinsic value verbatim as frozen_reference_fair_value (no OE derive)', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-frozen-ref-'))
    dirs.push(projectDir)
    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
    const state = makeState(ledgerPath, join(projectDir, 'data', 'source-ledger'))

    // The case carries the computed book IV (264.08) + the computed buy threshold (184.86).
    const { research_case_id } = await seedCase(ledgerPath, {
      intrinsic_value_per_share: 264.08,
      buy_price_per_share: 184.86,
    })

    const promoted = await promoteResearchCaseToWatchlist(state, research_case_id)

    expect(promoted.frozen_iv_valuation_version).toBe(VALUATION_PARAMS.version)
    // The frozen reference IS the book IV, snapshotted verbatim — distinct from the margined buy-below.
    expect(promoted.frozen_reference_fair_value).toBe(264.08)
    expect(promoted.locked_buy_below).toBe(184.86)
    expect((promoted as Record<string, unknown>).frozen_band_low).toBeUndefined()
    expect((promoted as Record<string, unknown>).frozen_band_high).toBeUndefined()

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const [item] = projectWatchlist(await store.list())
      expect(item?.frozen_reference_fair_value).toBe(264.08)
      expect(item?.frozen_iv_valuation_version).toBe(VALUATION_PARAMS.version)
      expect(item?.locked_buy_below).toBe(184.86)
    } finally {
      store.close()
    }
  })

  it('leaves the frozen reference absent when the case has no oe_ps (fail-closed)', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-frozen-ref-none-'))
    dirs.push(projectDir)
    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
    const state = makeState(ledgerPath, join(projectDir, 'data', 'source-ledger'))

    // A valuation WITH a discounted buy-below but NO oe_ps.
    const { research_case_id } = await seedCase(ledgerPath, { buy_price_per_share: 150 })

    const promoted = await promoteResearchCaseToWatchlist(state, research_case_id)

    expect(promoted.frozen_oe_ps).toBeUndefined()
    expect(promoted.frozen_reference_fair_value).toBeUndefined()
    expect(promoted.frozen_iv_valuation_version).toBeUndefined()
    expect(promoted.locked_buy_below).toBe(150)

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const [item] = projectWatchlist(await store.list())
      expect(item?.frozen_oe_ps).toBeUndefined()
      expect(item?.frozen_reference_fair_value).toBeUndefined()
      expect(item?.frozen_iv_valuation_version).toBeUndefined()
      expect(item?.locked_buy_below).toBe(150)
    } finally {
      store.close()
    }
  })

  it('LEGACY TOLERANCE: a legacy event carrying frozen_band_* + frozen_iv still projects (frozen_iv → reference)', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-frozen-legacy-'))
    dirs.push(projectDir)
    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')

    const store = new SQLiteEventStore(ledgerPath)
    try {
      // A legacy watchlist confirmation written BEFORE the scope-reframe: it carries frozen_band_low/high +
      // the legacy frozen_iv price anchor. The projection must TOLERATE it (read via guards, not throw) and
      // map the old frozen_iv onto the new frozen_reference_fair_value.
      await store.append({
        event_id: 'evt_watchlist_draft_confirmed_legacy_wi',
        event_type: 'watchlist_draft_confirmed',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'legacy_wi',
        correlation_id: 'rc_legacy',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          watchlist_item_id: 'legacy_wi',
          research_case_id: 'rc_legacy',
          ticker: 'LEG',
          locked_buy_below: 120,
          frozen_band_low: 0.06,
          frozen_band_high: 0.10,
          frozen_oe_ps: 10,
          frozen_iv: 175,
          frozen_iv_valuation_version: 'valuation-2026-06-cap-1',
          signed_thesis: 'legacy admit',
        },
        source_ids: [],
        created_at: new Date().toISOString(),
        schema_version: 1,
      })

      const [item] = projectWatchlist(await store.list())
      expect(item?.frozen_oe_ps).toBe(10)
      // The legacy frozen_iv maps onto the reference fair value.
      expect(item?.frozen_reference_fair_value).toBe(175)
      expect(item?.locked_buy_below).toBe(120)
    } finally {
      store.close()
    }
  })
})
