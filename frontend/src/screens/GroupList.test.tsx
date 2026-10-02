// Screen 1 — group list (SPEC §3.1, §13, §14.2, §14.3, Amendment A.3/A.4, ledger #3).
// Contract: docs/conformance/screens.md
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { S } from '../strings'
import { deferred, errorReply, type Reply } from '../test/fakeApi'
import { ALPHA, CONFIG, TEAM1, estate } from '../test/fixtures'
import { openCard, openTile, renderApp, resetTestEnvironment } from '../test/renderApp'

vi.mock('react-chartjs-2', () => import('../test/chartMock'))

afterEach(resetTestEnvironment)

const TERM = CONFIG.groupTerm
const ROOT = CONFIG.rootGroup

/** Elements whose whole text content equals `text` (an element and its wrapper may both match). */
function byWholeText(text: string): HTMLElement[] {
  return screen.queryAllByText((_, el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim() === text)
}

describe('§3.1 group list — states', () => {
  it('SG01 product title, and loading = three placeholder cards with no text', async () => {
    const hold = deferred<Reply>()
    renderApp({ override: (c) => (c.path === '/api/groups' ? hold.promise : undefined) })
    expect(await screen.findByRole('heading', { name: S.productTitle })).toBeInTheDocument()
    const placeholders = await screen.findAllByTestId('group-placeholder')
    expect(placeholders).toHaveLength(3)
    for (const p of placeholders) expect(p.textContent).toBe('')
    expect(screen.queryByText(/Available/)).toBeNull()
    hold.resolve({ body: estate.groups })
    expect(await screen.findByRole('heading', { name: S.availableGroups(TERM, 3) })).toBeInTheDocument()
    expect(screen.queryAllByTestId('group-placeholder')).toHaveLength(0)
  })

  it('SG02 failure: heading `Loading error`, the verbatim message, and `Retry` re-reads with refresh=1', async () => {
    const message = 'GitLab API error: 401 Unauthorized — token expired'
    const { api, user } = renderApp({
      override: (c, nth) => (c.path === '/api/groups' && nth === 0 ? errorReply(message) : undefined),
    })
    expect(await screen.findByRole('heading', { name: S.groupLoadingError })).toBeInTheDocument()
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(api.count('/api/groups', { refresh: true })).toBe(0)
    await user.click(screen.getByRole('button', { name: S.retry }))
    expect(await screen.findByRole('heading', { name: S.availableGroups(TERM, 3) })).toBeInTheDocument()
    expect(api.count('/api/groups', { refresh: true })).toBe(1)
    expect(screen.queryByText(message)).toBeNull()
  })

  it('SG03 nothing eligible (A.4): heading, body with ROOT_GROUP as code, and `Refresh` (refresh=1)', async () => {
    const { api, user } = renderApp({
      override: (c, nth) => (c.path === '/api/groups' && nth === 0 ? { body: [] } : undefined),
    })
    expect(await screen.findByRole('heading', { name: S.noGroupHeading(TERM) })).toBeInTheDocument()
    const body = S.noGroupBody(TERM, ROOT)
    expect(byWholeText(`${body.before}${body.code}${body.after}`).length).toBeGreaterThan(0)
    expect(screen.getByText(ROOT, { selector: 'code' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: S.refresh }))
    expect(await screen.findByRole('heading', { name: S.availableGroups(TERM, 3) })).toBeInTheDocument()
    expect(api.count('/api/groups', { refresh: true })).toBe(1)
  })

  it('SG04 populated: `Available ARTs (n)` counts CARDS, not groups (ledger #3), plus A.4 guidance with ROOT_GROUP as code', async () => {
    renderApp()
    // 3 cards carry 5 groups (alpha + team-1, beta + x, delta).
    expect(await screen.findByRole('heading', { name: S.availableGroups(TERM, 3) })).toBeInTheDocument()
    expect(screen.getAllByTestId('group-card')).toHaveLength(3)
    expect(screen.getAllByTestId('group-tile')).toHaveLength(2)
    const g = S.groupGuidance(TERM, ROOT)
    expect(byWholeText(`${g.before}${g.code}${g.after}`).length).toBeGreaterThan(0)
    expect(screen.getByText(ROOT, { selector: 'code' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: S.refresh })).toBeInTheDocument()
  })

  it('SG05 cards in contract order: category label (own segment), display name, full path; tiles show name + own segment only', async () => {
    renderApp()
    const cards = await screen.findAllByTestId('group-card')
    expect(cards).toHaveLength(estate.groups.length)
    estate.groups.forEach((group, i) => {
      const card = cards[i]
      expect(within(card).getByText(group.segment)).toBeInTheDocument()
      expect(within(card).getByText(group.name)).toBeInTheDocument()
      expect(within(card).getByText(group.fullPath)).toBeInTheDocument()
      const tiles = within(card).queryAllByTestId('group-tile')
      expect(tiles).toHaveLength(group.children.length)
      group.children.forEach((child, j) => {
        expect(within(tiles[j]).getByText(child.name)).toBeInTheDocument()
        expect(within(tiles[j]).getByText(child.segment)).toBeInTheDocument()
        expect(within(tiles[j]).queryByText(child.fullPath)).toBeNull()
      })
    })
  })

  it('SG06 clicking the parent card selects the PARENT group', async () => {
    const { api, user } = renderApp()
    await openCard(user, 'Alpha')
    const header = screen.getByTestId('review-header')
    expect(within(header).getByText('Alpha')).toBeInTheDocument()
    expect(within(header).getByText(ALPHA)).toBeInTheDocument()
    expect(api.count('/api/iterations', { group: ALPHA })).toBe(1)
    expect(api.count('/api/iterations', { group: TEAM1 })).toBe(0)
  })

  it('SG07 clicking a tile selects THAT CHILD only (the parent card is not selected)', async () => {
    const { api, user } = renderApp()
    await openTile(user, 'Team One')
    const header = screen.getByTestId('review-header')
    expect(within(header).getByText('Team One')).toBeInTheDocument()
    expect(within(header).getByText(TEAM1)).toBeInTheDocument()
    expect(api.count('/api/iterations', { group: TEAM1 })).toBe(1)
    expect(api.count('/api/iterations', { group: ALPHA })).toBe(0)
    expect(api.count('/api/reports', { group: ALPHA })).toBe(0)
  })

  it('SG08 group-list `Refresh` re-reads the groups with refresh=1 — once, and nothing else', async () => {
    const { api, user } = renderApp()
    await screen.findByRole('heading', { name: S.availableGroups(TERM, 3) })
    const before = api.calls.length
    await user.click(screen.getByRole('button', { name: S.refresh }))
    await vi.waitFor(() => expect(api.count('/api/groups', { refresh: true })).toBe(1))
    expect(api.calls.slice(before).map((c) => c.path)).toEqual(['/api/groups'])
    expect(await screen.findByRole('heading', { name: S.availableGroups(TERM, 3) })).toBeInTheDocument()
  })

  it('SG09 GROUP_TERM and ROOT_GROUP come from /api/config (never hard-coded)', async () => {
    const config = { groupTerm: 'Train', rootGroup: 'acme/eng' }
    const { user } = renderApp({ estate: { ...estate, config } })
    expect(await screen.findByRole('heading', { name: S.availableGroups('Train', 3) })).toBeInTheDocument()
    expect(screen.getByText('acme/eng', { selector: 'code' })).toBeInTheDocument()
    await user.click(screen.getByText('Alpha'))
    expect(await screen.findByRole('button', { name: S.backToGroups('Train') })).toBeInTheDocument()
    expect(screen.queryByText(/ARTs?\b/)).toBeNull()
  })

  it('SG10 nothing eligible uses the configured term and root too', async () => {
    const config = { groupTerm: 'Train', rootGroup: 'acme/eng' }
    renderApp({ estate: { ...estate, config, groups: [] } })
    expect(await screen.findByRole('heading', { name: S.noGroupHeading('Train') })).toBeInTheDocument()
    const body = S.noGroupBody('Train', 'acme/eng')
    expect(byWholeText(`${body.before}${body.code}${body.after}`).length).toBeGreaterThan(0)
  })
})
