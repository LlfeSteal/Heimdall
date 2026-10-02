import { describe, expect, it } from 'vitest'
import { mean, median } from './stats'

describe('median / mean', () => {
  it('median of an even count is the mean of the two middle values (§15.3)', () => {
    expect(median([45, 40, 24, 21])).toBe(32)
  })

  it('median of an odd count is the middle value; input order irrelevant', () => {
    expect(median([10, 5, 7.5])).toBe(7.5)
    expect(median([3])).toBe(3)
  })

  it('median does not mutate its input', () => {
    const input = [3, 1, 2]
    median(input)
    expect(input).toEqual([3, 1, 2])
  })

  it('median of nothing is 0 (§8.4: no rates ⇒ velocity 0)', () => {
    expect(median([])).toBe(0)
  })

  it('mean', () => {
    expect(mean([5, 0, 6, -1])).toBe(2.5)
    expect(mean([])).toBe(0)
  })
})
