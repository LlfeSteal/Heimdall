// TEST-ONLY helpers (imported by *.test.ts[x] only). Not part of the product.

import type { Annotation } from './model'
import type { StorageLike } from './storage'

/** In-memory StorageLike that records every call, so tests can assert the §10.4 order of operations. */
export class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>()
  readonly calls: string[] = []

  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.data.set(k, v)
  }

  getItem(key: string): string | null {
    this.calls.push(`get ${key}`)
    return this.data.has(key) ? (this.data.get(key) as string) : null
  }

  setItem(key: string, value: string): void {
    this.calls.push(`set ${key}`)
    this.data.set(key, String(value))
  }

  removeItem(key: string): void {
    this.calls.push(`remove ${key}`)
    this.data.delete(key)
  }

  /** Parsed JSON value under `key` (undefined when absent). */
  json(key: string): unknown {
    const raw = this.data.get(key)
    return raw === undefined ? undefined : JSON.parse(raw)
  }
}

/** A StorageLike whose every method throws (quota / SecurityError / disabled storage). */
export const throwingStorage: StorageLike = {
  getItem() {
    throw new Error('storage disabled')
  },
  setItem() {
    throw new Error('storage disabled')
  },
  removeItem() {
    throw new Error('storage disabled')
  },
}

let seq = 0
/** Builds a valid stored annotation; override any field. */
export function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  seq += 1
  return {
    id: `id-${seq}`,
    groupPath: 'org/delivery/alpha',
    iterationId: '42',
    date: '2026-09-10',
    author: 'Current User',
    text: `note ${seq}`,
    type: 'information',
    createdAt: '2026-09-10T08:00:00.000Z',
    ...overrides,
  }
}
