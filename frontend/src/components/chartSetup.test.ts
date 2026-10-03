// The chart theme: token values read from <html> at runtime, re-read when the appearance changes.
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { installTokens } from '../test/tokens'
import { readChartTheme, tint, useChartTheme } from './chartSetup'

let uninstall: (() => void) | null = null
/** Token values without whitespace (engines differ in how they serialise rgba()). */
const squashed = (t: Record<string, string>) =>
  Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.replace(/\s+/g, '')]))
afterEach(() => {
  uninstall?.()
  uninstall = null
  delete document.documentElement.dataset.theme
})

describe('chart theme', () => {
  it('CT01 without a stylesheet (jsdom) the light values of the guide apply', () => {
    const t = readChartTheme()
    expect(t).toMatchObject({ remaining: '#007aff', today: '#ff3b30', forecast: '#ff9500', ideal: '#aeaeb2', card: '#ffffff' })
  })

  it('CT02 light tokens: semantic tokens resolve to the guide hues', () => {
    uninstall = installTokens()
    document.documentElement.dataset.theme = 'light'
    expect(squashed({ ...readChartTheme() })).toMatchObject({
      text: '#1d1d1f',
      textSecondary: 'rgba(60,60,67,0.6)',
      separator: 'rgba(60,60,67,0.12)',
      card: '#ffffff',
      tooltipBg: 'rgba(246,246,248,0.97)',
      remaining: '#007aff',
      forecast: '#ff9500',
      today: '#ff3b30',
      ideal: '#aeaeb2',
      tolerance: '#34c759',
      delivered: '#34c759',
      totalScope: 'rgba(60,60,67,0.6)',
      info: '#007aff',
      risk: '#ff3b30',
    })
  })

  it('CT03 dark tokens: data-theme="dark" gives the brighter dark variants', () => {
    uninstall = installTokens()
    document.documentElement.dataset.theme = 'dark'
    expect(squashed({ ...readChartTheme() })).toMatchObject({
      text: '#f5f5f7',
      textSecondary: 'rgba(235,235,245,0.6)',
      separator: 'rgba(84,84,88,0.45)',
      card: '#1c1c1e',
      tooltipBg: 'rgba(44,44,46,0.97)',
      remaining: '#0a84ff',
      forecast: '#ff9f0a',
      today: '#ff453a',
      ideal: '#636366',
      tolerance: '#30d158',
      delivered: '#30d158',
      totalScope: 'rgba(235,235,245,0.6)',
      info: '#0a84ff',
      risk: '#ff453a',
    })
  })

  it('CT04 useChartTheme re-reads the tokens when data-theme changes', async () => {
    uninstall = installTokens()
    document.documentElement.dataset.theme = 'light'
    const { result } = renderHook(() => useChartTheme())
    expect(result.current.remaining).toBe('#007aff')
    document.documentElement.dataset.theme = 'dark'
    await waitFor(() => expect(result.current.remaining).toBe('#0a84ff'))
    expect(result.current.today).toBe('#ff453a')
  })

  it('CT05 tint() handles hex and rgb(a) token values', () => {
    expect(tint('#007aff', 0.12)).toBe('rgba(0, 122, 255, 0.12)')
    expect(tint('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)')
    expect(tint('rgba(60, 60, 67, 0.6)', 0.5)).toBe('rgba(60, 60, 67, 0.3)')
    expect(tint('rgba(60,60,67,0.6)', 0.5)).toBe('rgba(60, 60, 67, 0.3)')
    expect(tint('rgb(52, 199, 89)', 0.14)).toBe('rgba(52, 199, 89, 0.14)')
  })
})
