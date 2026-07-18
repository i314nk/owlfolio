import { describe, expect, it } from 'vitest'

import { t } from '../i18n'

// ENGLISH-ONLY (owner pivot, 2026-07-19): the app ships English; translation into any language is
// external and on-demand (browser full-page translate). The copy table keeps the typed-key
// discipline — shared chrome strings live in one place and a missing key is a compile error.

describe('the English copy table', () => {
  it('serves the shared chrome strings', () => {
    expect(t('brand_title')).toBe('Owner\u2019s Manual')
    expect(t('nav_command_center')).toBe('Command Center')
    expect(t('nav_superinvestors')).toBe('Superinvestors')
    expect(t('sp_title')).toBe('Provider setup')
  })

  it('carries no Arabic renderings — translation is an external concern', () => {
    for (const key of ['brand_title', 'footer_text', 'ln_desc', 'sd_desc'] as const) {
      expect(/[\u0600-\u06FF]/.test(t(key))).toBe(false)
    }
  })
})
