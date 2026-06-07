import type { LedgerEventEnvelope } from '../eventEnvelope'

export type HoldingProjection = {
  holding_id: string
  watchlist_item_id: string
  research_case_id: string
  company_id?: string
  ticker?: string
  strategy_id?: string
  strategy_version?: string
  thesis_summary?: string
  shares: number
  cost_basis_per_share: number
  total_cost_basis: number
  currency: string
  opened_at: string
  latest_price_per_share?: number
  latest_market_value?: number
  latest_valuation_at?: string
  latest_valuation_event_id?: string
  latest_valuation_source?: string
  latest_price_checked_at?: string
  latest_valuation_confidence?: string
  latest_valuation_caveat?: string
  latest_valuation_source_ids?: string[]
  latest_valuation_missing_data?: string[]
  unrealized_gain_loss?: number
  unrealized_gain_loss_percent?: number
  portfolio_weight?: number
  pending_review_id?: string
  pending_review_thesis_health?: string
  pending_review_action_stance?: string
  pending_review_rationale?: string
  pending_review_next_review_at?: string
  latest_review_id?: string
  thesis_health?: string
  action_stance?: string
  latest_review_rationale?: string
  latest_review_evidence_summary?: string
  latest_review_uncertainty?: string
  next_review_at?: string
  latest_reviewed_at?: string
  opened_by_actor_type?: string
  opened_by_actor_id?: string
  shariah_gate_decision_id?: string
  shariah_gate_status?: string
  shariah_gate_allowed?: boolean
  shariah_gate_reasons?: string[]
  shariah_required_source_ids?: string[]
  shariah_missing_evidence?: string[]
  updated_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function getNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key]
  return typeof value === 'boolean' ? value : undefined
}

function getStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key]
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}

type ShariahGateDecisionProjection = {
  decision_id: string
  target_id: string
  status?: string
  allowed?: boolean
  reasons: string[]
  required_source_ids: string[]
  missing_evidence: string[]
  created_at: string
}

function projectShariahGateDecisions(events: LedgerEventEnvelope<unknown>[]): Map<string, ShariahGateDecisionProjection> {
  const decisions = new Map<string, ShariahGateDecisionProjection>()

  for (const event of events) {
    if (event.event_type !== 'shariah_gate_decision_recorded' || !isRecord(event.payload)) {
      continue
    }
    const targetId = getString(event.payload, 'target_id')
    if (targetId === undefined) {
      continue
    }
    const existing = decisions.get(targetId)
    if (existing !== undefined && existing.created_at > event.created_at) {
      continue
    }
    const decisionId = getString(event.payload, 'gate_decision_id') ?? event.aggregate_id
    const decision: ShariahGateDecisionProjection = {
      decision_id: decisionId,
      target_id: targetId,
      reasons: getStringArray(event.payload, 'reasons'),
      required_source_ids: getStringArray(event.payload, 'required_source_ids'),
      missing_evidence: getStringArray(event.payload, 'missing_evidence'),
      created_at: event.created_at,
    }
    const status = getString(event.payload, 'status')
    if (status !== undefined) {
      decision.status = status
    }
    const allowed = getBoolean(event.payload, 'allowed')
    if (allowed !== undefined) {
      decision.allowed = allowed
    }
    decisions.set(targetId, decision)
  }

  return decisions
}

function applyShariahGateDecision(target: HoldingProjection, decision: ShariahGateDecisionProjection | undefined): void {
  if (decision === undefined) {
    return
  }
  target.shariah_gate_decision_id = decision.decision_id
  if (decision.status !== undefined) {
    target.shariah_gate_status = decision.status
  }
  if (decision.allowed !== undefined) {
    target.shariah_gate_allowed = decision.allowed
  }
  target.shariah_gate_reasons = decision.reasons
  target.shariah_required_source_ids = decision.required_source_ids
  target.shariah_missing_evidence = decision.missing_evidence
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2))
}

function roundPercent(value: number): number {
  return Number(value.toFixed(2))
}

function applyString(
  target: HoldingProjection,
  key: keyof Pick<HoldingProjection, 'company_id' | 'ticker' | 'strategy_id' | 'strategy_version' | 'thesis_summary'>,
  value: string | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

export function projectHoldings(events: LedgerEventEnvelope<unknown>[]): HoldingProjection[] {
  const holdings = new Map<string, HoldingProjection>()
  const shariahGateDecisions = projectShariahGateDecisions(events)

  for (const event of events) {
    if (!isRecord(event.payload)) {
      continue
    }

    if (event.event_type === 'holding_opened') {
      const holdingId = getString(event.payload, 'holding_id') ?? event.aggregate_id
      const watchlistItemId = getString(event.payload, 'watchlist_item_id')
      const researchCaseId = getString(event.payload, 'research_case_id') ?? event.correlation_id
      if (watchlistItemId === undefined || researchCaseId === undefined) {
        continue
      }

      const shares = getNumber(event.payload, 'shares') ?? 0
      const costBasisPerShare = getNumber(event.payload, 'cost_basis_per_share') ?? 0
      const holding: HoldingProjection = {
        holding_id: holdingId,
        watchlist_item_id: watchlistItemId,
        research_case_id: researchCaseId,
        shares,
        cost_basis_per_share: costBasisPerShare,
        total_cost_basis: getNumber(event.payload, 'total_cost_basis') ?? roundMoney(shares * costBasisPerShare),
        currency: getString(event.payload, 'currency') ?? 'USD',
        opened_at: getString(event.payload, 'opened_at') ?? event.created_at.slice(0, 10),
        updated_at: event.created_at,
      }

      applyString(holding, 'company_id', getString(event.payload, 'company_id'))
      applyString(holding, 'ticker', getString(event.payload, 'ticker'))
      applyString(holding, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(holding, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyString(holding, 'thesis_summary', getString(event.payload, 'thesis_summary'))
      holding.opened_by_actor_type = getString(event.payload, 'opened_by_actor_type') ?? event.actor_type
      const openedByActorId = getString(event.payload, 'opened_by_actor_id') ?? event.actor_id
      if (openedByActorId !== undefined) {
        holding.opened_by_actor_id = openedByActorId
      }

      holdings.set(holdingId, holding)
      continue
    }

    if (event.event_type === 'holding_valuation_recorded') {
      const holdingId = getString(event.payload, 'holding_id') ?? event.aggregate_id
      const holding = holdings.get(holdingId)
      if (holding === undefined) {
        continue
      }

      const pricePerShare = getNumber(event.payload, 'price_per_share')
      const marketValue = getNumber(event.payload, 'market_value')
        ?? (pricePerShare === undefined ? undefined : roundMoney(pricePerShare * holding.shares))
      if (pricePerShare === undefined || marketValue === undefined) {
        continue
      }

      holding.latest_price_per_share = pricePerShare
      holding.latest_market_value = marketValue
      holding.latest_valuation_at = getString(event.payload, 'valued_at') ?? event.created_at.slice(0, 10)
      holding.latest_valuation_event_id = event.event_id
      holding.latest_valuation_source = getString(event.payload, 'valuation_source') ?? 'manual'
      const priceCheckedAt = getString(event.payload, 'price_checked_at')
      if (priceCheckedAt === undefined) {
        delete holding.latest_price_checked_at
      } else {
        holding.latest_price_checked_at = priceCheckedAt
      }
      const valuationConfidence = getString(event.payload, 'confidence')
      if (valuationConfidence === undefined) {
        delete holding.latest_valuation_confidence
      } else {
        holding.latest_valuation_confidence = valuationConfidence
      }
      const valuationCaveat = getString(event.payload, 'caveat')
      if (valuationCaveat === undefined) {
        delete holding.latest_valuation_caveat
      } else {
        holding.latest_valuation_caveat = valuationCaveat
      }
      holding.latest_valuation_source_ids = [...event.source_ids]
      holding.latest_valuation_missing_data = getStringArray(event.payload, 'missing_data')
      const unrealizedGainLoss = roundMoney(marketValue - holding.total_cost_basis)
      holding.unrealized_gain_loss = unrealizedGainLoss
      if (holding.total_cost_basis !== 0) {
        holding.unrealized_gain_loss_percent = roundPercent((unrealizedGainLoss / holding.total_cost_basis) * 100)
      }
      holding.updated_at = event.created_at
      continue
    }

    if (event.event_type === 'holding_review_drafted') {
      const holdingId = getString(event.payload, 'holding_id') ?? event.correlation_id
      if (holdingId === undefined) {
        continue
      }
      const holding = holdings.get(holdingId)
      if (holding === undefined) {
        continue
      }

      const reviewId = getString(event.payload, 'review_id') ?? event.aggregate_id
      const thesisHealth = getString(event.payload, 'thesis_health')
      const actionStance = getString(event.payload, 'action_stance')
      const rationale = getString(event.payload, 'rationale')
      const nextReviewAt = getString(event.payload, 'next_review_at')
      holding.pending_review_id = reviewId
      if (thesisHealth !== undefined) holding.pending_review_thesis_health = thesisHealth
      if (actionStance !== undefined) holding.pending_review_action_stance = actionStance
      if (rationale !== undefined) holding.pending_review_rationale = rationale
      if (nextReviewAt !== undefined) holding.pending_review_next_review_at = nextReviewAt
      holding.updated_at = event.created_at
      continue
    }

    if (event.event_type === 'holding_review_confirmed' || event.event_type === 'holding_review_overridden') {
      const holdingId = getString(event.payload, 'holding_id') ?? event.correlation_id
      if (holdingId === undefined) {
        continue
      }
      const holding = holdings.get(holdingId)
      if (holding === undefined) {
        continue
      }

      const decidedReviewId = getString(event.payload, 'review_id') ?? event.aggregate_id
      if (holding.pending_review_id === decidedReviewId) {
        delete holding.pending_review_id
        delete holding.pending_review_thesis_health
        delete holding.pending_review_action_stance
        delete holding.pending_review_rationale
        delete holding.pending_review_next_review_at
      }

      holding.latest_review_id = decidedReviewId
      const thesisHealth = getString(event.payload, 'thesis_health')
      const actionStance = getString(event.payload, 'action_stance')
      const rationale = getString(event.payload, 'rationale')
      const evidenceSummary = getString(event.payload, 'evidence_summary')
      const uncertainty = getString(event.payload, 'uncertainty')
      const nextReviewAt = getString(event.payload, 'next_review_at')
      if (thesisHealth !== undefined) holding.thesis_health = thesisHealth
      if (actionStance !== undefined) holding.action_stance = actionStance
      if (rationale !== undefined) holding.latest_review_rationale = rationale
      if (evidenceSummary !== undefined) holding.latest_review_evidence_summary = evidenceSummary
      if (uncertainty !== undefined) holding.latest_review_uncertainty = uncertainty
      if (nextReviewAt !== undefined) holding.next_review_at = nextReviewAt
      holding.latest_reviewed_at = event.created_at
      holding.updated_at = event.created_at
      continue
    }

    if (event.event_type === 'holding_review_rejected') {
      const holdingId = getString(event.payload, 'holding_id') ?? event.correlation_id
      if (holdingId === undefined) {
        continue
      }
      const holding = holdings.get(holdingId)
      if (holding === undefined) {
        continue
      }
      const rejectedReviewId = getString(event.payload, 'review_id') ?? event.aggregate_id
      if (holding.pending_review_id === rejectedReviewId) {
        delete holding.pending_review_id
        delete holding.pending_review_thesis_health
        delete holding.pending_review_action_stance
        delete holding.pending_review_rationale
        delete holding.pending_review_next_review_at
      }
      holding.updated_at = event.created_at
    }
  }

  const totalMarketValue = [...holdings.values()].reduce((sum, holding) => sum + (holding.latest_market_value ?? 0), 0)
  if (totalMarketValue > 0) {
    for (const holding of holdings.values()) {
      if (holding.latest_market_value !== undefined) {
        holding.portfolio_weight = roundPercent((holding.latest_market_value / totalMarketValue) * 100)
      }
    }
  }

  for (const holding of holdings.values()) {
    applyShariahGateDecision(holding, shariahGateDecisions.get(holding.holding_id))
  }

  return [...holdings.values()]
}
