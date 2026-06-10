import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ProposedSourcesSchema, type GroundFn } from '../groundedAgent'
import { runValidatedAgent, ValidatedAgentFailedError } from '../runValidatedAgent'
import type { CapturedSource } from '../sourceGrounding'

const schema = z.object({
  finding_summary: z.string().min(1),
  // OPTIONAL on the schema, REQUIRED by the validator below (the dogfood high-stakes field).
  moat_rubric: z.object({ proposed_tier: z.string() }).optional(),
  proposed_sources: ProposedSourcesSchema,
})

const src = (id: string) => ({
  source_id: id,
  title: 'T',
  url: 'https://www.sec.gov/x',
  excerpt: 'e',
})

const ground: GroundFn = vi.fn(async (sources: { source_id: string; title: string; url: string; excerpt: string }[]) => ({
  captured: sources.map((s) => ({
    source_id: s.source_id,
    title: s.title,
    url: s.url,
    excerpt: s.excerpt,
    availability: 'available' as const,
    fetched_at: 'x',
    content_hash: 'sha256:1',
  })) as CapturedSource[],
  verified_ids: sources.map((s) => s.source_id),
}))

// A stub provider whose structured() returns a scripted sequence of payloads, recording each prompt.
function scriptedProvider(payloads: unknown[]) {
  let call = 0
  const prompts: string[] = []
  return {
    provider: {
      provider_id: 'stub',
      capabilities: {} as never,
      complete: vi.fn(),
      runWithTools: vi.fn(),
      structured: vi.fn(async (req: { prompt: string }) => {
        prompts.push(req.prompt)
        const payload = payloads[Math.min(call, payloads.length - 1)]
        call++
        return payload
      }),
    },
    prompts,
    callCount: () => call,
  }
}

const baseRequest = { run_id: 'r', model_id: 'm', prompt: 'analyze X', timeout_ms: 1000 }

describe('runValidatedAgent — schema validation + retry (harness defense 1)', () => {
  it('succeeds on the first try when the required field is present', async () => {
    const { provider, callCount } = scriptedProvider([
      { finding_summary: 'ok', moat_rubric: { proposed_tier: 'wide' }, proposed_sources: [src('s1')] },
    ])
    const out = await runValidatedAgent(provider as never, baseRequest, schema, {
      ground,
      requiredFields: [{ name: 'moat_rubric', present: (a) => a.moat_rubric !== undefined }],
    })
    expect(out.status).toBe('ok')
    if (out.status !== 'ok') throw new Error('expected ok')
    expect(out.result.analysis.finding_summary).toBe('ok')
    expect(callCount()).toBe(1)
  })

  it('retries (bouncing the error into the prompt) and succeeds on the second attempt', async () => {
    const { provider, prompts, callCount } = scriptedProvider([
      // attempt 1: missing the required moat_rubric
      { finding_summary: 'ok', proposed_sources: [src('s1')] },
      // attempt 2 (retry): now includes it
      { finding_summary: 'ok', moat_rubric: { proposed_tier: 'wide' }, proposed_sources: [src('s1')] },
    ])
    const out = await runValidatedAgent(provider as never, baseRequest, schema, {
      ground,
      requiredFields: [{ name: 'moat_rubric', present: (a) => a.moat_rubric !== undefined }],
    })
    expect(out.status).toBe('ok')
    expect(callCount()).toBe(2)
    // The retry prompt bounced the specific validation error back to the model.
    expect(prompts[1]).toMatch(/previous output failed/i)
    expect(prompts[1]).toMatch(/moat_rubric/)
  })

  it('marks the stage FAILED after 2 failed attempts (never passed through as complete)', async () => {
    const { provider, callCount } = scriptedProvider([
      { finding_summary: 'ok', proposed_sources: [src('s1')] }, // missing required field, every time
    ])
    const out = await runValidatedAgent(provider as never, baseRequest, schema, {
      ground,
      requiredFields: [{ name: 'moat_rubric', present: (a) => a.moat_rubric !== undefined }],
    })
    expect(out.status).toBe('failed')
    if (out.status !== 'failed') throw new Error('expected failed')
    expect(out.attempts).toBe(2)
    expect(out.missing).toContain('moat_rubric')
    // 2 attempts total (initial + 1 retry).
    expect(callCount()).toBe(2)
  })

  it('throwOnFailed=true throws a ValidatedAgentFailedError after exhausting retries', async () => {
    const { provider } = scriptedProvider([
      { finding_summary: 'ok', proposed_sources: [src('s1')] },
    ])
    await expect(
      runValidatedAgent(provider as never, baseRequest, schema, {
        ground,
        requiredFields: [{ name: 'moat_rubric', present: (a) => a.moat_rubric !== undefined }],
        throwOnFailed: true,
      }),
    ).rejects.toBeInstanceOf(ValidatedAgentFailedError)
  })

  it('treats a schema/provider throw as a failed attempt and retries', async () => {
    let call = 0
    const provider = {
      provider_id: 'stub',
      capabilities: {} as never,
      complete: vi.fn(),
      runWithTools: vi.fn(),
      structured: vi.fn(async () => {
        call++
        if (call === 1) throw new Error('Structured output validation failed: bad json')
        return { finding_summary: 'ok', moat_rubric: { proposed_tier: 'wide' }, proposed_sources: [src('s1')] }
      }),
    }
    const out = await runValidatedAgent(provider as never, baseRequest, schema, {
      ground,
      requiredFields: [{ name: 'moat_rubric', present: (a) => a.moat_rubric !== undefined }],
    })
    expect(out.status).toBe('ok')
    expect(call).toBe(2)
  })
})
