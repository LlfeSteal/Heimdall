/// <reference types="node" />
// Appearance preference (STYLEGUIDE.md §10): resolution, persistence, and parity of the pre-paint script in
// index.html with the app's own resolution.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Appearance, APPEARANCE_KEY, readAppearance, resolveTheme, writeAppearance } from './appearance'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

/** window.matchMedia stand-in answering `(prefers-color-scheme: dark)` with `dark`. */
function stubSystem(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: dark && query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

describe('appearance preference', () => {
  it('AP01 defaults to Automatic when nothing (or something invalid) is stored', () => {
    expect(readAppearance()).toBe('auto')
    localStorage.setItem(APPEARANCE_KEY, 'sepia')
    expect(readAppearance()).toBe('auto')
  })

  it('AP02 a choice is persisted under `heimdall-appearance` and read back', () => {
    for (const a of ['light', 'dark', 'auto'] as Appearance[]) {
      writeAppearance(a)
      expect(localStorage.getItem(APPEARANCE_KEY)).toBe(a)
      expect(readAppearance()).toBe(a)
    }
  })

  it('AP03 storage that throws never breaks the choice: it is kept in memory for the page', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => writeAppearance('dark')).not.toThrow()
    expect(readAppearance()).toBe('dark')
    vi.restoreAllMocks()
    writeAppearance('auto')
    expect(readAppearance()).toBe('auto')
  })

  it('AP04 resolution: Automatic follows the system, Light and Dark are fixed', () => {
    expect(resolveTheme('auto', false)).toBe('light')
    expect(resolveTheme('auto', true)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('pre-paint script (index.html)', () => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
  const source = /<script id="appearance-script">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''
  const run = () => new Function(source)()

  it('AP05 is inline in <head>, before the app bundle, with the color-scheme and theme-color metas', () => {
    expect(source).toContain('heimdall-appearance')
    const head = html.slice(0, html.indexOf('</head>'))
    expect(head).toContain('id="appearance-script"')
    expect(html.indexOf('appearance-script')).toBeLessThan(html.indexOf('/src/main.tsx'))
    expect(head).toContain('<meta name="color-scheme" content="light dark" />')
    expect(head).toMatch(/<meta name="theme-color" content="#f5f5f7" media="\(prefers-color-scheme: light\)" \/>/)
    expect(head).toMatch(/<meta name="theme-color" content="#000000" media="\(prefers-color-scheme: dark\)" \/>/)
  })

  it('AP06 sets the same data-theme as the app for every stored value × system appearance', () => {
    for (const stored of [null, 'auto', 'light', 'dark', 'bogus']) {
      for (const dark of [false, true]) {
        localStorage.clear()
        if (stored !== null) localStorage.setItem(APPEARANCE_KEY, stored)
        stubSystem(dark)
        delete document.documentElement.dataset.theme
        run()
        expect(document.documentElement.dataset.theme, `${stored} / system ${dark ? 'dark' : 'light'}`).toBe(
          resolveTheme(readAppearance(), dark),
        )
      }
    }
  })

  it('AP07 falls back to Light without matchMedia, and survives storage that throws', () => {
    vi.stubGlobal('matchMedia', undefined)
    run()
    expect(document.documentElement.dataset.theme).toBe('light')
    stubSystem(true)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    run()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
