import { describe, expect, it, vi } from 'vitest'

import type { Provider } from '@owlfolio/providers'

import { runArabicProsePass, ArabicProseSchema } from '../arabicProsePass'

const ENGLISH_PROSE = {
  decision_reason: 'WATCH — the price sits above the computed buy-below.',
  thesis_summary: 'A durable payments network with pricing power.',
  evidence_summary: 'Grounded in the FY2025 10-K: revenue growth and margins.',
  valuation_rationale: 'FCF-based IV with an 8% assumed growth.',
  shariah_rationale: 'Sector compliant; ratios within AAOIFI thresholds.',
  synthesis_summary: 'The lanes agree; the verdict is WATCH pending price.',
}

const ARABIC_PROSE = {
  decision_reason: 'مراقبة — السعر أعلى من سعر الشراء المحسوب.',
  thesis_summary: 'شبكة مدفوعات متينة تتمتع بقدرة تسعيرية.',
  evidence_summary: 'موثَّق من التقرير السنوي 10-K لسنة 2025: نمو الإيرادات والهوامش.',
  valuation_rationale: 'قيمة جوهرية على أساس التدفق النقدي الحر بنمو مفترض 8%.',
  shariah_rationale: 'القطاع متوافق؛ والنسب ضمن حدود معايير أيوفي.',
  synthesis_summary: 'المسارات متوافقة؛ والحكم مراقبة بانتظار السعر.',
}

function providerReturning(result: unknown, opts: { failFirst?: boolean } = {}): Provider {
  let calls = 0
  return {
    provider_id: 'openrouter',
    structured: vi.fn(async () => {
      calls += 1
      if (opts.failFirst === true && calls === 1) {
        throw new Error('transient upstream 502')
      }
      return result
    }),
  } as unknown as Provider
}

describe('runArabicProsePass — the focused Arabic prose rendering (owner, 2026-07-18)', () => {
  it('returns the Arabic rendering of the six prose fields', async () => {
    const provider = providerReturning(ARABIC_PROSE)
    const prose = await runArabicProsePass(provider, {
      research_case_id: 'rc_test',
      model_id: 'z-ai/glm-5.2',
      ticker: 'V',
      prose: ENGLISH_PROSE,
    })
    expect(prose).toEqual(ARABIC_PROSE)
  })

  it('the prompt carries the fidelity contract: no new claims, keep tickers/enums/citations, AAOIFI terminology, English authoritative', async () => {
    const provider = providerReturning(ARABIC_PROSE)
    await runArabicProsePass(provider, {
      research_case_id: 'rc_test',
      model_id: 'z-ai/glm-5.2',
      ticker: 'V',
      prose: ENGLISH_PROSE,
    })
    const request = (provider.structured as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { prompt: string; task_kind: string }
    expect(request.task_kind).toBe('structured-output')
    expect(request.prompt).toContain('faithful rendering')
    expect(request.prompt).toContain('do NOT add, remove, soften, or strengthen any claim')
    expect(request.prompt).toContain('AAOIFI')
    expect(request.prompt).toContain('English record remains authoritative')
    // The English source prose is embedded for the model to render.
    expect(request.prompt).toContain('durable payments network')
  })

  it('retries once on a transient error, then succeeds', async () => {
    const provider = providerReturning(ARABIC_PROSE, { failFirst: true })
    const prose = await runArabicProsePass(provider, {
      research_case_id: 'rc_test',
      model_id: 'z-ai/glm-5.2',
      ticker: 'V',
      prose: ENGLISH_PROSE,
    })
    expect(prose).toEqual(ARABIC_PROSE)
    expect((provider.structured as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
  })

  it('FAIL-OPEN: exhausted retries return undefined — the run must never fail for a prose rendering', async () => {
    const provider = {
      provider_id: 'openrouter',
      structured: vi.fn(async () => { throw new Error('down') }),
    } as unknown as Provider
    const prose = await runArabicProsePass(provider, {
      research_case_id: 'rc_test',
      model_id: 'z-ai/glm-5.2',
      ticker: 'V',
      prose: ENGLISH_PROSE,
    })
    expect(prose).toBeUndefined()
  })

  it('schema rejects empty renderings (a blank field is a failed pass, not a silent blank dossier line)', () => {
    expect(ArabicProseSchema.safeParse({ ...ARABIC_PROSE, thesis_summary: '' }).success).toBe(false)
    expect(ArabicProseSchema.safeParse(ARABIC_PROSE).success).toBe(true)
  })
})
