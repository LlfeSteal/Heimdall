// Rendering helpers for the burndown annotation callouts (SPEC §10.5, ledger #11 as changed on 2026-10-02):
// the stacking offsets stay in workload units, but the y axis widens so every label box stays visible.
import { ANNOTATION_LABEL } from '../domain/annotationGeometry'

const ELLIPSIS = '…'

/**
 * The lines drawn in a callout box: the text's own lines, each capped at 25 characters, at most 3 lines (an
 * ellipsis marks anything cut). This keeps the drawn box at the §10.5 estimate (`annotationLabelSize`), which
 * is also what the stacking used, so stacked boxes cannot overlap.
 */
export function calloutLines(text: string): string[] {
  const { MAX_CHARS_PER_LINE, MAX_LINES } = ANNOTATION_LABEL
  const all = text.split('\n')
  const cap = (line: string) =>
    line.length > MAX_CHARS_PER_LINE ? `${line.slice(0, MAX_CHARS_PER_LINE - 1)}${ELLIPSIS}` : line
  const lines = all.slice(0, MAX_LINES).map(cap)
  if (all.length > MAX_LINES) {
    const last = lines[MAX_LINES - 1]
    if (!last.endsWith(ELLIPSIS)) lines[MAX_LINES - 1] = `${last.slice(0, MAX_CHARS_PER_LINE - 1)}${ELLIPSIS}`
  }
  return lines
}

/** One label box seen from the y axis: the workload value its edge sits at, its direction and pixel height. */
export interface CalloutBand {
  /** value ± offset (workload units): the box's edge nearest to its point. */
  anchor: number
  /** +1 = the box extends upwards from the anchor, −1 = downwards. */
  direction: 1 | -1
  /** Drawn box height in pixels. */
  heightPx: number
}

/** Breathing room kept between a box and the plot edge. */
const EDGE_MARGIN_PX = 4

/**
 * Widens [min, max] so every band — anchor plus its pixel height converted to workload units on the final
 * scale — lies inside the plot of `plotHeight` pixels. Fixed-point iteration (the unit/pixel ratio depends on
 * the range it is widening); it converges whenever one box per side is shorter than the plot.
 */
export function widenRangeForCallouts(
  range: { min: number; max: number },
  bands: readonly CalloutBand[],
  plotHeight: number,
): { min: number; max: number } {
  if (bands.length === 0 || plotHeight <= 0) return range
  const up = bands.filter((b) => b.direction === 1)
  const down = bands.filter((b) => b.direction === -1)
  let max = Math.max(range.max, ...up.map((b) => b.anchor))
  let min = Math.min(range.min, ...down.map((b) => b.anchor))
  for (let i = 0; i < 12; i++) {
    const unitsPerPx = Math.max(max - min, 1) / plotHeight
    const nextMax = Math.max(max, ...up.map((b) => b.anchor + (b.heightPx + EDGE_MARGIN_PX) * unitsPerPx))
    const nextMin = Math.min(min, ...down.map((b) => b.anchor - (b.heightPx + EDGE_MARGIN_PX) * unitsPerPx))
    const settled = nextMax - max < 1e-6 && min - nextMin < 1e-6
    max = nextMax
    min = nextMin
    if (settled) break
  }
  return { min, max }
}

/** Gap between a callout's point and the near edge of its box, horizontally (px). */
export const CALLOUT_GAP_PX = 10

/**
 * §10.5 horizontal push, kept inside the plot: a box on the left half starts `pushPx` right of its point, one
 * on the right half ends `pushPx` left of it; then it is shifted back inside [left, right] if it would cross.
 * Returns the pixel x of the box's LEFT edge.
 */
export function calloutLeft(
  pointX: number,
  widthPx: number,
  sign: -1 | 1,
  pushPx: number,
  plot: { left: number; right: number },
): number {
  const left = sign === 1 ? pointX + pushPx : pointX - pushPx - widthPx
  return Math.min(Math.max(left, plot.left), plot.right - widthPx)
}
