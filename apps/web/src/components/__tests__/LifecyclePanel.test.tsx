import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { NameLifecycleProjection } from '@owlfolio/ledger/projections/nameLifecycleProjection'

import { LifecyclePanel } from '../LifecyclePanel'

function render(names: NameLifecycleProjection[]): string {
  return renderToStaticMarkup(createElement(LifecyclePanel, { names }))
}

const candidate: NameLifecycleProjection = {
  ticker: 'CAND',
  company: 'Candidate Co',
  state: 'candidate',
  prune_action_available: false,
  updated_at: '2026-06-01T00:00:00.000Z',
}

const watchedHealthy: NameLifecycleProjection = {
  ticker: 'WTCH',
  company: 'Watched Co',
  state: 'watched',
  buy_price_per_share: 90,
  fair_value_per_share: 120,
  gate_clean: true,
  prune_action_available: false,
  updated_at: '2026-06-02T00:00:00.000Z',
}

const watchedDeteriorating: NameLifecycleProjection = {
  ticker: 'ROT',
  company: 'Rotting Co',
  state: 'watched',
  falsifier_tripped: true,
  falsifier_reason: 'Shariah re-screen returned FAIL.',
  prune_action_available: false,
  updated_at: '2026-06-03T00:00:00.000Z',
}

const held: NameLifecycleProjection = {
  ticker: 'HELD',
  company: 'Held Co',
  state: 'held',
  buy_price_per_share: 50,
  fair_value_per_share: 80,
  prune_action_available: false,
  updated_at: '2026-06-04T00:00:00.000Z',
}

const exitedSold: NameLifecycleProjection = {
  ticker: 'SOLD',
  company: 'Sold Co',
  state: 'exited',
  exit_provenance: 'sold',
  prune_action_available: false,
  updated_at: '2026-06-05T00:00:00.000Z',
}

const exitedScreened: NameLifecycleProjection = {
  ticker: 'SCRN',
  company: 'Screened Co',
  state: 'exited',
  exit_provenance: 'screened_out',
  prune_action_available: false,
  updated_at: '2026-06-06T00:00:00.000Z',
}

const rediscovered: NameLifecycleProjection = {
  ticker: 'BACK',
  company: 'Comeback Co',
  state: 'candidate',
  prior_exit_provenance: 'screened_out',
  prune_action_available: false,
  updated_at: '2026-06-07T00:00:00.000Z',
}

describe('LifecyclePanel', () => {
  it('groups names by lifecycle state in candidate → watched → held → exited order', () => {
    const html = render([exitedSold, held, watchedHealthy, candidate])
    expect(html).toContain('data-lifecycle-group="candidate"')
    expect(html).toContain('data-lifecycle-group="watched"')
    expect(html).toContain('data-lifecycle-group="held"')
    expect(html).toContain('data-lifecycle-group="exited"')
    // Ordering: candidate group precedes watched precedes held precedes exited.
    const order = ['candidate', 'watched', 'held', 'exited'].map((state) =>
      html.indexOf(`data-lifecycle-group="${state}"`),
    )
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('renders each name with ticker, company and buy-below; the forward-DCF fair value is no longer shown', () => {
    const html = render([watchedHealthy])
    expect(html).toContain('WTCH')
    expect(html).toContain('Watched Co')
    expect(html).toContain('$90')
    // forward-DCF removal: the dollar "Fair value" line is gone even though the projection carries the legacy
    // fair_value_per_share: 120 (a dollar reference FV read as a contradiction against the buy-below).
    expect(html).not.toContain('Fair value')
    expect(html).not.toContain('$120')
  })

  it('flags a deteriorating watched name (falsifier tripped) with its reason — NOT healthy — and shows no prune action yet', () => {
    const html = render([watchedDeteriorating])
    // The deteriorating flag is shown with the reason.
    expect(html.toLowerCase()).toContain('deteriorating')
    expect(html).toContain('Shariah re-screen returned FAIL.')
    // It must indicate there is no prune action available yet (the gap is kept visible).
    expect(html.toLowerCase()).toContain('no prune action')
    // It must carry the deteriorating marker, not present itself as healthy.
    expect(html).toContain('data-falsifier-tripped="true"')
  })

  it('does not flag a healthy watched name as deteriorating', () => {
    const html = render([watchedHealthy])
    expect(html).not.toContain('data-falsifier-tripped="true"')
    // The deteriorating flag block (and its reason copy) must not render for a healthy name.
    expect(html).not.toContain('data-testid="lifecycle-deteriorating"')
    expect(html.toLowerCase()).not.toContain('no prune action')
  })

  it('shows exit provenance distinctly for sold vs screened-out exits', () => {
    const html = render([exitedSold, exitedScreened])
    expect(html).toContain('data-exit-provenance="sold"')
    expect(html).toContain('data-exit-provenance="screened_out"')
    expect(html.toLowerCase()).toContain('sold')
    expect(html.toLowerCase()).toContain('screened out')
  })

  it('shows re-discovery history for a live name with a prior exit', () => {
    const html = render([rediscovered])
    expect(html).toContain('data-prior-exit-provenance="screened_out"')
    expect(html.toLowerCase()).toContain('previously screened out')
  })

  it('renders an empty state when there are no names', () => {
    const html = render([])
    expect(html.toLowerCase()).toContain('no names')
  })
})
