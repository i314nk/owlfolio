import { NextResponse } from 'next/server'

import { OWL_THEMES } from '@owlfolio/shared'

import { getOnboardingState, updateAppearanceSettings } from '../../../../lib/onboarding'

/** POST — update the UI palette. Accepts `{ theme: <OwlThemeId> }`; unknown ids are rejected. */
export async function POST(request: Request) {
  const state = await getOnboardingState()
  if (!state.is_initialized) {
    return NextResponse.json({ error: 'Onboarding is not initialized' }, { status: 409 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const theme = (body as { theme?: unknown } | null)?.theme
  if (typeof theme !== 'string' || !OWL_THEMES.some((t) => t.id === theme)) {
    return NextResponse.json({ error: `Body must be { theme: ${OWL_THEMES.map((t) => t.id).join(' | ')} }` }, { status: 400 })
  }

  const config = await updateAppearanceSettings({ theme })
  return NextResponse.json({ appearance: config.appearance })
}
