import { createElement } from 'react'

/**
 * The valuation price ladder — the decision card's zone strip, shared by the dossier, the
 * watchlist zone board, and the portfolio thesis rows. Load-up (rule 8) → buy (rule 7) → IV,
 * with the live price marked. Renders null unless every anchor is present and ordered
 * (load < buy < IV, all positive) — a partial ladder would mislead.
 */
export function createPriceLadderElement(args: { iv?: number; load?: number; buy?: number; livePrice?: number }) {
  const { iv, load, buy } = args
  // The ANCHORS are required (no partial ladders); the live-price marker is optional — the boards
  // read price SNAPSHOTS, and a freshly promoted name has none until the next refresh. The zones
  // still say everything the analysis computed; the marker joins when a price exists.
  const livePrice = args.livePrice !== undefined && args.livePrice > 0 ? args.livePrice : undefined
  if (iv === undefined || load === undefined || buy === undefined) return null
  if (!(iv > 0) || !(load > 0) || !(buy > load) || !(iv > buy)) return null
  const top = Math.max(livePrice ?? 0, iv) * 1.08
  const pct = (x: number) => `${((x / top) * 100).toFixed(2)}%`
  const seg = (from: number, to: number, color: string, key: string) => createElement('div', {
    key,
    style: { background: color, height: '100%', left: pct(from), position: 'absolute' as const, top: 0, width: pct(to - from) },
  })
  const tick = (x: number, label: string, key: string) => createElement('div', {
    key,
    style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', left: pct(x), position: 'absolute' as const, top: '100%', transform: 'translateX(-50%)', whiteSpace: 'nowrap' as const },
  }, label)
  const inZone = livePrice !== undefined && livePrice <= buy
  return createElement(
    'div',
    { 'data-testid': 'price-ladder', style: { display: 'grid', gap: '0.2rem', margin: '0.3rem 0 1.4rem' } },
    createElement(
      'div',
      { style: { background: 'var(--owl-color-panel-deep)', border: '1px solid var(--owl-color-border)', borderRadius: '999px', height: '0.85rem', overflow: 'visible', position: 'relative' as const } },
      seg(0, load, 'rgba(34, 197, 94, 0.55)', 'seg-load'),
      seg(load, buy, 'rgba(34, 197, 94, 0.28)', 'seg-buy'),
      seg(buy, iv, 'rgba(214, 178, 94, 0.25)', 'seg-fair'),
      // The live-price marker (only when a price snapshot/quote exists).
      livePrice === undefined ? null : createElement('div', {
        'data-testid': 'price-ladder-marker',
        style: { background: inZone ? '#4ade80' : 'var(--owl-color-risk-bright)', borderRadius: '1px', bottom: '-0.3rem', left: pct(livePrice), position: 'absolute' as const, top: '-0.3rem', transform: 'translateX(-50%)', width: '3px' },
      }),
      livePrice === undefined ? null : createElement('div', {
        style: { color: inZone ? '#4ade80' : 'var(--owl-color-risk-bright)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', fontWeight: 800, left: pct(livePrice), position: 'absolute' as const, bottom: 'calc(100% + 0.35rem)', transform: 'translateX(-50%)', whiteSpace: 'nowrap' as const },
      }, `price $${livePrice.toFixed(2)}`),
      tick(load, `load up $${load.toFixed(2)}`, 'tick-load'),
      tick(buy, `buy $${buy.toFixed(2)}`, 'tick-buy'),
      tick(iv, `IV $${iv.toFixed(2)}`, 'tick-iv'),
    ),
  )
}
