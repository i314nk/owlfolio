import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const routeMapPath = join(process.cwd(), 'docs/architecture/owlfolio-v2-domain-boundaries.md')

describe('Owlfolio v2 route ownership documentation', () => {
  it('documents the route/page owners that downstream lanes depend on', () => {
    expect(existsSync(routeMapPath)).toBe(true)
    const routeMap = readFileSync(routeMapPath, 'utf8')

    expect(routeMap).toContain('| Shariah status | `@owlfolio/ledger` | `/shariah` |')
    expect(routeMap).toContain('| Purification | `@owlfolio/ledger` | `/purification` |')
    expect(routeMap).toContain('| Monthly accounting | `@owlfolio/ledger` | `/accounting` |')
    expect(routeMap).toContain('| Provider status | `@owlfolio/providers` | `/providers` |')
    expect(routeMap).toContain('| Audit trail | `@owlfolio/ledger` | `/audit` |')
    expect(routeMap).toContain('| Worker status | `@owlfolio/ledger` | `/worker` |')
  })
})
