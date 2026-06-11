import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'

import {
  parseCalibrationUniverse,
  suggestCalibrationUniverseAdditions,
  type CalibrationUniverse,
} from '../calibrationUniverse'

const universe: CalibrationUniverse = {
  version: 'calibration-universe-test-1',
  names: [
    { ticker: 'CPRT', company: 'Copart', market: 'US', fundamentals_hint: 'edgar', status: 'active' },
    { ticker: 'TABREED', company: 'Tabreed', market: 'intl', status: 'deferred', defer_reason: 'Non-SEC filer (DFM/ADX) — no automated fundamentals source.' },
  ],
}

function discoveryEvent(ticker: string, company: string): LedgerEventEnvelope<Record<string, unknown>> {
  return {
    event_id: `evt_discovery_${ticker}`,
    event_type: 'discovery_candidate_discovered',
    aggregate_type: 'discovery_candidate',
    aggregate_id: `cand_${ticker}`,
    actor_type: 'provider',
    actor_id: 'discovery',
    payload: {
      candidate_id: `cand_${ticker}`,
      ticker,
      company_name: company,
      market: 'US',
      strategy_id: 'buffett-munger',
      strategy_version: '1',
      discovery_source: '13f_clone',
      dedupe_key: `buffett-munger:1:${ticker}`,
      status: 'discovered',
    },
    source_ids: [],
    created_at: '2026-01-01T00:00:00.000Z',
    schema_version: 1,
  }
}

function researchRequestedEvent(ticker: string, caseId: string): LedgerEventEnvelope<Record<string, unknown>> {
  return {
    event_id: `evt_rc_${caseId}`,
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: caseId,
    correlation_id: caseId,
    actor_type: 'user',
    actor_id: 'user_local',
    payload: {
      research_case_id: caseId,
      ticker,
      company_id: `company_${ticker.toLowerCase()}`,
      strategy_id: 'buffett-munger',
      strategy_version: '1',
    },
    source_ids: [],
    created_at: '2026-02-01T00:00:00.000Z',
    schema_version: 1,
  }
}

describe('parseCalibrationUniverse', () => {
  it('parses a valid universe document', () => {
    const parsed = parseCalibrationUniverse({
      version: 'v1',
      names: [{ ticker: 'cprt', company: 'Copart', market: 'US', fundamentals_hint: 'edgar' }],
    })
    expect(parsed).toBeDefined()
    // ticker is normalized to upper-case.
    expect(parsed?.names[0]?.ticker).toBe('CPRT')
  })

  it('fails closed (undefined) on a malformed document', () => {
    expect(parseCalibrationUniverse({ version: 'v1' })).toBeUndefined()
    expect(parseCalibrationUniverse({ names: [] })).toBeUndefined()
    expect(parseCalibrationUniverse(null)).toBeUndefined()
    expect(parseCalibrationUniverse({ version: 'v1', names: [{ ticker: 'X' }] })).toBeUndefined()
  })

  it('defaults status to active when omitted', () => {
    const parsed = parseCalibrationUniverse({
      version: 'v1',
      names: [{ ticker: 'CPRT', company: 'Copart', market: 'US', fundamentals_hint: 'edgar' }],
    })
    expect(parsed?.names[0]?.status).toBe('active')
  })

  it('parses a deferred name with its defer reason (no automated fundamentals source)', () => {
    const parsed = parseCalibrationUniverse({
      version: 'v1',
      names: [
        {
          ticker: 'TABREED',
          company: 'Tabreed',
          market: 'intl',
          status: 'deferred',
          defer_reason: 'Non-SEC filer (DFM/ADX) — no automated fundamentals source.',
        },
      ],
    })
    const tabreed = parsed?.names[0]
    expect(tabreed?.status).toBe('deferred')
    expect(tabreed?.defer_reason).toMatch(/Non-SEC filer/)
    // A deferred name need not carry a fundamentals_hint (it has no automated lane).
    expect(tabreed?.fundamentals_hint).toBeUndefined()
  })
})

describe('suggestCalibrationUniverseAdditions', () => {
  it('surfaces researched + 13F-discovered tickers not already in the universe', () => {
    const events = [
      discoveryEvent('FDS', 'FactSet'), // not in universe → suggested
      discoveryEvent('CPRT', 'Copart'), // already in universe → excluded
      researchRequestedEvent('NVO', 'rc_nvo_1'), // researched, not in universe → suggested
      researchRequestedEvent('TABREED', 'rc_tab_1'), // already in universe → excluded
    ]
    const suggestions = suggestCalibrationUniverseAdditions(universe, events)
    const tickers = suggestions.map((s) => s.ticker).sort()
    expect(tickers).toEqual(['FDS', 'NVO'])
  })

  it('labels the provenance of each suggestion (researched vs 13F-discovered)', () => {
    const events = [
      discoveryEvent('FDS', 'FactSet'),
      researchRequestedEvent('NVO', 'rc_nvo_1'),
    ]
    const suggestions = suggestCalibrationUniverseAdditions(universe, events)
    const fds = suggestions.find((s) => s.ticker === 'FDS')
    const nvo = suggestions.find((s) => s.ticker === 'NVO')
    expect(fds?.sources).toContain('13f_discovered')
    expect(nvo?.sources).toContain('researched')
  })

  it('dedupes a ticker discovered AND researched into one suggestion carrying both sources', () => {
    const events = [
      discoveryEvent('FDS', 'FactSet'),
      researchRequestedEvent('FDS', 'rc_fds_1'),
    ]
    const suggestions = suggestCalibrationUniverseAdditions(universe, events)
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]?.sources.sort()).toEqual(['13f_discovered', 'researched'])
  })

  it('returns an empty list when every candidate is already in the universe', () => {
    const events = [discoveryEvent('CPRT', 'Copart'), researchRequestedEvent('TABREED', 'rc_tab_1')]
    expect(suggestCalibrationUniverseAdditions(universe, events)).toEqual([])
  })

  it('excludes deferred names from suggestions (they are already listed, just deferred)', () => {
    // TABREED is in the universe as a deferred name; a discovery/research hit must NOT re-suggest it.
    const events = [discoveryEvent('TABREED', 'Tabreed'), researchRequestedEvent('TABREED', 'rc_tab_2')]
    expect(suggestCalibrationUniverseAdditions(universe, events)).toEqual([])
  })
})
