import { NextResponse } from 'next/server'

import type { AppConfig } from '@owlfolio/shared'

import { shouldUseTestDemoDefault } from '../../../../lib/appConfigStore'
import { getOnboardingState, switchMode } from '../../../../lib/onboarding'

const VALID_MODES: AppConfig['mode'][] = ['unconfigured', 'demo', 'personal-local']

function isValidMode(value: unknown): value is AppConfig['mode'] {
  return typeof value === 'string' && (VALID_MODES as string[]).includes(value)
}

/**
 * Switch the active mode (demo ↔ personal-local) through the idempotent, non-destructive S1 `switchMode`.
 *
 * This is the providers-page guided-setup mode control — re-editable at any time, NOT a one-shot wizard
 * step. It deliberately delegates to `switchMode` (which no-ops on the same already-initialized mode,
 * repoints the ledger without wipe/re-seed across demo↔personal, seeds only an empty demo ledger, and
 * preserves `initialized_at`) rather than re-implementing init here.
 */
export async function POST(request: Request): Promise<Response> {
  let mode: unknown
  try {
    const body = (await request.json()) as { mode?: unknown }
    mode = body.mode
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body', message: 'Invalid JSON body' } }, { status: 400 })
  }

  if (!isValidMode(mode)) {
    return NextResponse.json(
      { error: { code: 'invalid_mode', message: `Unknown mode: ${String(mode)}` } },
      { status: 400 },
    )
  }

  // Write-path guard: demo mode is retired for real users. It is only enterable under the test
  // harness (playwright e2e / vitest); a directly crafted demo request is rejected in production.
  if (mode === 'demo' && !shouldUseTestDemoDefault(process.env)) {
    return NextResponse.json(
      {
        error: {
          code: 'demo_mode_retired',
          message: 'Demo mode has been retired. Connect a provider to run real research.',
        },
      },
      { status: 400 },
    )
  }

  try {
    const config = await switchMode(mode)
    const state = await getOnboardingState()
    return NextResponse.json({ config, is_initialized: state.is_initialized })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown mode switch error'
    return NextResponse.json({ error: { code: 'mode_switch_error', message } }, { status: 500 })
  }
}
