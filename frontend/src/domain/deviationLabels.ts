// Deviation call-outs beside the chart (SPEC §9, §3.6).
import type { IterationState } from '../api/types'
import { S } from '../strings'
import { TOLERANCE_RATIO } from './curve'
import { deviationPercent, type ForecastSeries, lastForecastValue } from './forecast'
import { isLive } from './state'
import { settle } from './stats'

/** §2.3 deviation-label visibility: forecast deviation ≥ 1 %. */
export const FORECAST_LABEL_MIN_PERCENT = 1

/** 'tolerance' = GREEN label; 'forecast' = ORANGE (warm accent) label. */
export type DeviationLabelKind = 'tolerance' | 'forecast'

export interface DeviationLabel {
  kind: DeviationLabelKind
  /** Literal text, taken from `S.toleranceLabel` / `S.forecastLabel(n)` in strings.ts. */
  text: string
  /** The workload value the label is drawn at (tolerance level, or the forecast's last value). */
  value: number
}

export interface DeviationLabelInput {
  committedTotal: number
  state: IterationState
  forecast: ForecastSeries
}

/**
 * §9. committedTotal ≤ 0 → []. Otherwise first the tolerance label
 * { kind: 'tolerance', text: 'Deviation +10 %', value: committedTotal × 0.1 }; then, only if NOT closed
 * (unknown state = live) and the forecast has any value: pct = deviationPercent(forecast, committedTotal);
 * if pct ≥ 1 → { kind: 'forecast', text: `Deviation +${Math.round(pct)} %`, value: lastForecastValue }.
 * Order: tolerance first, forecast second.
 */
export function deviationLabels(input: DeviationLabelInput): DeviationLabel[] {
  const { committedTotal, state, forecast } = input
  if (committedTotal <= 0) return []
  const labels: DeviationLabel[] = [
    { kind: 'tolerance', text: S.toleranceLabel, value: committedTotal * TOLERANCE_RATIO },
  ]
  const last = lastForecastValue(forecast)
  if (isLive(state) && last !== null) {
    const pct = settle(deviationPercent(forecast, committedTotal)!)
    if (pct >= FORECAST_LABEL_MIN_PERCENT) {
      labels.push({ kind: 'forecast', text: S.forecastLabel(Math.round(pct)), value: last })
    }
  }
  return labels
}

/** §9: the gutter beside the plot is reserved only when at least one label exists. */
export function reservesGutter(labels: readonly DeviationLabel[]): boolean {
  return labels.length > 0
}

export interface LabelPlacementInput {
  /** The value each label annotates (same order as the labels). */
  values: number[]
  /** Maps a workload value to a pixel y (y grows downwards; larger value ⇒ smaller y). */
  toPixel: (value: number) => number
  /** Pixel y of the top edge of the plot area. */
  plotTop: number
  /** Pixel y of the bottom edge of the plot area (plotBottom > plotTop). */
  plotBottom: number
  /** Label height in pixels. */
  labelHeight: number
}

/**
 * §9 placement. Returns the pixel y of each label's vertical CENTRE, in INPUT order.
 * 1. y_i = toPixel(values[i]).
 * 2. Order top-to-bottom by y (ascending y; stable — ties keep input order).
 * 3. Walk that order: if y_next − y_prev < labelHeight, set y_next = y_prev + labelHeight (exactly one
 *    label-height below the one above it, using the already-pushed y_prev).
 * 4. Then clamp every label independently into [plotTop + labelHeight/2, plotBottom − labelHeight/2].
 *    (Literal: step 4 runs after step 3 and may re-introduce overlap at the bounds.)
 * Horizontal position is the renderer's job (anchored to the outer edge of the gutter).
 */
export function placeDeviationLabels(input: LabelPlacementInput): number[] {
  const { values, toPixel, plotTop, plotBottom, labelHeight } = input
  const ys = values.map(toPixel)
  // Array#sort is stable, so ties keep input order.
  const topToBottom = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b])
  for (let k = 1; k < topToBottom.length; k++) {
    const above = ys[topToBottom[k - 1]]
    const i = topToBottom[k]
    if (ys[i] - above < labelHeight) ys[i] = above + labelHeight
  }
  const min = plotTop + labelHeight / 2
  const max = plotBottom - labelHeight / 2
  return ys.map((y) => Math.min(max, Math.max(min, y)))
}
