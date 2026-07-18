import { describe, expect, it } from 'vitest'

import { OWL_LOCALES, localeDir, resolveLocale } from '@owlfolio/shared/appConfig'

import { englishContentNote, t } from '../i18n'

describe('i18n S1 (2026-07-17)', () => {
  it('resolveLocale defaults to en for absent/unknown; every registered locale resolves to itself', () => {
    expect(resolveLocale(undefined)).toBe('en')
    expect(resolveLocale('xx')).toBe('en')
    for (const l of OWL_LOCALES) expect(resolveLocale(l.id)).toBe(l.id)
  })

  it('Arabic is RTL; English is LTR', () => {
    expect(localeDir('ar')).toBe('rtl')
    expect(localeDir('en')).toBe('ltr')
  })

  it('the chrome dictionary translates the nav; the brand renders in Arabic', () => {
    expect(t('ar', 'nav_command_center')).toBe('مركز القيادة')
    expect(t('ar', 'brand_title')).toBe('دليل المالك')
    expect(t('en', 'nav_superinvestors')).toBe('Superinvestors')
  })

  it('the settings chrome keys translate (automation / data safety / provider setup)', () => {
    expect(t('ar', 'sa_title')).toContain('أتمتة')
    expect(t('ar', 'sd_title')).toBe('أمان البيانات')
    expect(t('ar', 'sp_title')).toBe('إعداد المزوِّد')
    expect(t('en', 'sp_title')).toBe('Provider setup')
  })

  it('the English-content note exists only off-English — the honest not-yet-translated banner', () => {
    expect(englishContentNote('en')).toBeUndefined()
    expect(englishContentNote('ar')).toMatch(/بالإنجليزية/)
  })
})
