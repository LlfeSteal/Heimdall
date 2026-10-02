// Annotation flow on the real canvas: click a point, add, persist across reload, edit with the unsaved-changes
// guard, delete, and scoping per (group, iteration) (SPEC §3.3–§3.5, §10, §15.8).
import type { Page } from '@playwright/test'
import { ALPHA, COLOURS, TEAM1, chartSnapshot, clickPoint, gotoGroupList, openCard, openTile, selectIteration, shot, expect, test } from './helpers'

const KEY = 'heimdall-annotations.v1'

async function addAnnotation(page: Page, date: string, text: string, type: 'Information' | 'Risk') {
  await clickPoint(page, date)
  const dlg = page.getByTestId('annotation-dialog')
  await expect(dlg.getByRole('heading', { name: 'Add annotation' })).toBeVisible()
  await expect(dlg).toContainText(`Date: ${date}`)
  await dlg.getByPlaceholder('Explain the deviation...').fill(text)
  await dlg.getByRole('button', { name: type, exact: true }).click()
  await expect(dlg.getByRole('button', { name: type, exact: true })).toHaveAttribute('aria-pressed', 'true')
  await dlg.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(dlg).toHaveCount(0)
}

async function storedAnnotations(page: Page) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]'), KEY) as Promise<
    { id: string; groupPath?: string; iterationId?: string; date: string; text: string; type?: string; author?: string }[]
  >
}

test.describe('E-A annotations', () => {
  test('E-A1 full flow: add (Risk) → list → reload persists → edit + overlap guard → delete', async ({ page }) => {
    await gotoGroupList(page)
    await openCard(page, 'alpha')
    await expect(page.locator('canvas')).toBeVisible()
    const snap = await chartSnapshot(page)
    const remainingDates = snap.labels.filter((_, i) => snap.datasets[0].data[i] !== null)
    const [d1, d2] = [remainingDates[1], remainingDates[3]]

    const rail = page.getByTestId('annotations-rail')
    await expect(rail.getByRole('heading', { name: 'Annotations (0)' })).toBeVisible()
    await expect(rail).toContainText('No annotation for this iteration')

    // Dialogue appears directly under the chart, required text disables Add while blank.
    await clickPoint(page, d1)
    const dlg = page.getByTestId('annotation-dialog')
    await expect(dlg.getByRole('heading', { name: 'Add annotation' })).toBeVisible()
    await expect(dlg).toContainText(`Date: ${d1}`)
    await expect(dlg).toContainText('Type')
    await expect(dlg.getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
    const canvasBox = (await page.locator('canvas').boundingBox())!
    const dlgBox = (await dlg.boundingBox())!
    expect(dlgBox.y).toBeGreaterThanOrEqual(canvasBox.y + canvasBox.height - 1)
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toHaveCount(0)

    await addAnnotation(page, d1, 'Scope added mid-sprint\nwaiting on API team', 'Risk')
    const items = rail.getByTestId('annotation-item')
    await expect(rail.getByRole('heading', { name: 'Annotations (1)' })).toBeVisible()
    await expect(items).toHaveCount(1)
    await expect(items.first()).toContainText(d1)
    await expect(items.first()).toContainText('by Current User')
    await expect(items.first()).toContainText('Scope added mid-sprint')
    await expect(items.first()).toHaveAttribute('data-type', 'risk')
    // Rendered on the canvas as a red callout, behind the datasets.
    const after = await chartSnapshot(page)
    const label = after.annotations.find((a) => a.type === 'label')
    expect(label?.content).toEqual(['Scope added mid-sprint', 'waiting on API team'])
    expect(label?.drawTime).toBe('beforeDatasetsDraw')
    expect(String(label?.backgroundColor)).toContain('220, 38, 38') // RED tint
    await addAnnotation(page, d2, 'Team member sick', 'Information')
    await expect(items).toHaveCount(2)
    await expect(items.nth(1)).toHaveAttribute('data-type', 'information')
    const after2 = await chartSnapshot(page)
    expect(after2.annotations.filter((a) => a.type === 'label').map((a) => String(a.backgroundColor))).toEqual([
      expect.stringContaining('220, 38, 38'),
      expect.stringContaining('37, 99, 235'),
    ])
    await shot(page, '02-review-burndown-annotations')

    // Storage carries the (group, iid) scope.
    const stored = await storedAnnotations(page)
    expect(stored).toHaveLength(2)
    expect(JSON.stringify(stored)).toContain(ALPHA)

    // Reload: back on the group list (no deep links), annotation still there (localStorage).
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Available ARTs (3)' })).toBeVisible()
    await expect(page.getByTestId('review-header')).toHaveCount(0)
    await openCard(page, 'alpha')
    await expect(rail.getByRole('heading', { name: 'Annotations (2)' })).toBeVisible()
    await expect(items.first()).toContainText('Scope added mid-sprint')

    // Edit from the list → change text → click another point → confirm prompt.
    await items.first().getByRole('button', { name: 'Edit' }).click()
    await expect(dlg.getByRole('heading', { name: 'Edit annotation' })).toBeVisible()
    await expect(dlg).toContainText(`Date: ${d1}`)
    await expect(dlg.getByRole('button', { name: 'Risk', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const textarea = dlg.getByPlaceholder('Explain the deviation...')
    await expect(textarea).toHaveValue('Scope added mid-sprint\nwaiting on API team')
    await textarea.fill('Scope added mid-sprint (edited)')

    const prompts: string[] = []
    page.once('dialog', async (d) => {
      prompts.push(d.message())
      await d.dismiss()
    })
    const d3 = remainingDates[4]
    await clickPoint(page, d3)
    await expect.poll(() => prompts).toEqual(['Unsaved changes will be lost. Continue?'])
    // Declined: nothing changed.
    await expect(dlg.getByRole('heading', { name: 'Edit annotation' })).toBeVisible()
    await expect(dlg).toContainText(`Date: ${d1}`)
    await expect(textarea).toHaveValue('Scope added mid-sprint (edited)')

    page.once('dialog', async (d) => {
      prompts.push(d.message())
      await d.accept()
    })
    await clickPoint(page, d3)
    await expect.poll(() => prompts.length).toBe(2)
    expect(prompts[1]).toBe('Unsaved changes will be lost. Continue?')
    await expect(dlg.getByRole('heading', { name: 'Add annotation' })).toBeVisible()
    await expect(dlg).toContainText(`Date: ${d3}`)
    await expect(textarea).toHaveValue('')
    await expect(items.first()).toContainText('Scope added mid-sprint\nwaiting on API team') // discarded edit
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // Clicking an annotated point opens the first annotation for editing; save an edit.
    await clickPoint(page, d1)
    await expect(dlg.getByRole('heading', { name: 'Edit annotation' })).toBeVisible()
    await textarea.fill('Scope added mid-sprint (final)')
    await dlg.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(dlg).toHaveCount(0)
    await expect(items.first()).toContainText('Scope added mid-sprint (final)')
    await expect(items).toHaveCount(2)

    // No prompt without unsaved changes.
    let unexpected = 0
    const onDialog = async (d: { dismiss: () => Promise<void> }) => {
      unexpected++
      await d.dismiss()
    }
    page.on('dialog', onDialog)
    await clickPoint(page, d1)
    await clickPoint(page, d2)
    await expect(dlg).toContainText(`Date: ${d2}`)
    expect(unexpected).toBe(0)
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // Delete (no prompt).
    await items.first().getByRole('button', { name: 'Delete' }).click()
    await expect(items).toHaveCount(1)
    await expect(items.first()).toContainText('Team member sick')
    await items.first().getByRole('button', { name: 'Delete' }).click()
    await expect(items).toHaveCount(0)
    await expect(rail).toContainText('No annotation for this iteration')
    expect(unexpected).toBe(0)
    page.off('dialog', onDialog)
    expect(await storedAnnotations(page)).toHaveLength(0)
  })

  test('E-A2 burnup shows annotations as amber point markers only', async ({ page }) => {
    await gotoGroupList(page)
    await openCard(page, 'alpha')
    const snap = await chartSnapshot(page)
    const date = snap.labels[2]
    await addAnnotation(page, date, 'Burnup marker check', 'Information')
    await page.getByRole('button', { name: 'Burnup' }).click()
    await expect.poll(async () => (await chartSnapshot(page)).title).toBe('Burnup Chart')
    const up = await chartSnapshot(page)
    expect(up.annotations).toHaveLength(1)
    expect(up.annotations[0].type).toBe('point')
    expect(up.annotations[0].backgroundColor).toBe(COLOURS.AMBER)
    expect(up.annotations[0].content).toBeUndefined()
  })

  test('E-A3 scoping: the same iid in two groups never leaks (alpha vs alpha/team-1, both iid 7)', async ({ page, request }) => {
    const a = await (await request.get(`http://localhost:8080/api/iterations?group=${encodeURIComponent(ALPHA)}`)).json()
    const t = await (await request.get(`http://localhost:8080/api/iterations?group=${encodeURIComponent(TEAM1)}`)).json()
    const aSel = a.find((it: { state: string }) => it.state !== 'upcoming')
    const tSel = t.find((it: { state: string }) => it.state !== 'upcoming')
    expect(aSel.iid).toBe(tSel.iid) // same iid auto-selected in both groups

    await gotoGroupList(page)
    await openCard(page, 'alpha')
    const snapA = await chartSnapshot(page)
    await addAnnotation(page, snapA.labels[1], 'Alpha only note', 'Information')
    await expect(page.getByTestId('annotation-item')).toHaveCount(1)

    await page.getByRole('button', { name: '← Back to ARTs' }).click()
    await openTile(page, 'team-1')
    await expect(page.locator('canvas')).toBeVisible()
    await expect(page.getByTestId('chart-card').locator('.iteration-header h2')).toHaveText(tSel.title)
    const rail = page.getByTestId('annotations-rail')
    await expect(rail.getByRole('heading', { name: 'Annotations (0)' })).toBeVisible()
    await expect(rail).not.toContainText('Alpha only note')
    const snapT = await chartSnapshot(page)
    expect(snapT.annotations.filter((x) => x.type === 'label')).toHaveLength(0)
    await addAnnotation(page, snapT.labels[1], 'Team-1 only note', 'Risk')
    await expect(page.getByTestId('annotation-item')).toHaveCount(1)
    // Delete team-1's: alpha's untouched.
    await page.getByTestId('annotation-item').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('annotation-item')).toHaveCount(0)

    await page.getByRole('button', { name: '← Back to ARTs' }).click()
    await openCard(page, 'alpha')
    await expect(rail.getByRole('heading', { name: 'Annotations (1)' })).toBeVisible()
    await expect(page.getByTestId('annotation-item')).toContainText('Alpha only note')
    // Another iteration of the same group has its own list.
    await selectIteration(page, 'Sprint 6')
    await expect(rail.getByRole('heading', { name: 'Annotations (0)' })).toBeVisible()
  })

  test('E-A4 changing iteration discards an open dialogue without prompting', async ({ page }) => {
    await gotoGroupList(page)
    await openCard(page, 'alpha')
    const snap = await chartSnapshot(page)
    await clickPoint(page, snap.labels[1])
    await page.getByTestId('annotation-dialog').getByPlaceholder('Explain the deviation...').fill('unsaved')
    let prompts = 0
    page.on('dialog', async (d) => {
      prompts++
      await d.dismiss()
    })
    await selectIteration(page, 'Sprint 6')
    await expect(page.getByTestId('annotation-dialog')).toHaveCount(0)
    expect(prompts).toBe(0)
  })
})
