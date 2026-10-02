import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, todayUtc } from './dates'

describe('dates (§7.2, §7.3, ledger #9)', () => {
  it('todayUtc returns the UTC calendar day, not the local one', () => {
    // 23:30 at UTC−5 on the 10th is already the 11th in UTC.
    expect(todayUtc(new Date('2026-03-10T23:30:00-05:00'))).toBe('2026-03-11')
    // 00:30 at UTC+2 on the 11th is still the 10th in UTC.
    expect(todayUtc(new Date('2026-03-11T00:30:00+02:00'))).toBe('2026-03-10')
  })

  it('todayUtc defaults to the current instant', () => {
    expect(todayUtc()).toBe(new Date().toISOString().slice(0, 10))
  })

  it('addDays walks calendar days across month ends and DST changes', () => {
    expect(addDays('2026-02-27', 1)).toBe('2026-02-28')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30') // EU DST switch on 2026-03-29
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02') // US DST switch
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('daysBetween is a signed whole number of calendar days', () => {
    expect(daysBetween('2026-03-01', '2026-03-04')).toBe(3)
    expect(daysBetween('2026-03-04', '2026-03-01')).toBe(-3)
    expect(daysBetween('2026-03-01', '2026-03-01')).toBe(0)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(daysBetween('2026-02-01', '2026-03-01')).toBe(28)
  })
})
