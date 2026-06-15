// Phase 5 S5 — the DEPLOYMENT HURDLE: cash is a first-class position.
//
// Idle capital's default home is the Shariah-compliant savings sleeve (capital-stable Mudarabah). To
// justify deploying that capital out of the sleeve and into a name, the candidate's owner-earnings yield
// at entry must clear a HURDLE above the EXPECTED (not guaranteed) savings rate — beating zero, or even
// beating the savings rate alone, is NOT enough:
//
//     hurdle_rate = savings_expected_profit_rate + equity_risk_margin
//     clears      = owner_earnings_yield >= hurdle_rate
//
// CASH-IS-CORRECT FRAMING: when a candidate does NOT clear the hurdle (or there is no candidate), the
// correct posture is to HOLD IN SAVINGS. That is the ACTIVE form of fat-pitch discipline, reported as the
// CORRECT posture — NEVER an under-deployment warning or error. This module provides the hurdle + the
// honest, positive framing; the S6 assembler turns a non-clearing/no-candidate result into a
// `hold_in_savings` outcome carrying the expected savings return.
//
// ISLAND: pure, deterministic, no I/O, no LLM, no probability.

/** Deployment posture. Both are NON-error: deploying clears the hurdle; holding in savings is CORRECT. */
export type DeploymentPosture = 'deploy' | 'hold_in_savings'

/**
 * Severity of the outcome for surfacing. ALWAYS 'ok': neither deploying nor holding-in-savings is a
 * warning/error. Holding idle capital in the sleeve because nothing clears the hurdle is the correct,
 * disciplined posture — not a shortfall to be flagged.
 */
export type DeploymentSeverity = 'ok'

export type DeploymentHurdleResult = {
  /** True iff owner_earnings_yield >= hurdle_rate (>= is inclusive). */
  clears: boolean
  /** savings_expected_profit_rate + equity_risk_margin. */
  hurdle_rate: number
  /** 'deploy' when the hurdle clears; otherwise 'hold_in_savings' (the CORRECT fat-pitch posture). */
  posture: DeploymentPosture
  /** Always 'ok' — holding in savings is correct, never a warning/error. */
  severity: DeploymentSeverity
  reason: string
}

const finite = (v: number): boolean => typeof v === 'number' && Number.isFinite(v)

/**
 * Evaluate whether a candidate's owner-earnings yield clears the deployment hurdle above the savings rate.
 *
 * Fail-closed: a non-finite owner_earnings_yield does NOT deploy — it holds in savings (still the correct,
 * non-error posture). The hurdle binds: beating zero is not enough; the yield must clear
 * savings_expected_profit_rate + equity_risk_margin.
 */
export function evaluateDeploymentHurdle(args: {
  /** Candidate's owner-earnings yield at entry (from cheapnessScreen / the valuation core). */
  owner_earnings_yield: number
  /** The ONE expected (NOT guaranteed) Mudarabah savings rate, from SavingsSleeveConfig. */
  savings_expected_profit_rate: number
  /** The margin a candidate must clear ABOVE the savings rate to justify deploying out of the sleeve. */
  equity_risk_margin: number
}): DeploymentHurdleResult {
  const hurdleRate = args.savings_expected_profit_rate + args.equity_risk_margin
  const pct = (n: number): string => `${(n * 100).toFixed(2)}%`

  if (!finite(args.owner_earnings_yield)) {
    return {
      clears: false,
      hurdle_rate: hurdleRate,
      posture: 'hold_in_savings',
      severity: 'ok',
      reason:
        `owner-earnings yield is unavailable, so the deployment hurdle (${pct(hurdleRate)} = expected `
        + `savings ${pct(args.savings_expected_profit_rate)} + equity risk margin `
        + `${pct(args.equity_risk_margin)}) is not cleared. Holding idle capital in the savings sleeve is `
        + 'the CORRECT posture (fat-pitch discipline), not an under-deployment warning.',
    }
  }

  const clears = args.owner_earnings_yield >= hurdleRate

  if (clears) {
    return {
      clears: true,
      hurdle_rate: hurdleRate,
      posture: 'deploy',
      severity: 'ok',
      reason:
        `owner-earnings yield ${pct(args.owner_earnings_yield)} clears the deployment hurdle `
        + `${pct(hurdleRate)} (expected savings ${pct(args.savings_expected_profit_rate)} + equity risk `
        + `margin ${pct(args.equity_risk_margin)}); deploying out of the savings sleeve is justified.`,
    }
  }

  return {
    clears: false,
    hurdle_rate: hurdleRate,
    posture: 'hold_in_savings',
    severity: 'ok',
    reason:
      `owner-earnings yield ${pct(args.owner_earnings_yield)} does NOT clear the deployment hurdle `
      + `${pct(hurdleRate)} (expected savings ${pct(args.savings_expected_profit_rate)} + equity risk `
      + `margin ${pct(args.equity_risk_margin)}) — beating zero or the savings rate alone is not enough. `
      + 'Holding idle capital in the savings sleeve is the CORRECT posture (the active form of fat-pitch '
      + 'discipline), not an under-deployment warning.',
  }
}
