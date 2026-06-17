import { describe, expect, it } from 'vitest'
import { buffettMungerStrategy, discountRate, twoStageValuation } from '@owlfolio/strategies/buffettMunger'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import type {
  NameLifecycleProjection,
  NameLifecycleState,
} from '@owlfolio/ledger/projections/nameLifecycleProjection'
import {
  detectSignals,
  selectAction,
  runFalsifierCheck,
  runReUnderwrite,
  LIFECYCLE_SIGNALS,
  LIFECYCLE_STATES,
  type LifecycleSignal,
} from '../lifecycleCadence'

// A recent ISO date so freshness/annual-rerun monitors do NOT trip unless a test wants them to.
const RECENT = '2026-05-01T00:00:00.000Z'
const NOW = new Date('2026-06-01T00:00:00.000Z')

// valuation-core revision — the valuation-inverted signal solves the live price's IMPLIED growth off the
// FROZEN band/oe_ps. We build live prices from the forward FV at a near-term growth so a chosen price
// implies a known growth off frozen_oe_ps=10 against the frozen band ceiling 0.10.
const FROZEN_OE_PS = 10
const FROZEN_BAND_HIGH = 0.10
const fvAt = (g: number): number =>
  twoStageValuation({
    oe_ps: FROZEN_OE_PS,
    g,
    terminal_g: VALUATION_PARAMS.terminal_growth,
    discount: discountRate(buffettMungerStrategy),
    ceiling_multiple: VALUATION_PARAMS.fv_cap_multiple,
    absurd_multiple: VALUATION_PARAMS.fv_absurd_multiple,
    horizon: VALUATION_PARAMS.stage1_horizon,
    fade_years: VALUATION_PARAMS.growth_fade_years,
  }).fair_value as number
// A price implying growth AT/ABOVE the frozen band ceiling (inverts) and one BELOW it (holds).
const PRICE_IMPLIES_ABOVE_CEILING = fvAt(0.12)
const PRICE_IMPLIES_BELOW_CEILING = fvAt(0.05)

function name(overrides: Partial<NameLifecycleProjection> & { state: NameLifecycleState }): NameLifecycleProjection {
  return {
    ticker: 'TEST',
    prune_action_available: false,
    updated_at: RECENT,
    ...overrides,
  }
}

describe('detectSignals — STATE-INDEPENDENCE (the discipline tripwire)', () => {
  // GUARD: detectSignals takes NO `state` param. The structural guarantee of this task is that
  // detection is state-independent — the SAME name-data must yield the SAME signal set regardless of
  // the name's lifecycle state. We drive that by holding all data fixed and varying ONLY `state`.
  it('produces the identical signal set across all states for identical name-data', () => {
    // market_value 250 of nav 1_000 = 25% > the ~22% appreciation-review threshold (Phase 5 S3) → fires
    // over_concentrated, so the tripwire exercises ALL signals across states (a regression coupling
    // any one signal to state breaks this). NB: 25% (not 20%) because the review threshold is ~22%, not 15%.
    const asOfData = { now: NOW, current_price: PRICE_IMPLIES_ABOVE_CEILING, market_value: 250, portfolio_nav: 1_000, thesis_break: true }
    const baseData = {
      // buy_price_per_share ABOVE the live price so price_crossed_buybelow also fires (price ≤ buy-below),
      // while the SAME live price implies growth ≥ the frozen band ceiling so valuation_inverted fires too.
      buy_price_per_share: PRICE_IMPLIES_ABOVE_CEILING + 1,
      fair_value_per_share: 80,
      // frozen band ceiling 0.10 + oe_ps 10: the live price implies ~12% growth ≥ the ceiling →
      // valuation_inverted fires (the market now prices growth above the frozen sustainable ceiling).
      frozen_band_high: FROZEN_BAND_HIGH,
      frozen_oe_ps: FROZEN_OE_PS,
      gate_clean: false,
      shariah_gate_status: 'FAIL',
      falsifier_tripped: true,
      updated_at: '2024-01-01T00:00:00.000Z', // old → stale + reunderwrite_due
    }

    const signalSets = LIFECYCLE_STATES.map((state) =>
      [...detectSignals(name({ ...baseData, state }), asOfData)].sort(),
    )

    // The fixture is constructed to fire ALL signals — so the cross-state equality below is a
    // genuine tripwire for every signal (if any one became state-coupled, the sets would diverge here).
    const first = signalSets[0]
    expect(first).toEqual([...LIFECYCLE_SIGNALS].sort())
    // Every state yields the exact same signal set.
    for (const set of signalSets) {
      expect(set).toEqual(first)
    }
  })

  it('does not raise a signal when its underlying data is absent (absence is not state-branching)', () => {
    // No price, no ratios, no nav, fresh case, clean gate, no falsifier → no signals.
    const signals = detectSignals(
      name({ state: 'watched', updated_at: RECENT, gate_clean: true }),
      { now: NOW },
    )
    expect(signals).toEqual([])
  })

  it('raises price_crossed_buybelow only when current_price <= buy_price', () => {
    const at = detectSignals(name({ state: 'watched', buy_price_per_share: 50, gate_clean: true }), {
      now: NOW,
      current_price: 50,
    })
    expect(at).toContain('price_crossed_buybelow')

    const above = detectSignals(name({ state: 'watched', buy_price_per_share: 50, gate_clean: true }), {
      now: NOW,
      current_price: 51,
    })
    expect(above).not.toContain('price_crossed_buybelow')
  })

  it('raises stale for a superseded-but-RECENT case (superseded is a freshness fact, age-independent)', () => {
    // The case's updated_at is RECENT (fresh by age) and the gate is clean + price cheap — the ONLY
    // staleness cause is `superseded: true`. If superseded is honored, `stale` fires regardless of age.
    const superseded = detectSignals(
      name({ state: 'watched', updated_at: RECENT, superseded: true, buy_price_per_share: 50, gate_clean: true }),
      { now: NOW, current_price: 40 },
    )
    expect(superseded).toContain('stale')
    // It is NOT reunderwrite_due (that derives purely from age, and the case is recent).
    expect(superseded).not.toContain('reunderwrite_due')

    // ISOLATION: the identical name WITHOUT superseded does NOT raise stale — proving superseded is the
    // sole cause here, and that selectAction('stale','watched') therefore suppresses only the superseded one.
    const notSuperseded = detectSignals(
      name({ state: 'watched', updated_at: RECENT, buy_price_per_share: 50, gate_clean: true }),
      { now: NOW, current_price: 40 },
    )
    expect(notSuperseded).not.toContain('stale')

    // The suppress action is what a watched + stale name resolves to.
    expect(selectAction('stale', 'watched').kind).toBe('suppress')
  })

  it('raises stale and reunderwrite_due for an old case', () => {
    const signals = detectSignals(
      name({ state: 'watched', updated_at: '2024-01-01T00:00:00.000Z', gate_clean: true }),
      { now: NOW },
    )
    expect(signals).toContain('stale')
    expect(signals).toContain('reunderwrite_due')
  })

  it('raises gated when the name gate is not clean', () => {
    const signals = detectSignals(name({ state: 'watched', gate_clean: false }), { now: NOW })
    expect(signals).toContain('gated')
  })

  it('raises shariah_breach from an embedded FAIL gate status', () => {
    const signals = detectSignals(
      name({ state: 'held', shariah_gate_status: 'FAIL', gate_clean: true }),
      { now: NOW },
    )
    expect(signals).toContain('shariah_breach')
  })

  it('raises shariah_breach from re-screen ratios when ratios present', () => {
    const signals = detectSignals(name({ state: 'held', gate_clean: true }), {
      now: NOW,
      // Ratios engineered to breach (interest-bearing debt 90% of market cap > 30% cap).
      shariah_ratios: {
        interest_bearing_debt: 900,
        cash_and_securities: 0,
        total_revenue: 1_000,
        market_cap: 1_000,
        impermissible_income: 0,
      },
    })
    expect(signals).toContain('shariah_breach')
  })

  it('raises over_concentrated only when holding + nav present and over the cap', () => {
    const signals = detectSignals(
      name({ state: 'held', holding_id: 'h1', gate_clean: true }),
      { now: NOW, market_value: 250, portfolio_nav: 1_000 }, // 25% > the ~22% appreciation-review threshold
    )
    expect(signals).toContain('over_concentrated')
  })

  it('raises falsifier_tripped from the projection flag OR the thesis_break seam', () => {
    const fromFlag = detectSignals(
      name({ state: 'held', falsifier_tripped: true, gate_clean: true }),
      { now: NOW },
    )
    expect(fromFlag).toContain('falsifier_tripped')

    const fromSeam = detectSignals(name({ state: 'held', gate_clean: true }), {
      now: NOW,
      thesis_break: true,
    })
    expect(fromSeam).toContain('falsifier_tripped')
  })

  it('thesis_break defaults false (deferred seam visible, not fabricated)', () => {
    const signals = detectSignals(name({ state: 'held', gate_clean: true }), { now: NOW })
    expect(signals).not.toContain('falsifier_tripped')
  })
})

describe('detectSignals — valuation_inverted (implied-growth-vs-FROZEN-band)', () => {
  // valuation-core revision — the MIRROR of the buy. The signal fires when the live price's IMPLIED growth
  // (solved off the SIGN-OFF-FROZEN band/oe_ps) reaches the frozen band ceiling — a signed-off cause-ref,
  // NOT a raw price move — and routes to a sell-REVIEW. It must NEVER fire by price alone (no frozen band).
  const frozenBand = { frozen_band_high: FROZEN_BAND_HIGH, frozen_oe_ps: FROZEN_OE_PS }

  it('raises valuation_inverted when implied growth ≥ the frozen band ceiling on a held name', () => {
    const signals = detectSignals(
      name({ state: 'held', ...frozenBand, gate_clean: true }),
      { now: NOW, current_price: PRICE_IMPLIES_ABOVE_CEILING },
    )
    expect(signals).toContain('valuation_inverted')
  })

  it('does NOT raise valuation_inverted when implied growth < the frozen band ceiling (margin intact)', () => {
    const signals = detectSignals(
      name({ state: 'held', ...frozenBand, gate_clean: true }),
      { now: NOW, current_price: PRICE_IMPLIES_BELOW_CEILING },
    )
    expect(signals).not.toContain('valuation_inverted')
  })

  it('does NOT raise valuation_inverted when the frozen band/oe_ps are absent (fail-closed; never price-alone)', () => {
    const signals = detectSignals(
      name({ state: 'held', gate_clean: true }),
      { now: NOW, current_price: 10_000 },
    )
    expect(signals).not.toContain('valuation_inverted')
  })

  it('does NOT raise valuation_inverted when current_price is absent (fail-closed)', () => {
    const signals = detectSignals(
      name({ state: 'held', ...frozenBand, gate_clean: true }),
      { now: NOW },
    )
    expect(signals).not.toContain('valuation_inverted')
  })

  it('detection of valuation_inverted is state-independent (same set across all states)', () => {
    const asOfData = { now: NOW, current_price: PRICE_IMPLIES_ABOVE_CEILING }
    const baseData = { ...frozenBand, gate_clean: true }
    const sets = LIFECYCLE_STATES.map((state) =>
      detectSignals(name({ ...baseData, state }), asOfData).includes('valuation_inverted'),
    )
    // Every state raises the signal identically (true everywhere) — no state-coupling.
    for (const raised of sets) {
      expect(raised).toBe(true)
    }
  })

  it('can read the frozen band/oe_ps from CadenceAsOfData when the caller threads them there', () => {
    const signals = detectSignals(
      name({ state: 'held', gate_clean: true }),
      { now: NOW, current_price: PRICE_IMPLIES_ABOVE_CEILING, frozen_band_high: FROZEN_BAND_HIGH, frozen_oe_ps: FROZEN_OE_PS },
    )
    expect(signals).toContain('valuation_inverted')
  })
})

describe('selectAction — total (signal × state) lookup table', () => {
  it('returns a defined action for EVERY (signal, state) pair in the cartesian product', () => {
    for (const signal of LIFECYCLE_SIGNALS) {
      for (const state of LIFECYCLE_STATES) {
        const action = selectAction(signal, state)
        expect(action).toBeDefined()
        expect(typeof action.kind).toBe('string')
      }
    }
  })

  it('THROWS on an unknown signal (totality guard)', () => {
    expect(() => selectAction('bogus_signal' as LifecycleSignal, 'watched')).toThrow()
  })

  it('THROWS on an unknown state (totality guard)', () => {
    expect(() => selectAction('stale', 'bogus_state' as NameLifecycleState)).toThrow()
  })

  it('pins price_crossed_buybelow cells', () => {
    expect(selectAction('price_crossed_buybelow', 'watched').kind).toBe('buy_eval')
    expect(selectAction('price_crossed_buybelow', 'candidate').kind).toBe('no_op')
    expect(selectAction('price_crossed_buybelow', 'held').kind).toBe('no_op')
    expect(selectAction('price_crossed_buybelow', 'exited').kind).toBe('no_op')
  })

  it('the watched buy_eval references the on-demand sizing recommendation (Phase 5 S7)', () => {
    // The buy_eval action no longer stops at "evaluate a buy"; it points the human at the on-demand
    // sizing recommendation (the S6 assembler) that is computed when they open the sizing step.
    const buyEval = selectAction('price_crossed_buybelow', 'watched')
    expect(buyEval.kind).toBe('buy_eval')
    expect(buyEval.sizing_recommendation_available).toBe(true)
    expect(buyEval.reason).toMatch(/sizing/i)
  })

  it('the held add-tranche cell stays a no_op (deferred — left out of the auto path)', () => {
    // Promoting (price_crossed_buybelow, held) to an auto add-tranche path adds risk (it needs per-name
    // held floor/sic data the cadence table does not carry); it stays an explicit no_op with a reason.
    const held = selectAction('price_crossed_buybelow', 'held')
    expect(held.kind).toBe('no_op')
    expect(held.reason).toMatch(/add-tranche/i)
  })

  it('pins falsifier_tripped cells', () => {
    expect(selectAction('falsifier_tripped', 'held').kind).toBe('sell_review')
    const watched = selectAction('falsifier_tripped', 'watched')
    expect(watched.kind).toBe('reprice_or_prune_review')
    expect(watched.prune_action_available).toBe(false)
    expect(selectAction('falsifier_tripped', 'candidate').kind).toBe('no_op')
    expect(selectAction('falsifier_tripped', 'exited').kind).toBe('no_op')
  })

  it('pins shariah_breach cells', () => {
    expect(selectAction('shariah_breach', 'held').kind).toBe('shariah_grace_or_divest')
    expect(selectAction('shariah_breach', 'watched').kind).toBe('removal_review')
    expect(selectAction('shariah_breach', 'candidate').kind).toBe('no_op')
    expect(selectAction('shariah_breach', 'exited').kind).toBe('no_op')
  })

  it('pins reunderwrite_due cells', () => {
    expect(selectAction('reunderwrite_due', 'held').kind).toBe('re_underwrite')
    expect(selectAction('reunderwrite_due', 'watched').kind).toBe('re_underwrite')
    expect(selectAction('reunderwrite_due', 'candidate').kind).toBe('no_op')
    expect(selectAction('reunderwrite_due', 'exited').kind).toBe('no_op')
  })

  it('pins over_concentrated cells', () => {
    expect(selectAction('over_concentrated', 'held').kind).toBe('trim_review')
    expect(selectAction('over_concentrated', 'candidate').kind).toBe('no_op')
    expect(selectAction('over_concentrated', 'watched').kind).toBe('no_op')
    expect(selectAction('over_concentrated', 'exited').kind).toBe('no_op')
  })

  it('pins valuation_inverted cells (Phase 6 S8c)', () => {
    expect(selectAction('valuation_inverted', 'held').kind).toBe('sell_review')
    expect(selectAction('valuation_inverted', 'watched').kind).toBe('no_op')
    expect(selectAction('valuation_inverted', 'candidate').kind).toBe('no_op')
    expect(selectAction('valuation_inverted', 'exited').kind).toBe('no_op')
    // The held sell_review reason names the frozen-IV inversion.
    expect(selectAction('valuation_inverted', 'held').reason).toMatch(/frozen|intrinsic value/i)
    // Honest label (single source for the worker emission): a valuation-inverted held sell-review carries
    // its OWN reason_code — it must NOT be mislabeled as a broken thesis.
    expect(selectAction('valuation_inverted', 'held').reason_code).toBe('valuation_inverted')
    expect(selectAction('falsifier_tripped', 'held').reason_code).toBe('thesis_broken')
  })

  it('pins stale and gated cells', () => {
    expect(selectAction('stale', 'watched').kind).toBe('suppress')
    expect(selectAction('stale', 'candidate').kind).toBe('no_op')
    expect(selectAction('stale', 'held').kind).toBe('no_op')
    expect(selectAction('stale', 'exited').kind).toBe('no_op')
    expect(selectAction('gated', 'watched').kind).toBe('suppress')
    expect(selectAction('gated', 'candidate').kind).toBe('no_op')
    expect(selectAction('gated', 'held').kind).toBe('no_op')
    expect(selectAction('gated', 'exited').kind).toBe('no_op')
  })

  it('every no_op carries a reason', () => {
    for (const signal of LIFECYCLE_SIGNALS) {
      for (const state of LIFECYCLE_STATES) {
        const action = selectAction(signal, state)
        if (action.kind === 'no_op') {
          expect(action.reason).toBeTruthy()
        }
      }
    }
  })
})

describe('pass orchestrators', () => {
  const names: NameLifecycleProjection[] = [
    name({ ticker: 'BUY', state: 'watched', buy_price_per_share: 50, gate_clean: true }),
    name({ ticker: 'BREAK', state: 'held', falsifier_tripped: true, gate_clean: true }),
    name({ ticker: 'BIG', state: 'held', holding_id: 'h1', gate_clean: true }),
  ]

  it('runFalsifierCheck routes each name to the right actions', () => {
    const results = runFalsifierCheck(names, {
      now: NOW,
      // Per-name as-of data is shared here; BUY is at buy price, BIG is over-concentrated.
      current_price: 50,
      market_value: 300,
      portfolio_nav: 1_000,
    })

    const buy = results.find((r) => r.ticker === 'BUY')
    expect(buy?.actions.map((a) => a.kind)).toContain('buy_eval')

    const broken = results.find((r) => r.ticker === 'BREAK')
    expect(broken?.actions.map((a) => a.kind)).toContain('sell_review')

    const big = results.find((r) => r.ticker === 'BIG')
    expect(big?.actions.map((a) => a.kind)).toContain('trim_review')

    // Actionable results exclude no_ops.
    for (const r of results) {
      expect(r.actions.every((a) => a.kind !== 'no_op')).toBe(true)
    }
  })

  it('runReUnderwrite surfaces reunderwrite_due on an old held/watched name', () => {
    const old = [
      name({ ticker: 'OLD', state: 'held', updated_at: '2024-01-01T00:00:00.000Z', gate_clean: true }),
    ]
    const results = runReUnderwrite(old, { now: NOW })
    const row = results.find((r) => r.ticker === 'OLD')
    expect(row?.signals).toContain('reunderwrite_due')
    expect(row?.actions.map((a) => a.kind)).toContain('re_underwrite')
  })
})

describe('deferred thesis_break seam', () => {
  it('thesis_break true on a held name → falsifier_tripped → sell_review', () => {
    const results = runFalsifierCheck(
      [name({ ticker: 'TB', state: 'held', gate_clean: true })],
      { now: NOW, thesis_break: true },
    )
    const row = results.find((r) => r.ticker === 'TB')
    expect(row?.signals).toContain('falsifier_tripped')
    expect(row?.actions.map((a) => a.kind)).toContain('sell_review')
  })
})
