import { expect, test } from '@playwright/test'

import { initWorkflow } from './helpers'

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

  await page.goto('/')
  const initialPrimaryNav = page.getByRole('navigation', { name: /primary owner.s manual navigation/i })
  // The fresh (reset) default is now `unconfigured`; the app-wide workspace indicator shows the honest
  // "no provider configured" state. initWorkflow() below sets up personal-local.
  await expect(initialPrimaryNav.getByText(/no provider configured/i)).toBeVisible()

  // Programmatic init (mock-provider + personal-local) replaces driving the wizard UI. The e2e no longer
  // depends on the wizard to perform setup; the wizard can be deleted in the follow-up slice.
  await initWorkflow(request)

  await page.goto('/')
  await expect(page).toHaveURL('/')
  const primaryNav = page.getByRole('navigation', { name: /primary owner.s manual navigation/i })
  await expect(primaryNav.getByRole('link', { name: 'Command Center', exact: true })).toHaveAttribute('href', '/')
  await expect(primaryNav.getByRole('link', { name: /research/i })).toHaveAttribute('href', '/research')
  await expect(primaryNav.getByRole('link', { name: /watchlist/i })).toHaveAttribute('href', '/watchlist')
  await expect(primaryNav.getByRole('link', { name: /portfolio/i })).toHaveAttribute('href', '/portfolio')
  // SCALE-DOWN S2: the Accounting page is retired — no nav entry.
  await expect(primaryNav.getByRole('link', { name: /accounting/i })).toHaveCount(0)
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
  await page.getByRole('navigation', { name: /primary owner.s manual navigation/i }).getByRole('link', { name: /watchlist/i }).click()
  await expect(page).toHaveURL('/watchlist')
  await expect(page.getByText('No watchlist items yet. Create a research case first.')).toBeVisible()
  await page.getByRole('navigation', { name: /primary owner.s manual navigation/i }).getByRole('link', { name: /portfolio/i }).click()
  await expect(page).toHaveURL('/portfolio')
  await expect(page.getByRole('heading', { name: /no holdings are open yet/i })).toBeVisible()
  await page.getByRole('navigation', { name: /primary owner.s manual navigation/i }).getByRole('link', { name: 'Audit', exact: true }).click()
  await expect(page).toHaveURL('/audit')
  await expect(page.getByRole('heading', { name: /audit activity/i })).toBeVisible()
  // /providers is retired: the nav "Providers" link now points at the consolidated /settings/providers
  // page (provider logins + LLM API keys + provider/model selection). The heavy trust gate was removed —
  // research quality depends on the model the user picks, and that responsibility is theirs.
  await page.getByRole('navigation', { name: /primary owner.s manual navigation/i }).getByRole('link', { name: /providers/i }).click()
  await expect(page).toHaveURL('/settings/providers')
  await expect(page.getByRole('heading', { name: /provider setup/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /trust & certification/i })).toHaveCount(0)
  await expect(page.getByText(/Research quality depends on the model you choose/i)).toBeVisible()

  await page.getByRole('navigation', { name: /primary owner.s manual navigation/i }).getByRole('link', { name: 'Command Center', exact: true }).click()
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
  // Compact zone board: each candidate is one row; the ticker links to the original analysis and the
  // full checkpoint expands beneath.
  const msftRow = page.locator('details[data-watchlist-row="MSFT"]')
  await expect(msftRow).toBeVisible()
  await expect(msftRow.getByRole('link', { name: 'MSFT', exact: true })).toHaveAttribute('href', `/research/${researchCaseId}`)
  // The "Confirmed" badge is retired (every admitted name is confirmed by construction) — the
  // Shariah chip + the CONDITIONAL explanation carry the row's signal now.
  await expect(msftRow.getByText('CONDITIONAL', { exact: true })).toBeVisible()
  await msftRow.locator('> summary').click()
  await expect(msftRow.getByText(/Shariah-permissible to hold, with an obligation/)).toBeVisible()
  await msftRow.locator('> summary').click()
  await expect(page.getByText('Draft — awaiting user confirmation')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /confirm watchlist draft/i })).toHaveCount(0)
  await msftRow.locator('> summary').click()
  // The expansion is the small decision card: the thesis + "Open the full analysis" (gate reasons,
  // required sources, and provenance moved to the dossier).
  // The display text is the LATEST ANALYSIS's own thesis (not the admitted-on draft copy).
  await expect(msftRow.getByText(/wide-moat compounder/)).toBeVisible()
  await expect(msftRow.getByRole('link', { name: 'Open the full analysis' })).toHaveAttribute('href', `/research/${researchCaseId}`)

  // The dashboard shows the item already confirmed: no pending watchlist-confirmation approval remains.
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Monitor confirmed watchlist items for buy-zone and thesis updates' })).toBeVisible()
  await expect(page.locator('article').filter({ hasText: 'Watchlist drafts' }).getByText('0', { exact: true })).toBeVisible()
  await expect(page.locator('article').filter({ hasText: 'Confirmed watchlist' }).getByText('1', { exact: true })).toBeVisible()
  await expect(page.locator('article').filter({ hasText: 'Open holdings' }).getByText('0', { exact: true })).toBeVisible()
  await expect(page.locator('article').filter({ hasText: 'Decisions waiting' }).getByText('0', { exact: true })).toBeVisible()

  await page.goto('/watchlist')
  // SCALE-DOWN S5: share counts are retired — the entry price is the one manual field. The open-holding
  // form lives in the expanded row.
  await page.locator('details[data-watchlist-row="MSFT"] > summary').click()
  await page.getByLabel('Cost basis per share').fill('812.40')
  await page.getByLabel('Opened date').fill('2026-05-31')
  await page.getByRole('button', { name: /record initial holding/i }).click()

  await expect(page).toHaveURL('/watchlist')
  // ONE HOME PER NAME: the held name leaves the watchlist board (its home is the portfolio now);
  // the ledger line points there.
  await expect(page.locator('details[data-watchlist-row="MSFT"]')).toHaveCount(0)
  await expect(page.locator('article').filter({ hasText: 'Held — see portfolio' }).getByText('1', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /record initial holding/i })).toHaveCount(0)

  await page.goto('/portfolio')
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible()
  // Compact thesis rows: the summary carries the entry-price anchor; the body expands.
  const msftHolding = page.locator('details[data-holding-row="MSFT"]')
  await expect(msftHolding).toBeVisible()
  await expect(msftHolding.getByText('entry $812.40')).toBeVisible()
  await msftHolding.locator('> summary').click()
  // SCALE-DOWN S5: the thesis view — the entry price is the anchor; no share/value books. Gate
  // evidence lives in the dossier now; the row keeps the anchor + the route to the full analysis.
  await expect(page.getByText('Your entry price: $812.40')).toBeVisible()
  await expect(page.getByText('Opened: 2026-05-31')).toBeVisible()
  await expect(msftHolding.getByRole('link', { name: 'Open the full analysis' })).toHaveAttribute('href', `/research/${researchCaseId}`)

  // REVIEW RETIRED (owner, 2026-07-14): the drafted Buffett-Munger review + its confirm/override/
  // reject ceremony and the review schedule are GONE — the quarterly check-in, the 10-K full-re-run
  // prompt, and the zone board carry the duty. The row exposes the check-in; no review forms exist.
  await expect(page.getByRole('button', { name: /run buffett-munger review/i })).toHaveCount(0)
  await expect(page.getByText('Manual fallback actions')).toHaveCount(0)
  await expect(msftHolding.getByTestId('rereview-button')).toBeVisible()

  await page.goto('/')
  await expect(page.getByText('Holding review schedule')).toHaveCount(0)
  await expect(page.getByText('Check in held names against new filings (quarterly cadence)').first()).toBeVisible()
  await expect(page.locator('article').filter({ hasText: 'Confirmed watchlist' }).getByText('0', { exact: true })).toBeVisible()
  await expect(page.locator('article').filter({ hasText: 'Open holdings' }).getByText('1', { exact: true })).toBeVisible()
  await expect(page.locator('article').filter({ hasText: 'Decisions waiting' }).getByText('0', { exact: true })).toBeVisible()

  // SCALE-DOWN S2/S3: the accounting + purification pages are retired; /passive is informative.
  await page.goto('/passive')
  await expect(page.getByRole('heading', { name: 'Passive', exact: true })).toBeVisible()
  await expect(page.getByText(/load up the truck|never sell the sleeve|own the market first/i).first()).toBeVisible()
  await expect(page.getByText(/EDUCATIONAL CONTENT, NOT ADVICE/i)).toBeVisible()

  await page.goto('/audit')
  await expect(page.getByRole('heading', { name: /audit activity/i })).toBeVisible()
  await expect(page.locator('li').filter({ hasText: 'research_case_created' }).first()).toBeVisible()
  await expect(page.locator('li').filter({ hasText: 'holding_opened' }).first()).toBeVisible()

  // ── Close the holding (the human-authored exit) — the position leaves the portfolio and the name
  // returns to plain watching on the board.
  await page.goto('/portfolio')
  await page.locator('details[data-holding-row="MSFT"] > summary').click()
  await page.getByText('Close holding (record the exit)').click()
  // The CONDITIONAL name's close form carries the exit-purification GUIDANCE (never an account).
  await expect(page.getByTestId('exit-purification-guidance')).toBeVisible()
  await expect(page.getByText(/GUIDANCE, NOT AN ACCOUNT/)).toBeVisible()
  await page.getByLabel('Exit price per share').fill('905.10')
  await page.getByLabel('Sell-discipline reason').selectOption('valuation_inverted')
  await page.getByRole('button', { name: /record the exit/i }).click()
  await expect(page).toHaveURL('/portfolio')
  await expect(page.getByRole('heading', { name: /no holdings are open yet/i })).toBeVisible()

  await page.goto('/watchlist')
  const msftRowAfterClose = page.locator('details[data-watchlist-row="MSFT"]')
  await expect(msftRowAfterClose).toBeVisible()
  await expect(msftRowAfterClose.getByText('CONDITIONAL', { exact: true })).toBeVisible()

  // ── Remove the name from the watchlist (the human-authored prune) — the board empties; the
  // research case + the audit trail survive.
  await msftRowAfterClose.locator('> summary').click()
  await page.getByText('Remove from watchlist', { exact: true }).first().click()
  await page.getByLabel('Reason').fill('Cycle complete — no longer tracking in the e2e flow.')
  await page.getByRole('button', { name: /remove from watchlist/i }).click()
  await expect(page).toHaveURL('/watchlist')
  await expect(page.locator('details[data-watchlist-row="MSFT"]')).toHaveCount(0)

  await page.goto('/audit')
  await expect(page.locator('li').filter({ hasText: 'holding_closed' }).first()).toBeVisible()
  await expect(page.locator('li').filter({ hasText: 'watchlist_item_pruned' }).first()).toBeVisible()

  await expect(browserErrors).toEqual([])
})

test('screening OFF: the toggle persists, the run skips the gate, and the admission records DISABLED (never a fake pass)', async ({ page, request }) => {
  await initWorkflow(request)

  // Turn screening OFF through the settings UI (the toggle + save round-trip).
  await page.goto('/settings/automation')
  // The toggle is a client component — wait for hydration before clicking (a pre-hydration click
  // lands on inert server HTML and silently does nothing).
  await page.waitForLoadState('networkidle')
  await page.getByTestId('shariah-toggle').click()
  await page.getByTestId('shariah-save').click()
  await expect(page.getByText('Screening is OFF')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Screening is OFF')).toBeVisible()

  // A full mock run with screening OFF: the swarm skips the Shariah gate + lanes.
  const automationResponse = await request.post('/api/settings/automation', { data: { deep_dive_approval: 'automatic' } })
  expect(automationResponse.ok()).toBe(true)
  await page.goto('/research/new')
  await page.getByLabel('Ticker').fill('MSFT')
  await page.getByRole('button', { name: /create research case/i }).click()
  await expect(page).toHaveURL(/\/research\/rc_msft_/)
  await expect(page.getByText('Verdict summary')).toBeVisible()

  // Promote → the admission gate records an explicit DISABLED decision; the board shows the neutral
  // GATE OFF chip (never APPROVED) and NO purification surface.
  const promoteButton = page.getByRole('button', { name: /promote to watchlist/i })
  await expect(promoteButton).toBeEnabled()
  await promoteButton.click()
  await expect(page).toHaveURL('/watchlist')
  const row = page.locator('details[data-watchlist-row="MSFT"]')
  await expect(row).toBeVisible()
  await expect(row.getByText('GATE OFF', { exact: true })).toBeVisible()
  await expect(row.getByText('CONDITIONAL', { exact: true })).toHaveCount(0)
  await row.locator('> summary').click()
  await expect(page.getByText(/Shariah-permissible to hold, with an obligation/)).toHaveCount(0)
})
