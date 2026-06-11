import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'

import {
  buildCalibrationUniverseMemberAddedEvent,
  buildCalibrationUniverseMemberRemovedEvent,
  parseCalibrationUniverse,
  projectCalibrationUniverse,
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

  it('excludes tickers added via ledger events from the suggestions (they are now in the universe)', () => {
    // A 13F-discovered name the owner then ADDED via a member_added event must not re-surface as a suggestion.
    const added = buildCalibrationUniverseMemberAddedEvent({ ticker: 'FDS', company: 'FactSet' })
    const composed = projectCalibrationUniverse(universe, [added])
    const events = [discoveryEvent('FDS', 'FactSet')]
    expect(suggestCalibrationUniverseAdditions(composed, events)).toEqual([])
  })
})

describe('calibration universe member event builders', () => {
  it('builds a user-authored member_added event with a normalized (upper-case, trimmed) ticker', () => {
    const event = buildCalibrationUniverseMemberAddedEvent({ ticker: '  fds ', company: 'FactSet', market: 'US' })
    expect(event.event_type).toBe('calibration_universe_member_added')
    expect(event.aggregate_type).toBe('strategy')
    expect(event.actor_type).toBe('user')
    expect(event.payload.ticker).toBe('FDS')
    expect(event.payload.company).toBe('FactSet')
    expect(event.payload.market).toBe('US')
  })

  it('omits optional company/market when not supplied', () => {
    const event = buildCalibrationUniverseMemberAddedEvent({ ticker: 'fds' })
    expect(event.payload.ticker).toBe('FDS')
    expect(event.payload.company).toBeUndefined()
    expect(event.payload.market).toBeUndefined()
  })

  it('builds a user-authored member_removed event with a normalized ticker', () => {
    const event = buildCalibrationUniverseMemberRemovedEvent({ ticker: ' cprt ' })
    expect(event.event_type).toBe('calibration_universe_member_removed')
    expect(event.aggregate_type).toBe('strategy')
    expect(event.actor_type).toBe('user')
    expect(event.payload.ticker).toBe('CPRT')
  })
})

describe('projectCalibrationUniverse', () => {
  const seed: CalibrationUniverse = {
    version: 'seed-1',
    names: [
      { ticker: 'CPRT', company: 'Copart', market: 'US', fundamentals_hint: 'edgar', status: 'active' },
      { ticker: 'TABREED', company: 'Tabreed', market: 'intl', status: 'deferred', defer_reason: 'Non-SEC filer.' },
    ],
  }

  it('returns the seed names (with a derived version) when there are no events', () => {
    const composed = projectCalibrationUniverse(seed, [])
    expect(composed.names.map((n) => n.ticker)).toEqual(['CPRT', 'TABREED'])
    // version derives from the seed + applied-event count; with 0 events it still differs from the bare seed.
    expect(composed.version).toContain('seed-1')
  })

  it('preserves a deferred seed name status', () => {
    const composed = projectCalibrationUniverse(seed, [])
    const tabreed = composed.names.find((n) => n.ticker === 'TABREED')
    expect(tabreed?.status).toBe('deferred')
    expect(tabreed?.defer_reason).toMatch(/Non-SEC filer/)
  })

  it('adds a user-added ticker as active', () => {
    const added = buildCalibrationUniverseMemberAddedEvent({ ticker: 'FDS', company: 'FactSet', market: 'US' })
    const composed = projectCalibrationUniverse(seed, [added])
    const fds = composed.names.find((n) => n.ticker === 'FDS')
    expect(fds).toBeDefined()
    expect(fds?.status).toBe('active')
    expect(fds?.company).toBe('FactSet')
    expect(fds?.market).toBe('US')
  })

  it('tombstones a removed SEED name (suppressed from the projection)', () => {
    const removed = buildCalibrationUniverseMemberRemovedEvent({ ticker: 'CPRT' })
    const composed = projectCalibrationUniverse(seed, [removed])
    expect(composed.names.map((n) => n.ticker)).not.toContain('CPRT')
  })

  it('un-tombstones a seed name when it is re-added after removal', () => {
    const events = [
      buildCalibrationUniverseMemberRemovedEvent({ ticker: 'CPRT' }),
      buildCalibrationUniverseMemberAddedEvent({ ticker: 'CPRT' }),
    ]
    const composed = projectCalibrationUniverse(seed, events)
    const cprt = composed.names.find((n) => n.ticker === 'CPRT')
    expect(cprt).toBeDefined()
    // The seed metadata (company) is preserved on un-tombstone.
    expect(cprt?.company).toBe('Copart')
  })

  it('derives a version that changes on each edit', () => {
    const v0 = projectCalibrationUniverse(seed, []).version
    const v1 = projectCalibrationUniverse(seed, [buildCalibrationUniverseMemberAddedEvent({ ticker: 'FDS' })]).version
    const v2 = projectCalibrationUniverse(seed, [
      buildCalibrationUniverseMemberAddedEvent({ ticker: 'FDS' }),
      buildCalibrationUniverseMemberRemovedEvent({ ticker: 'CPRT' }),
    ]).version
    expect(v0).not.toBe(v1)
    expect(v1).not.toBe(v2)
  })

  it('is idempotent: re-adding an already-active ticker is a no-op (no duplicate, version unchanged after the first)', () => {
    const once = projectCalibrationUniverse(seed, [buildCalibrationUniverseMemberAddedEvent({ ticker: 'FDS' })])
    const twice = projectCalibrationUniverse(seed, [
      buildCalibrationUniverseMemberAddedEvent({ ticker: 'FDS' }),
      buildCalibrationUniverseMemberAddedEvent({ ticker: 'FDS' }),
    ])
    expect(twice.names.filter((n) => n.ticker === 'FDS')).toHaveLength(1)
    expect(twice.version).toBe(once.version)
  })

  it('normalizes the event ticker to upper-case when matching against seed names', () => {
    const composed = projectCalibrationUniverse(seed, [buildCalibrationUniverseMemberRemovedEvent({ ticker: 'cprt' })])
    expect(composed.names.map((n) => n.ticker)).not.toContain('CPRT')
  })
})
