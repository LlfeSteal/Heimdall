import { describe, expect, it } from 'vitest'
import { annotationsOnDate, belongsTo, effectiveType } from './model'
import { makeAnnotation } from './testStorage'

describe('§10.1 model', () => {
  it('MO01 absent type means information', () => {
    expect(effectiveType({})).toBe('information')
    expect(effectiveType({ type: undefined })).toBe('information')
  })

  it('MO02 explicit types are kept', () => {
    expect(effectiveType({ type: 'risk' })).toBe('risk')
    expect(effectiveType({ type: 'information' })).toBe('information')
  })

  it('MO03 annotationsOnDate returns every annotation of that date, in list order', () => {
    const a1 = makeAnnotation({ date: '2026-09-10', text: 'first' })
    const other = makeAnnotation({ date: '2026-09-11' })
    const a2 = makeAnnotation({ date: '2026-09-10', text: 'second' })
    expect(annotationsOnDate([a1, other, a2], '2026-09-10')).toEqual([a1, a2])
    expect(annotationsOnDate([a1, other, a2], '2026-09-12')).toEqual([])
  })
})

describe('§10.2 scoping predicate', () => {
  const ann = makeAnnotation({ groupPath: 'org/delivery/alpha', iterationId: '42' })

  it('MO10 belongs only to the exact (group, iteration) pair', () => {
    expect(belongsTo(ann, 'org/delivery/alpha', '42')).toBe(true)
    expect(belongsTo(ann, 'org/delivery/beta', '42')).toBe(false)
    expect(belongsTo(ann, 'org/delivery/alpha', '43')).toBe(false)
  })

  it('MO11 an incomplete pair matches nothing (never "all")', () => {
    expect(belongsTo(ann, null, '42')).toBe(false)
    expect(belongsTo(ann, undefined, '42')).toBe(false)
    expect(belongsTo(ann, '', '42')).toBe(false)
    expect(belongsTo(ann, 'org/delivery/alpha', null)).toBe(false)
    expect(belongsTo(ann, 'org/delivery/alpha', '')).toBe(false)
    expect(belongsTo({ groupPath: '', iterationId: '' }, '', '')).toBe(false)
  })
})
