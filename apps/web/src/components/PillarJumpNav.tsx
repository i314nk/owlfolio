'use client'

import { createElement, type ReactNode } from 'react'

// createElement (no JSX) — repo convention for components imported under vitest (jsx: preserve).

export type PillarJumpTone = 'pass' | 'caution' | 'fail' | 'muted'

export type PillarJumpEntry = {
  /** The anchor suffix — matches the pillar section's `pillar-anchor-<id>` DOM id. */
  id: string
  /** The chip label (GATE, P1 … SYN). */
  label: string
  tone: PillarJumpTone
}

const TONE_GLYPH: Record<PillarJumpTone, string> = { pass: '✓', caution: '⚠', fail: '✗', muted: '·' }
const TONE_COLOR: Record<PillarJumpTone, string> = {
  pass: 'var(--owl-color-positive)',
  caution: 'var(--owl-color-gold-bright)',
  fail: 'var(--owl-color-risk-bright)',
  muted: 'var(--owl-color-quiet)',
}

/**
 * The dossier's sticky pillar jump bar (owner-approved 2026-07-17): one chip per pillar with its
 * verdict glyph; a click EXPANDS the target pillar (the sections are <details>) and scrolls to it.
 * Orientation on a long dossier without nested scrolling.
 */
export function PillarJumpNav({ entries }: { entries: PillarJumpEntry[] }): ReactNode {
  function jump(id: string): void {
    const el = document.getElementById(`pillar-anchor-${id}`)
    if (el === null) return
    if (el instanceof HTMLDetailsElement) el.open = true
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return createElement(
    'nav',
    {
      'aria-label': 'Pillar navigation',
      'data-testid': 'pillar-jump-nav',
      style: {
        alignItems: 'center',
        background: 'var(--owl-color-panel-deep)',
        backdropFilter: 'blur(6px)',
        border: '1px solid var(--owl-color-border)',
        borderRadius: '0.6rem',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.15rem',
        padding: '0.3rem 0.5rem',
        position: 'sticky',
        top: '0.4rem',
        zIndex: 5,
      },
    },
    ...entries.flatMap((entry, i) => [
      i > 0 ? createElement('span', { key: `sep-${entry.id}`, style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-2xs)' } }, '·') : null,
      createElement(
        'button',
        {
          key: entry.id,
          type: 'button',
          className: 'owl-focusable',
          'data-testid': `pillar-jump-${entry.id}`,
          onClick: () => jump(entry.id),
          style: {
            alignItems: 'baseline',
            background: 'none',
            border: 'none',
            borderRadius: '0.4rem',
            color: 'var(--owl-color-muted)',
            cursor: 'pointer',
            display: 'inline-flex',
            fontFamily: 'var(--owl-font-mono)',
            fontSize: 'var(--owl-text-2xs)',
            fontWeight: 800,
            gap: '0.3rem',
            letterSpacing: '0.06em',
            padding: '0.25rem 0.45rem',
          },
        },
        entry.label,
        createElement('span', { style: { color: TONE_COLOR[entry.tone] } }, TONE_GLYPH[entry.tone]),
      ),
    ]),
  )
}
