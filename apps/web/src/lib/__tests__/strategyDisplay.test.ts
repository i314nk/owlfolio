import { describe, expect, it } from 'vitest'

import { strategyDisplayName } from '../strategyDisplay'

describe('strategyDisplayName', () => {
  it('maps the persisted buffett-munger id to the Buffett 4-Pillar display name', () => {
    expect(strategyDisplayName('buffett-munger')).toBe('Buffett 4-Pillar')
  })

  it('falls back to the raw id for an unknown strategy (never invents a name)', () => {
    expect(strategyDisplayName('quality-growth')).toBe('quality-growth')
  })
})
