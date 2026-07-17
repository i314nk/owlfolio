import { NextResponse } from 'next/server'

import { OWL_LOCALES } from '@owlfolio/shared'

import { getOnboardingState, updateLanguageSettings } from '../../../../lib/onboarding'

/** POST — update the UI language. Accepts `{ language: <OwlLocale> }`; unknown ids are rejected. */
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
  const language = (body as { language?: unknown } | null)?.language
  if (typeof language !== 'string' || !OWL_LOCALES.some((l) => l.id === language)) {
    return NextResponse.json({ error: `Body must be { language: ${OWL_LOCALES.map((l) => l.id).join(' | ')} }` }, { status: 400 })
  }

  const config = await updateLanguageSettings({ language })
  return NextResponse.json({ language: config.language })
}
