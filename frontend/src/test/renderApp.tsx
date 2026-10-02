// Shared harness for the screen tests: renders <App /> against the fake backend with a pinned clock.
// Test-only. Every screen test file must also install the chart mock itself (vi.mock is per file):
//   vi.mock('react-chartjs-2', () => import('../test/chartMock'))

import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import App from '../App'
import { clickChartAt, indexOfDate, resetChartMock } from './chartMock'
import { createFakeApi, type FakeApiOptions } from './fakeApi'
import { CONFIG, NOW_ISO } from './fixtures'

export interface RenderAppOptions extends FakeApiOptions {
  /** What the stubbed `window.confirm` answers (default true). */
  confirm?: boolean
  /**
   * Also fake setTimeout/setInterval (for the 30 s score timeout). The fake clock still advances with real
   * time (`shouldAdvanceTime`), so testing-library's polling keeps working; jump with
   * `await act(() => vi.advanceTimersByTimeAsync(ms))`.
   */
  fakeTimers?: boolean
}

/**
 * Pins "now" to NOW_ISO (2026-03-12T10:00:00Z ⇒ todayUtc() = TODAY). Only `Date` is faked unless
 * `timers` is set; the clock keeps ticking in real time from there.
 */
export function pinClock(timers = false): void {
  vi.useFakeTimers({
    toFake: timers ? ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] : ['Date'],
    shouldAdvanceTime: true,
  })
  vi.setSystemTime(new Date(NOW_ISO))
}

export function renderApp(options: RenderAppOptions = {}) {
  pinClock(options.fakeTimers ?? false)
  const api = createFakeApi(options)
  vi.stubGlobal('fetch', api.fetch)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(options.confirm ?? true)
  const pushState = vi.spyOn(window.history, 'pushState')
  const replaceState = vi.spyOn(window.history, 'replaceState')
  const user = userEvent.setup(options.fakeTimers ? { advanceTimers: vi.advanceTimersByTime } : {})
  const view = render(<App />)
  return { api, confirm, pushState, replaceState, user, ...view }
}

/** afterEach: unmount, restore timers/globals/spies, clear browser storage and the chart mock. */
export function resetTestEnvironment(): void {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
  resetChartMock()
}

type User = ReturnType<typeof userEvent.setup>

export const term = CONFIG.groupTerm

/** Waits for screen 1 and clicks the card (parent group) whose display name is `name`. */
export async function openCard(user: User, name: string): Promise<void> {
  const label = await screen.findByText(name)
  await user.click(label)
  await screen.findByRole('button', { name: `← Back to ${term}s` })
}

/** Waits for screen 1 and clicks the tile (child group) whose display name is `name`. */
export async function openTile(user: User, name: string): Promise<void> {
  const tile = (await screen.findAllByTestId('group-tile')).find((t) => within(t).queryByText(name))
  if (!tile) throw new Error(`no tile named ${name}`)
  await user.click(within(tile).getByText(name))
  await screen.findByRole('button', { name: `← Back to ${term}s` })
}

/** The iteration row (left rail) whose title is `title`. */
export async function findRow(title: string): Promise<HTMLElement> {
  const rows = await screen.findAllByTestId('iteration-row')
  const row = rows.find((r) => within(r).queryByText(title))
  if (!row) throw new Error(`no iteration row titled ${title}`)
  return row
}

/** Clicks the iteration row titled `title`. */
export async function selectIteration(user: User, title: string): Promise<void> {
  await user.click(await findRow(title))
}

/** Waits until a chart has been rendered (mocked <Line>) and returns the chart card. */
export async function waitForChart(): Promise<HTMLElement> {
  await screen.findByTestId('chart-line')
  return screen.getByTestId('chart-card')
}

/** Simulates a click on the chart point dated `date` (Chart.js options.onClick). */
export function clickPoint(date: string): void {
  act(() => clickChartAt(indexOfDate(date)))
}

/** Moves the pinned clock forward (new annotation ids come from the clock, ledger #14). */
export function tick(ms = 1000): void {
  vi.setSystemTime(new Date(Date.now() + ms))
}
