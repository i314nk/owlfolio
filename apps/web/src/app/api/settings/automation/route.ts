import { NextResponse } from 'next/server'

import type { AutomationSettings } from '@owlfolio/shared'
import {
  AutomationCadenceDiscoveryValues,
  AutomationCadencePriceRefreshValues,
  AutomationCadencePurificationValues,
  AutomationCadenceReanalysisValues,
  AutomationCadenceThesisReviewValues,
  AutomationCadenceWatchlistValues,
  mergeAutomationSettings,
} from '@owlfolio/shared'

import { getOnboardingState, updateAutomationSettings } from '../../../../lib/onboarding'

function isValidPartialAutomation(body: unknown): body is Partial<AutomationSettings> {
  if (typeof body !== 'object' || body === null) {
    return false
  }

  const b = body as Record<string, unknown>

  if ('research_engine_enabled' in b && typeof b.research_engine_enabled !== 'boolean') {
    return false
  }

  if ('quick_screen_approval' in b && !(['automatic', 'review'] as string[]).includes(b.quick_screen_approval as string)) {
    return false
  }

  if ('discovery' in b) {
    const d = b.discovery as Record<string, unknown>
    if (typeof d !== 'object' || d === null) return false
    if ('enabled' in d && typeof d.enabled !== 'boolean') return false
    if ('cadence' in d && !(AutomationCadenceDiscoveryValues as readonly string[]).includes(d.cadence as string)) return false
  }

  if ('watchlist_monitoring' in b) {
    const w = b.watchlist_monitoring as Record<string, unknown>
    if (typeof w !== 'object' || w === null) return false
    if ('enabled' in w && typeof w.enabled !== 'boolean') return false
    if ('cadence' in w && !(AutomationCadenceWatchlistValues as readonly string[]).includes(w.cadence as string)) return false
  }

  if ('thesis_review' in b) {
    const h = b.thesis_review as Record<string, unknown>
    if (typeof h !== 'object' || h === null) return false
    if ('enabled' in h && typeof h.enabled !== 'boolean') return false
    if ('cadence' in h && !(AutomationCadenceThesisReviewValues as readonly string[]).includes(h.cadence as string)) return false
  }

  if ('reanalysis' in b) {
    const r = b.reanalysis as Record<string, unknown>
    if (typeof r !== 'object' || r === null) return false
    if ('cadence' in r && !(AutomationCadenceReanalysisValues as readonly string[]).includes(r.cadence as string)) return false
  }

  if ('purification' in b) {
    const p = b.purification as Record<string, unknown>
    if (typeof p !== 'object' || p === null) return false
    if ('enabled' in p && typeof p.enabled !== 'boolean') return false
    if ('cadence' in p && !(AutomationCadencePurificationValues as readonly string[]).includes(p.cadence as string)) return false
  }

  if ('price_refresh' in b) {
    const v = b.price_refresh as Record<string, unknown>
    if (typeof v !== 'object' || v === null) return false
    if ('enabled' in v && typeof v.enabled !== 'boolean') return false
    if ('cadence' in v && !(AutomationCadencePriceRefreshValues as readonly string[]).includes(v.cadence as string)) return false
  }

  return true
}

export async function GET() {
  const state = await getOnboardingState()
  return NextResponse.json({ automation: mergeAutomationSettings(state.config.automation) })
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json()

    if (!isValidPartialAutomation(body)) {
      return NextResponse.json(
        { error: { code: 'invalid_automation_update', message: 'Invalid automation settings payload' } },
        { status: 400 },
      )
    }

    const config = await updateAutomationSettings(body)
    return NextResponse.json({ automation: mergeAutomationSettings(config.automation) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error updating automation settings'
    return NextResponse.json(
      { error: { code: 'automation_update_error', message } },
      { status: 500 },
    )
  }
}
