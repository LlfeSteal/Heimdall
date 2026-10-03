// Callout rendering helpers (SPEC §10.5; ledger #11 as changed 2026-10-02). Contract: docs/conformance/final-audit.md
import { describe, expect, it } from 'vitest'
import { annotationLabelSize } from '../domain/annotationGeometry'
import { calloutLeft, calloutLines, widenRangeForCallouts } from './calloutLayout'

describe('calloutLines (§10.5 box = estimate: ≤ 25 chars per line, ≤ 3 lines)', () => {
  it('CL01 short text is drawn as is, one line per text line', () => {
    expect(calloutLines('Scope added\nby PO')).toEqual(['Scope added', 'by PO'])
  })

  it('CL02 a line longer than 25 characters is cut to 25 with an ellipsis', () => {
    const [line] = calloutLines('x'.repeat(400))
    expect(line).toHaveLength(25)
    expect(line.endsWith('…')).toBe(true)
  })

  it('CL03 more than 3 lines: 3 lines, the third ends with an ellipsis', () => {
    expect(calloutLines('a\nb\nc\nd\ne')).toEqual(['a', 'b', 'c…'])
  })

  it('CL04 the drawn lines never exceed the §10.5 estimate (25 chars wide, 3 lines high)', () => {
    for (const text of ['', 'one', 'x'.repeat(80), 'a\nb\nc\nd', `${'y'.repeat(30)}\nz`]) {
      const lines = calloutLines(text)
      const size = annotationLabelSize(text)
      expect(lines.length * 13 + 10).toBe(size.height)
      expect(Math.max(...lines.map((l) => l.length), 1) * 6 + 14).toBeLessThanOrEqual(size.width)
    }
  })
})

describe('widenRangeForCallouts (labels never leave the plot)', () => {
  const H = 300
  const pixel = (r: { min: number; max: number }, v: number) => ((r.max - v) / (r.max - r.min)) * H

  it('CW01 no band ⇒ range unchanged', () => {
    expect(widenRangeForCallouts({ min: 0, max: 50 }, [], H)).toEqual({ min: 0, max: 50 })
  })

  it('CW02 every band (anchor + pixel height) ends up inside [0, H], above and below', () => {
    const bands = [
      { anchor: 70, direction: 1 as const, heightPx: 49 },
      { anchor: 46 + 20, direction: 1 as const, heightPx: 23 },
      { anchor: 10 - 20, direction: -1 as const, heightPx: 36 },
    ]
    const r = widenRangeForCallouts({ min: 0, max: 50 }, bands, H)
    for (const b of bands) {
      const edge = pixel(r, b.anchor)
      if (b.direction === 1) expect(edge - b.heightPx).toBeGreaterThanOrEqual(0)
      else expect(edge + b.heightPx).toBeLessThanOrEqual(H)
    }
    expect(r.min).toBeLessThanOrEqual(0)
    expect(r.max).toBeGreaterThanOrEqual(50)
  })

  it('CW03 fifteen stacked labels on one date still fit (the axis grows, nothing is clipped)', () => {
    const bands = Array.from({ length: 15 }, (_, k) => ({ anchor: 50 + 20 + k * 40, direction: 1 as const, heightPx: 24 }))
    const r = widenRangeForCallouts({ min: 0, max: 50 }, bands, H)
    for (const b of bands) expect(pixel(r, b.anchor) - b.heightPx).toBeGreaterThanOrEqual(0)
  })
})

describe('calloutLeft (§10.5 horizontal push, kept inside the plot)', () => {
  const plot = { left: 40, right: 640 }
  it('CX01 left half pushes rightwards, right half leftwards', () => {
    expect(calloutLeft(200, 100, 1, 20, plot)).toBe(220)
    expect(calloutLeft(500, 100, -1, 20, plot)).toBe(380)
  })
  it('CX02 a box that would cross the plot edge is shifted back inside', () => {
    expect(calloutLeft(600, 160, 1, 20, plot)).toBe(480)
    expect(calloutLeft(60, 160, -1, 20, plot)).toBe(40)
  })
})
