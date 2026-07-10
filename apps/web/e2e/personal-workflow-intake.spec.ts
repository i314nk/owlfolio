import { expect, test } from '@playwright/test'

import { initWorkflow } from './helpers'

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

test('personal-local mode can create the first research case from the command center', async ({ page, request }) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text())
    }
  })

  const nextReviewDate = isoDateDaysFromToday(153)

  await page.goto('/')
  const initialPrimaryNav = page.getByRole('navigation', { name: /primary owlfolio navigation/i })
  // The fresh (reset) default is now `unconfigured`; the app-wide workspace indicator shows the honest
  // "no provider configured" state. initWorkflow() below sets up personal-local.
  await expect(initialPrimaryNav.getByText(/no provider configured/i)).toBeVisible()

  // Programmatic init (mock-provider + personal-local) replaces driving the wizard UI. The e2e no longer
  // depends on the wizard to perform setup; the wizard can be deleted in the follow-up slice.
  await initWorkflow(request)

  await page.goto('/')
  await expect(page).toHaveURL('/')
  const primaryNav = page.getByRole('navigation', { name: /primary owlfolio navigation/i })
  await expect(primaryNav.getByRole('link', { name: 'Command Center', exact: true })).toHaveAttribute('href', '/')
  await expect(primaryNav.getByRole('link', { name: /research/i })).toHaveAttribute('href', '/research')
  await expect(primaryNav.getByRole('link', { name: /watchlist/i })).toHaveAttribute('href', '/watchlist')
  await expect(primaryNav.getByRole('link', { name: /portfolio/i })).toHaveAttribute('href', '/portfolio')
  await expect(primaryNav.getByRole('link', { name: /accounting/i })).toHaveAttribute('href', '/accounting/monthly')
  await expect(primaryNav.getByRole('link', { name: 'Audit', exact: true })).toHaveAttribute('href', '/audit')
  await expect(primaryNav.getByRole('link', { name: /providers/i })).toHaveAttribute('href', '/settings/providers')
  await expect(primaryNav.getByRole('link', { name: /onboarding/i })).toHaveCount(0)
  await expect(primaryNav.getByRole('link', { name: /start setup/i })).toHaveCount(0)

  await primaryNav.getByRole('link', { name: /research/i }).click()
  await expect(page).toHaveURL('/research')
  await expect(page.getByRole('heading', { name: /research library/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /manual ticker intake/i })).toBeVisible()
  await page.getByRole('link', { name: /manual ticker intake/i }).click()
  await expect(page).toHaveURL('/research/new')
  await expect(page.getByRole('button', { name: /create research case/i })).toBeVisible()
  // The onboarding wizard is retired: /onboarding now permanently redirects to the consolidated guided-
  // setup surface at /settings/providers, so a visit lands there and shows the provider/model picker.
  await page.goto('/onboarding')
  await expect(page).toHaveURL('/settings/providers')
  await expect(page.getByRole('heading', { name: /choose a provider and model/i })).toBeVisible()
  await page.getByRole('navigation', { name: /primary owlfolio navigation/i }).getByRole('link', { name: /watchlist/i }).click()
  await expect(page).toHaveURL('/watchlist')
  await expect(page.getByText('No watchlist items yet. Create a research case first.')).toBeVisible()
  await page.getByRole('navigation', { name: /primary owlfolio navigation/i }).getByRole('link', { name: /portfolio/i }).click()
  await expect(page).toHaveURL('/portfolio')
  await expect(page.getByRole('heading', { name: /no holdings are open yet/i })).toBeVisible()
  await page.getByRole('navigation', { name: /primary owlfolio navigation/i }).getByRole('link', { name: 'Audit', exact: true }).click()
  await expect(page).toHaveURL('/audit')
  await expect(page.getByRole('heading', { name: /audit activity/i })).toBeVisible()
  // /providers is retired: the nav "Providers" link now points at the consolidated /settings/providers
  // page (provider logins + LLM API keys + provider/model selection). The heavy trust gate was removed —
  // research quality depends on the model the user picks, and that responsibility is theirs.
  await page.getByRole('navigation', { name: /primary owlfolio navigation/i }).getByRole('link', { name: /providers/i }).click()
  await expect(page).toHaveURL('/settings/providers')
  await expect(page.getByRole('heading', { name: /provider setup/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /trust & certification/i })).toHaveCount(0)
  await expect(page.getByText(/Research quality depends on the model you choose/i)).toBeVisible()

  await page.getByRole('navigation', { name: /primary owlfolio navigation/i }).getByRole('link', { name: 'Command Center', exact: true }).click()
  await expect(page).toHaveURL('/')

  await page.getByRole('link', { name: /open research cockpit/i }).first().click()
  await expect(page).toHaveURL('/research')
  await expect(page.getByRole('heading', { name: /research library/i })).toBeVisible()
  await page.getByRole('link', { name: /manual ticker intake/i }).click()
  await expect(page).toHaveURL('/research/new')

  // Set deep_dive_approval to 'automatic' so this run completes straight through
  // (default is 'review' which pauses behind the front gates; the e2e needs the full run)
  const automationResponse = await request.post('/api/settings/automation', {
    data: { deep_dive_approval: 'automatic' },
  })
  expect(automationResponse.ok()).toBe(true)

  await page.getByLabel('Ticker').fill('MSFT')
  await page.getByRole('button', { name: /create research case/i }).click()

  await expect(page).toHaveURL(/\/research\/rc_msft_/)
  // exact: the accessible-sources change adds <h3>"MSFT primary/secondary source" headings in the evidence
  // section, so a loose 'MSFT' heading match is now ambiguous — pin to the dossier <h1> title.
  await expect(page.getByRole('heading', { name: 'MSFT', exact: true })).toBeVisible()
  await expect(page.getByText('Research dossier')).toBeVisible()
  await expect(page.getByText('Verdict summary')).toBeVisible()
  // The verdict now renders as a "Verdict: WATCH" bullet in the (open-by-default) decision panel — the
  // standalone hero verdict chip was consolidated away, so an exact 'WATCH' text node no longer exists.
  await expect(page.getByText(/Verdict:\s*WATCH/).first()).toBeVisible()
  // The standalone "Thesis" heading/box was removed — the whole-case thesis now LEADS the decision panel
  // as prose (its only home); the per-dimension valuation/shariah/risks cards were consolidated away and
  // the per-dimension findings live in the (collapsed) specialist lanes.
  await expect(page.getByText(/compounder/i).first()).toBeVisible()
  await expect(page.getByText(/decision_drafted/i).first()).not.toBeVisible()
  await page.getByText('Evidence & sources', { exact: true }).click()
  // Each grounded source is a collapsible <details> whose summary is its title; the audit source_id reveals
  // on expand. Assert the MSFT-attributed source titles surface (they carry the mock_msft_* ids on expand).
  await expect(page.getByText('MSFT primary source').first()).toBeVisible()
  await expect(page.getByText('MSFT secondary source').first()).toBeVisible()
  await expect(page.getByText(/Costco|src_cost_/)).toHaveCount(0)
  const researchCaseId = new URL(page.url()).pathname.split('/').at(-1)
  expect(researchCaseId).toMatch(/^rc_msft_/)

  // Review-and-promote: the dossier analysis (bear case, key wrong assumption, thesis-break triggers) is
  // surfaced above; the human reviews it and promotes in one gated step. No required thesis text, no
  // checklist ceremony — the promote click itself is the human commitment.
  const promoteButton = page.getByRole('button', { name: /promote to watchlist/i })
  await expect(promoteButton).toBeEnabled()
  await promoteButton.click()

  // Phase 8 S4: admission is a SINGLE gated step — the promote lands the item user-confirmed (the
  // former separate "confirm watchlist draft" action + its interstitial state are gone). No second click.
  await expect(page).toHaveURL('/watchlist')
  await expect(page.getByRole('heading', { name: 'MSFT', exact: true })).toBeVisible()
  await expect(page.getByText('User confirmed')).toBeVisible()
  await expect(page.getByText('Draft — awaiting user confirmation')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /confirm watchlist draft/i })).toHaveCount(0)
  await expect(page.getByText('CONDITIONAL — allowed')).toBeVisible()
  await expect(page.getByText('Required Shariah sources: mock_msft_primary, mock_msft_secondary')).toBeVisible()
  await expect(page.getByRole('link', { name: `Research case ${researchCaseId}` })).toHaveAttribute('href', `/research/${researchCaseId}`)

  // The dashboard shows the item already confirmed: no pending watchlist-confirmation approval remains.
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
  await expect(page.getByRole('heading', { name: 'MSFT', exact: true })).toBeVisible()
  await expect(page.getByText('Holding recorded')).toBeVisible()
  await expect(page.getByText('Holding open')).toBeVisible()
  await expect(page.getByRole('button', { name: /record initial holding/i })).toHaveCount(0)

  await page.goto('/portfolio')
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'MSFT', exact: true })).toBeVisible()
  await expect(page.getByText('Shares: 3.25')).toBeVisible()
  await expect(page.getByText('CONDITIONAL — allowed')).toBeVisible()
  await expect(page.getByText('Required Shariah sources: mock_msft_primary, mock_msft_secondary')).toBeVisible()
  await expect(page.getByText('Cost basis / share: $812.40')).toBeVisible()
  await expect(page.getByText('Total cost basis: $2,640.30', { exact: true })).toBeVisible()
  await expect(page.getByText('Opened: 2026-05-31')).toBeVisible()

  await page.getByText('Manual fallback actions', { exact: true }).click()
  await page.getByLabel('Current price per share').fill('900')
  await page.getByLabel('Valuation date').fill('2026-06-01')
  await page.getByRole('button', { name: /record valuation snapshot/i }).click()

  await expect(page).toHaveURL('/portfolio')
  await expect(page.getByText('Current value: $2,925.00', { exact: true })).toBeVisible()
  await expect(page.getByText('Current price / share: $900.00')).toBeVisible()
  await expect(page.getByText(/Unrealized P&L: \$284\.70 \(10\.78%\)/)).toBeVisible()
  await expect(page.getByText('Concentration: 100.00%')).toBeVisible()
  await expect(page.getByText('Valuation date: 2026-06-01')).toBeVisible()

  await page.getByText('Manual fallback actions', { exact: true }).click()
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
  await expect(page.getByText('Approval queue')).toBeVisible()
  await expect(page.getByText('Holding review decisions')).toBeVisible()
  await expect(page.getByText('MSFT strategy review draft')).toBeVisible()
  await expect(page.getByText('Provider proposes thesis health HEALTHY, action stance HOLD, next review 2026-09-30.')).toBeVisible()
  await expect(page.getByRole('link', { name: /apply provider draft/i })).toHaveAttribute('href', /\/portfolio#holding_msft_/)
  await expect(page.getByRole('link', { name: /reject provider draft/i })).toHaveAttribute('href', /\/portfolio#holding_msft_/)
  await expect(page.getByRole('link', { name: /apply user override/i })).toHaveAttribute('href', /\/portfolio#holding_msft_/)

  await page.goto('/portfolio')

  // Audit-and-decide re-underwrite (confirm): affirming the provider draft is gated on a SINGLE
  // cognitive-reflection acknowledgement. Scope to the confirm form (action …/confirm) so it doesn't
  // touch the sibling override form's acknowledgement.
  const confirmForm = page.locator('form[action$="/confirm"]')
  await confirmForm.getByLabel(/I have reflected on these reasoning checks for my own thinking/i).check()

  const applyProviderDraft = page.getByRole('button', { name: /apply provider draft/i })
  await expect(applyProviderDraft).toBeEnabled()
  await applyProviderDraft.click()

  await expect(page).toHaveURL('/portfolio')
  await expect(page.getByText('Thesis health: HEALTHY')).toBeVisible()
  await expect(page.getByText('Action stance: HOLD')).toBeVisible()
  await expect(page.getByText('Next review: 2026-09-30')).toBeVisible()
  await expect(page.getByRole('button', { name: /apply provider draft/i })).toHaveCount(0)

  await page.getByText('Manual fallback actions', { exact: true }).click()
  await page.getByRole('button', { name: /run buffett-munger review/i }).click()

  await expect(page).toHaveURL('/portfolio')
  await page.getByLabel('Override thesis health').selectOption('WATCH')
  await page.getByLabel('Override action stance').selectOption('RESEARCH_MORE')
  await page.getByLabel('Override rationale').fill('User override: valuation requires another evidence pass before adding.')
  await page.getByLabel('Override evidence summary').fill('Compared provider draft to the manual valuation snapshot and original thesis.')
  await page.getByLabel('Override uncertainty').fill('Need updated Shariah ratio review and concentration check.')
  await page.getByLabel('Override next review date').fill(nextReviewDate)

  // Audit-and-decide re-underwrite (override): the human authors their own thesis fields (filled above)
  // AND checks the SINGLE cognitive-reflection acknowledgement. Scope to the override form (action
  // …/override) so it doesn't touch the sibling confirm form's acknowledgement.
  const overrideForm = page.locator('form[action$="/override"]')
  await overrideForm.getByLabel(/I have reflected on these reasoning checks for my own thinking/i).check()

  const applyUserOverride = page.getByRole('button', { name: /apply user override/i })
  await expect(applyUserOverride).toBeEnabled()
  await applyUserOverride.click()

  await expect(page).toHaveURL('/portfolio')
  await expect(page.getByText('Thesis health: WATCH')).toBeVisible()
  await expect(page.getByText('Action stance: RESEARCH_MORE')).toBeVisible()
  await expect(page.getByText('User override: valuation requires another evidence pass before adding.')).toBeVisible()
  await expect(page.getByText(`Next review: ${nextReviewDate}`)).toBeVisible()
  await expect(page.getByRole('button', { name: /apply user override/i })).toHaveCount(0)

  await page.getByText('Manual fallback actions', { exact: true }).click()
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
  await expect(page.getByText(/· \d+ days/)).toBeVisible()
  await expect(page.getByRole('link', { name: /review msft/i }).first()).toHaveAttribute('href', /\/portfolio#holding_msft_/)
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
