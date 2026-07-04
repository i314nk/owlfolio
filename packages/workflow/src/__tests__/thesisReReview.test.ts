import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import {
  MAX_RE_REVIEW_FILINGS,
  buildReReviewIdempotencyKey,
  draftThesisReReview,
  loadPriorThesis,
} from '../thesisReReview.js'
import { ingestManualSourceBundle } from '../sourceLedger'
import type { GroundFn } from '../groundedAgent'
import type { NewFilingsCheck, WeightedNewFiling } from '../reReviewTrigger.js'

const sha = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`

const dirs: string[] = []
async function makeTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CASE_ID = 'rc_cost_rr'

function baseEvent(over: Partial<LedgerEventEnvelope<unknown>> & { event_id: string; event_type: string; payload: unknown }): LedgerEventEnvelope<unknown> {
  return {
    aggregate_type: 'research_case',
    aggregate_id: CASE_ID,
    correlation_id: CASE_ID,
    actor_type: 'provider',
    actor_id: 'test-provider',
    source_ids: [],
    created_at: '2026-06-01T00:00:00.000Z',
    schema_version: 1,
    ...over,
  } as LedgerEventEnvelope<unknown>
}

async function seedDecidedCase(store: InMemoryEventStore): Promise<void> {
  await store.append(baseEvent({
    event_id: 'evt_case_created',
    event_type: 'research_case_created',
    payload: { research_case_id: CASE_ID, company_id: 'company_cost', ticker: 'COST', strategy_id: 'buffett-munger' },
  }))
  await store.append(baseEvent({
    event_id: 'evt_analysis',
    event_type: 'buffett_munger_analysis_drafted',
    payload: {
      research_case_id: CASE_ID,
      investment_verdict: 'WATCH',
      key_wrong_assumption: 'Membership renewal stays above 90%',
      thesis_break_triggers: ['Renewal rate drops below 88%', 'A major membership-fee revolt'],
    },
  }))
  await store.append(baseEvent({
    event_id: 'evt_decision',
    event_type: 'decision_drafted',
    payload: { research_case_id: CASE_ID, decision: 'WATCH', thesis_summary: 'Membership-fee compounder with durable renewal economics.' },
  }))
}

const NEW_8K: WeightedNewFiling = { form: '8-K', filed: '2026-06-20', url: 'https://www.sec.gov/Archives/edgar/data/909832/000090983226000300/cost-8k.htm', weight: 'strong' }

function check(over: Partial<NewFilingsCheck>): NewFilingsCheck {
  return {
    ticker: 'COST',
    research_case_id: CASE_ID,
    new_filings: [NEW_8K],
    strongest_trigger: 'strong',
    prior_corpus_size: 1,
    no_prior_corpus: false,
    checked_at: '2026-07-05T00:00:00.000Z',
    ...over,
  }
}

/** Ground stub: verifies every proposed source with hash = sha(url). */
const verifyAllGround = (async (sources: { source_id: string; title: string; url: string; excerpt: string }[]) => ({
  captured: sources.map((s) => ({
    source_id: s.source_id, title: s.title, url: s.url, excerpt: s.excerpt,
    availability: 'available' as const, fetched_at: 'x', content_hash: sha(s.url),
  })),
  verified_ids: sources.map((s) => s.source_id),
})) as unknown as GroundFn

/** A provider whose structured() returns the given re-review payload (citations filled per-call). */
function reReviewProvider(payload: (proposedIds: string[]) => Record<string, unknown>) {
  return {
    provider_id: 'fake-rr',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async () => {
      // The pass grounds delta filings with deterministic ids rr_8k_2026-06-20_0 etc.
      return payload(['rr_8k_2026-06-20_0'])
    }),
  }
}

const intactPayload = (ids: string[]) => ({
  overall_assessment: 'INTACT',
  trigger_assessments: [
    { trigger: 'Renewal rate drops below 88%', tripped: 'no', evidence_citation: ids[0]!, reasoning: 'The 8-K reports renewal at 90.4%.' },
    { trigger: 'A major membership-fee revolt', tripped: 'no', evidence_citation: ids[0]!, reasoning: 'No fee action disclosed.' },
  ],
  changed_dimensions: [],
  narrative: 'New 8-K does not change the thesis.',
  source_ids: ids,
  proposed_sources: [{ source_id: ids[0]!, title: '8-K', url: NEW_8K.url, excerpt: 'e' }],
})

async function seedPriorBundle(sourceLedgerPath: string) {
  await ingestManualSourceBundle({
    source_ledger_path: sourceLedgerPath,
    research_case_id: CASE_ID,
    ticker: 'COST',
    strategy_id: 'buffett-munger',
    ingested_by_actor_type: 'system',
    ingested_by_actor_id: 'research_workflow',
    sources: [{
      source_id: 'sec_edgar_10k_0000909832_fy2025',
      kind: 'url' as const,
      url: 'https://www.sec.gov/Archives/edgar/data/909832/000090983225000101/cost-10k.htm',
      content_hash: sha('prior-10k'),
      availability: 'available' as const,
    }],
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('loadPriorThesis', () => {
  it('loads the full recorded thesis from the projection', async () => {
    const store = new InMemoryEventStore()
    await seedDecidedCase(store)
    const prior = loadPriorThesis(await store.list(), CASE_ID)
    expect(prior).toBeDefined()
    expect(prior!.thesis_summary).toContain('Membership-fee compounder')
    expect(prior!.thesis_break_triggers).toHaveLength(2)
    expect(prior!.key_wrong_assumption).toContain('renewal stays above 90%')
  })

  it('fail-closed: unknown case or missing thesis_summary → undefined', async () => {
    const store = new InMemoryEventStore()
    await seedDecidedCase(store)
    expect(loadPriorThesis(await store.list(), 'rc_unknown')).toBeUndefined()
    const store2 = new InMemoryEventStore()
    await store2.append(baseEvent({ event_id: 'e1', event_type: 'research_case_created', payload: { research_case_id: CASE_ID, company_id: 'c', ticker: 'COST', strategy_id: 'buffett-munger' } }))
    expect(loadPriorThesis(await store2.list(), CASE_ID)).toBeUndefined()
  })
})

describe('draftThesisReReview', () => {
  it('happy path: grounds the delta, assesses every recorded trigger, appends the event with verified-only source_ids', async () => {
    const projectDir = await makeTempDir('owlfolio-rr-pass-')
    const sourceLedgerPath = join(projectDir, 'source-ledger')
    await seedPriorBundle(sourceLedgerPath)
    const store = new InMemoryEventStore()
    await seedDecidedCase(store)
    const provider = reReviewProvider(intactPayload)

    const recorded = await draftThesisReReview(store, provider as never, {
      research_case_id: CASE_ID,
      model_id: 'test-model',
      causation_id: 'evt_decision',
      source_ledger_path: sourceLedgerPath,
      check: check({}),
    }, { ground: verifyAllGround })

    expect(recorded.assessment).toBe('INTACT')
    expect(recorded.trigger_assessments).toHaveLength(2)
    expect(recorded.re_review_ungrounded).toBeUndefined()
    const events = await store.list()
    const evt = events.find((e) => e.event_type === 'research_case_re_review_recorded')!
    expect(evt.aggregate_id).toBe(CASE_ID)
    expect(evt.source_ids).toContain('rr_8k_2026-06-20_0')
    expect((evt.payload as { new_filings: unknown[] }).new_filings).toHaveLength(1)
  })

  it('FAIL-CLOSED: a tripped=yes assessment citing an unverified id degrades to UNVERIFIED (never a confident diff)', async () => {
    const projectDir = await makeTempDir('owlfolio-rr-unverified-')
    const sourceLedgerPath = join(projectDir, 'source-ledger')
    await seedPriorBundle(sourceLedgerPath)
    const store = new InMemoryEventStore()
    await seedDecidedCase(store)
    const provider = reReviewProvider((ids) => ({
      ...intactPayload(ids),
      overall_assessment: 'BROKEN',
      trigger_assessments: [
        { trigger: 'Renewal rate drops below 88%', tripped: 'yes', evidence_citation: 'made_up_source', reasoning: 'invented' },
      ],
      broken_claim: 'renewal',
    }))

    const recorded = await draftThesisReReview(store, provider as never, {
      research_case_id: CASE_ID, model_id: 'test-model', causation_id: 'evt_decision',
      source_ledger_path: sourceLedgerPath, check: check({}),
    }, { ground: verifyAllGround })

    expect(recorded.assessment).toBe('UNVERIFIED')
    expect(recorded.re_review_ungrounded).toBe(true)
    expect(recorded.ungrounded_reason).toMatch(/cite|verif/i)
  })

  it('caps the reviewed delta at MAX_RE_REVIEW_FILINGS strongest-first and records the skipped remainder', async () => {
    const projectDir = await makeTempDir('owlfolio-rr-cap-')
    const sourceLedgerPath = join(projectDir, 'source-ledger')
    await seedPriorBundle(sourceLedgerPath)
    const store = new InMemoryEventStore()
    await seedDecidedCase(store)
    const provider = reReviewProvider(intactPayload)

    const many: WeightedNewFiling[] = Array.from({ length: MAX_RE_REVIEW_FILINGS + 2 }, (_, i) => ({
      form: '8-K', filed: `2026-06-${String(20 - i).padStart(2, '0')}`, url: `https://www.sec.gov/x/8k-${i}.htm`, weight: 'strong' as const,
    }))
    const recorded = await draftThesisReReview(store, provider as never, {
      research_case_id: CASE_ID, model_id: 'test-model', causation_id: 'evt_decision',
      source_ledger_path: sourceLedgerPath, check: check({ new_filings: many }),
    }, { ground: verifyAllGround })

    expect(recorded.new_filings).toHaveLength(MAX_RE_REVIEW_FILINGS)
    expect(recorded.skipped_filings).toHaveLength(2)
  })

  it('idempotency is delta-content-keyed: same delta converges, a new filing re-fires', () => {
    const a = buildReReviewIdempotencyKey(CASE_ID, [NEW_8K])
    const b = buildReReviewIdempotencyKey(CASE_ID, [{ ...NEW_8K, url: `${NEW_8K.url}?utm=x` }])
    const c = buildReReviewIdempotencyKey(CASE_ID, [NEW_8K, { ...NEW_8K, url: 'https://www.sec.gov/x/other.htm', filed: '2026-06-21' }])
    expect(a).toBe(b) // normalized URLs
    expect(a).not.toBe(c)
    expect(a).toMatch(new RegExp(`^re-review:${CASE_ID}:[0-9a-f]{12}$`))
  })

  it('guards: empty delta / no_prior_corpus / missing thesis all throw before any provider spend', async () => {
    const projectDir = await makeTempDir('owlfolio-rr-guards-')
    const sourceLedgerPath = join(projectDir, 'source-ledger')
    await seedPriorBundle(sourceLedgerPath)
    const store = new InMemoryEventStore()
    await seedDecidedCase(store)
    const provider = reReviewProvider(intactPayload)
    const base = { research_case_id: CASE_ID, model_id: 'm', causation_id: 'e', source_ledger_path: sourceLedgerPath }

    await expect(draftThesisReReview(store, provider as never, { ...base, check: check({ new_filings: [] }) }, { ground: verifyAllGround })).rejects.toThrow(/no new filings/i)
    await expect(draftThesisReReview(store, provider as never, { ...base, check: check({ no_prior_corpus: true }) }, { ground: verifyAllGround })).rejects.toThrow(/prior corpus/i)
    await expect(draftThesisReReview(store, provider as never, { ...base, research_case_id: 'rc_unknown', check: check({ research_case_id: 'rc_unknown' }) }, { ground: verifyAllGround })).rejects.toThrow(/thesis/i)
    expect(provider.structured).not.toHaveBeenCalled()
  })
})
