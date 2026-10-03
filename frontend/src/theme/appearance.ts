// Appearance (STYLEGUIDE.md §10): Automatic (follows the system, live), Light or Dark. The choice sets
// `data-theme="light|dark"` on <html>; the stylesheet maps it to tokens. The inline script in index.html applies
// the same resolution before first paint — keep the two in step (appearance.test.ts checks the parity).
import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type Appearance = 'auto' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export const APPEARANCE_KEY = 'heimdall-appearance'
export const APPEARANCES: readonly Appearance[] = ['auto', 'light', 'dark']
const DARK_QUERY = '(prefers-color-scheme: dark)'

const isAppearance = (v: unknown): v is Appearance => v === 'auto' || v === 'light' || v === 'dark'

// In-memory copy for when storage is unavailable (private mode, blocked site data): the choice still applies
// for this page's lifetime.
let memory: Appearance = 'auto'
let writeFailed = false

/** The stored preference; `auto` when nothing (valid) is stored or storage cannot be read. */
export function readAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(APPEARANCE_KEY)
    if (isAppearance(stored)) return stored
    if (!writeFailed) return 'auto'
  } catch {
    // storage unavailable: fall back to the in-memory choice
  }
  return memory
}

const listeners = new Set<() => void>()

/** Persists the preference (best effort) and tells every subscriber. */
export function writeAppearance(next: Appearance): void {
  memory = next
  try {
    localStorage.setItem(APPEARANCE_KEY, next)
    writeFailed = false
  } catch {
    // storage unavailable: the in-memory copy carries the choice
    writeFailed = true
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab changing the preference.
  const onStorage = (e: StorageEvent) => {
    if (e.key === APPEARANCE_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function darkQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null
}

export function systemPrefersDark(): boolean {
  return darkQuery()?.matches ?? false
}

export function resolveTheme(appearance: Appearance, prefersDark: boolean): Theme {
  if (appearance === 'auto') return prefersDark ? 'dark' : 'light'
  return appearance
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

/** The preference, a setter, and the side effect that keeps `<html data-theme>` in step (system changes included). */
export function useAppearance(): [Appearance, (next: Appearance) => void] {
  const appearance = useSyncExternalStore(subscribe, readAppearance, () => 'auto' as Appearance)

  useEffect(() => {
    applyTheme(resolveTheme(appearance, systemPrefersDark()))
    if (appearance !== 'auto') return
    const query = darkQuery()
    if (!query) return
    const onChange = () => applyTheme(resolveTheme('auto', query.matches))
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [appearance])

  const set = useCallback((next: Appearance) => writeAppearance(next), [])
  return [appearance, set]
}
