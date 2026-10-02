import { describe, expect, it } from 'vitest'
import { isClosed, isLive } from './state'

describe('iteration state semantics (§5.3, ledger #17)', () => {
  it('only the exact state "closed" is closed', () => {
    expect(isClosed('closed')).toBe(true)
    expect(isClosed('current')).toBe(false)
    expect(isClosed('Closed')).toBe(false)
    expect(isClosed(null)).toBe(false)
    expect(isClosed(undefined)).toBe(false)
  })

  it('every non-closed state, including unknown and missing, is live', () => {
    expect(isLive('current')).toBe(true)
    expect(isLive('started')).toBe(true)
    expect(isLive('')).toBe(true)
    expect(isLive(null)).toBe(true)
    expect(isLive(undefined)).toBe(true)
    expect(isLive('closed')).toBe(false)
  })
})
