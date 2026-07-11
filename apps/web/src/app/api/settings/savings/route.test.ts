import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GET, POST } from './route'

// The compliant savings anchor route (F.2): the ONE user-owned opportunity-cost number behind the
// discount, hurdle, and sizing. Out-of-band writes are rejected 400 (never silently clamped here).
describe('/api/settings/savings', () => {
  let dir: string
  let prevConfigPath: string | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'owlfolio-savings-route-'))
    prevConfigPath = process.env.OWLFOLIO_APP_CONFIG_PATH
    process.env.OWLFOLIO_APP_CONFIG_PATH = join(dir, 'app-config.json')
  })

  afterEach(async () => {
    if (prevConfigPath === undefined) delete process.env.OWLFOLIO_APP_CONFIG_PATH
    else process.env.OWLFOLIO_APP_CONFIG_PATH = prevConfigPath
    await rm(dir, { recursive: true, force: true })
  })

  it('GET reports the fail-closed default with configured: false before any write', async () => {
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.configured).toBe(false)
    expect(body.savings.savings_expected_profit_rate).toBe(0.02)
  })

  it('POST persists an in-band anchor, stamps the vintage, and GET reflects it as configured', async () => {
    const post = await POST(new Request('http://localhost/api/settings/savings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ savings_expected_profit_rate: 0.035 }),
    }))
    expect(post.status).toBe(200)
    const postBody = await post.json()
    expect(postBody.savings.savings_expected_profit_rate).toBe(0.035)
    expect(postBody.savings.savings_rate_set_at).toBeDefined()

    const get = await GET()
    const body = await get.json()
    expect(body.configured).toBe(true)
    expect(body.savings.savings_expected_profit_rate).toBe(0.035)
  })

  it('POST rejects an out-of-band rate with 400 (never a silent clamp)', async () => {
    for (const bad of [0.5, -0.01, 'high', null]) {
      const response = await POST(new Request('http://localhost/api/settings/savings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ savings_expected_profit_rate: bad }),
      }))
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.code).toBe('invalid_savings_update')
    }
  })
})
