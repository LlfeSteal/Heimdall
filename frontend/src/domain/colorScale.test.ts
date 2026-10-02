import { describe, expect, it } from 'vitest'
import { compliantTone, deviationTone, differenceTone } from './colorScale'

describe('§2.3 / A.6 colour scales', () => {
  it('average deviation (percent): ≤ 10 good · ≤ 20 caution · above poor', () => {
    expect(deviationTone(0)).toBe('good')
    expect(deviationTone(8.75)).toBe('good') // §15.3 → good per A.6 (the "caution" in §15.3 is errata)
    expect(deviationTone(10)).toBe('good')
    expect(deviationTone(10.01)).toBe('caution')
    expect(deviationTone(20)).toBe('caution')
    expect(deviationTone(20.01)).toBe('poor')
  })

  it('delivery difference on |d| points: ≤ 2 good · ≤ 5 caution · above poor', () => {
    expect(differenceTone(0)).toBe('good')
    expect(differenceTone(2)).toBe('good')
    expect(differenceTone(-2)).toBe('good')
    expect(differenceTone(2.5)).toBe('caution') // §15.3
    expect(differenceTone(-2.01)).toBe('caution')
    expect(differenceTone(5)).toBe('caution')
    expect(differenceTone(-5)).toBe('caution')
    expect(differenceTone(5.01)).toBe('poor')
    expect(differenceTone(-6)).toBe('poor')
  })

  it('compliant share (percent, higher is better): ≥ 70 good · ≥ 50 caution · below poor', () => {
    expect(compliantTone(100)).toBe('good')
    expect(compliantTone(70)).toBe('good')
    expect(compliantTone(69.99)).toBe('caution')
    expect(compliantTone(50)).toBe('caution') // §15.3 → caution per A.6 (the "poor" in §15.3 is errata)
    expect(compliantTone(49.99)).toBe('poor')
    expect(compliantTone(0)).toBe('poor')
  })
})
