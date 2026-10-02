import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_LABEL,
  annotationLabelSize,
  bandsOverlap,
  horizontalPushSign,
  stackAnnotationLabels,
  verticalPushSign,
} from './annotationGeometry'
import { days } from './testkit'

describe('§10.5 constants', () => {
  it('match the spec', () => {
    expect(ANNOTATION_LABEL).toEqual({
      WIDTH_BUDGET: 150,
      CHAR_WIDTH: 6,
      MAX_CHARS_PER_LINE: 25,
      MAX_LINES: 3,
      LINE_HEIGHT: 13,
      PADDING_X: 14,
      PADDING_Y: 10,
      MIN_WIDTH: 40,
      MIN_HEIGHT: 20,
      GAP: 20,
      MARKER_RADIUS: 5,
    })
  })
})

describe('§10.5 / §15.7 label size', () => {
  it('§15.7: empty text → 40 × 23 (width floored)', () => {
    expect(annotationLabelSize('')).toEqual({ width: 40, height: 23 })
  })

  it('§15.7: one line → 23, two → 36, three → 49, ten → 49', () => {
    expect(annotationLabelSize('one').height).toBe(23)
    expect(annotationLabelSize('one\ntwo').height).toBe(36)
    expect(annotationLabelSize('a\nb\nc').height).toBe(49)
    expect(annotationLabelSize(Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')).height).toBe(49)
  })

  it('§15.7: a 400-character single line caps at width 164', () => {
    expect(annotationLabelSize('x'.repeat(400))).toEqual({ width: 164, height: 23 })
  })

  it('width = max(round(min(longest, 25) × 6 + 14), 40)', () => {
    expect(annotationLabelSize('x'.repeat(4)).width).toBe(40) // 38 → floored to 40
    expect(annotationLabelSize('x'.repeat(5)).width).toBe(44)
    expect(annotationLabelSize('x'.repeat(10)).width).toBe(74)
    expect(annotationLabelSize('x'.repeat(25)).width).toBe(164)
    expect(annotationLabelSize('x'.repeat(26)).width).toBe(164)
  })

  it('width counts the LONGEST line, never the total text length', () => {
    expect(annotationLabelSize(`abc\n${'x'.repeat(20)}`).width).toBe(134) // not 24 chars → 158
    expect(annotationLabelSize(`${'x'.repeat(12)}\n${'y'.repeat(12)}\n${'z'.repeat(12)}`).width).toBe(86)
  })

  it('lines beyond the third still count for the longest-line width', () => {
    expect(annotationLabelSize(`a\nb\nc\n${'x'.repeat(10)}`)).toEqual({ width: 74, height: 49 })
  })
})

describe('§10.5 overlap test', () => {
  it('[a, a+hA) and [b, b+hB) overlap iff a < b+hB and b < a+hA (half-open)', () => {
    expect(bandsOverlap(0, 10, 10, 10)).toBe(false)
    expect(bandsOverlap(10, 10, 0, 10)).toBe(false)
    expect(bandsOverlap(0, 10, 9, 1)).toBe(true)
    expect(bandsOverlap(0, 10, 5, 100)).toBe(true)
    expect(bandsOverlap(-5, 10, 0, 23)).toBe(true)
    expect(bandsOverlap(20, 23, -5, 10)).toBe(false)
  })
})

describe('§10.5 / §15.7 stacking', () => {
  const axis = days('2026-03-01', 10)

  it('even a single label is lifted by one gap (20) so it never sits on its own dot', () => {
    expect(stackAnnotationLabels([{ date: '2026-03-03', value: 40, height: 23 }], axis)).toEqual([
      { index: 0, date: '2026-03-03', offset: 20 },
    ])
  })

  it('a tall label is lifted by the same 20 (the marker band is radius 5)', () => {
    expect(stackAnnotationLabels([{ date: '2026-03-03', value: 40, height: 49 }], axis)[0].offset).toBe(20)
  })

  it('annotations dated outside the axis are silently dropped; indices refer to the input', () => {
    const out = stackAnnotationLabels(
      [
        { date: '2026-02-01', value: 10, height: 23 },
        { date: '2026-03-04', value: 10, height: 23 },
        { date: '2026-05-01', value: 10, height: 23 },
      ],
      axis,
    )
    expect(out).toEqual([{ index: 1, date: '2026-03-04', offset: 20 }])
  })

  it('labels far apart vertically do not interact', () => {
    const out = stackAnnotationLabels(
      [
        { date: '2026-03-02', value: 0, height: 23 },
        { date: '2026-03-03', value: 80, height: 23 },
      ],
      axis,
    )
    expect(out.map((o) => o.offset)).toEqual([20, 20])
  })

  it('stacks in AXIS order, returns in INPUT order; a later date stacks at least as high as an earlier one', () => {
    const out = stackAnnotationLabels(
      [
        { date: '2026-03-05', value: 50, height: 23 }, // later, listed first
        { date: '2026-03-02', value: 50, height: 23 }, // earlier, listed second
      ],
      axis,
    )
    // earlier processed first → 20; later must clear [70, 93) → 60
    expect(out).toEqual([
      { index: 0, date: '2026-03-05', offset: 60 },
      { index: 1, date: '2026-03-02', offset: 20 },
    ])
    expect(out[0].offset).toBeGreaterThanOrEqual(out[1].offset)
  })

  it('same date: input order breaks the tie', () => {
    const out = stackAnnotationLabels(
      [
        { date: '2026-03-04', value: 50, height: 23 },
        { date: '2026-03-04', value: 50, height: 23 },
        { date: '2026-03-04', value: 50, height: 23 },
      ],
      axis,
    )
    expect(out.map((o) => o.offset)).toEqual([20, 60, 100])
  })

  it('offset = max(offset from earlier labels, offset from own marker)', () => {
    // earlier label band [70, 93); this label at 85 overlaps it at offset 0, clears it at 20; marker needs 20.
    const out = stackAnnotationLabels(
      [
        { date: '2026-03-02', value: 50, height: 23 },
        { date: '2026-03-03', value: 85, height: 23 },
      ],
      axis,
    )
    expect(out.map((o) => o.offset)).toEqual([20, 20])
  })

  it('§15.7: fifteen annotations on one date never overlap, and the stack climbs past the top of the range (unclamped)', () => {
    const heights = [23, 36, 49, 23, 23, 49, 36, 23, 49, 49, 23, 36, 23, 36, 49]
    const items = heights.map((height) => ({ date: '2026-03-06', value: 90, height }))
    const out = stackAnnotationLabels(items, axis)
    expect(out).toHaveLength(15)
    expect(out.map((o) => o.index)).toEqual(heights.map((_, i) => i))
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++)
        expect(bandsOverlap(90 + out[i].offset, heights[i], 90 + out[j].offset, heights[j]), `${i} vs ${j}`).toBe(false)
    const rangeTop = 100
    expect(Math.max(...out.map((o) => 90 + o.offset))).toBeGreaterThan(rangeTop)
    for (const o of out) expect(o.offset).toBeGreaterThanOrEqual(20)
  })

  it('every offset is a multiple of the 20-unit gap', () => {
    const out = stackAnnotationLabels(
      [
        { date: '2026-03-02', value: 13, height: 36 },
        { date: '2026-03-02', value: 17, height: 23 },
        { date: '2026-03-03', value: 31, height: 49 },
      ],
      axis,
    )
    for (const o of out) expect(o.offset % 20).toBe(0)
  })
})

describe('§10.5 placement direction', () => {
  it('right half of the axis is pushed leftwards (−1), left half rightwards (+1); the centre counts as left', () => {
    expect(horizontalPushSign(0, 10)).toBe(1)
    expect(horizontalPushSign(4, 10)).toBe(1)
    expect(horizontalPushSign(5, 10)).toBe(-1)
    expect(horizontalPushSign(9, 10)).toBe(-1)
    expect(horizontalPushSign(5, 11)).toBe(1)
    expect(horizontalPushSign(6, 11)).toBe(-1)
  })

  it('upper half of the workload range is offset upwards (+1), lower half downwards (−1); the midpoint counts as lower', () => {
    expect(verticalPushSign(80, 0, 100)).toBe(1)
    expect(verticalPushSign(20, 0, 100)).toBe(-1)
    expect(verticalPushSign(50, 0, 100)).toBe(-1)
    expect(verticalPushSign(51, 0, 100)).toBe(1)
    expect(verticalPushSign(15, 10, 30)).toBe(-1)
    expect(verticalPushSign(25, 10, 30)).toBe(1)
  })
})
