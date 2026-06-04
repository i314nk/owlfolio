import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

type FilterCollisionCheck = {
  maxRightOverflow: number
  hasHorizontalCollision: boolean
  actorSelectWidth: number
}

async function initializeDemoWorkflow(page: Page): Promise<void> {
  await page.goto('/onboarding')
  await page.getByRole('radio', { name: /personal local mode/i }).click()
  await page.getByRole('combobox').selectOption('mock-provider')
  await page.getByRole('button', { name: /initialize owlfolio workflow/i }).click()
  await expect(page).toHaveURL('/')
}

async function measureAuditFilterLayout(page: Page): Promise<FilterCollisionCheck> {
  const form = page.locator('form[action="/audit"]')
  await expect(form).toBeVisible()
  return form.evaluate<FilterCollisionCheck>((formElement) => {
    const labels = Array.from(formElement.querySelectorAll('label'))
    const rects = labels.map((label) => {
      return label.getBoundingClientRect()
    })

    let hasHorizontalCollision = false
    let maxRightOverflow = 0

    const formRect = formElement.getBoundingClientRect()
    for (const rect of rects) {
      maxRightOverflow = Math.max(maxRightOverflow, rect.right - formRect.right)
    }

    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const first = rects[i]!
        const second = rects[j]!
        const sameRow = Math.abs(first.top - second.top) <= 6

        if (!sameRow) {
          continue
        }

        const overlap = Math.min(first.right, second.right) - Math.max(first.left, second.left)
        if (overlap > 1) {
          hasHorizontalCollision = true
          break
        }
      }

      if (hasHorizontalCollision) {
        break
      }
    }

    const actorSelect = formElement.querySelector('select[name="actor"]') as HTMLSelectElement | null
    const actorSelectWidth = actorSelect === null ? 0 : actorSelect.getBoundingClientRect().width

    return {
      hasHorizontalCollision,
      maxRightOverflow,
      actorSelectWidth,
    }
  })
}

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/testing/reset')
  expect(response.ok()).toBe(true)
})

test('audit trail command affordance link focuses query search input', async ({ page }) => {
  await initializeDemoWorkflow(page)

  await page
    .getByRole('navigation', { name: /primary owlfolio navigation/i })
    .getByRole('link', { name: /audit trail search/i })
    .click()

  await expect(page).toHaveURL('/audit?focus=1')
  const searchInput = page.getByRole('searchbox', { name: /search raw ledger evidence/i })
  await expect(searchInput).toBeFocused()
})

test('audit filters keep actor and related controls from overlapping at desktop width', async ({ page }) => {
  await initializeDemoWorkflow(page)
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.goto('/audit')

  await expect(page.getByRole('heading', { name: /audit activity/i })).toBeVisible()
  const layout = await measureAuditFilterLayout(page)

  expect(layout.hasHorizontalCollision).toBe(false)
  expect(layout.maxRightOverflow).toBeLessThanOrEqual(2)
  expect(layout.actorSelectWidth).toBeGreaterThanOrEqual(120)
})
