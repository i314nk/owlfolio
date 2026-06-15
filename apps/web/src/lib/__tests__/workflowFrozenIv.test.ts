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
// Phase 6 S3 — freezing the UNDISCOUNTED intrinsic value at sign-off.
//
// promoteResearchCaseToWatchlist (the admit/sign-off path) must freeze the case's UNDISCOUNTED IV
// (valuation.fair_value_per_share) as `frozen_iv` — DISTINCT from the MoS-discounted buy-below
// (valuation.buy_price_per_share, frozen as `locked_buy_below`). The valuation-inverted sell trigger
// reads `frozen_iv`. Don't-move-the-number (F.9/F.10): it freezes here with its valuation-version
// provenance. FAIL-CLOSED: a case with no undiscounted IV freezes frozen_iv as ABSENT — never the
// discounted buy-below.
//
// New sibling file (NOT workflow.test.ts) per the slice's test-placement guidance.
// ---------------------------------------------------------------------------

const HUMAN_SIGNED_THESIS =
  'I am admitting this name: durable franchise, low permanent-loss risk, buying with a margin of safety.'

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
 * Seed a research case whose `buffett_munger_analysis_drafted` carries a `valuation` payload with BOTH the
 * undiscounted fair value and the discounted buy-below (when `valuation` is provided), then a drafted
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
        // COMPLIANT + sourced so the Shariah gate allows the watchlist promotion (mirrors the MSFT setup).
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

describe('promoteResearchCaseToWatchlist — freeze undiscounted IV at sign-off (Phase 6 S3)', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  it('freezes frozen_iv from the case UNDISCOUNTED fair value, distinct from the discounted buy-below', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-frozen-iv-'))
    dirs.push(projectDir)
    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
    const state = makeState(ledgerPath, join(projectDir, 'data', 'source-ledger'))

    // fair_value_per_share (216) is the UNDISCOUNTED IV; buy_price_per_share (150) is the MoS-discounted
    // buy-below. They are deliberately different so a backfill bug would be caught.
    const { research_case_id } = await seedCase(ledgerPath, {
      fair_value_per_share: 216,
      buy_price_per_share: 150,
    })

    const promoted = await promoteResearchCaseToWatchlist(state, research_case_id, HUMAN_SIGNED_THESIS)

    expect(promoted.frozen_iv).toBe(216)
    expect(promoted.frozen_iv_valuation_version).toBe(VALUATION_PARAMS.version)
    // The discounted buy-below froze separately and is NOT the frozen IV.
    expect(promoted.locked_buy_below).toBe(150)
    expect(promoted.frozen_iv).not.toBe(promoted.locked_buy_below)

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const [item] = projectWatchlist(await store.list())
      expect(item?.frozen_iv).toBe(216)
      expect(item?.frozen_iv_valuation_version).toBe(VALUATION_PARAMS.version)
      expect(item?.locked_buy_below).toBe(150)
    } finally {
      store.close()
    }
  })

  it('leaves frozen_iv absent when the case has no undiscounted IV (fail-closed, never the buy-below)', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-frozen-iv-none-'))
    dirs.push(projectDir)
    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
    const state = makeState(ledgerPath, join(projectDir, 'data', 'source-ledger'))

    // A valuation WITH a discounted buy-below but NO undiscounted fair value.
    const { research_case_id } = await seedCase(ledgerPath, { buy_price_per_share: 150 })

    const promoted = await promoteResearchCaseToWatchlist(state, research_case_id, HUMAN_SIGNED_THESIS)

    // No undiscounted IV → frozen_iv absent; it must NEVER be backfilled from the discounted buy-below.
    expect(promoted.frozen_iv).toBeUndefined()
    expect(promoted.frozen_iv_valuation_version).toBeUndefined()
    expect(promoted.locked_buy_below).toBe(150)

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const [item] = projectWatchlist(await store.list())
      expect(item?.frozen_iv).toBeUndefined()
      expect(item?.frozen_iv_valuation_version).toBeUndefined()
      expect(item?.locked_buy_below).toBe(150)
    } finally {
      store.close()
    }
  })
})
