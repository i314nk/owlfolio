import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ResearchCasePanel } from '../ResearchCasePanel'
import type { AppResearchCase } from '../../lib/workflow'

// ── Phase 6 S8b: the SELL DECISION panel (worst-case-first; guard-held = CORRECT posture; no auto-close) ──
//
// The panel renders the PERSISTED `sell_recommendation` projection (advisory) for a HELD name, leading with
// the worst case, distinguishing the four decision_status states, and NEVER offering an auto-sell control.

function heldCase(): AppResearchCase {
  return {
    research_case_id: 'rc_sell_001',
    version: 1,
    superseded: false,
    stage: 'holding',
    company_id: 'company_sell',
    ticker: 'SELL',
    strategy_id: 'buffett-munger',
    investment_verdict: 'HOLD',
    valuation_status: 'FAIR',
    valuation: { moat_class: 'wide', moat_passes_gate: true, buy_price_per_share: 100 },
    next_required_action: 'Consider the sell decision.',
    updated_at: '2026-06-08T12:00:00.000Z',
    gate_checklist: [],
    source_ids: [],
    ledger_timeline: [],
  }
}

const worstCase = () => ({
  downside_floor_per_share: 80,
  downside_floor_basis: 'net_cash',
  downside_floor_reliability: 'high',
  realistic_downside: 20,
})

describe('SellDecisionPanel — Phase 6 S8b', () => {
  it('shows the on-demand request control and no fabricated decision when none is persisted (held)', () => {
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase: heldCase(), mode: 'personal-local' }))
    expect(html).toContain('Sell decision')
    expect(html).toContain('Request sell decision')
    expect(html).not.toContain('data-testid="sell-decision"')
  })

  it('renders a SELL_REVIEW worst-case-first, surfaces reason + sign-off, and the close is human-authored', () => {
    const researchCase: AppResearchCase = {
      ...heldCase(),
      sell_recommendation: {
        decision_status: 'sell_review',
        reason_code: 'thesis_broken',
        trigger: 'thesis_broke',
        impairment_call: 'permanent_impairment',
        minimum_hold_decision: 'allow_sell_review',
        worst_case: worstCase(),
        bias_caveats: [{ kind: 'disposition', message: 'do not hold just to avoid realizing a loss' }],
        requires_human_signoff: true,
        recorded_at: '2026-06-08T13:00:00.000Z',
      },
    }
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase, mode: 'personal-local' }))

    expect(html).toContain('data-sell-status="sell_review"')
    // Worst case appears and precedes the reason in the DOM (worst-case-first).
    expect(html).toContain('data-testid="sell-worst-case"')
    expect(html).toContain('Concrete downside floor $80.00/share')
    expect(html).toContain('data-testid="sell-floor-basis"')
    expect(html).toContain('net cash')
    expect(html.indexOf('sell-worst-case')).toBeLessThan(html.indexOf('sell-reason-code'))
    // Reason code surfaced.
    expect(html).toContain('data-testid="sell-reason-code"')
    expect(html).toContain('thesis broke')
    // Human sign-off prominently surfaced.
    expect(html).toContain('data-testid="sell-human-signoff"')
    expect(html).toContain('Requires your sign-off')
    expect(html).toContain('The close is human-authored')
    // Bias caveats rendered as advisory notes.
    expect(html).toContain('data-testid="sell-bias-caveats"')
    expect(html).toContain('do not hold just to avoid realizing a loss')
    // CRITICAL: there is NO auto-close / auto-sell control anywhere.
    // CRITICAL: the close copy is present, but there is NO actionable auto-close / sell button.
    expect(html).toContain('There is no auto-sell')
    expect(html).not.toContain('Close holding')
    expect(html).not.toContain('Sell now')
    expect(html).not.toContain('Confirm sale')
  })

  it('renders HOLD as the CORRECT POSITIVE posture (emerald), NOT a yellow/red warning', () => {
    const researchCase: AppResearchCase = {
      ...heldCase(),
      sell_recommendation: {
        decision_status: 'hold',
        reason_code: 'minimum_hold_active',
        trigger: 'thesis_broke',
        impairment_call: 'fixable_temporary',
        minimum_hold_decision: 'hold_blocks_sell',
        worst_case: worstCase(),
        bias_caveats: [],
        requires_human_signoff: false,
        recorded_at: '2026-06-08T13:30:00.000Z',
      },
    }
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase, mode: 'personal-local' }))

    expect(html).toContain('data-sell-status="hold"')
    expect(html).toContain('data-testid="sell-hold-correct-posture"')
    expect(html).toContain('Correct posture')
    expect(html).toContain('disposition brake working as designed')
    // POSITIVE posture: emerald accent border is used.
    expect(html).toContain('#34d399')
    // No yellow caveat / red risk palette INSIDE the hold block (before the request control).
    const holdBlock = html.slice(html.indexOf('data-sell-status="hold"'))
    const panelEnd = holdBlock.indexOf('Re-run sell decision')
    const holdMarkup = holdBlock.slice(0, panelEnd === -1 ? undefined : panelEnd)
    // worst-case block carries red, but the DECISION framing is emerald (no gold/yellow warning color).
    expect(holdMarkup).not.toContain('#f0d999')
    // No actionable auto-close control.
    expect(html).not.toContain('Close holding')
    expect(html).not.toContain('Confirm sale')
  })

  it('renders ESCALATE_REVIEW as a distinct neutral/attention "needs your judgment" state (not an error)', () => {
    const researchCase: AppResearchCase = {
      ...heldCase(),
      sell_recommendation: {
        decision_status: 'escalate_review',
        reason_code: 'escalate_human_review',
        trigger: 'thesis_broke',
        impairment_call: 'unresolved',
        minimum_hold_decision: 'escalate_human_review',
        worst_case: worstCase(),
        bias_caveats: [],
        requires_human_signoff: true,
        recorded_at: '2026-06-08T13:45:00.000Z',
      },
    }
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase, mode: 'personal-local' }))

    expect(html).toContain('data-sell-status="escalate_review"')
    expect(html).toContain('data-testid="sell-escalate-message"')
    expect(html).toContain('needs your judgment')
    expect(html).toContain('unresolved or incoherent')
    expect(html).not.toContain('Close holding')
    expect(html).not.toContain('Confirm sale')
  })

  it('renders CANNOT_ASSESS fail-closed (a neutral honest message, never a fabricated verdict)', () => {
    const researchCase: AppResearchCase = {
      ...heldCase(),
      sell_recommendation: {
        decision_status: 'cannot_assess',
        trigger: 'valuation_inverted',
        worst_case: {},
        bias_caveats: [],
        recorded_at: '2026-06-08T14:00:00.000Z',
      },
    }
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase, mode: 'personal-local' }))

    expect(html).toContain('data-sell-status="cannot_assess"')
    expect(html).toContain('Cannot assess the sell trigger')
    expect(html).toContain('fail-closed')
    expect(html).not.toContain('Close holding')
    expect(html).not.toContain('Confirm sale')
  })
})
