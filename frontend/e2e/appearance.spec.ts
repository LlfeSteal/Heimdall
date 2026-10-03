// Appearance (STYLEGUIDE.md §10): Automatic / Light / Dark, applied before first paint, persisted, followed live,
// and the light/dark screenshot tour of every screen state (checked by eye against the guide).
import type { Page } from '@playwright/test'
import {
  ALPHA,
  DARK_COLOURS,
  apiReports,
  chartSnapshot,
  clickPoint,
  expect,
  gotoGroupList,
  openCard,
  seedAnnotation,
  shot,
  test,
} from './helpers'

const KEY = 'heimdall-appearance'

/** Records `<html data-theme>` at the moment <body> is created, i.e. before anything can be painted. */
async function recordThemeAtFirstPaint(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __themeAtBody?: string | null }
    new MutationObserver((_, observer) => {
      if (!document.body) return
      w.__themeAtBody = document.documentElement.getAttribute('data-theme')
      observer.disconnect()
    }).observe(document, { childList: true, subtree: true })
  })
}

const themeAtFirstPaint = (page: Page) =>
  page.evaluate(() => (window as unknown as { __themeAtBody?: string | null }).__themeAtBody ?? null)
const htmlTheme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'))
const appearance = (page: Page) => page.getByRole('radiogroup', { name: 'Appearance' })

test.describe('E-T appearance', () => {
  test('E-T1 Dark persists across reload and is on <html> before first paint', async ({ page }) => {
    await recordThemeAtFirstPaint(page)
    await gotoGroupList(page)
    expect(await themeAtFirstPaint(page)).toBe('light')
    await expect(appearance(page).getByRole('radio', { name: 'Automatic' })).toHaveAttribute('aria-checked', 'true')

    await appearance(page).getByRole('radio', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('dark')
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(0, 0, 0)')

    await page.reload()
    expect(await themeAtFirstPaint(page)).toBe('dark')
    await expect(appearance(page).getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')

    // The canvas follows: dark token values.
    await openCard(page, 'alpha')
    await expect(page.locator('canvas')).toBeVisible()
    await expect.poll(async () => (await chartSnapshot(page)).datasets[0].borderColor).toBe(DARK_COLOURS.BLUE)
    const snap = await chartSnapshot(page)
    expect(snap.datasets[2].borderColor).toBe(DARK_COLOURS.FORECAST)
    expect(snap.datasets[1].borderColor).toBe(DARK_COLOURS.GREY)
    expect((snap.datasets[0].pointBackgroundColor as string[]).filter((c) => c === DARK_COLOURS.TODAY)).toHaveLength(1)

    // Back to Light, live (no reload): canvas re-themed.
    await appearance(page).getByRole('radio', { name: 'Light' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect.poll(async () => (await chartSnapshot(page)).datasets[0].borderColor).toBe('#007aff')
  })

  test('E-T2 Automatic follows the system appearance live; a fixed choice ignores it', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await recordThemeAtFirstPaint(page)
    await gotoGroupList(page)
    expect(await themeAtFirstPaint(page)).toBe('dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await appearance(page).getByRole('radio', { name: 'Light' }).click()
    await page.emulateMedia({ colorScheme: 'light' })
    await page.emulateMedia({ colorScheme: 'dark' })
    expect(await htmlTheme(page)).toBe('light')
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`E-T3 screenshot tour (${theme})`, async ({ page, request }) => {
      const reports = await apiReports(request, ALPHA)
      const live = reports.find((r) => r.iid === '7')!
      const pts = live.report!.series
      // Transitions off, so every shot shows settled states.
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('/')
      await page.evaluate(
        ({ key, theme, notes }) => {
          localStorage.setItem(key, theme)
          localStorage.setItem('heimdall-annotations.v1', JSON.stringify(notes))
        },
        {
          key: KEY,
          theme,
          notes: [
            seedAnnotation(ALPHA, '7', pts[1].date, 'Scope added by PO', 'information', '1'),
            seedAnnotation(ALPHA, '7', pts[3].date, 'Prod incident\nwaiting on infra', 'risk', '2'),
          ],
        },
      )
      await gotoGroupList(page)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await shot(page, `${theme}-01-group-list`)

      await openCard(page, 'alpha')
      await expect(page.getByTestId('deviation-gutter')).toHaveAttribute('data-placed', 'true')
      await expect(page.getByTestId('annotation-item')).toHaveCount(2)
      await chartSnapshot(page)
      await shot(page, `${theme}-02-review-burndown`)

      await clickPoint(page, pts[2].date)
      await expect(page.getByTestId('annotation-dialog')).toBeVisible()
      await page.getByTestId('annotation-dialog').getByRole('button', { name: 'Risk' }).click()
      await shot(page, `${theme}-03-annotation-dialog`)
      await page.getByTestId('annotation-dialog').getByRole('button', { name: 'Cancel' }).click()

      await page.getByRole('button', { name: 'Burnup' }).click()
      await expect.poll(async () => (await chartSnapshot(page)).title).toBe('Burnup Chart')
      await shot(page, `${theme}-04-burnup`)

      await page.getByRole('button', { name: '← Back to Teams' }).click()
      await openCard(page, 'delta')
      await expect(page.getByTestId('iteration-rail').getByRole('alert')).toBeVisible()
      await shot(page, `${theme}-05-error-and-empty`)

      // Group-list failure banner and the nothing-eligible empty state (API answers stubbed).
      await page.route('**/api/groups**', (route) =>
        route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'GitLab API error: 401 Unauthorized' }) }),
      )
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Loading error' })).toBeVisible()
      await shot(page, `${theme}-06-group-list-error`)
      await page.unroute('**/api/groups**')
      await page.route('**/api/groups**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
      await page.reload()
      await expect(page.getByRole('heading', { name: 'No Team found' })).toBeVisible()
      await shot(page, `${theme}-07-no-group`)
    })
  }
})
