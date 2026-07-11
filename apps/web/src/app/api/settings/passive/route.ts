import { NextResponse } from 'next/server'

import {
  mergePassiveSleeveConfig,
  PASSIVE_SCHEDULE_DAY_MAX,
  PASSIVE_SCHEDULE_DAY_MIN,
  PASSIVE_SPLITS,
} from '@owlfolio/shared'

import { getOnboardingState, updateOnboardingConfig } from '../../../../lib/onboarding'

// B7 (book alignment): the PASSIVE-SLEEVE PLAN — the split (80/20 | 60/40 | 100/0), the monthly
// amount you can REGULARLY commit (rule 1), and the schedule day (rule 2). The plan lives in
// app-config; contributions are separate user-authored ledger events. Out-of-band writes are
// rejected 400; the config-layer merge stays the fail-closed backstop for hand-edited files.

export async function GET() {
  const state = await getOnboardingState()
  return NextResponse.json({
    passive: mergePassiveSleeveConfig(state.config.passive),
    configured: state.config.passive?.passive_set_at !== undefined,
  })
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json()
    const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>

    if (!(PASSIVE_SPLITS as readonly string[]).includes(b.split as string)) {
      return NextResponse.json(
        { error: { code: 'invalid_passive_update', message: `split must be one of ${PASSIVE_SPLITS.join(' | ')}` } },
        { status: 400 },
      )
    }
    if (typeof b.monthly_amount !== 'number' || !Number.isFinite(b.monthly_amount) || b.monthly_amount < 0) {
      return NextResponse.json(
        { error: { code: 'invalid_passive_update', message: 'monthly_amount must be a non-negative number (rule 1: only an amount you can regularly commit)' } },
        { status: 400 },
      )
    }
    if (typeof b.schedule_day !== 'number' || !Number.isInteger(b.schedule_day) || b.schedule_day < PASSIVE_SCHEDULE_DAY_MIN || b.schedule_day > PASSIVE_SCHEDULE_DAY_MAX) {
      return NextResponse.json(
        { error: { code: 'invalid_passive_update', message: `schedule_day must be an integer between ${PASSIVE_SCHEDULE_DAY_MIN} and ${PASSIVE_SCHEDULE_DAY_MAX}` } },
        { status: 400 },
      )
    }

    const state = await getOnboardingState()
    const config = await updateOnboardingConfig({
      passive: {
        ...state.config.passive,
        split: b.split as (typeof PASSIVE_SPLITS)[number],
        monthly_amount: b.monthly_amount,
        schedule_day: b.schedule_day,
      },
    })
    return NextResponse.json({ passive: mergePassiveSleeveConfig(config.passive), configured: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error updating the passive plan'
    return NextResponse.json({ error: { code: 'passive_update_error', message } }, { status: 500 })
  }
}
