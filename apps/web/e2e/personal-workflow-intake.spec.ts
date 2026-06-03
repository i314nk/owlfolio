import { expect, test } from '@playwright/test'

function isoDateDaysFromToday(daysFromToday: number): string {
  const today = new Date()
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + daysFromToday))
    .toISOString()
    .slice(0, 10)
}

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/testing/reset')
  expect(response.ok()).toBe(true)
})

test('personal-local mode can create the first research case from the command center', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text())
    }
  })

  const nextReviewDate = isoDateDaysFromToday(153)

  await page.goto('/onboarding')
  await page.getByRole('radio', { name: /personal local mode/i }).click()
  await page.getByRole('combobox').selectOption('mock-provider')
  await page.getByRole('button', { name: /initialize owlfolio workflow/i }).click()

  await expect(page).toHaveURL('/')
  const primaryNav = page.getByRole('navigation', { name: /primary owlfolio navigation/i })
  await expect(primaryNav.getByRole('link', { name: 'Command Center', exact: true })).toHaveAttribute('href', '/')
  await expect(primaryNav.getByRole('link', { name: /research/i })).toHaveAttribute('href', '/research/new')
  await expect(primaryNav.getByRole('link', { name: /watchlist/i })).toHaveAttribute('href', '/watchlist')
  await expect(primaryNav.getByRole('link', { name: /portfolio/i })).toHaveAttribute('href', '/portfolio')
  await expect(primaryNav.getByRole('link', { name: /accounting/i })).toHaveAttribute('href', '/accounting/monthly')
  await expect(primaryNav.getByRole('link', { name: 'Audit', exact: true })).toHaveAttribute('href', '/audit')
  await expect(primaryNav.getByRole('link', { name: /providers/i })).toHaveAttribute('href', '/providers')
  await expect(primaryNav.getByRole('link', { name: /onboarding/i })).toHaveAttribute('href', '/onboarding')

  await primaryNav.getByRole('link', { name: /research/i }).click()
  await expect(page).toHaveURL('/research/new')
  await expect(page.getByRole('button', { name: /create research case/i })).toBeVisible()
  await page.getByRole('navigation', { name: /primary owlfolio navigation/i }).getByRole('link', { name: /onboarding/i }).click()
  await expect(page).toHaveURL('/onboarding')
  await expect(page.getByRole('heading', { name: /set up owlfolio/i })).toBeVisible()
  await page.getByRole('navigation', { name: /primary owlfolio navigation/i }).getByRole('link', { name: /watchlist/i }).click()
  await expect(page).toHaveURL('/watchlist')
  await expect(page.getByText('No watchlist drafts yet. Create a research case first.')).toBeVisible()
  await page.getByRole('navigation', { name: /primary owlfolio navigation/i }).getByRole('link', { name: /portfolio/i }).click()
  await expect(page).toHaveURL('/portfolio')
  await expect(page.getByRole('heading', { name: /no holdings are open yet/i })).toBeVisible()
  await page.getByRole('navigation', { name: /primary owlfolio navigation/i }).getByRole('link', { name: 'Audit', exact: true }).click()
  await expect(page).toHaveURL('/audit')
  await expect(page.getByRole('heading', { name: /audit activity/i })).toBeVisible()
  await page.getByRole('navigation', { name: /primary owlfolio navigation/i }).getByRole('link', { name: /providers/i }).click()
  await expect(page).toHaveURL('/providers')
  await expect(page.getByRole('heading', { name: /provider status/i })).toBeVisible()
  await expect(page.getByText('Mock provider', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Mock provider provider readiness categories').getByText('Effective support (gating source of truth): certified', { exact: true })).toBeVisible()
  await expect(page.getByText('Claude', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Claude provider readiness categories').getByText('Effective support (gating source of truth): unsupported', { exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: /primary owlfolio navigation/i }).getByRole('link', { name: 'Command Center', exact: true }).click()
  await expect(page).toHaveURL('/')

  await page.getByRole('link', { name: /start first research case/i }).first().click()
  await expect(page).toHaveURL('/research/new')

  await page.getByLabel('Ticker').fill('MSFT')
  await page.getByRole('button', { name: /create research case/i }).click()

  await expect(page).toHaveURL(/\/research\/rc_msft_/)
  await expect(page.getByRole('heading', { name: 'MSFT' })).toBeVisible()
  await expect(page.getByText(/decision_drafted/i).first()).toBeVisible()
  await expect(page.getByText('WATCH', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/conditional/i).first()).toBeVisible()
  await expect(page.getByText('src_msft_10k_2025', { exact: true })).toBeVisible()
  await expect(page.getByText('src_msft_proxy_2025', { exact: true })).toBeVisible()
  await expect(page.getByText('src_msft_q1_2026', { exact: true })).toBeVisible()
  await expect(page.getByText(/Costco|src_cost_/)).toHaveCount(0)
  const researchCaseId = new URL(page.url()).pathname.split('/').at(-1)
  expect(researchCaseId).toMatch(/^rc_msft_/)

  await page.getByRole('button', { name: /promote to watchlist/i }).click()

  await expect(page).toHaveURL('/watchlist')
  await expect(page.getByRole('heading', { name: 'MSFT' })).toBeVisible()
  await expect(page.getByText('Draft — awaiting user confirmation')).toBeVisible()
  await expect(page.getByText('Shariah gate: COMPLIANT')).toBeVisible()
  await expect(page.getByText('Required Shariah sources: src_msft_10k_2025, src_msft_proxy_2025, src_msft_q1_2026')).toBeVisible()
  await expect(page.getByRole('link', { name: `Research case ${researchCaseId}` })).toHaveAttribute('href', `/research/${researchCaseId}`)

  await page.getByRole('button', { name: /confirm watchlist draft/i }).click()

  await expect(page).toHaveURL('/watchlist')
  await expect(page.getByRole('heading', { name: 'MSFT' })).toBeVisible()
  await expect(page.getByText('User confirmed')).toBeVisible()
  await expect(page.getByRole('button', { name: /confirm watchlist draft/i })).toHaveCount(0)
  await expect(page.getByRole('link', { name: `Research case ${researchCaseId}` })).toHaveAttribute('href', `/research/${researchCaseId}`)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Monitor confirmed watchlist items for buy-zone and thesis updates' })).toBeVisible()
  await expect(page.locator('article').filter({ hasText: 'Watchlist drafts' }).getByText('0', { exact: true })).toBeVisible()
  await expect(page.locator('article').filter({ hasText: 'Confirmed watchlist' }).getByText('1', { exact: true })).toBeVisible()
  await expect(page.locator('article').filter({ hasText: 'Open holdings' }).getByText('0', { exact: true })).toBeVisible()
  await expect(page.locator('article').filter({ hasText: 'Pending user actions' }).getByText('0', { exact: true })).toBeVisible()

  await page.goto('/watchlist')
  await page.getByLabel('Shares').fill('3.25')
  await page.getByLabel('Cost basis per share').fill('812.40')
  await page.getByLabel('Opened date').fill('2026-05-31')
  await page.getByRole('button', { name: /record initial holding/i }).click()

  await expect(page).toHaveURL('/watchlist')
  await expect(page.getByRole('heading', { name: 'MSFT' })).toBeVisible()
  await expect(page.getByText('Holding recorded')).toBeVisible()
  await expect(page.getByText(/holding_msft_/)).toBeVisible()
  await expect(page.getByRole('button', { name: /record initial holding/i })).toHaveCount(0)

  await page.goto('/portfolio')
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'MSFT' })).toBeVisible()
  await expect(page.getByText('Shares: 3.25')).toBeVisible()
  await expect(page.getByText('Shariah gate: COMPLIANT')).toBeVisible()
  await expect(page.getByText('Required Shariah sources: src_msft_10k_2025, src_msft_proxy_2025, src_msft_q1_2026')).toBeVisible()
  await expect(page.getByText('Cost basis / share: $812.40')).toBeVisible()
  await expect(page.getByText('Total cost basis: $2,640.30', { exact: true })).toBeVisible()
  await expect(page.getByText('Opened: 2026-05-31')).toBeVisible()

  await page.getByLabel('Current price per share').fill('900')
  await page.getByLabel('Valuation date').fill('2026-06-01')
  await page.getByRole('button', { name: /record valuation snapshot/i }).click()

  await expect(page).toHaveURL('/portfolio')
  await expect(page.getByText('Current value: $2,925.00', { exact: true })).toBeVisible()
  await expect(page.getByText('Current price / share: $900.00')).toBeVisible()
  await expect(page.getByText(/Unrealized P&L: \$284\.70 \(10\.78%\)/)).toBeVisible()
  await expect(page.getByText('Concentration: 100.00%')).toBeVisible()
  await expect(page.getByText('Valuation date: 2026-06-01')).toBeVisible()

  await page.getByRole('button', { name: /run buffett-munger review/i }).click()

  await expect(page).toHaveURL('/portfolio')
  await expect(page.getByText('Strategy review drafted').first()).toBeVisible()
  await expect(page.getByText('Choose one auditable decision path')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Apply provider draft' })).toBeVisible()
  await expect(page.getByText('Applies the provider-authored thesis health, action stance, and next review date to portfolio state.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Apply user override' })).toBeVisible()
  await expect(page.getByText('Applies your edited values instead of the provider draft and records a user-authored audit event.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Reject provider draft' })).toBeVisible()
  await expect(page.getByText('Leaves the current confirmed portfolio thesis unchanged and clears this pending draft.')).toBeVisible()
  await page.goto('/')
  await expect(page.getByText('Confirm the drafted strategy review for MSFT')).toBeVisible()
  await expect(page.locator('article').filter({ hasText: 'Pending user actions' }).getByText('1', { exact: true })).toBeVisible()

  await page.goto('/portfolio')
  await page.getByRole('button', { name: /apply provider draft/i }).click()

  await expect(page).toHaveURL('/portfolio')
  await expect(page.getByText('Thesis health: HEALTHY')).toBeVisible()
  await expect(page.getByText('Action stance: HOLD')).toBeVisible()
  await expect(page.getByText('Next review: 2026-09-30')).toBeVisible()
  await expect(page.getByRole('button', { name: /apply provider draft/i })).toHaveCount(0)

  await page.getByRole('button', { name: /run buffett-munger review/i }).click()

  await expect(page).toHaveURL('/portfolio')
  await page.getByLabel('Override thesis health').selectOption('WATCH')
  await page.getByLabel('Override action stance').selectOption('RESEARCH_MORE')
  await page.getByLabel('Override rationale').fill('User override: valuation requires another evidence pass before adding.')
  await page.getByLabel('Override evidence summary').fill('Compared provider draft to the manual valuation snapshot and original thesis.')
  await page.getByLabel('Override uncertainty').fill('Need updated Shariah ratio review and concentration check.')
  await page.getByLabel('Override next review date').fill(nextReviewDate)
  await page.getByRole('button', { name: /apply user override/i }).click()

  await expect(page).toHaveURL('/portfolio')
  await expect(page.getByText('Thesis health: WATCH')).toBeVisible()
  await expect(page.getByText('Action stance: RESEARCH_MORE')).toBeVisible()
  await expect(page.getByText('User override: valuation requires another evidence pass before adding.')).toBeVisible()
  await expect(page.getByText(`Next review: ${nextReviewDate}`)).toBeVisible()
  await expect(page.getByRole('button', { name: /apply user override/i })).toHaveCount(0)

  await page.getByRole('button', { name: /run buffett-munger review/i }).click()

  await expect(page).toHaveURL('/portfolio')
  await expect(page.getByText('Strategy review drafted').first()).toBeVisible()
  await page.getByLabel('Rejection reason').fill('Reject stale draft after override; wait for new evidence.')
  await page.getByRole('button', { name: /reject strategy review/i }).click()

  await expect(page).toHaveURL('/portfolio')
  await expect(page.getByText('Thesis health: WATCH')).toBeVisible()
  await expect(page.getByText('Action stance: RESEARCH_MORE')).toBeVisible()
  await expect(page.getByText(`Next review: ${nextReviewDate}`)).toBeVisible()
  await expect(page.getByRole('button', { name: /reject strategy review/i })).toHaveCount(0)

  await page.goto('/')
  await expect(page.getByText(`Next scheduled strategy review for MSFT is ${nextReviewDate}`)).toBeVisible()
  await expect(page.getByText('Holding review schedule')).toBeVisible()
  await expect(page.getByText('Upcoming')).toBeVisible()
  await expect(page.getByText(`Next review: ${nextReviewDate}`)).toBeVisible()
  await expect(page.getByText(/^\d+ days$/)).toBeVisible()
  await expect(page.getByRole('link', { name: /review msft in portfolio/i })).toHaveAttribute('href', /\/portfolio#holding_msft_/)
  await expect(page.locator('article').filter({ hasText: 'Confirmed watchlist' }).getByText('0', { exact: true })).toBeVisible()
  await expect(page.locator('article').filter({ hasText: 'Open holdings' }).getByText('1', { exact: true })).toBeVisible()
  await expect(page.locator('article').filter({ hasText: 'Pending user actions' }).getByText('0', { exact: true })).toBeVisible()

  await page.goto('/accounting/monthly')
  await expect(page.getByRole('heading', { name: /monthly accounting report/i })).toBeVisible()
  await expect(page.getByText('$2,925.00').first()).toBeVisible()
  await expect(page.getByText('MSFT').first()).toBeVisible()

  await page.goto('/purification')
  await expect(page.getByRole('heading', { name: /purification ledger/i })).toBeVisible()
  await expect(page.getByText(/No purification obligations have been recorded yet/i).or(page.getByText(/Unpaid obligations/i))).toBeVisible()

  await page.goto('/audit')
  await expect(page.getByRole('heading', { name: /audit activity/i })).toBeVisible()
  await expect(page.locator('li').filter({ hasText: 'research_case_created' }).first()).toBeVisible()
  await expect(page.locator('li').filter({ hasText: /holding_review_rejected|holding_review_overridden/ }).first()).toBeVisible()

  await expect(browserErrors).toEqual([])
})
