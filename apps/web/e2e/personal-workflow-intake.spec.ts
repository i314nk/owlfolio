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
  await expect(initialPrimaryNav.getByRole('link', { name: /start setup/i })).toHaveAttribute('href', '/onboarding')
  await expect(initialPrimaryNav.getByText(/setup needed/i)).toBeVisible()

  await page.goto('/onboarding')
  await page.getByRole('button', { name: /use chatgpt\/codex/i }).click()
  await page.getByText('Advanced: choose a different provider').click()
  await page.getByRole('combobox', { name: /provider family/i }).selectOption('mock-provider')
  await page.getByRole('button', { name: /start using owlfolio/i }).click()

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
  await page.goto('/onboarding')
  await expect(page).toHaveURL('/onboarding')
  await expect(page.getByRole('heading', { name: /start setup/i })).toBeVisible()
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
  // page, which carries the per-provider Trust & certification section folded in from the old page.
  await page.getByRole('navigation', { name: /primary owlfolio navigation/i }).getByRole('link', { name: /providers/i }).click()
  await expect(page).toHaveURL('/settings/providers')
  await expect(page.getByRole('heading', { name: /provider keys/i })).toBeVisible()
  // The Trust & certification section preserves the honest, fail-closed gating verdicts.
  await expect(page.getByRole('heading', { name: /trust & certification/i })).toBeVisible()
  await expect(
    page.getByLabel('Mock provider trust primary status', { exact: true }).getByText('Effective support (gating source of truth): certified', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByLabel('Claude trust primary status', { exact: true }).getByText('Effective support (gating source of truth): unsupported', { exact: true }),
  ).toBeVisible()

  await page.getByRole('navigation', { name: /primary owlfolio navigation/i }).getByRole('link', { name: 'Command Center', exact: true }).click()
  await expect(page).toHaveURL('/')

  await page.getByRole('link', { name: /open research cockpit/i }).first().click()
  await expect(page).toHaveURL('/research')
  await expect(page.getByRole('heading', { name: /research library/i })).toBeVisible()
  await page.getByRole('link', { name: /manual ticker intake/i }).click()
  await expect(page).toHaveURL('/research/new')

  // Set quick_screen_approval to 'automatic' so this run completes straight through
  // (default is 'review' which pauses after quick screen; the e2e needs the full run)
  const automationResponse = await request.post('/api/settings/automation', {
    data: { quick_screen_approval: 'automatic' },
  })
  expect(automationResponse.ok()).toBe(true)

  await page.getByLabel('Ticker').fill('MSFT')
  await page.getByRole('button', { name: /create research case/i }).click()

  await expect(page).toHaveURL(/\/research\/rc_msft_/)
  await expect(page.getByRole('heading', { name: 'MSFT' })).toBeVisible()
  await expect(page.getByText('Research dossier')).toBeVisible()
  await expect(page.getByText('Verdict summary')).toBeVisible()
  await expect(page.getByText('WATCH', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Thesis' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Valuation' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Shariah / compliance' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Risks / open questions' })).toBeVisible()
  await expect(page.getByText(/decision_drafted/i).first()).not.toBeVisible()
  await page.getByText('Evidence and audit details', { exact: true }).click()
  await expect(page.locator('article').filter({ hasText: 'MSFT primary source' }).getByText('mock_msft_primary', { exact: true })).toBeVisible()
  await expect(page.locator('article').filter({ hasText: 'MSFT secondary source' }).getByText('mock_msft_secondary', { exact: true })).toBeVisible()
  await expect(page.getByText(/Costco|src_cost_/)).toHaveCount(0)
  const researchCaseId = new URL(page.url()).pathname.split('/').at(-1)
  expect(researchCaseId).toMatch(/^rc_msft_/)

  // The admit control requires a human-typed signed thesis (Task 4.3); the promote button is disabled
  // until one is entered, and the field is never pre-filled from the agent draft.
  const signedThesis = page.getByLabel('Your signed thesis')
  await expect(signedThesis).toHaveValue('')
  await expect(page.getByRole('button', { name: /promote to watchlist/i })).toBeDisabled()
  await signedThesis.fill('Admitting MSFT: durable quality compounder bought with a margin of safety.')

  // Phase 7: admission is also completion-blocked on the quality + bias hygiene checklist — every item
  // (business failure modes + cognitive biases) must be addressed (checkbox + a non-empty reasoned note),
  // and the cognitive notes are never pre-filled. The promote button stays disabled until the thesis AND
  // the whole checklist are addressed. Address every item, then promote.
  const checklistNotes = page.locator('textarea[name^="checklist_note["]')
  const noteCount = await checklistNotes.count()
  expect(noteCount).toBeGreaterThan(0)
  for (let i = 0; i < noteCount; i += 1) {
    await expect(checklistNotes.nth(i)).toHaveValue('') // non-prefilled (esp. cognitive)
    await checklistNotes.nth(i).fill('Considered and addressed for this admission.')
  }
  const checklistAddressed = page.locator('input[name^="checklist_addressed["]')
  const addressedCount = await checklistAddressed.count()
  for (let i = 0; i < addressedCount; i += 1) {
    await checklistAddressed.nth(i).check()
  }

  const promoteButton = page.getByRole('button', { name: /promote to watchlist/i })
  await expect(promoteButton).toBeEnabled()
  await promoteButton.click()

  // Phase 8 S4: admission is a SINGLE gated step — the promote lands the item user-confirmed (the
  // former separate "confirm watchlist draft" action + its interstitial state are gone). No second click.
  await expect(page).toHaveURL('/watchlist')
  await expect(page.getByRole('heading', { name: 'MSFT' })).toBeVisible()
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
  await expect(page.getByRole('heading', { name: 'MSFT' })).toBeVisible()
  await expect(page.getByText('Holding recorded')).toBeVisible()
  await expect(page.getByText('Holding open')).toBeVisible()
  await expect(page.getByRole('button', { name: /record initial holding/i })).toHaveCount(0)

  await page.goto('/portfolio')
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'MSFT' })).toBeVisible()
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

  // Phase 7: the re-underwrite sign-off (confirming the provider draft) is ALSO completion-blocked on the
  // hygiene checklist (the integrity fix that turned an ungated confirmation into a real one). Scope the
  // fill to the confirm form (action …/confirm) so it doesn't touch the sibling override form's checklist.
  const confirmForm = page.locator('form[action$="/confirm"]')
  const confirmNotes = confirmForm.locator('textarea[name^="checklist_note["]')
  const confirmNoteCount = await confirmNotes.count()
  expect(confirmNoteCount).toBeGreaterThan(0)
  for (let i = 0; i < confirmNoteCount; i += 1) {
    await confirmNotes.nth(i).fill('Re-underwrite: considered and addressed (incl. Shariah-drift + data-completeness).')
  }
  const confirmAddressed = confirmForm.locator('input[name^="checklist_addressed["]')
  const confirmAddressedCount = await confirmAddressed.count()
  for (let i = 0; i < confirmAddressedCount; i += 1) {
    await confirmAddressed.nth(i).check()
  }

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

  // Phase 7: the override re-underwrite sign-off is completion-blocked too (the S3 bypass fix — override
  // is a co-equal sign-off, gated identically to confirm). Fill the override form's checklist (scoped to
  // action …/override) before applying.
  const overrideForm = page.locator('form[action$="/override"]')
  const overrideNotes = overrideForm.locator('textarea[name^="checklist_note["]')
  const overrideNoteCount = await overrideNotes.count()
  expect(overrideNoteCount).toBeGreaterThan(0)
  for (let i = 0; i < overrideNoteCount; i += 1) {
    await overrideNotes.nth(i).fill('Override re-underwrite: considered and addressed.')
  }
  const overrideAddressed = overrideForm.locator('input[name^="checklist_addressed["]')
  const overrideAddressedCount = await overrideAddressed.count()
  for (let i = 0; i < overrideAddressedCount; i += 1) {
    await overrideAddressed.nth(i).check()
  }

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
