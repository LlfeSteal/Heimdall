// Screen 1 — group list (SPEC §3.1, Amendment A.3–A.5).
import { gotoGroupList, shot, expect, test } from './helpers'

test.describe('E-G group list', () => {
  test('E-G1 heading, guidance, cards alpha/beta/delta with their tiles; gamma and team-2 absent', async ({ page }) => {
    await gotoGroupList(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Heimdall')
    await expect(page.getByRole('heading', { name: 'Available Teams (3)' })).toBeVisible()
    const guidance = page.getByText('Select a Team under')
    await expect(guidance).toContainText('Select a Team under org/delivery to view its iterations.')
    await expect(guidance.locator('code')).toHaveText('org/delivery')

    const cards = page.getByTestId('group-card')
    await expect(cards).toHaveCount(3)
    await expect(cards.locator('.category')).toHaveText(['alpha', 'beta', 'delta'])
    await expect(cards.locator('.group-card-main .group-path')).toHaveText([
      'org/delivery/alpha',
      'org/delivery/beta',
      'org/delivery/delta',
    ])
    await expect(cards.nth(0).getByTestId('group-tile')).toHaveCount(1)
    await expect(cards.nth(0).getByTestId('group-tile').locator('.tile-segment')).toHaveText('team-1')
    await expect(cards.nth(0).getByTestId('group-tile').locator('.tile-name')).toHaveText('Team One')
    await expect(cards.nth(1).getByTestId('group-tile').locator('.tile-segment')).toHaveText('x')
    await expect(cards.nth(2).getByTestId('group-tile')).toHaveCount(0)

    const body = page.locator('body')
    await expect(body).not.toContainText('gamma')
    await expect(body).not.toContainText('team-2')
    await expect(body).not.toContainText('Team Two')
    await expect(body).not.toContainText('zeta')
    await expect(body).not.toContainText('Sub Team')
    // Tiles never show the full path.
    await expect(body).not.toContainText('org/delivery/alpha/team-1')
    await shot(page, '01-group-list')
  })

  test('E-G2 Refresh re-reads /api/groups?refresh=1 and nothing else', async ({ page }) => {
    await gotoGroupList(page)
    const seen: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/api/')) seen.push(new URL(r.url()).pathname + new URL(r.url()).search)
    })
    const res = page.waitForResponse((r) => r.url().includes('/api/groups?refresh=1'))
    await page.getByRole('button', { name: 'Refresh' }).click()
    await res
    await expect(page.getByRole('heading', { name: 'Available Teams (3)' })).toBeVisible()
    expect(seen).toEqual(['/api/groups?refresh=1'])
  })

  test('E-G3 loading shows three empty placeholder cards', async ({ page }) => {
    await page.route('**/api/groups*', async (route) => {
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })
    await page.goto('/')
    const ph = page.getByTestId('group-placeholder')
    await expect(ph).toHaveCount(3)
    for (const t of await ph.allTextContents()) expect(t).toBe('')
    await expect(page.getByRole('heading', { name: 'Available Teams (3)' })).toBeVisible()
  })

  test('E-G4 no URL change / history entry when navigating', async ({ page }) => {
    await gotoGroupList(page)
    const url = page.url()
    const len = await page.evaluate(() => history.length)
    await page.getByTestId('group-card').first().locator('.group-card-main').click()
    await expect(page.getByTestId('review-header')).toBeVisible()
    expect(page.url()).toBe(url)
    expect(await page.evaluate(() => history.length)).toBe(len)
    await page.getByRole('button', { name: '← Back to Teams' }).click()
    await expect(page.getByRole('heading', { name: 'Available Teams (3)' })).toBeVisible()
    expect(page.url()).toBe(url)
  })
})
