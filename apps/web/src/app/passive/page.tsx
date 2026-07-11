import { createElement } from 'react'

import { mergePassiveSleeveConfig } from '@owlfolio/shared/appConfig'

import { PassiveContributionForm } from '../../components/PassiveContributionForm'
import { PassiveSleevePanel } from '../../components/PassiveSleevePanel'
import { RouteHeader } from '../../components/designSystem'
import { UnconfiguredNotice } from '../../components/UnconfiguredNotice'
import { isUnconfiguredForUser } from '../../lib/modeView'
import { getOnboardingState } from '../../lib/onboarding'
import { computePassiveDue, computeSplitDrift } from '../../lib/passiveSleeve'
import { getPassiveSleeveView } from '../../lib/workflow'

export const dynamic = 'force-dynamic'

const pct = (v: number): string => `${(v * 100).toFixed(0)}%`
const usd = (v: number): string => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`

/**
 * B7 (Phase 4, book alignment): the PASSIVE page — the book's step-2 foundation. The plan (split +
 * monthly DCA + schedule day), the recorded contributions, the rule-2 due read, and the split-drift
 * view. Rule 3 by construction: there is NO sell/withdraw affordance anywhere on this page.
 */
export default async function PassivePage() {
  const state = await getOnboardingState()
  if (isUnconfiguredForUser(state.config)) {
    return createElement(UnconfiguredNotice, { feature: 'Passive sleeve' })
  }

  const passive = mergePassiveSleeveConfig(state.config.passive)
  const configured = state.config.passive?.passive_set_at !== undefined
  const { sleeve, active_value } = await getPassiveSleeveView(state)
  const today = new Date().toISOString().slice(0, 10)
  const due = computePassiveDue(passive, sleeve.last_contribution_at, today)
  const drift = computeSplitDrift({ split: passive.split, passive_total_contributed: sleeve.total_contributed, active_value })

  const helper = { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', margin: 0 } as const

  return createElement(
    'main',
    { className: 'owl-route-frame owl-route-frame-wide' },
    createElement(
      'p',
      { className: 'owl-route-back-row' },
      createElement('a', { className: 'owl-back-link owl-focusable', href: '/' }, '← Back to command center'),
    ),
    createElement(RouteHeader, {
      kicker: 'Passive foundation',
      title: 'Passive sleeve — monthly dollar-cost averaging',
      description: 'The index foundation on the side of the active book. Rule 1: only an amount you can regularly commit. Rule 2: buy on a consistent schedule, no matter what. Rule 3: a lifelong commitment — this page deliberately has no sell control.',
    }),
    createElement('hr', { className: 'owl-rule' }),
    createElement(PassiveSleevePanel, { initialPassive: passive, configured }),
    createElement('hr', { className: 'owl-rule' }),
    createElement(
      'section',
      { 'aria-label': 'Passive sleeve status', className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' }, 'data-testid': 'passive-sleeve-status' },
      createElement('p', { className: 'owl-section-accent' }, 'The recorded side'),
      createElement(
        'div',
        { className: 'owl-ledger-line' },
        createElement('article', { className: 'owl-ledger-stat' },
          createElement('p', { className: 'owl-ledger-label' }, 'Total contributed (at cost)'),
          createElement('p', { className: 'owl-ledger-figure owl-ledger-figure-money' }, usd(sleeve.total_contributed))),
        createElement('article', { className: 'owl-ledger-stat' },
          createElement('p', { className: 'owl-ledger-label' }, 'Months contributed'),
          createElement('p', { className: 'owl-ledger-figure' }, String(sleeve.months_contributed))),
        createElement('article', { className: 'owl-ledger-stat' },
          createElement('p', { className: 'owl-ledger-label' }, 'Next due (rule 2)'),
          createElement('p', { className: 'owl-ledger-figure', 'data-testid': 'passive-next-due' }, due.next_due)),
        createElement('article', { className: 'owl-ledger-stat' },
          createElement('p', { className: 'owl-ledger-label' }, 'This month'),
          createElement('p', {
            className: 'owl-ledger-figure',
            'data-testid': 'passive-month-status',
            style: due.overdue ? { color: 'var(--owl-color-gold-bright)' } : {},
          }, due.contributed_this_month ? 'Contributed ✓' : due.overdue ? 'OVERDUE — rule 2: no matter what' : 'Due ahead')),
      ),
      createElement(PassiveContributionForm),
      createElement(
        'p',
        { style: helper, 'data-testid': 'passive-drift' },
        `Split: target ${pct(drift.target_passive_fraction)} passive`
        + (drift.actual_passive_fraction !== undefined
            ? ` · actual ${pct(drift.actual_passive_fraction)} (${(drift.drift ?? 0) >= 0 ? 'passive-heavy' : 'active-heavy'} by ${pct(Math.abs(drift.drift ?? 0))})`
            : ' · nothing recorded yet'),
      ),
      createElement('p', { style: { ...helper, color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-2xs)', fontFamily: 'var(--owl-font-mono)' } }, drift.basis_note),
      sleeve.contributions.length === 0
        ? null
        : createElement(
            'ul',
            { style: { color: 'var(--owl-color-muted)', display: 'grid', fontSize: 'var(--owl-text-sm)', gap: '0.25rem', margin: 0, paddingLeft: '1.1rem' } },
            ...[...sleeve.contributions].reverse().slice(0, 12).map((c) => createElement(
              'li',
              { key: c.contribution_id },
              `${c.contributed_at} — ${usd(c.amount)}${c.instrument !== undefined ? ` · ${c.instrument}` : ''}${c.note !== undefined ? ` · ${c.note}` : ''}`,
            )),
          ),
    ),
  )
}
