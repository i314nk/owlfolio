import { NextResponse } from 'next/server'

import {
  DEFAULT_SAVINGS_SLEEVE,
  SAVINGS_RATE_MAX,
  SAVINGS_RATE_MIN,
  type SavingsSleeveConfig,
} from '@owlfolio/shared'

import { getOnboardingState, updateOnboardingConfig } from '../../../../lib/onboarding'

// The COMPLIANT SAVINGS ANCHOR setting (F.2): `savings_expected_profit_rate` is the ONE number that
// anchors the valuation discount (anchor + equity premium), the deployment hurdle (anchor +
// equity_risk_margin), and sizing — a single user-owned opportunity-cost input, deliberately NOT a
// per-name discount override (F.13: uniform discount; no valuation-loosening knobs). Out-of-band
// values are REJECTED with 400 (a settings write should error loudly, not silently clamp); the
// config-layer fail-closed clamp remains the backstop for hand-edited files.

function inBand(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= SAVINGS_RATE_MIN && value <= SAVINGS_RATE_MAX
}

function currentSleeve(savings: SavingsSleeveConfig | undefined): SavingsSleeveConfig {
  return savings ?? DEFAULT_SAVINGS_SLEEVE
}

export async function GET() {
  const state = await getOnboardingState()
  return NextResponse.json({
    savings: currentSleeve(state.config.savings),
    // Whether the anchor is a USER-SET value or the fail-closed default (the UI labels this honestly).
    // Field presence is not the signal (defaults materialize the sleeve): the vintage stamp is — it is
    // written only when a rate CHANGE lands through the merge.
    configured: state.config.savings?.savings_rate_set_at !== undefined,
  })
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json()
    const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>

    if (!inBand(b.savings_expected_profit_rate)) {
      return NextResponse.json(
        {
          error: {
            code: 'invalid_savings_update',
            message: `savings_expected_profit_rate must be a number between ${SAVINGS_RATE_MIN} and ${SAVINGS_RATE_MAX} (decimal, e.g. 0.035 for 3.5%)`,
          },
        },
        { status: 400 },
      )
    }
    if ('equity_risk_margin' in b && b.equity_risk_margin !== undefined && !inBand(b.equity_risk_margin)) {
      return NextResponse.json(
        {
          error: {
            code: 'invalid_savings_update',
            message: `equity_risk_margin must be a number between ${SAVINGS_RATE_MIN} and ${SAVINGS_RATE_MAX} (decimal)`,
          },
        },
        { status: 400 },
      )
    }

    const state = await getOnboardingState()
    const existing = currentSleeve(state.config.savings)
    // updateOnboardingConfig routes savings writes through mergeSavingsSleeveConfig, which STAMPS the
    // rate vintage (savings_rate_set_at) on a rate change.
    const config = await updateOnboardingConfig({
      savings: {
        ...existing,
        savings_expected_profit_rate: b.savings_expected_profit_rate,
        ...(inBand(b.equity_risk_margin) ? { equity_risk_margin: b.equity_risk_margin } : {}),
      },
    })
    return NextResponse.json({ savings: currentSleeve(config.savings), configured: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error updating the savings anchor'
    return NextResponse.json({ error: { code: 'savings_update_error', message } }, { status: 500 })
  }
}
