// App shell: two screens, no routing, no deep links, no history entries (SPEC §3, ledger #20); per-mount
// data client. Contract: docs/conformance/screens.md
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { S } from './strings'
import { CONFIG } from './test/fixtures'
import {
  clickPoint,
  openCard,
  openTile,
  renderApp,
  resetTestEnvironment,
  selectIteration,
  waitForChart,
} from './test/renderApp'

vi.mock('react-chartjs-2', () => import('./test/chartMock'))

afterEach(resetTestEnvironment)

const TERM = CONFIG.groupTerm

describe('§3 / ledger #20 navigation without routing', () => {
  it('SN01 a full journey never touches browser history or the URL', async () => {
    const start = { path: window.location.pathname, search: window.location.search, hash: window.location.hash }
    const historyLength = window.history.length
    const { pushState, replaceState, user } = renderApp()
    await openCard(user, 'Alpha')
    await waitForChart()
    await selectIteration(user, 'Sprint 6')
    await waitForChart()
    clickPoint('2026-02-20')
    await screen.findByTestId('annotation-dialog')
    await user.click(screen.getByRole('button', { name: S.backToGroups(TERM) }))
    await openTile(user, 'Team One')
    await waitForChart()
    expect(pushState).not.toHaveBeenCalled()
    expect(replaceState).not.toHaveBeenCalled()
    expect(window.history.length).toBe(historyLength)
    expect({ path: window.location.pathname, search: window.location.search, hash: window.location.hash }).toEqual(start)
  })

  it('SN02 every mount starts on the group list with fresh data (no state survives a reload)', async () => {
    const first = renderApp()
    await openCard(first.user, 'Alpha')
    await waitForChart()
    cleanup()
    const groupsBefore = first.api.count('/api/groups')
    render(<App />)
    expect(await screen.findByRole('heading', { name: S.availableGroups(TERM, 3) })).toBeInTheDocument()
    expect(screen.queryByTestId('review-header')).toBeNull()
    expect(first.api.count('/api/groups')).toBe(groupsBefore + 1)
  })
})
