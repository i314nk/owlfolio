import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import {
  MAX_RE_REVIEW_FILINGS,
  ThesisReReviewSchema,
  buildReReviewIdempotencyKey,
  draftThesisReReview,
  loadPriorThesis,
  reReviewToolBudget,
  selectReviewedFilings,
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

/**
 * FLAKE FIX (2026-07-17, 3 sightings): without this injection the production default performs a
 * LIVE sec.gov exhibit-discovery fetch (the stub provider is not 'mock-provider') — fast standalone,
 * intermittently slow/failing under full-suite parallel load. Unit tests stay offline.
 */
const noExhibits = async () => []

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
    }, { ground: verifyAllGround, discoverExhibits: noExhibits })

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
    }, { ground: verifyAllGround, discoverExhibits: noExhibits })

    expect(recorded.assessment).toBe('UNVERIFIED')
    expect(recorded.re_review_ungrounded).toBe(true)
    expect(recorded.ungrounded_reason).toMatch(/cite|verif/i)
  })

  it('a decisive assessment citing MULTIPLE joined ids stays grounded when at least one verifies (live-fire find)', async () => {
    // The live GLM run cited 'rr_a; rr_b; rr_c' in one evidence_citation. Exact-match would degrade a
    // legitimately-cited decisive judgment to UNVERIFIED — fail-closed but false noise. Split-and-any:
    // ≥1 verified token grounds the citation; ALL-unverified still degrades (next test above).
    const projectDir = await makeTempDir('owlfolio-rr-multicite-')
    const sourceLedgerPath = join(projectDir, 'source-ledger')
    await seedPriorBundle(sourceLedgerPath)
    const store = new InMemoryEventStore()
    await seedDecidedCase(store)
    const provider = reReviewProvider((ids) => ({
      ...intactPayload(ids),
      trigger_assessments: [
        { trigger: 'Renewal rate drops below 88%', tripped: 'no', evidence_citation: `${ids[0]!}; some_unverified_id`, reasoning: 'renewal reported fine' },
        { trigger: 'A major membership-fee revolt', tripped: 'no', evidence_citation: ids[0]!, reasoning: 'no fee action' },
      ],
    }))

    const recorded = await draftThesisReReview(store, provider as never, {
      research_case_id: CASE_ID, model_id: 'test-model', causation_id: 'evt_decision',
      source_ledger_path: sourceLedgerPath, check: check({}),
    }, { ground: verifyAllGround, discoverExhibits: noExhibits })

    expect(recorded.assessment).toBe('INTACT')
    expect(recorded.re_review_ungrounded).toBeUndefined()
  })

  it('HARNESS-DERIVED: a model INTACT with EVERY trigger unclear and no changed dimensions records INCONCLUSIVE (live-fire find)', async () => {
    // Live GLM run: 8-K announcement covers + an unreadable 10-Q → all three triggers 'unclear', yet the
    // model self-reported INTACT "by default". Absence of assessable evidence is not evidence of an
    // intact thesis — the harness downgrades to INCONCLUSIVE. INTACT must be affirmative.
    const projectDir = await makeTempDir('owlfolio-rr-inconclusive-')
    const sourceLedgerPath = join(projectDir, 'source-ledger')
    await seedPriorBundle(sourceLedgerPath)
    const store = new InMemoryEventStore()
    await seedDecidedCase(store)
    const provider = reReviewProvider((ids) => ({
      ...intactPayload(ids),
      trigger_assessments: [
        { trigger: 'Renewal rate drops below 88%', tripped: 'unclear', evidence_citation: ids[0]!, reasoning: 'no renewal figures in the readable content' },
        { trigger: 'A major membership-fee revolt', tripped: 'unclear', evidence_citation: ids[0]!, reasoning: 'not addressed by the new filings' },
      ],
    }))

    const recorded = await draftThesisReReview(store, provider as never, {
      research_case_id: CASE_ID, model_id: 'test-model', causation_id: 'evt_decision',
      source_ledger_path: sourceLedgerPath, check: check({}),
    }, { ground: verifyAllGround, discoverExhibits: noExhibits })

    expect(recorded.assessment).toBe('INCONCLUSIVE')
    expect(recorded.re_review_ungrounded).toBeUndefined() // citations verified fine — this is not a verification failure
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
    }, { ground: verifyAllGround, discoverExhibits: noExhibits })

    expect(recorded.new_filings).toHaveLength(MAX_RE_REVIEW_FILINGS)
    expect(recorded.skipped_filings).toHaveLength(2)
  })

  it('FORM DIVERSITY: the cap never lets 8-K covers crowd out the one 10-Q (live-fire find)', () => {
    // Live round 3: 7 filings, strongest-first cap of 6 — six strong 8-K announcement covers made the
    // cut, and the single medium 10-Q (the document that actually CARRIES the renewal/sales/margin
    // data) was skipped. The cap must keep the newest filing of each distinct form, then fill by
    // strength.
    const eightKs: WeightedNewFiling[] = Array.from({ length: MAX_RE_REVIEW_FILINGS }, (_, i) => ({
      form: '8-K', filed: `2026-06-${String(20 - i).padStart(2, '0')}`, url: `https://www.sec.gov/x/8k-${i}.htm`, weight: 'strong' as const,
    }))
    const tenQ: WeightedNewFiling = { form: '10-Q', filed: '2026-05-30', url: 'https://www.sec.gov/x/10q.htm', weight: 'medium' }
    const { reviewed, skipped } = selectReviewedFilings([...eightKs, tenQ], MAX_RE_REVIEW_FILINGS)
    expect(reviewed).toHaveLength(MAX_RE_REVIEW_FILINGS)
    expect(reviewed.some((f) => f.form === '10-Q')).toBe(true) // the 10-Q always makes the cut
    expect(skipped).toHaveLength(1)
    expect(skipped[0]!.form).toBe('8-K') // the OLDEST 8-K is what gets dropped
    expect(skipped[0]!.filed).toBe('2026-06-15')
  })

  it('EXHIBIT GROUNDING: a reviewed 8-K grounds its EX-99 exhibits alongside the cover (live-fire find)', async () => {
    // The announcement cover carries no numbers — the press-release exhibit does. The pass discovers
    // exhibits per reviewed 8-K (injectable), grounds them with parent-derived ids, and offers them in
    // the read affordance. 10-Qs/proxies get no exhibit lookup.
    const projectDir = await makeTempDir('owlfolio-rr-exhibits-')
    const sourceLedgerPath = join(projectDir, 'source-ledger')
    await seedPriorBundle(sourceLedgerPath)
    const store = new InMemoryEventStore()
    await seedDecidedCase(store)
    const provider = reReviewProvider(intactPayload)

    const proposals: { source_id: string; url: string }[] = []
    const spyGround = (async (sources: { source_id: string; title: string; url: string; excerpt: string }[]) => {
      proposals.push(...sources.map((s) => ({ source_id: s.source_id, url: s.url })))
      return (verifyAllGround as unknown as (s: unknown) => unknown)(sources)
    }) as unknown as GroundFn

    const discoverExhibits = vi.fn(async (url: string) => (url === NEW_8K.url
      ? ['https://www.sec.gov/Archives/edgar/data/909832/000090983225000164/costex9918-k121125.htm']
      : []))

    await draftThesisReReview(store, provider as never, {
      research_case_id: CASE_ID, model_id: 'test-model', causation_id: 'evt_decision',
      source_ledger_path: sourceLedgerPath,
      check: check({ new_filings: [NEW_8K, { form: '10-Q', filed: '2026-06-25', url: 'https://www.sec.gov/x/10q.htm', weight: 'medium' }] }),
    }, { ground: spyGround, discoverExhibits })

    // Discovery is 8-K-scoped.
    expect(discoverExhibits).toHaveBeenCalledTimes(1)
    expect(discoverExhibits).toHaveBeenCalledWith(NEW_8K.url)
    // The exhibit was grounded with a parent-derived id.
    const exhibit = proposals.find((p) => p.url.includes('costex991'))
    expect(exhibit).toBeDefined()
    expect(exhibit!.source_id).toMatch(/^rr_8k_2026-06-20_0_ex1$/)
  })

  it('the schema tolerates a malformed final proposed_sources url (live-fire find: one bad URL killed a verified diff)', () => {
    // The tools loop grounds via tool calls DURING the loop; the final proposed_sources array is
    // type-bound bookkeeping that nothing re-fetches. Live GLM echoed a source id in a url field and
    // the strict .url() check threw away an otherwise fully-verified diff. Tolerant here; the SSRF
    // guard still protects every path that actually fetches.
    const parsed = ThesisReReviewSchema.safeParse({
      overall_assessment: 'INTACT',
      trigger_assessments: [{ trigger: 't', tripped: 'no', evidence_citation: 'rr_8k_2026-06-20_0', reasoning: 'r' }],
      changed_dimensions: [],
      narrative: 'n',
      source_ids: ['rr_8k_2026-06-20_0'],
      proposed_sources: [{ source_id: 's', title: 't', url: 'rr_8k_2025-12-11_0', excerpt: 'e' }],
    })
    expect(parsed.success).toBe(true)
  })

  it('tool budget scales with the reviewed delta (live-fire find: 6 filings starved the 10-call default)', () => {
    // The live run read five 8-Ks and had budget left only for the 10-Q's section INDEX — never its
    // MD&A. Each reviewed filing needs up to two reads (index + section) plus slack for the prompt
    // affordances and prior-corpus re-reads.
    expect(reReviewToolBudget(1)).toBeGreaterThanOrEqual(6)
    expect(reReviewToolBudget(MAX_RE_REVIEW_FILINGS)).toBeGreaterThanOrEqual(4 + 2 * MAX_RE_REVIEW_FILINGS)
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

    await expect(draftThesisReReview(store, provider as never, { ...base, check: check({ new_filings: [] }) }, { ground: verifyAllGround, discoverExhibits: noExhibits })).rejects.toThrow(/no new filings/i)
    await expect(draftThesisReReview(store, provider as never, { ...base, check: check({ no_prior_corpus: true }) }, { ground: verifyAllGround, discoverExhibits: noExhibits })).rejects.toThrow(/prior corpus/i)
    await expect(draftThesisReReview(store, provider as never, { ...base, research_case_id: 'rc_unknown', check: check({ research_case_id: 'rc_unknown' }) }, { ground: verifyAllGround, discoverExhibits: noExhibits })).rejects.toThrow(/thesis/i)
    expect(provider.structured).not.toHaveBeenCalled()
  })
})
