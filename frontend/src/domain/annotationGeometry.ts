// Annotation label size and anti-overlap stacking (SPEC §10.5, §15.7, ledger #11/#12).
// Pure geometry: no Chart.js. Offsets are in WORKLOAD units (KNOWN BEHAVIOUR), never clamped.
import type { IsoDate } from './dates'

/** §10.5 constants. */
export const ANNOTATION_LABEL = {
  /** wrap budget used to size the box */
  WIDTH_BUDGET: 150,
  /** font size 10 × 0.6 */
  CHAR_WIDTH: 6,
  MAX_CHARS_PER_LINE: 25,
  MAX_LINES: 3,
  LINE_HEIGHT: 13,
  PADDING_X: 14,
  PADDING_Y: 10,
  MIN_WIDTH: 40,
  MIN_HEIGHT: 20,
  /** vertical step between stacked labels */
  GAP: 20,
  /** radius of the point marker a label must clear */
  MARKER_RADIUS: 5,
} as const

export interface LabelSize {
  width: number
  height: number
}

/**
 * §10.5 estimated size. lines = text.split('\n'); lineCount = min(lines.length, 3);
 * longestLineLen = max(longest line length, 1);
 * width = max(round(min(longestLineLen, 25) × 6 + 14), 40); height = max(round(lineCount × 13 + 10), 20).
 * Width counts the LONGEST line, never the total length. '' → 40 × 23.
 */
export function annotationLabelSize(text: string): LabelSize {
  const { CHAR_WIDTH, MAX_CHARS_PER_LINE, MAX_LINES, LINE_HEIGHT, PADDING_X, PADDING_Y, MIN_WIDTH, MIN_HEIGHT } =
    ANNOTATION_LABEL
  const lines = text.split('\n')
  const lineCount = Math.min(lines.length, MAX_LINES)
  const longestLineLen = Math.max(...lines.map((line) => line.length), 1)
  return {
    width: Math.max(Math.round(Math.min(longestLineLen, MAX_CHARS_PER_LINE) * CHAR_WIDTH + PADDING_X), MIN_WIDTH),
    height: Math.max(Math.round(lineCount * LINE_HEIGHT + PADDING_Y), MIN_HEIGHT),
  }
}

/** §10.5 overlap of vertical bands [a, a+heightA) and [b, b+heightB): a < b+heightB && b < a+heightA. */
export function bandsOverlap(a: number, heightA: number, b: number, heightB: number): boolean {
  return a < b + heightB && b < a + heightA
}

export interface StackItem {
  /** Date of the point the annotation is pinned to. */
  date: IsoDate
  /** The point's value (workload units) — the base of the label's band. */
  value: number
  /** Label height (from `annotationLabelSize`). */
  height: number
}

export interface StackedItem {
  /** Index of this item in the caller's input array. */
  index: number
  date: IsoDate
  /** Upward offset from the point, in workload units (≥ 20). Label band = [value+offset, value+offset+height). */
  offset: number
}

/**
 * §10.5 stacking.
 * 1. Drop items whose date is not on `axis` (they are absent from the result).
 * 2. Process in axis order (ascending axis index; same date → input order), NOT list order.
 * 3. For each item: offset = 0; for every earlier-processed item e, in processing order:
 *      while bandsOverlap(value+offset, height, e.value+e.offset, e.height): offset += 20.
 *    pointOffset = 0; while bandsOverlap(value+pointOffset, height, value−5, 10): pointOffset += 20.
 *    offset = max(offset, pointOffset).
 * 4. Return the kept items in the caller's ORIGINAL order.
 * Nothing clamps the stack (it may climb above the workload range).
 */
export function stackAnnotationLabels(items: StackItem[], axis: IsoDate[]): StackedItem[] {
  const { GAP, MARKER_RADIUS } = ANNOTATION_LABEL
  const axisIndex = new Map<IsoDate, number>()
  axis.forEach((date, i) => {
    if (!axisIndex.has(date)) axisIndex.set(date, i)
  })
  const kept = items
    .map((item, index) => ({ ...item, index, position: axisIndex.get(item.date) }))
    .filter((item): item is typeof item & { position: number } => item.position !== undefined)

  const offsets = new Map<number, number>()
  const placed: { value: number; offset: number; height: number }[] = []
  // Array#sort is stable: same date → input order.
  for (const item of [...kept].sort((a, b) => a.position - b.position)) {
    const { value, height } = item
    let offset = 0
    for (const e of placed) {
      while (bandsOverlap(value + offset, height, e.value + e.offset, e.height)) offset += GAP
    }
    let pointOffset = 0
    while (bandsOverlap(value + pointOffset, height, value - MARKER_RADIUS, 2 * MARKER_RADIUS)) pointOffset += GAP
    offset = Math.max(offset, pointOffset)
    placed.push({ value, offset, height })
    offsets.set(item.index, offset)
  }
  return kept.map(({ index, date }) => ({ index, date, offset: offsets.get(index)! }))
}

/**
 * §10.5 horizontal push direction: −1 = push LEFTWARDS (label on the right half of the axis),
 * +1 = push RIGHTWARDS (left half). Right half ⇔ axisIndex > (axisLength − 1) / 2; the exact centre
 * counts as the left half. The distance (proportional to chart width) is the renderer's concern.
 */
export function horizontalPushSign(axisIndex: number, axisLength: number): -1 | 1 {
  return axisIndex > (axisLength - 1) / 2 ? -1 : 1
}

/**
 * §10.5 vertical callout direction: +1 = offset UPWARDS (value in the upper half of [rangeMin, rangeMax]),
 * −1 = DOWNWARDS (lower half). Upper half ⇔ value > (rangeMin + rangeMax) / 2; the midpoint counts as lower.
 */
export function verticalPushSign(value: number, rangeMin: number, rangeMax: number): -1 | 1 {
  return value > (rangeMin + rangeMax) / 2 ? 1 : -1
}
