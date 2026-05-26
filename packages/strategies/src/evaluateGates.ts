import type { HardGate, StrategyContract } from './strategyContract'

export type ShariahFactStatus = 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT'

export type GateFacts = Partial<Record<string, boolean | ShariahFactStatus>> & {
  shariah_status?: ShariahFactStatus
  owner_earnings_positive?: boolean
  leverage_safe?: boolean
  valuation_complete?: boolean
  source_coverage_complete?: boolean
}

export type GateEvaluationStatus = 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'INSUFFICIENT_DATA'

export interface GateEvaluationResult {
  status: GateEvaluationStatus
  failed_gates: string[]
  warning_gates: string[]
  unknown_gates: string[]
  conditional_gates: string[]
}

type SingleGateResult = 'pass' | 'conditional' | 'fail' | 'unknown'

export function evaluateGates(strategy: StrategyContract, facts: GateFacts): GateEvaluationResult {
  const failed_gates: string[] = []
  const warning_gates: string[] = []
  const unknown_gates: string[] = []
  const conditional_gates: string[] = []

  for (const gate of strategy.hard_gates) {
    const result = evaluateGate(strategy, gate, facts)

    if (result === 'fail' && gate.severity === 'blocking') {
      failed_gates.push(gate.id)
    }

    if (result === 'fail' && gate.severity === 'warning') {
      warning_gates.push(gate.id)
    }

    if (result === 'unknown' && gate.severity === 'blocking') {
      unknown_gates.push(gate.id)
    }

    if (result === 'conditional') {
      conditional_gates.push(gate.id)
    }
  }

  if (failed_gates.length > 0) {
    return { status: 'NON_COMPLIANT', failed_gates, warning_gates, unknown_gates, conditional_gates }
  }

  if (unknown_gates.length > 0) {
    return { status: 'INSUFFICIENT_DATA', failed_gates, warning_gates, unknown_gates, conditional_gates }
  }

  if (conditional_gates.length > 0) {
    return { status: 'CONDITIONAL', failed_gates, warning_gates, unknown_gates, conditional_gates }
  }

  return { status: 'COMPLIANT', failed_gates, warning_gates, unknown_gates, conditional_gates }
}

function evaluateGate(strategy: StrategyContract, gate: HardGate, facts: GateFacts): SingleGateResult {
  const value = facts[gate.fact_key]

  if (value === undefined || value === null) {
    return 'unknown'
  }

  switch (gate.check) {
    case 'boolean_true':
      if (typeof value !== 'boolean') {
        return 'unknown'
      }

      return value ? 'pass' : 'fail'

    case 'shariah_compliant_or_conditional':
      if (value === 'COMPLIANT' && strategy.shariah.accepted_statuses.includes(value)) {
        return 'pass'
      }

      if (value === 'CONDITIONAL') {
        if (strategy.shariah.allow_conditional && strategy.shariah.accepted_statuses.includes(value)) {
          return 'conditional'
        }

        return 'fail'
      }

      if (value === 'NON_COMPLIANT' && strategy.shariah.prohibited_statuses.includes(value)) {
        return 'fail'
      }

      return 'unknown'
  }
}
