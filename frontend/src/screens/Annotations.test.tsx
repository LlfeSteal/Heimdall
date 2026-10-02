// Right rail, annotation dialogue, list items, overlap warning, scoping and lifecycle wiring
// (SPEC §3.2 right rail, §3.3–§3.5, §10.2, §10.3, §10.4, §13, §14.3, §15.8).
// Contract: docs/conformance/screens.md
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { S } from '../strings'
import { ALPHA, BETA, CONFIG } from '../test/fixtures'
import {
  clickPoint,
  openCard,
  renderApp,
  resetTestEnvironment,
  selectIteration,
  tick,
  waitForChart,
} from '../test/renderApp'

vi.mock('react-chartjs-2', () => import('../test/chartMock'))

afterEach(resetTestEnvironment)

const TERM = CONFIG.groupTerm
const KEY = 'heimdall-annotations.v1'
const rail = () => screen.getByTestId('annotations-rail')
const dialog = () => screen.getByTestId('annotation-dialog')
const items = () => within(rail()).queryAllByTestId('annotation-item')
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? '[]') as Array<Record<string, unknown>>
const textarea = () => within(dialog()).getByPlaceholderText(S.textPlaceholder) as HTMLTextAreaElement

type User = ReturnType<typeof renderApp>['user']

async function addAnnotation(user: User, date: string, text: string) {
  clickPoint(date)
  await screen.findByTestId('annotation-dialog')
  await user.type(textarea(), text)
  await user.click(within(dialog()).getByRole('button', { name: S.add }))
  await waitFor(() => expect(screen.queryByTestId('annotation-dialog')).toBeNull())
  tick()
}

async function openAlpha(user: User) {
  await openCard(user, 'Alpha')
  return waitForChart()
}

describe('§3.2 right rail', () => {
  it('SA01 heading `Annotations (0)`, empty text, help box `How to use` with its two lines', async () => {
    const { user } = renderApp()
    await openAlpha(user)
    expect(within(rail()).getByRole('heading', { name: S.annotationsHeading(0) })).toBeInTheDocument()
    expect(within(rail()).getByText(S.noAnnotations)).toBeInTheDocument()
    expect(within(rail()).getByText(S.helpHeading)).toBeInTheDocument()
    expect(within(rail()).getByText(S.helpClick)).toBeInTheDocument()
    expect(within(rail()).getByText(S.helpLocal)).toBeInTheDocument()
  })
})

describe('§3.3 annotation dialogue', () => {
  it('SA02 opens directly under the chart (in the chart card): `Add annotation`, `Date: {date}`, `Type` Information/Risk, placeholder, Cancel/Add', async () => {
    const { user } = renderApp()
    const card = await openAlpha(user)
    expect(screen.queryByTestId('annotation-dialog')).toBeNull()
    clickPoint('2026-03-05')
    const d = await within(card).findByTestId('annotation-dialog')
    expect(within(d).getByRole('heading', { name: S.addAnnotation })).toBeInTheDocument()
    expect(within(d).getByText(S.dialogDate('2026-03-05'))).toBeInTheDocument()
    expect(within(d).getByText(S.typeLabel)).toBeInTheDocument()
    expect(within(d).getByRole('button', { name: S.typeInformation })).toHaveAttribute('aria-pressed', 'true')
    expect(within(d).getByRole('button', { name: S.typeRisk })).toHaveAttribute('aria-pressed', 'false')
    expect(textarea().tagName).toBe('TEXTAREA')
    expect(textarea().value).toBe('')
    expect(within(d).getByRole('button', { name: S.cancel })).toBeInTheDocument()
    // Text is required: the action is disabled until there is non-blank text.
    expect(within(d).getByRole('button', { name: S.add })).toBeDisabled()
    await user.type(textarea(), '   ')
    expect(within(d).getByRole('button', { name: S.add })).toBeDisabled()
    await user.type(textarea(), 'x')
    expect(within(d).getByRole('button', { name: S.add })).toBeEnabled()
  })

  it('SA03 `Add` writes through to storage scoped (group, iid), closes, and the rail shows the amber card', async () => {
    const { user } = renderApp()
    await openAlpha(user)
    await addAnnotation(user, '2026-03-05', 'Scope added by PO')
    expect(within(rail()).getByRole('heading', { name: S.annotationsHeading(1) })).toBeInTheDocument()
    expect(within(rail()).queryByText(S.noAnnotations)).toBeNull()
    const [item] = items()
    expect(within(item).getByText('2026-03-05')).toBeInTheDocument()
    expect(within(item).getByText(S.byAuthor(S.currentUser))).toBeInTheDocument()
    expect(within(item).getByRole('button', { name: S.edit })).toBeInTheDocument()
    expect(within(item).getByRole('button', { name: S.delete })).toBeInTheDocument()
    expect(within(item).getByText('Scope added by PO')).toBeInTheDocument()
    expect(stored()).toEqual([
      expect.objectContaining({
        groupPath: ALPHA,
        iterationId: '7',
        date: '2026-03-05',
        author: S.currentUser,
        text: 'Scope added by PO',
        type: 'information',
      }),
    ])
  })

  it('SA04 `Risk` choice is the filled one and is saved as risk', async () => {
    const { user } = renderApp()
    await openAlpha(user)
    clickPoint('2026-03-06')
    await screen.findByTestId('annotation-dialog')
    await user.click(within(dialog()).getByRole('button', { name: S.typeRisk }))
    expect(within(dialog()).getByRole('button', { name: S.typeRisk })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog()).getByRole('button', { name: S.typeInformation })).toHaveAttribute('aria-pressed', 'false')
    await user.type(textarea(), 'Key dev sick')
    await user.click(within(dialog()).getByRole('button', { name: S.add }))
    await waitFor(() => expect(stored()).toEqual([expect.objectContaining({ type: 'risk', text: 'Key dev sick' })]))
  })

  it('SA05 free text with newlines: Enter inserts a newline, it does not submit', async () => {
    const { user } = renderApp()
    await openAlpha(user)
    clickPoint('2026-03-06')
    await screen.findByTestId('annotation-dialog')
    await user.type(textarea(), 'line one{Enter}line two')
    expect(screen.getByTestId('annotation-dialog')).toBeInTheDocument()
    expect(textarea().value).toBe('line one\nline two')
    await user.click(within(dialog()).getByRole('button', { name: S.add }))
    await waitFor(() => expect(stored()).toEqual([expect.objectContaining({ text: 'line one\nline two' })]))
  })

  it('SA06 `Cancel` closes the dialogue and writes nothing', async () => {
    const { user } = renderApp()
    await openAlpha(user)
    clickPoint('2026-03-06')
    await screen.findByTestId('annotation-dialog')
    await user.type(textarea(), 'never saved')
    await user.click(within(dialog()).getByRole('button', { name: S.cancel }))
    expect(screen.queryByTestId('annotation-dialog')).toBeNull()
    expect(stored()).toEqual([])
    expect(items()).toHaveLength(0)
  })

  it('SA07 `Edit` in the list: `Edit annotation`, pre-filled, action `Edit`; saving updates in place', async () => {
    const { user } = renderApp()
    await openAlpha(user)
    await addAnnotation(user, '2026-03-05', 'first text')
    await user.click(within(items()[0]).getByRole('button', { name: S.edit }))
    const d = await screen.findByTestId('annotation-dialog')
    expect(within(d).getByRole('heading', { name: S.editAnnotation })).toBeInTheDocument()
    expect(within(d).getByText(S.dialogDate('2026-03-05'))).toBeInTheDocument()
    expect(textarea().value).toBe('first text')
    expect(within(d).queryByRole('button', { name: S.add })).toBeNull()
    await user.clear(textarea())
    await user.type(textarea(), 'edited text')
    await user.click(within(d).getByRole('button', { name: S.edit }))
    await waitFor(() => expect(screen.queryByTestId('annotation-dialog')).toBeNull())
    expect(items()).toHaveLength(1)
    expect(within(items()[0]).getByText('edited text')).toBeInTheDocument()
    expect(stored()).toHaveLength(1)
  })

  it('SA08 clicking a point that carries an annotation opens it for editing', async () => {
    const { user } = renderApp()
    await openAlpha(user)
    await addAnnotation(user, '2026-03-05', 'already here')
    clickPoint('2026-03-05')
    const d = await screen.findByTestId('annotation-dialog')
    expect(within(d).getByRole('heading', { name: S.editAnnotation })).toBeInTheDocument()
    expect(textarea().value).toBe('already here')
  })

  it('SA09 `Delete` removes it (no prompt) and the count follows', async () => {
    const { confirm, user } = renderApp()
    await openAlpha(user)
    await addAnnotation(user, '2026-03-05', 'one')
    await addAnnotation(user, '2026-03-06', 'two')
    expect(within(rail()).getByRole('heading', { name: S.annotationsHeading(2) })).toBeInTheDocument()
    await user.click(within(items()[0]).getByRole('button', { name: S.delete }))
    await waitFor(() => expect(items()).toHaveLength(1))
    expect(within(items()[0]).getByText('two')).toBeInTheDocument()
    expect(within(rail()).getByRole('heading', { name: S.annotationsHeading(1) })).toBeInTheDocument()
    expect(stored().map((a) => a.text)).toEqual(['two'])
    expect(confirm).not.toHaveBeenCalled()
  })

  it('SA10 the list keeps SAVE order (nothing re-sorts by date)', async () => {
    const { user } = renderApp()
    await openAlpha(user)
    await addAnnotation(user, '2026-03-09', 'later date, saved first')
    await addAnnotation(user, '2026-03-03', 'earlier date, saved second')
    expect(items().map((i) => within(i).queryByText(/saved/)?.textContent)).toEqual([
      'later date, saved first',
      'earlier date, saved second',
    ])
  })
})

describe('§3.5 overlap warning', () => {
  it('SA11 unsaved text + click on a DIFFERENT point → `Unsaved changes will be lost. Continue?`; declining changes nothing', async () => {
    const { confirm, user } = renderApp({ confirm: false })
    await openAlpha(user)
    clickPoint('2026-03-05')
    await screen.findByTestId('annotation-dialog')
    await user.type(textarea(), 'work in progress')
    clickPoint('2026-03-06')
    expect(confirm).toHaveBeenCalledWith(S.unsavedPrompt)
    expect(within(dialog()).getByText(S.dialogDate('2026-03-05'))).toBeInTheDocument()
    expect(textarea().value).toBe('work in progress')
  })

  it('SA12 accepting the prompt moves the dialogue to the new point, text discarded', async () => {
    const { confirm, user } = renderApp({ confirm: true })
    await openAlpha(user)
    clickPoint('2026-03-05')
    await screen.findByTestId('annotation-dialog')
    await user.type(textarea(), 'work in progress')
    clickPoint('2026-03-06')
    expect(confirm).toHaveBeenCalledWith(S.unsavedPrompt)
    await waitFor(() => expect(within(dialog()).getByText(S.dialogDate('2026-03-06'))).toBeInTheDocument())
    expect(textarea().value).toBe('')
  })

  it('SA13 unsaved text + `Edit` on another annotation → same prompt; declining keeps everything', async () => {
    const { confirm, user } = renderApp({ confirm: false })
    await openAlpha(user)
    await addAnnotation(user, '2026-03-05', 'saved one')
    clickPoint('2026-03-07')
    await screen.findByTestId('annotation-dialog')
    await user.type(textarea(), 'draft')
    await user.click(within(items()[0]).getByRole('button', { name: S.edit }))
    expect(confirm).toHaveBeenCalledWith(S.unsavedPrompt)
    expect(within(dialog()).getByRole('heading', { name: S.addAnnotation })).toBeInTheDocument()
    expect(within(dialog()).getByText(S.dialogDate('2026-03-07'))).toBeInTheDocument()
    expect(textarea().value).toBe('draft')
  })

  it('SA14 no prompt when nothing is unsaved', async () => {
    const { confirm, user } = renderApp()
    await openAlpha(user)
    clickPoint('2026-03-05')
    await screen.findByTestId('annotation-dialog')
    clickPoint('2026-03-06')
    await waitFor(() => expect(within(dialog()).getByText(S.dialogDate('2026-03-06'))).toBeInTheDocument())
    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('§10.3 / §14.3 lifecycle wiring and §10.2 scoping', () => {
  it('SA15 choosing another iteration discards the selection and unsaved text at once — no prompt', async () => {
    const { confirm, user } = renderApp()
    await openAlpha(user)
    clickPoint('2026-03-05')
    await screen.findByTestId('annotation-dialog')
    await user.type(textarea(), 'unsaved')
    await selectIteration(user, 'Sprint 6')
    expect(screen.queryByTestId('annotation-dialog')).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
    await selectIteration(user, 'Sprint 7')
    await waitForChart()
    expect(screen.queryByTestId('annotation-dialog')).toBeNull()
    expect(stored()).toEqual([])
  })

  it('SA16 back to the group list clears the selection; re-entering shows the saved list and no dialogue', async () => {
    const { confirm, user } = renderApp()
    await openAlpha(user)
    await addAnnotation(user, '2026-03-05', 'kept')
    clickPoint('2026-03-06')
    await screen.findByTestId('annotation-dialog')
    await user.type(textarea(), 'unsaved')
    await user.click(screen.getByRole('button', { name: S.backToGroups(TERM) }))
    expect(confirm).not.toHaveBeenCalled()
    await openAlpha(user)
    expect(screen.queryByTestId('annotation-dialog')).toBeNull()
    expect(items()).toHaveLength(1)
    expect(within(items()[0]).getByText('kept')).toBeInTheDocument()
  })

  it('SA17 §15.8: annotations belong to (group, iteration) — alpha #7 and beta #7 never see each other’s', async () => {
    const { user } = renderApp()
    await openAlpha(user)
    await addAnnotation(user, '2026-03-05', 'alpha note')
    await user.click(screen.getByRole('button', { name: S.backToGroups(TERM) }))
    await openCard(user, 'Beta') // auto-selects beta #7: same iid, other group
    await waitForChart()
    expect(within(rail()).getByRole('heading', { name: S.annotationsHeading(0) })).toBeInTheDocument()
    expect(within(rail()).getByText(S.noAnnotations)).toBeInTheDocument()
    await addAnnotation(user, '2026-03-05', 'beta note')
    expect(items()).toHaveLength(1)
    expect(within(items()[0]).getByText('beta note')).toBeInTheDocument()
    await user.click(within(items()[0]).getByRole('button', { name: S.delete }))
    await waitFor(() => expect(items()).toHaveLength(0))
    await user.click(screen.getByRole('button', { name: S.backToGroups(TERM) }))
    await openAlpha(user)
    expect(items()).toHaveLength(1)
    expect(within(items()[0]).getByText('alpha note')).toBeInTheDocument()
    expect(stored()).toEqual([expect.objectContaining({ groupPath: ALPHA, iterationId: '7', text: 'alpha note' })])
    expect(stored().some((a) => a.groupPath === BETA)).toBe(false)
  })

  it('SA18 the list follows the selected iteration (same group, other iid → its own list)', async () => {
    const { user } = renderApp()
    await openAlpha(user)
    await addAnnotation(user, '2026-03-05', 'on sprint 7')
    await selectIteration(user, 'Sprint 6')
    await waitForChart()
    expect(within(rail()).getByRole('heading', { name: S.annotationsHeading(0) })).toBeInTheDocument()
    await selectIteration(user, 'Sprint 7')
    await waitFor(() => expect(within(rail()).getByRole('heading', { name: S.annotationsHeading(1) })).toBeInTheDocument())
  })
})
