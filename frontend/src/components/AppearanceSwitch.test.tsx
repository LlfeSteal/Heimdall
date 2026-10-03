// Appearance switch (STYLEGUIDE.md §7, §10, §12): radio-group semantics, persistence, `<html data-theme>`, and
// Automatic following the system live.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { S } from '../strings'
import { openCard, renderApp, resetTestEnvironment } from '../test/renderApp'
import { APPEARANCE_KEY } from '../theme/appearance'
import { AppearanceSwitch } from './AppearanceSwitch'

vi.mock('react-chartjs-2', () => import('../test/chartMock'))

afterEach(() => {
  resetTestEnvironment()
  delete document.documentElement.dataset.theme
})

/** A controllable `(prefers-color-scheme: dark)` media query. */
function stubSystem(initiallyDark: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    matches: initiallyDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => query))
  return {
    set(dark: boolean) {
      query.matches = dark
      act(() => listeners.forEach((l) => l()))
    },
    listeners,
  }
}

const group = () => screen.getByRole('radiogroup', { name: S.appearance })
const radio = (name: string) => within(group()).getByRole('radio', { name })
const theme = () => document.documentElement.dataset.theme

describe('AppearanceSwitch', () => {
  it('AS01 a radio group `Appearance` with Automatic / Light / Dark; Automatic checked by default', () => {
    render(<AppearanceSwitch />)
    const radios = within(group()).getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual([S.appearanceAuto, S.appearanceLight, S.appearanceDark])
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    // Roving tab stop: only the checked segment is tabbable.
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1])
  })

  it('AS02 choosing Dark checks it, stores it and sets <html data-theme="dark">', async () => {
    stubSystem(false)
    const user = userEvent.setup()
    render(<AppearanceSwitch />)
    expect(theme()).toBe('light')
    await user.click(radio(S.appearanceDark))
    expect(radio(S.appearanceDark)).toHaveAttribute('aria-checked', 'true')
    expect(radio(S.appearanceAuto)).toHaveAttribute('aria-checked', 'false')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('dark')
    expect(theme()).toBe('dark')
    await user.click(radio(S.appearanceLight))
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('light')
    expect(theme()).toBe('light')
  })

  it('AS03 a stored choice is restored on mount', () => {
    stubSystem(false)
    localStorage.setItem(APPEARANCE_KEY, 'dark')
    render(<AppearanceSwitch />)
    expect(radio(S.appearanceDark)).toHaveAttribute('aria-checked', 'true')
    expect(theme()).toBe('dark')
  })

  it('AS04 Automatic follows the system live; Light or Dark ignore it', async () => {
    const system = stubSystem(false)
    const user = userEvent.setup()
    render(<AppearanceSwitch />)
    expect(theme()).toBe('light')
    system.set(true)
    expect(theme()).toBe('dark')
    system.set(false)
    expect(theme()).toBe('light')
    await user.click(radio(S.appearanceLight))
    expect(system.listeners.size).toBe(0)
    system.set(true)
    expect(theme()).toBe('light')
  })

  it('AS05 arrow keys move the choice (wrapping) and the focus', () => {
    stubSystem(false)
    render(<AppearanceSwitch />)
    radio(S.appearanceAuto).focus()
    fireEvent.keyDown(radio(S.appearanceAuto), { key: 'ArrowRight' })
    expect(radio(S.appearanceLight)).toHaveAttribute('aria-checked', 'true')
    expect(radio(S.appearanceLight)).toHaveFocus()
    fireEvent.keyDown(radio(S.appearanceLight), { key: 'ArrowLeft' })
    fireEvent.keyDown(radio(S.appearanceAuto), { key: 'ArrowLeft' })
    expect(radio(S.appearanceDark)).toHaveAttribute('aria-checked', 'true')
    expect(radio(S.appearanceDark)).toHaveFocus()
    expect(theme()).toBe('dark')
  })

  it('AS06 is in the toolbar of both screens, and the choice carries over', async () => {
    stubSystem(false)
    const { user } = renderApp()
    await user.click(await screen.findByRole('radio', { name: S.appearanceDark }))
    await openCard(user, 'Alpha')
    const header = screen.getByTestId('review-header')
    expect(within(header).getByRole('radio', { name: S.appearanceDark })).toHaveAttribute('aria-checked', 'true')
    expect(theme()).toBe('dark')
  })
})
