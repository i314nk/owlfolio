import { describe, expect, it } from 'vitest'

import { chunk, shouldTranslateText, TRANSLATE_TARGETS, type ElementLike } from '../pageTranslate'

// In-app page translation via the browser's built-in Translator API (owner, 2026-07-19).
// The walker core is DOM-agnostic so it tests without jsdom: an element is a tagName +
// getAttribute + parentElement chain.

function el(tagName: string, attrs: Record<string, string> = {}, parent: ElementLike | null = null): ElementLike {
  return {
    tagName: tagName.toUpperCase(),
    getAttribute: (name: string) => attrs[name] ?? null,
    parentElement: parent,
  }
}

describe('shouldTranslateText — what the in-app translator may touch', () => {
  it('translates ordinary prose text under ordinary elements', () => {
    expect(shouldTranslateText('A durable wide-moat compounder.', el('p'))).toBe(true)
  })

  it('skips empty/whitespace-only nodes and detached text', () => {
    expect(shouldTranslateText('   \n ', el('p'))).toBe(false)
    expect(shouldTranslateText('', el('p'))).toBe(false)
    expect(shouldTranslateText(null, el('p'))).toBe(false)
    expect(shouldTranslateText('text', null)).toBe(false)
  })

  it('HARDENING CONTRACT: skips any node under translate="no" — at any ancestor depth', () => {
    const protectedParent = el('span', { translate: 'no' })
    expect(shouldTranslateText('evt_decision_drafted_x1', protectedParent)).toBe(false)
    const nested = el('em', {}, el('div', { translate: 'no' }))
    expect(shouldTranslateText('OWLFOLIO_LEDGER_PATH', nested)).toBe(false)
  })

  it('skips script/style/code/textarea/select subtrees and form inputs', () => {
    expect(shouldTranslateText('const x = 1', el('script'))).toBe(false)
    expect(shouldTranslateText('.owl { color: red }', el('style'))).toBe(false)
    expect(shouldTranslateText('corepack pnpm dev', el('code'))).toBe(false)
    expect(shouldTranslateText('user text', el('textarea'))).toBe(false)
    // A span INSIDE a select's option must not be touched mid-control either.
    expect(shouldTranslateText('label', el('option', {}, el('select')))).toBe(false)
  })

  it('translate="yes" on a child re-enables under a protected ancestor (standard semantics)', () => {
    const reEnabled = el('span', { translate: 'yes' }, el('div', { translate: 'no' }))
    expect(shouldTranslateText('prose inside a protected card', reEnabled)).toBe(true)
  })
})

describe('the target-language menu', () => {
  it('offers Arabic first and only BCP-47 ids', () => {
    expect(TRANSLATE_TARGETS[0]?.id).toBe('ar')
    for (const target of TRANSLATE_TARGETS) {
      expect(target.id).toMatch(/^[a-z]{2}(-[A-Za-z]{2,4})?$/)
      expect(target.label.length).toBeGreaterThan(0)
    }
  })
})

describe('chunk — the translation batcher', () => {
  it('splits into fixed-size batches preserving order', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
  })
})
