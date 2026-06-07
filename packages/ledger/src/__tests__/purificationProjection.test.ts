import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import {
  buildPurificationObligationRecordedEvent,
  buildPurificationPaymentRecordedEvent,
  projectAaoifiDividendPurificationCalculations,
  projectPurificationLedger,
} from '../projections/purificationProjection'

function event(
  overrides: Partial<LedgerEventEnvelope<unknown>> & Pick<LedgerEventEnvelope<unknown>, 'event_id' | 'event_type' | 'aggregate_type' | 'aggregate_id' | 'actor_type' | 'payload' | 'created_at'>,
): LedgerEventEnvelope<unknown> {
  return {
    source_ids: [],
    schema_version: 1,
    ...overrides,
  }
}

const shariahEvaluation = event({
  event_id: 'evt_shariah_eval_msft_june',
  event_type: 'shariah_evaluation_recorded',
  aggregate_type: 'holding',
  aggregate_id: 'holding_msft_001',
  actor_type: 'provider',
  actor_id: 'mock-provider',
  payload: {
    evaluation_id: 'shariah_msft_june',
    holding_id: 'holding_msft_001',
    status: 'CONDITIONAL',
    policy_basis: 'AAOIFI',
    source_ids: ['src_msft_10k', 'src_shariah_screen'],
  },
  source_ids: ['src_msft_10k', 'src_shariah_screen'],
  created_at: '2026-06-29T12:00:00.000Z',
})

const accountingSnapshot = event({
  event_id: 'evt_acct_2026_06',
  event_type: 'accounting_snapshot_recorded',
  aggregate_type: 'accounting_snapshot',
  aggregate_id: 'acct_2026_06',
  actor_type: 'worker',
  actor_id: 'monthly-accounting-worker',
  payload: {
    snapshot_id: 'acct_2026_06',
    period_start: '2026-06-01',
    period_end: '2026-06-30',
    currency: 'USD',
    nav: 2925,
    current_value: 2925,
    invested_cost_basis: 2640.3,
    unrealized_gain_loss: 284.7,
    cash_balance: 0,
    deposits: 0,
    withdrawals: 0,
    cash_ledger_status: 'placeholder',
    missing_valuation_holding_ids: [],
    holdings: [
      {
        holding_id: 'holding_msft_001',
        ticker: 'MSFT',
        currency: 'USD',
        shares: 3.25,
        cost_basis: 2640.3,
        current_value: 2925,
        unrealized_gain_loss: 284.7,
        valuation_status: 'valued',
        latest_valuation_at: '2026-06-30',
      },
    ],
    updated_at: '2026-06-30T23:59:00.000Z',
  },
  created_at: '2026-06-30T23:59:00.000Z',
})

describe('purification ledger projection', () => {
  it('calculates AAOIFI-aware dividend purification with full audit fields', () => {
    const holding = event({
      event_id: 'evt_holding_opened_msft_001',
      event_type: 'holding_opened',
      aggregate_type: 'holding',
      aggregate_id: 'holding_msft_001',
      actor_type: 'user',
      actor_id: 'user_local',
      payload: {
        holding_id: 'holding_msft_001',
        watchlist_item_id: 'wl_msft_001',
        research_case_id: 'rc_msft_001',
        company_id: 'company_msft',
        ticker: 'MSFT',
        company_name: 'Microsoft Corporation',
        shares: 3.25,
        cost_basis_per_share: 812.4,
        currency: 'USD',
        opened_at: '2026-05-28',
      },
      created_at: '2026-05-28T10:00:00.000Z',
    })
    const dividend = event({
      event_id: 'evt_dividend_msft_june',
      event_type: 'dividend_income_recorded',
      aggregate_type: 'cash_account',
      aggregate_id: 'cash_usd',
      actor_type: 'user',
      actor_id: 'user_local',
      payload: {
        dividend_id: 'div_msft_2026_06',
        holding_id: 'holding_msft_001',
        cash_account_id: 'cash_usd',
        amount: 40,
        currency: 'USD',
        received_at: '2026-06-15',
        taxable_status: 'unclassified',
      },
      source_ids: ['broker_dividend_notice_2026_06'],
      created_at: '2026-06-15T09:00:00.000Z',
    })
    const sourcedEvaluation = event({
      ...shariahEvaluation,
      payload: {
        ...(shariahEvaluation.payload as Record<string, unknown>),
        company_name: 'Microsoft Corporation',
        policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
        standard_reference: 'AAOIFI SS 21 (secondary-source mapped)',
        non_compliant_income_ratio: 0.05,
        source_filing_period_start: '2026-01-01',
        source_filing_period_end: '2026-03-31',
        source_filing_type: '10-Q',
        source_filing_date: '2026-04-25',
        evidence_summary: 'Mock provider ratio from company filing; secondary AAOIFI policy mapping requires review.',
        policy_source_ids: ['policy_aaoifi_ss21_secondary'],
      },
      created_at: '2026-06-14T12:00:00.000Z',
    })

    const projection = projectAaoifiDividendPurificationCalculations([holding, dividend, sourcedEvaluation], {
      as_of: '2026-06-30',
      calculated_at: '2026-07-01T00:05:00.000Z',
    })

    expect(projection.pending).toEqual([])
    expect(projection.calculations).toEqual([
      expect.objectContaining({
        calculation_id: expect.stringMatching(/^calc_holding_msft_001_div_msft_2026_06_AAOIFI_SS21_APP_POLICY_2026_06_[a-z0-9]+$/),
        holding_id: 'holding_msft_001',
        company_id: 'company_msft',
        ticker: 'MSFT',
        company_name: 'Microsoft Corporation',
        period_start: '2026-06-15',
        period_end: '2026-06-15',
        policy_basis: 'AAOIFI',
        policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
        standard_reference: 'AAOIFI SS 21 (secondary-source mapped)',
        calculation_method: 'dividend_ratio',
        dividend_event_id: 'evt_dividend_msft_june',
        dividend_income_amount: 40,
        non_compliant_income_ratio: 0.05,
        purification_ratio: 0.05,
        holding_period_basis: 'dividend_received_during_open_holding_period',
        purification_amount: 2,
        currency: 'USD',
        calculated_at: '2026-07-01T00:05:00.000Z',
        next_calculation_at: '2026-10-01T00:05:00.000Z',
        requires_user_confirmation: true,
        requires_scholar_review: true,
      }),
    ])
    expect(projection.calculations[0]?.source_ids).toEqual([
      'broker_dividend_notice_2026_06',
      'src_msft_10k',
      'src_shariah_screen',
      'policy_aaoifi_ss21_secondary',
    ])
    expect(projection.calculations[0]?.caveats).toContain('Estimated purification amount; Owlfolio is not a religious, legal, tax, or financial adviser.')
  })

  it('fails closed instead of calculating when AAOIFI ratio or policy evidence is missing', () => {
    const dividend = event({
      event_id: 'evt_dividend_missing_ratio',
      event_type: 'dividend_income_recorded',
      aggregate_type: 'cash_account',
      aggregate_id: 'cash_usd',
      actor_type: 'user',
      payload: {
        dividend_id: 'div_missing_ratio',
        holding_id: 'holding_msft_001',
        amount: 40,
        currency: 'USD',
        received_at: '2026-06-15',
      },
      source_ids: ['broker_dividend_notice_2026_06'],
      created_at: '2026-06-15T09:00:00.000Z',
    })

    const projection = projectAaoifiDividendPurificationCalculations([dividend, shariahEvaluation], {
      as_of: '2026-06-30',
      calculated_at: '2026-07-01T00:05:00.000Z',
    })

    expect(projection.calculations).toEqual([])
    expect(projection.pending).toEqual([
      expect.objectContaining({
        dividend_event_id: 'evt_dividend_missing_ratio',
        holding_id: 'holding_msft_001',
        status: 'pending',
        missing_evidence: expect.arrayContaining([
          'policy_version',
          'non_compliant_income_ratio',
          'policy_source_ids',
          'applicable_source_filing_period',
        ]),
      }),
    ])
  })

  it('does not calculate dividends received after the requested as-of date', () => {
    const futureDividend = event({
      event_id: 'evt_dividend_future',
      event_type: 'dividend_income_recorded',
      aggregate_type: 'cash_account',
      aggregate_id: 'cash_usd',
      actor_type: 'user',
      payload: {
        dividend_id: 'div_future',
        holding_id: 'holding_msft_001',
        amount: 40,
        currency: 'USD',
        received_at: '2026-07-15',
      },
      source_ids: ['broker_dividend_notice_future'],
      created_at: '2026-07-15T09:00:00.000Z',
    })
    const sourcedEvaluation = event({
      ...shariahEvaluation,
      payload: {
        ...(shariahEvaluation.payload as Record<string, unknown>),
        policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
        non_compliant_income_ratio: 0.05,
        source_filing_period_start: '2026-01-01',
        source_filing_period_end: '2026-03-31',
        policy_source_ids: ['policy_aaoifi_ss21_secondary'],
      },
    })

    const projection = projectAaoifiDividendPurificationCalculations([futureDividend, sourcedEvaluation], {
      as_of: '2026-06-30',
      calculated_at: '2026-07-01T00:05:00.000Z',
    })

    expect(projection.calculations).toEqual([])
    expect(projection.pending).toEqual([])
  })

  it('does not use Shariah evidence recorded after the requested as-of date', () => {
    const holding = event({
      event_id: 'evt_holding_opened_for_future_evidence',
      event_type: 'holding_opened',
      aggregate_type: 'holding',
      aggregate_id: 'holding_msft_001',
      actor_type: 'user',
      payload: {
        holding_id: 'holding_msft_001',
        ticker: 'MSFT',
        shares: 1,
        cost_basis_per_share: 100,
        currency: 'USD',
        opened_at: '2026-05-28',
      },
      created_at: '2026-05-28T10:00:00.000Z',
    })
    const dividend = event({
      event_id: 'evt_dividend_needs_historical_evidence',
      event_type: 'dividend_income_recorded',
      aggregate_type: 'cash_account',
      aggregate_id: 'cash_usd',
      actor_type: 'user',
      payload: {
        dividend_id: 'div_needs_historical_evidence',
        holding_id: 'holding_msft_001',
        amount: 40,
        currency: 'USD',
        received_at: '2026-06-15',
      },
      source_ids: ['broker_dividend_notice_2026_06'],
      created_at: '2026-06-15T09:00:00.000Z',
    })
    const futureEvaluation = event({
      ...shariahEvaluation,
      payload: {
        ...(shariahEvaluation.payload as Record<string, unknown>),
        policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
        non_compliant_income_ratio: 0.05,
        source_filing_period_start: '2026-01-01',
        source_filing_period_end: '2026-03-31',
        policy_source_ids: ['policy_aaoifi_ss21_secondary'],
      },
      created_at: '2026-07-02T12:00:00.000Z',
    })

    const projection = projectAaoifiDividendPurificationCalculations([holding, dividend, futureEvaluation], {
      as_of: '2026-06-30',
      calculated_at: '2026-07-01T00:05:00.000Z',
    })

    expect(projection.calculations).toEqual([])
    expect(projection.pending[0]).toMatchObject({
      dividend_event_id: 'evt_dividend_needs_historical_evidence',
      missing_evidence: expect.arrayContaining(['shariah_evaluation_id', 'policy_version']),
    })
  })

  it('fails closed when holding-period evidence is missing or after the dividend date', () => {
    const lateHolding = event({
      event_id: 'evt_holding_opened_late',
      event_type: 'holding_opened',
      aggregate_type: 'holding',
      aggregate_id: 'holding_msft_001',
      actor_type: 'user',
      payload: {
        holding_id: 'holding_msft_001',
        ticker: 'MSFT',
        shares: 1,
        cost_basis_per_share: 100,
        currency: 'USD',
        opened_at: '2026-06-20',
      },
      created_at: '2026-06-20T10:00:00.000Z',
    })
    const dividend = event({
      event_id: 'evt_dividend_before_holding',
      event_type: 'dividend_income_recorded',
      aggregate_type: 'cash_account',
      aggregate_id: 'cash_usd',
      actor_type: 'user',
      payload: {
        dividend_id: 'div_before_holding',
        holding_id: 'holding_msft_001',
        amount: 40,
        currency: 'USD',
        received_at: '2026-06-15',
      },
      source_ids: ['broker_dividend_notice_2026_06'],
      created_at: '2026-06-15T09:00:00.000Z',
    })
    const sourcedEvaluation = event({
      ...shariahEvaluation,
      payload: {
        ...(shariahEvaluation.payload as Record<string, unknown>),
        policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
        non_compliant_income_ratio: 0.05,
        source_filing_period_start: '2026-01-01',
        source_filing_period_end: '2026-03-31',
        policy_source_ids: ['policy_aaoifi_ss21_secondary'],
      },
    })

    const projection = projectAaoifiDividendPurificationCalculations([lateHolding, dividend, sourcedEvaluation], {
      as_of: '2026-06-30',
      calculated_at: '2026-07-01T00:05:00.000Z',
    })

    expect(projection.calculations).toEqual([])
    expect(projection.pending[0]).toMatchObject({
      dividend_event_id: 'evt_dividend_before_holding',
      missing_evidence: expect.arrayContaining(['holding_period']),
    })
  })

  it('fails closed when the holding was closed before the dividend date', () => {
    const openedHolding = event({
      event_id: 'evt_holding_opened_then_closed',
      event_type: 'holding_opened',
      aggregate_type: 'holding',
      aggregate_id: 'holding_msft_001',
      actor_type: 'user',
      payload: {
        holding_id: 'holding_msft_001',
        ticker: 'MSFT',
        shares: 1,
        cost_basis_per_share: 100,
        currency: 'USD',
        opened_at: '2026-05-01',
      },
      created_at: '2026-05-01T10:00:00.000Z',
    })
    const closedHolding = event({
      event_id: 'evt_holding_closed_before_dividend',
      event_type: 'holding_closed',
      aggregate_type: 'holding',
      aggregate_id: 'holding_msft_001',
      actor_type: 'user',
      payload: {
        holding_id: 'holding_msft_001',
        closed_at: '2026-06-01',
      },
      created_at: '2026-06-01T10:00:00.000Z',
    })
    const dividend = event({
      event_id: 'evt_dividend_after_holding_close',
      event_type: 'dividend_income_recorded',
      aggregate_type: 'cash_account',
      aggregate_id: 'cash_usd',
      actor_type: 'user',
      payload: {
        dividend_id: 'div_after_holding_close',
        holding_id: 'holding_msft_001',
        amount: 40,
        currency: 'USD',
        received_at: '2026-06-15',
      },
      source_ids: ['broker_dividend_notice_2026_06'],
      created_at: '2026-06-15T09:00:00.000Z',
    })
    const sourcedEvaluation = event({
      ...shariahEvaluation,
      payload: {
        ...(shariahEvaluation.payload as Record<string, unknown>),
        policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
        non_compliant_income_ratio: 0.05,
        source_filing_period_start: '2026-01-01',
        source_filing_period_end: '2026-03-31',
        policy_source_ids: ['policy_aaoifi_ss21_secondary'],
      },
    })

    const projection = projectAaoifiDividendPurificationCalculations([openedHolding, closedHolding, dividend, sourcedEvaluation], {
      as_of: '2026-06-30',
      calculated_at: '2026-07-01T00:05:00.000Z',
    })

    expect(projection.calculations).toEqual([])
    expect(projection.pending[0]).toMatchObject({
      dividend_event_id: 'evt_dividend_after_holding_close',
      missing_evidence: expect.arrayContaining(['holding_period']),
    })
  })

  it('uses the latest source filing period applicable to the dividend instead of future evidence', () => {
    const holding = event({
      event_id: 'evt_holding_opened_for_period_match',
      event_type: 'holding_opened',
      aggregate_type: 'holding',
      aggregate_id: 'holding_msft_001',
      actor_type: 'user',
      payload: {
        holding_id: 'holding_msft_001',
        ticker: 'MSFT',
        shares: 1,
        cost_basis_per_share: 100,
        currency: 'USD',
        opened_at: '2026-05-01',
      },
      created_at: '2026-05-01T10:00:00.000Z',
    })
    const dividend = event({
      event_id: 'evt_dividend_period_match',
      event_type: 'dividend_income_recorded',
      aggregate_type: 'cash_account',
      aggregate_id: 'cash_usd',
      actor_type: 'user',
      payload: {
        dividend_id: 'div_period_match',
        holding_id: 'holding_msft_001',
        amount: 40,
        currency: 'USD',
        received_at: '2026-06-15',
      },
      source_ids: ['broker_dividend_notice_2026_06'],
      created_at: '2026-06-15T09:00:00.000Z',
    })
    const applicableEvaluation = event({
      ...shariahEvaluation,
      event_id: 'evt_shariah_eval_applicable_period',
      payload: {
        ...(shariahEvaluation.payload as Record<string, unknown>),
        evaluation_id: 'shariah_applicable_period',
        policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
        non_compliant_income_ratio: 0.05,
        source_filing_period_start: '2026-01-01',
        source_filing_period_end: '2026-03-31',
        policy_source_ids: ['policy_aaoifi_ss21_secondary'],
      },
      created_at: '2026-06-14T12:00:00.000Z',
    })
    const futureEvaluation = event({
      ...shariahEvaluation,
      event_id: 'evt_shariah_eval_future_period',
      payload: {
        ...(shariahEvaluation.payload as Record<string, unknown>),
        evaluation_id: 'shariah_future_period',
        policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
        non_compliant_income_ratio: 0.2,
        source_filing_period_start: '2026-07-01',
        source_filing_period_end: '2026-09-30',
        policy_source_ids: ['policy_aaoifi_ss21_secondary'],
      },
      created_at: '2026-06-14T13:00:00.000Z',
    })

    const projection = projectAaoifiDividendPurificationCalculations([holding, dividend, applicableEvaluation, futureEvaluation], {
      as_of: '2026-09-30',
      calculated_at: '2026-10-01T06:01:00.000Z',
    })

    expect(projection.pending).toEqual([])
    expect(projection.calculations[0]).toMatchObject({
      shariah_evaluation_id: 'shariah_applicable_period',
      purification_amount: 2,
      non_compliant_income_ratio: 0.05,
    })
  })

  it('changes calculation identity when same-policy evidence is corrected', () => {
    const holding = event({
      event_id: 'evt_holding_opened_for_corrected_ratio',
      event_type: 'holding_opened',
      aggregate_type: 'holding',
      aggregate_id: 'holding_msft_001',
      actor_type: 'user',
      payload: {
        holding_id: 'holding_msft_001',
        ticker: 'MSFT',
        shares: 1,
        cost_basis_per_share: 100,
        currency: 'USD',
        opened_at: '2026-05-01',
      },
      created_at: '2026-05-01T10:00:00.000Z',
    })
    const dividend = event({
      event_id: 'evt_dividend_corrected_ratio',
      event_type: 'dividend_income_recorded',
      aggregate_type: 'cash_account',
      aggregate_id: 'cash_usd',
      actor_type: 'user',
      payload: {
        dividend_id: 'div_corrected_ratio',
        holding_id: 'holding_msft_001',
        amount: 40,
        currency: 'USD',
        received_at: '2026-06-15',
      },
      source_ids: ['broker_dividend_notice_2026_06'],
      created_at: '2026-06-15T09:00:00.000Z',
    })
    const initialEvaluation = event({
      ...shariahEvaluation,
      event_id: 'evt_shariah_eval_initial_ratio',
      payload: {
        ...(shariahEvaluation.payload as Record<string, unknown>),
        evaluation_id: 'shariah_initial_ratio',
        policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
        non_compliant_income_ratio: 0.05,
        source_filing_period_start: '2026-01-01',
        source_filing_period_end: '2026-03-31',
        policy_source_ids: ['policy_aaoifi_ss21_secondary'],
      },
      created_at: '2026-06-14T12:00:00.000Z',
    })
    const correctedEvaluation = event({
      ...initialEvaluation,
      event_id: 'evt_shariah_eval_corrected_ratio',
      payload: {
        ...(initialEvaluation.payload as Record<string, unknown>),
        evaluation_id: 'shariah_corrected_ratio',
        non_compliant_income_ratio: 0.07,
      },
      created_at: '2026-06-14T13:00:00.000Z',
    })

    const initialProjection = projectAaoifiDividendPurificationCalculations([holding, dividend, initialEvaluation], {
      as_of: '2026-06-30',
      calculated_at: '2026-07-01T06:01:00.000Z',
    })
    const correctedProjection = projectAaoifiDividendPurificationCalculations([holding, dividend, correctedEvaluation], {
      as_of: '2026-06-30',
      calculated_at: '2026-07-01T06:01:00.000Z',
    })

    expect(initialProjection.calculations[0]?.calculation_id).toMatch(/^calc_holding_msft_001_div_corrected_ratio_AAOIFI_SS21_APP_POLICY_2026_06_[a-z0-9]+$/)
    expect(correctedProjection.calculations[0]?.calculation_id).toMatch(/^calc_holding_msft_001_div_corrected_ratio_AAOIFI_SS21_APP_POLICY_2026_06_[a-z0-9]+$/)
    expect(correctedProjection.calculations[0]?.calculation_id).not.toEqual(initialProjection.calculations[0]?.calculation_id)
    expect(correctedProjection.calculations[0]?.purification_amount).toBe(2.8)
  })

  it('projects corrected dividend inputs once by stable dividend id and changes amount-sensitive calculation identity', () => {
    const holding = event({
      event_id: 'evt_holding_opened_for_corrected_dividend',
      event_type: 'holding_opened',
      aggregate_type: 'holding',
      aggregate_id: 'holding_msft_001',
      actor_type: 'user',
      payload: {
        holding_id: 'holding_msft_001',
        ticker: 'MSFT',
        shares: 1,
        cost_basis_per_share: 100,
        currency: 'USD',
        opened_at: '2026-05-01',
      },
      created_at: '2026-05-01T10:00:00.000Z',
    })
    const initialDividend = event({
      event_id: 'evt_dividend_amount_initial',
      event_type: 'dividend_income_recorded',
      aggregate_type: 'cash_account',
      aggregate_id: 'cash_usd',
      actor_type: 'user',
      payload: {
        dividend_id: 'div_corrected_amount',
        holding_id: 'holding_msft_001',
        amount: 40,
        currency: 'USD',
        received_at: '2026-06-15',
      },
      source_ids: ['broker_dividend_notice_2026_06'],
      created_at: '2026-06-15T09:00:00.000Z',
    })
    const correctedDividend = event({
      ...initialDividend,
      event_id: 'evt_dividend_amount_corrected',
      payload: {
        ...(initialDividend.payload as Record<string, unknown>),
        amount: 60,
      },
      created_at: '2026-06-16T09:00:00.000Z',
    })
    const sourcedEvaluation = event({
      ...shariahEvaluation,
      payload: {
        ...(shariahEvaluation.payload as Record<string, unknown>),
        policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
        non_compliant_income_ratio: 0.05,
        source_filing_period_start: '2026-01-01',
        source_filing_period_end: '2026-03-31',
        policy_source_ids: ['policy_aaoifi_ss21_secondary'],
      },
      created_at: '2026-06-14T12:00:00.000Z',
    })

    const initialProjection = projectAaoifiDividendPurificationCalculations([holding, initialDividend, sourcedEvaluation], {
      as_of: '2026-06-30',
      calculated_at: '2026-07-01T06:01:00.000Z',
    })
    const correctedProjection = projectAaoifiDividendPurificationCalculations([holding, initialDividend, correctedDividend, sourcedEvaluation], {
      as_of: '2026-06-30',
      calculated_at: '2026-07-01T06:01:00.000Z',
    })

    expect(correctedProjection.calculations).toHaveLength(1)
    expect(correctedProjection.calculations[0]).toMatchObject({
      dividend_event_id: 'evt_dividend_amount_corrected',
      dividend_id: 'div_corrected_amount',
      dividend_income_amount: 60,
      purification_amount: 3,
    })
    expect(correctedProjection.calculations[0]?.calculation_id).not.toEqual(initialProjection.calculations[0]?.calculation_id)
  })

  it('projects corrected same-policy obligations as superseding the prior amount instead of double-counting', () => {
    const initialObligation = buildPurificationObligationRecordedEvent({
      obligation_id: 'purify_initial_corrected_ratio',
      calculation_id: 'calc_holding_msft_001_div_corrected_ratio_AAOIFI_SS21_APP_POLICY_2026_06_initial',
      holding_id: 'holding_msft_001',
      amount: 2,
      currency: 'USD',
      period_start: '2026-06-15',
      period_end: '2026-06-15',
      policy_basis: 'AAOIFI',
      policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
      calculation_method: 'dividend_ratio',
      dividend_event_id: 'evt_dividend_corrected_ratio_initial',
      dividend_id: 'div_corrected_ratio',
      dividend_income_amount: 40,
      non_compliant_income_ratio: 0.05,
      purification_ratio: 0.05,
      source_filing_period_start: '2026-01-01',
      source_filing_period_end: '2026-03-31',
      calculated_at: '2026-07-01T06:01:00.000Z',
    }, {
      event_id: 'evt_purify_initial_corrected_ratio',
      actor_id: 'purification-worker',
      created_at: '2026-07-01T06:01:00.000Z',
    })
    const paymentAgainstInitial = buildPurificationPaymentRecordedEvent({
      payment_id: 'pay_initial_corrected_ratio',
      obligation_id: 'purify_initial_corrected_ratio',
      amount: 1,
      currency: 'USD',
      paid_at: '2026-07-02',
      recipient: 'Local zakat charity',
    }, {
      event_id: 'evt_pay_initial_corrected_ratio',
      actor_id: 'user_local',
      created_at: '2026-07-02T09:00:00.000Z',
    })
    const correctedObligation = buildPurificationObligationRecordedEvent({
      obligation_id: 'purify_corrected_ratio',
      calculation_id: 'calc_holding_msft_001_div_corrected_ratio_AAOIFI_SS21_APP_POLICY_2026_06_corrected',
      holding_id: 'holding_msft_001',
      amount: 2.8,
      currency: 'USD',
      period_start: '2026-06-15',
      period_end: '2026-06-15',
      policy_basis: 'AAOIFI',
      policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
      calculation_method: 'dividend_ratio',
      dividend_event_id: 'evt_dividend_corrected_ratio_corrected',
      dividend_id: 'div_corrected_ratio',
      dividend_income_amount: 40,
      non_compliant_income_ratio: 0.07,
      purification_ratio: 0.07,
      source_filing_period_start: '2026-01-01',
      source_filing_period_end: '2026-03-31',
      calculated_at: '2026-07-03T06:01:00.000Z',
    }, {
      event_id: 'evt_purify_corrected_ratio',
      actor_id: 'purification-worker',
      created_at: '2026-07-03T06:01:00.000Z',
    })

    const ledger = projectPurificationLedger([initialObligation, paymentAgainstInitial, correctedObligation])

    expect(ledger.obligations).toEqual([
      expect.objectContaining({
        obligation_id: 'purify_corrected_ratio',
        amount: 2.8,
        paid_amount: 1,
        remaining_amount: 1.8,
        status: 'partially_paid',
      }),
    ])
    expect(ledger.summary_by_currency).toEqual({
      USD: { owed: 2.8, paid: 1, remaining: 1.8 },
    })
  })

  it('fails closed for non-AAOIFI policy basis in AAOIFI calculation projection', () => {
    const dividend = event({
      event_id: 'evt_dividend_non_aaoifi_policy',
      event_type: 'dividend_income_recorded',
      aggregate_type: 'cash_account',
      aggregate_id: 'cash_usd',
      actor_type: 'user',
      payload: {
        dividend_id: 'div_non_aaoifi_policy',
        holding_id: 'holding_msft_001',
        amount: 40,
        currency: 'USD',
        received_at: '2026-06-15',
      },
      source_ids: ['broker_dividend_notice_2026_06'],
      created_at: '2026-06-15T09:00:00.000Z',
    })
    const nonAaoifiEvaluation = event({
      ...shariahEvaluation,
      payload: {
        ...(shariahEvaluation.payload as Record<string, unknown>),
        policy_basis: 'internal-policy',
        policy_version: 'INTERNAL_POLICY_2026_06',
        non_compliant_income_ratio: 0.05,
        source_filing_period_start: '2026-01-01',
        source_filing_period_end: '2026-03-31',
        policy_source_ids: ['policy_internal'],
      },
    })

    const projection = projectAaoifiDividendPurificationCalculations([dividend, nonAaoifiEvaluation], {
      as_of: '2026-06-30',
      calculated_at: '2026-07-01T00:05:00.000Z',
    })

    expect(projection.calculations).toEqual([])
    expect(projection.pending[0]).toMatchObject({
      missing_evidence: expect.arrayContaining(['AAOIFI_policy_basis']),
    })
  })

  it('fails closed when company source evidence is missing or dividend amount is not positive', () => {
    const dividend = event({
      event_id: 'evt_dividend_bad_amount_no_sources',
      event_type: 'dividend_income_recorded',
      aggregate_type: 'cash_account',
      aggregate_id: 'cash_usd',
      actor_type: 'user',
      payload: {
        dividend_id: 'div_bad_amount_no_sources',
        holding_id: 'holding_msft_001',
        amount: -40,
        currency: 'USD',
        received_at: '2026-06-15',
      },
      source_ids: [],
      created_at: '2026-06-15T09:00:00.000Z',
    })
    const sourceFreeEvaluation = event({
      ...shariahEvaluation,
      source_ids: [],
      payload: {
        ...(shariahEvaluation.payload as Record<string, unknown>),
        source_ids: [],
        policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
        non_compliant_income_ratio: 0.05,
        source_filing_period_start: '2026-01-01',
        source_filing_period_end: '2026-03-31',
        policy_source_ids: ['policy_aaoifi_ss21_secondary'],
      },
    })

    const projection = projectAaoifiDividendPurificationCalculations([dividend, sourceFreeEvaluation], {
      as_of: '2026-06-30',
      calculated_at: '2026-07-01T00:05:00.000Z',
    })

    expect(projection.calculations).toEqual([])
    expect(projection.pending[0]).toMatchObject({
      missing_evidence: expect.arrayContaining(['positive_dividend_income_amount', 'source_ids']),
    })
  })

  it('fails closed when the dividend amount lacks source evidence', () => {
    const holding = event({
      event_id: 'evt_holding_opened_for_unsourced_dividend',
      event_type: 'holding_opened',
      aggregate_type: 'holding',
      aggregate_id: 'holding_msft_001',
      actor_type: 'user',
      payload: {
        holding_id: 'holding_msft_001',
        ticker: 'MSFT',
        shares: 1,
        cost_basis_per_share: 100,
        currency: 'USD',
        opened_at: '2026-05-28',
      },
      created_at: '2026-05-28T10:00:00.000Z',
    })
    const unsourcedDividend = event({
      event_id: 'evt_dividend_unsourced_amount',
      event_type: 'dividend_income_recorded',
      aggregate_type: 'cash_account',
      aggregate_id: 'cash_usd',
      actor_type: 'user',
      payload: {
        dividend_id: 'div_unsourced_amount',
        holding_id: 'holding_msft_001',
        amount: 40,
        currency: 'USD',
        received_at: '2026-06-15',
      },
      source_ids: [],
      created_at: '2026-06-15T09:00:00.000Z',
    })
    const sourcedEvaluation = event({
      ...shariahEvaluation,
      payload: {
        ...(shariahEvaluation.payload as Record<string, unknown>),
        policy_version: 'AAOIFI_SS21_APP_POLICY_2026_06',
        non_compliant_income_ratio: 0.05,
        source_filing_period_start: '2026-01-01',
        source_filing_period_end: '2026-03-31',
        policy_source_ids: ['policy_aaoifi_ss21_secondary'],
      },
      created_at: '2026-06-14T12:00:00.000Z',
    })

    const projection = projectAaoifiDividendPurificationCalculations([holding, unsourcedDividend, sourcedEvaluation], {
      as_of: '2026-06-30',
      calculated_at: '2026-07-01T00:05:00.000Z',
    })

    expect(projection.calculations).toEqual([])
    expect(projection.pending[0]).toMatchObject({
      dividend_event_id: 'evt_dividend_unsourced_amount',
      missing_evidence: expect.arrayContaining(['source_ids']),
    })
  })

  it('records an obligation tied to Shariah evidence and accounting state without auto-marking it paid', () => {
    const obligation = buildPurificationObligationRecordedEvent({
      obligation_id: 'purify_msft_2026_06',
      holding_id: 'holding_msft_001',
      amount: 14.63,
      currency: 'USD',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      reason: 'AAOIFI non-compliant income purification estimate',
      shariah_evaluation_id: 'shariah_msft_june',
      accounting_snapshot_id: 'acct_2026_06',
    }, {
      event_id: 'evt_purify_obligation_msft_june',
      actor_id: 'purification-worker',
      created_at: '2026-07-01T00:05:00.000Z',
      source_ids: ['src_msft_10k', 'src_shariah_screen', 'acct_2026_06'],
    })

    const ledger = projectPurificationLedger([shariahEvaluation, accountingSnapshot, obligation])

    expect(obligation).toMatchObject({
      event_type: 'purification_obligation_recorded',
      aggregate_type: 'purification_entry',
      aggregate_id: 'purify_msft_2026_06',
      actor_type: 'worker',
      actor_id: 'purification-worker',
    })
    expect(ledger.summary_by_currency).toEqual({
      USD: { owed: 14.63, paid: 0, remaining: 14.63 },
    })
    expect(ledger.obligations).toEqual([
      expect.objectContaining({
        obligation_id: 'purify_msft_2026_06',
        holding_id: 'holding_msft_001',
        amount: 14.63,
        paid_amount: 0,
        remaining_amount: 14.63,
        status: 'unpaid',
        shariah_status: 'CONDITIONAL',
        shariah_policy_basis: 'AAOIFI',
        shariah_source_ids: ['src_msft_10k', 'src_shariah_screen'],
        accounting_snapshot_id: 'acct_2026_06',
        accounting_nav: 2925,
        accounting_holding_value: 2925,
        audit_source_ids: ['src_msft_10k', 'src_shariah_screen', 'acct_2026_06'],
      }),
    ])
  })

  it('links obligations to dividend evidence without auto-paying them', () => {
    const dividend = event({
      event_id: 'evt_dividend_msft_june',
      event_type: 'dividend_income_recorded',
      aggregate_type: 'cash_account',
      aggregate_id: 'cash_usd',
      actor_type: 'user',
      actor_id: 'user_local',
      payload: {
        dividend_id: 'div_msft_2026_06',
        holding_id: 'holding_msft_001',
        cash_account_id: 'cash_usd',
        amount: 40,
        currency: 'USD',
        received_at: '2026-06-15',
        taxable_status: 'unclassified',
      },
      source_ids: ['broker_dividend_notice_2026_06'],
      created_at: '2026-06-15T09:00:00.000Z',
    })
    const obligation = buildPurificationObligationRecordedEvent({
      obligation_id: 'purify_msft_dividend_2026_06',
      holding_id: 'holding_msft_001',
      amount: 2,
      currency: 'USD',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      reason: 'Manual dividend impurity estimate for tracking; not a fatwa or tax calculation.',
      shariah_evaluation_id: 'shariah_msft_june',
      accounting_snapshot_id: 'acct_2026_06',
      dividend_event_id: 'evt_dividend_msft_june',
      impurity_rate: 0.05,
    }, {
      event_id: 'evt_purify_msft_dividend_june',
      actor_id: 'purification-worker',
      created_at: '2026-07-01T00:05:00.000Z',
      source_ids: ['acct_2026_06'],
    })

    const ledger = projectPurificationLedger([shariahEvaluation, accountingSnapshot, dividend, obligation])

    expect(ledger.obligations[0]).toMatchObject({
      obligation_id: 'purify_msft_dividend_2026_06',
      dividend_event_id: 'evt_dividend_msft_june',
      dividend_income_amount: 40,
      impurity_rate: 0.05,
      status: 'unpaid',
      paid_amount: 0,
      remaining_amount: 2,
      audit_source_ids: ['acct_2026_06', 'src_msft_10k', 'src_shariah_screen', 'broker_dividend_notice_2026_06'],
    })
    expect(ledger.summary_by_currency).toEqual({
      USD: { owed: 2, paid: 0, remaining: 2 },
    })
  })

  it('records explicit user payments and projects the remaining balance', () => {
    const obligation = buildPurificationObligationRecordedEvent({
      obligation_id: 'purify_msft_2026_06',
      holding_id: 'holding_msft_001',
      amount: 14.63,
      currency: 'USD',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      shariah_evaluation_id: 'shariah_msft_june',
    }, {
      event_id: 'evt_purify_obligation_msft_june',
      actor_id: 'purification-worker',
      created_at: '2026-07-01T00:05:00.000Z',
    })
    const payment = buildPurificationPaymentRecordedEvent({
      payment_id: 'purify_payment_msft_partial',
      obligation_id: 'purify_msft_2026_06',
      amount: 10,
      currency: 'USD',
      paid_at: '2026-07-03',
      recipient: 'Local zakat charity',
      note: 'User-entered partial payment',
    }, {
      event_id: 'evt_purify_payment_msft_partial',
      actor_id: 'user_local',
      created_at: '2026-07-03T08:00:00.000Z',
      source_ids: ['receipt_2026_07_03'],
    })

    const ledger = projectPurificationLedger([shariahEvaluation, obligation, payment])

    expect(payment).toMatchObject({
      event_type: 'purification_payment_recorded',
      aggregate_type: 'purification_entry',
      aggregate_id: 'purify_msft_2026_06',
      actor_type: 'user',
      actor_id: 'user_local',
    })
    expect(ledger.summary_by_currency).toEqual({
      USD: { owed: 14.63, paid: 10, remaining: 4.63 },
    })
    expect(ledger.payments).toEqual([
      expect.objectContaining({
        payment_id: 'purify_payment_msft_partial',
        obligation_id: 'purify_msft_2026_06',
        amount: 10,
        recipient: 'Local zakat charity',
        audit_source_ids: ['receipt_2026_07_03'],
      }),
    ])
    expect(ledger.obligations[0]).toMatchObject({
      status: 'partially_paid',
      paid_amount: 10,
      remaining_amount: 4.63,
    })
  })

  it('projects fully paid obligations only after explicit user payment events cover the amount', () => {
    const obligation = buildPurificationObligationRecordedEvent({
      obligation_id: 'purify_msft_2026_06',
      holding_id: 'holding_msft_001',
      amount: 14.63,
      currency: 'USD',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      shariah_evaluation_id: 'shariah_msft_june',
    }, {
      event_id: 'evt_purify_obligation_msft_june',
      actor_id: 'purification-worker',
      created_at: '2026-07-01T00:05:00.000Z',
    })
    const payment = buildPurificationPaymentRecordedEvent({
      payment_id: 'purify_payment_msft_final',
      obligation_id: 'purify_msft_2026_06',
      amount: 14.63,
      currency: 'USD',
      paid_at: '2026-07-03',
      recipient: 'Local zakat charity',
    }, {
      event_id: 'evt_purify_payment_msft_final',
      actor_id: 'user_local',
      created_at: '2026-07-03T08:00:00.000Z',
    })

    expect(projectPurificationLedger([shariahEvaluation, obligation]).obligations[0]).toMatchObject({
      status: 'unpaid',
      remaining_amount: 14.63,
    })
    expect(projectPurificationLedger([shariahEvaluation, obligation, payment]).obligations[0]).toMatchObject({
      status: 'paid',
      remaining_amount: 0,
    })
  })
})
