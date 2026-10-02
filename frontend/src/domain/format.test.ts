import { describe, expect, it } from 'vitest'
import {
  formatDateRange,
  formatPercentOneDecimal,
  formatPoints,
  formatShare,
  formatSignedPoints,
  formatWholePercent,
  oneDecimal,
  signedOneDecimal,
} from './format'

describe('§13 number formatting', () => {
  it('workload / points: one decimal', () => {
    expect(oneDecimal(32)).toBe('32.0')
    expect(oneDecimal(2.25 + 0.01)).toBe('2.3')
    expect(oneDecimal(0)).toBe('0.0')
    expect(formatPoints(32)).toBe('32.0 pts')
  })

  it('delivery difference: one decimal with an explicit + when zero or positive', () => {
    expect(signedOneDecimal(2.5)).toBe('+2.5')
    expect(signedOneDecimal(0)).toBe('+0.0')
    expect(signedOneDecimal(-1)).toBe('-1.0')
    expect(signedOneDecimal(-0)).toBe('+0.0')
    expect(formatSignedPoints(2.5)).toBe('+2.5 pts')
    expect(formatSignedPoints(-6)).toBe('-6.0 pts')
  })

  it('score deviation percentage: one decimal + " %" (§15.3: 0.0875 → "8.8 %")', () => {
    expect(formatPercentOneDecimal(8.75)).toBe('8.8 %')
    expect(formatPercentOneDecimal(0.0875 * 100)).toBe('8.8 %')
    expect(formatPercentOneDecimal(((0.1 + 0 + 0.2 + 0.05) / 4) * 100)).toBe('8.8 %')
    expect(formatPercentOneDecimal(10)).toBe('10.0 %')
  })

  it('compliant share: whole number + " %"', () => {
    expect(formatWholePercent(50)).toBe('50 %')
    expect(formatWholePercent(66.6)).toBe('67 %')
    expect(formatWholePercent(100 / 3)).toBe('33 %')
  })

  it('summary-strip share: whole number, rounded, "%"', () => {
    expect(formatShare(66.6)).toBe('67%')
    expect(formatShare(0)).toBe('0%')
  })

  it('dates are shown "start → due"', () => {
    expect(formatDateRange('2026-03-01', '2026-03-14')).toBe('2026-03-01 → 2026-03-14')
  })
})
