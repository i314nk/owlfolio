import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const routeMapPath = join(process.cwd(), 'docs/architecture/owlfolio-v2-domain-boundaries.md')

describe('Owlfolio v2 route ownership documentation', () => {
  it('documents the route/page owners that downstream lanes depend on', () => {
    expect(existsSync(routeMapPath)).toBe(true)
    const routeMap = readFileSync(routeMapPath, 'utf8')

    // The live route set as implemented under apps/web/src/app/**/page.tsx. There is no standalone
    // /shariah or /worker page, and /providers is retired (redirects to /settings/providers).
    expect(routeMap).toContain('| Purification | `@owlfolio/ledger` | `/purification` |')
    expect(routeMap).toContain('| Monthly accounting | `@owlfolio/ledger` | `/accounting/monthly` |')
    expect(routeMap).toContain('| Provider settings | `@owlfolio/providers` | `/settings/providers` |')
    expect(routeMap).toContain('| Audit trail | `@owlfolio/ledger` | `/audit` |')
    expect(routeMap).toContain('| Automation settings | `@owlfolio/ledger` | `/settings/automation` |')
    // The retired/non-existent routes must NOT be advertised as live page-owner ROWS in the table.
    expect(routeMap).not.toMatch(/\|[^|]*\|[^|]*\|\s*`\/shariah`\s*\|/)
    expect(routeMap).not.toMatch(/\|[^|]*\|[^|]*\|\s*`\/worker`\s*\|/)
  })
})
