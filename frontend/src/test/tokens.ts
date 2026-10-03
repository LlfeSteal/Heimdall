/// <reference types="node" />
// Test-only: installs the real token stylesheet (src/index.css) in jsdom, so getComputedStyle sees the tokens of
// the current `data-theme`. Vitest does not process CSS imports, hence the file read.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function installTokens(): () => void {
  const style = document.createElement('style')
  style.textContent = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')
  document.head.append(style)
  return () => style.remove()
}

/** Token values the stylesheet yields per appearance (STYLEGUIDE.md §2), for assertions. */
export const TOKEN_VALUES = {
  light: { remaining: '#007aff' },
  dark: { remaining: '#0a84ff', today: '#ff453a', forecast: '#ff9f0a', ideal: '#636366', risk: '#ff453a', card: '#1c1c1e' },
} as const
