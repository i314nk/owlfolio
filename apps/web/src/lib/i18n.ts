import type { OwlLocale } from '@owlfolio/shared/appConfig'

/**
 * i18n S1 (owner-approved 2026-07-17): the CHROME dictionary — navigation, the shell context bar,
 * the footer, and the top-right switchers. Long-form pages (Learn / Strategy / dossier prose) stay
 * English until properly translated, and say so via `english_content_note` when the locale is not
 * English. Keys are typed; a missing key is a compile error, never a silent English leak.
 */
const MESSAGES = {
  en: {
    brand_title: 'Owner’s Manual',
    brand_kicker: 'Fiduciary command center',
    nav_workflow: 'Workflow',
    nav_operations: 'Operations & evidence',
    nav_reference: 'Reference',
    nav_command_center: 'Command Center',
    nav_superinvestors: 'Superinvestors',
    nav_research: 'Research',
    nav_watchlist: 'Watchlist',
    nav_portfolio: 'Portfolio',
    nav_passive: 'Passive',
    nav_pipeline: 'Pipeline',
    nav_audit: 'Audit',
    nav_learn: 'Learn',
    nav_providers: 'Providers',
    nav_settings: 'Settings',
    nav_data_safety: 'Advanced / Data Safety',
    nav_aria_primary: 'Primary Owner’s Manual navigation',
    audit_search: 'Audit trail search',
    workspace: 'Workspace',
    ctx_local_ledger: 'Local ledger',
    ctx_local_ledger_value: 'Route-aware',
    ctx_shariah: 'Shariah context',
    ctx_shariah_value: 'Policy visible',
    ctx_provider: 'Provider readiness',
    ctx_provider_value: 'Shown inline',
    footer_label: 'Fiduciary boundary',
    footer_text: 'Automated output is a draft or observation — never a recommendation to act. Every irreversible transition is human-authored.',
    palette: 'Palette',
    language: 'Language',
    english_content_note: '',
  },
  ar: {
    brand_title: 'دليل المالك',
    brand_kicker: 'مركز القيادة الائتماني',
    nav_workflow: 'سير العمل',
    nav_operations: 'العمليات والأدلة',
    nav_reference: 'المراجع',
    nav_command_center: 'مركز القيادة',
    nav_superinvestors: 'كبار المستثمرين',
    nav_research: 'البحث',
    nav_watchlist: 'قائمة المراقبة',
    nav_portfolio: 'المحفظة',
    nav_passive: 'الاستثمار السلبي',
    nav_pipeline: 'خط المعالجة',
    nav_audit: 'سجل التدقيق',
    nav_learn: 'تعلَّم',
    nav_providers: 'المزوِّدون',
    nav_settings: 'الإعدادات',
    nav_data_safety: 'متقدِّم / أمان البيانات',
    nav_aria_primary: 'التنقل الرئيسي لدليل المالك',
    audit_search: 'البحث في سجل التدقيق',
    workspace: 'مساحة العمل',
    ctx_local_ledger: 'السجل المحلي',
    ctx_local_ledger_value: 'تبعاً للصفحة',
    ctx_shariah: 'السياق الشرعي',
    ctx_shariah_value: 'السياسة ظاهرة',
    ctx_provider: 'جاهزية المزوِّد',
    ctx_provider_value: 'معروضة ضمن الصفحة',
    footer_label: 'الحدود الائتمانية',
    footer_text: 'المخرجات الآلية مسوّدات أو ملاحظات — وليست توصية للتصرف أبداً. كل انتقال لا رجعة فيه يكتبه الإنسان بنفسه.',
    palette: 'لوحة الألوان',
    language: 'اللغة',
    english_content_note: 'محتوى هذه الصفحة التفصيلي ما يزال بالإنجليزية — الترجمة العربية الكاملة قادمة؛ عناصر التنقل والتحكم مُعرَّبة.',
  },
} as const satisfies Record<OwlLocale, Record<string, string>>

export type MessageKey = keyof typeof MESSAGES['en']

export function t(locale: OwlLocale, key: MessageKey): string {
  return MESSAGES[locale][key]
}

/**
 * The honest not-yet-translated banner for long-form pages (Learn / Strategy): visible only when
 * the locale is not English. Rendered by server pages; plain data so pages build their own element.
 */
export function englishContentNote(locale: OwlLocale): string | undefined {
  const note = t(locale, 'english_content_note')
  return note === '' ? undefined : note
}
