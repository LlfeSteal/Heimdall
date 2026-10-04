# Conformance checklist — domain algorithms (`frontend/src/domain/`)

Scope: SPEC §2.3 (register), §6, §7, §8, §9, §10.5, §11.2–11.3, §12, §13 (formatting), §15.3–§15.7, §15.10,
ledger #7–#12/#17, Amendment A.6. Everything here is **pure TypeScript** (no React, no Chart.js).

Tags: **[M]** spec MUST / literal / formula · **[KB]** KNOWN BEHAVIOUR reproduced on purpose ·
**[A]** analyst decision where the spec is silent or ambiguous (see "Ambiguities" at the end). Tests are
referenced as `file › test name`; all test files live beside their module in `frontend/src/domain/`.

Run: `cd frontend && npx vitest run src/domain` and `npx tsc -b --noEmit`.

---

## Builder brief

Every module currently exports documented **stubs** that call `notImplemented()` from `stub.ts`. Replace
each body; keep the signatures and exported constants exactly (tests import them); delete `stub.ts` when no
longer referenced. `testkit.ts` is test-only fixture code — do not import it from production code. Literals
come from `src/strings.ts` (`S`) — never re-type them. Doc comments on each stub are the contract; they
restate the spec formula precisely.

| Module | Exported API |
|---|---|
| `dates.ts` | `type IsoDate`; `todayUtc(now?: Date): IsoDate`; `addDays(date, days): IsoDate`; `daysBetween(from, to): number` — all UTC calendar-day arithmetic |
| `state.ts` | `isClosed(state)`; `isLive(state)` (= `!isClosed`; unknown/null/undefined are live) |
| `stats.ts` | `median(values)` (even → mean of middle two; `[]` → 0; no mutation); `mean(values)` (`[]` → 0) |
| `curve.ts` | `type Value = number \| null`; `interface CurveIteration {state, dueDate, report}`; `withTodayPoint(series, iteration, today)`; `withDueDatePoint(series, iteration)`; `completeSeries(iteration, today)`; `buildAxis(series, dueDate)`; `axisMetrics(axis, series): {firstIndex, totalDays}`; `remainingSeries(series, axis)`; `idealSeries(series, axis)`; `TOLERANCE_RATIO = 0.1`; `committedTotal(report, series)`; `toleranceLevel(committedTotal): number \| null`; `interface BurnupModel {axis, completed, totalScope, scopeProjectedFrom, ideal, forecast, projectedDone, openAtDue, todayIndex}`; `burnup(series, axis, forecastRemaining, todayIndex): BurnupModel` (Amendment B) |
| `forecast.ts` | constants `TREND_WINDOW = 5`, `HISTORY_MAX = 4`, `SHAPE_GRID_POINTS = 21`, `SHAPE_COLLAPSE_EPSILON = 1e-9`; `NOT_USABLE` (unique symbol) + `type NotUsable`; `type ForecastSeries = Value[]`; `ShapePoint {f, y}`, `Shape`; `type History = SeriesPoint[][]`; `dailyDirection(series, window = 5)`; `shapeOf(series): Shape \| null`; `sample(shape, f)`; `canonicalShape(history, maxIterations = 4): Shape \| null`; `shapeForecast(series, history, axis, todayIndex, endIndex, maxIterations = 4): ForecastSeries \| NotUsable`; `historicalRate(series): number \| null`; `velocityForecast(series, history, todayIndex, endIndex, maxIterations = 4): ForecastSeries` (`[]` when invalid); `closedExtension(series, axis)`; `type ForecastStrategy = 'closed-extension' \| 'shape' \| 'velocity' \| 'none'`; `selectForecast({state, series, axis, history, today}): {strategy, values}`; `lastForecastValue(f)`; `deviationPercent(f, committedTotal): number \| null`; `forecastHistory(iterations, selected, max = 4)`; `historySeries(iterations): History` |
| `deviationLabels.ts` | `FORECAST_LABEL_MIN_PERCENT = 1`; `DeviationLabel {kind: 'tolerance' \| 'forecast', text, value}`; `deviationLabels({committedTotal, state, forecast})`; `reservesGutter(labels)`; `placeDeviationLabels({values, toPixel, plotTop, plotBottom, labelHeight}): number[]` (label-centre pixel y, input order) |
| `annotationGeometry.ts` | `ANNOTATION_LABEL` constants; `annotationLabelSize(text): {width, height}`; `bandsOverlap(a, hA, b, hB)`; `StackItem {date, value, height}`; `StackedItem {index, date, offset}`; `stackAnnotationLabels(items, axis): StackedItem[]`; `horizontalPushSign(axisIndex, axisLength): -1 \| 1` (−1 = leftwards); `verticalPushSign(value, min, max): -1 \| 1` (+1 = upwards) |
| `predictability.ts` | `PREDICTABILITY_WINDOW = 4`; `COMPLIANT_THRESHOLD = 0.1`; `NO_SCORE` (unique symbol) + `type NoScore`; `PredictabilityScore {averageDeviation (fraction), averageDifference, medianVelocity, compliantShare (percent), analysedCount}`; `closedForScore(iterations, max = 4)`; `predictability(closed): PredictabilityScore \| NoScore`; `presentScore(score): ScorePresentation` (texts, tones, caption, analysed) |
| `metrics.ts` | `deliveryMetrics(report): {committed, delivered, deviation (percent), difference}`; `iterationMetrics(iteration, today): {…, vsIdeal}` (open → vs the burndown Ideal on today; closed → `deliveryMetrics`); `presentMetrics(m): {deviationText, deviationTone, diffText, diffTone}`; `deliverySummary(report): {completedPercent, inProgressPercent, completedShare, inProgressShare, completedOf, inProgressOf}` |
| `format.ts` | `oneDecimal`; `signedOneDecimal`; `formatPoints`; `formatSignedPoints`; `formatPercentOneDecimal` ("8.8 %"); `formatWholePercent` ("50 %"); `formatShare` ("67%"); `formatDateRange(start, due)` (delegates to `S.dateRange`) |
| `colorScale.ts` | `type Tone = 'good' \| 'caution' \| 'poor'`; `deviationTone(percent)`; `differenceTone(points)`; `compliantTone(percent)` |
| `model.ts` | `BurndownModel {series, axis, live, todayIndex, remaining, ideal, forecast, forecastStrategy, committedTotal, tolerance, labels, reserveGutter}`; `buildBurndownModel({iteration, iterations, today})`; `buildBurnupModel({iteration, iterations, today}): BurnupModel` (Amendment B) |

**Wiring the UI should use:** `today = todayUtc()` once per render; `buildBurndownModel` / `buildBurnupModel`
for the chart; `closedForScore(list)` → if `[]` render `S.scoreNone` without any read, else
`predictability(...)` → `presentScore`; `deliveryMetrics` → `presentMetrics`; `deliverySummary`.
The model sorts a **copy** of the repaired series by date before forecasting and computing `committedTotal`
(the today point is appended at the end, §7.2), but returns the repaired series itself in `series`.

Implementation hints that the tests force:
- Ideal line: use `firstRemaining × (1 − (pos − firstIndex) / totalDays)` (or force the last value) — the
  literal `r − (r / n) × k` leaves `3.55e-15` at the end for e.g. r = 30, n = 11 and the spec says *exactly* 0.
- Avoid `-0` in floored outputs (`Math.max(0, x)` is fine; tests check `Object.is(v, -0)` in places).
- `shapeForecast` checks `today.remaining ≤ 0` **before** looking at history (zeros even with no history).
- `velocityForecast` reads today **by position** (`series[todayIndex]`), `shapeForecast` **by date**.

---

## Checklist

### §7.2 Completeness repairs (§15.10)

| # | Rule | Tag | Test |
|---|---|---|---|
| D-1 | "Today" is the current calendar day in **UTC**, injectable | [M] §7.2, ledger #9 | `dates › todayUtc returns the UTC calendar day, not the local one`; `… defaults to the current instant` |
| D-2 | Live (not closed, unknown = live) + report + no point dated today → append point `{today, committed total, delivered total, remaining = inProgress total}` | [M] §7.2 | `curve › §15.10: a live iteration with no point for today gains one…`; `an unknown state counts as live`; `an empty live series with a report gains the today point` |
| D-3 | Today point placed at the END of the series (axis sort places it) | [M] §7.2 | `curve › the today point is appended at the END, not sorted into place` |
| D-4 | Live repair is a no-op when today's point exists, no report, or closed — returns the same reference | [M]/[A] identity | `curve › point for today already present → unchanged (same reference)`; `no report → unchanged; closed → unchanged` |
| D-5 | Closed: append due-date point with report totals when last point < due | [M] §7.2, §15.10 | `curve › §15.10: points on the 6th and 23rd, due the 24th → gains a third point…` |
| D-6 | Closed: no points / no due date / no report / last ≥ due → **original series, same reference** | [M] §7.2, §15.10 | `curve › §15.10: a closed iteration already reaching its due date is returned unchanged`; `last point after the due date…`; `no points / no due date / no report…`; `does nothing for a live iteration` |
| D-7 | Repairs are additive only; input never mutated | [M] §7.2 | `curve › §15.10: points on the 6th…` (input length), `§15.10: a live iteration…` |
| D-8 | `completeSeries` dispatches by state and preserves identity | [M] | `curve › §7.2 completeSeries` (4 tests); `model › returns the report series itself when no repair applies` |

### §7.3 Axis

| # | Rule | Tag | Test |
|---|---|---|---|
| D-9 | Axis = distinct series dates, sorted ascending (ISO text order) | [M] | `curve › sorts ascending and keeps each date once` |
| D-10 | Trailing fill: walk from the last known point one calendar day at a time up to and including the due date | [M] | `curve › fills only the trailing gap…`; `walks calendar days across a month end` |
| D-11 | Interior holes and the leading hole are NOT filled | [M] | `curve › fills only the trailing gap…` (03-04 absent); `leaves a hole at the start of the iteration alone` |
| D-12 | Weekends/holidays are ordinary axis days | [M] | `curve › fills only the trailing gap… weekends are on the axis` |
| D-13 | Due date is always present (even before the last point) | [M] | `curve › makes sure the due date is present even when it falls before the last point`; `a live "today" point appended after the due date…` |
| D-14 | `firstIndex` = first axis position with a point; `totalDays = max(last − firstIndex, 1)` | [M] | `curve › §7.3 firstIndex / totalDays` (3 tests) |
| D-15 | Calendar arithmetic is UTC and DST-proof | [A] ledger #10 | `dates › addDays walks calendar days across month ends and DST changes`; `daysBetween…` |

### §7.4 Burndown series

| # | Rule | Tag | Test |
|---|---|---|---|
| D-16 | Remaining = point's remaining at that date; `null` where no point (gap breaks the line, not interpolated) | [M] | `curve › value where there is a point, null where there is none` |
| D-17 | Remaining never clamped — negatives preserved | [M] §7.1, [KB] ledger #7 | `curve › negative remaining is preserved, never clamped` |
| D-18 | Ideal = null before firstIndex; `max(0, r − (r/totalDays)(pos − firstIndex))` | [M] | `curve › descends linearly…`; `is null before firstIndex`; `depends only on the first point`; `is never negative` |
| D-19 | Ideal reaches **exactly** 0 on the last axis position | [M] | `curve › reaches EXACTLY 0 at the last position…` |

### §7.5 Tolerance

| # | Rule | Tag | Test |
|---|---|---|---|
| D-20 | committedTotal = report committed weight, else first point's committed, else 0 | [M] | `curve › committedTotal = report committed workload…`; `a report with committed 0 still wins…`; `falls back to the first point's…` |
| D-21 | tolerance = committedTotal × 10 % | [M] §2.3 | `curve › tolerance = committedTotal × 10 %` |
| D-22 | committedTotal ≤ 0 → no line (and no labels, D-45) | [M] | `curve › no committed workload → no tolerance line`; `model › no committed workload → …` |

### Amendment B Burnup (replaces §7.6 and ledger #8; GitLab / Jira burnup)

| # | Rule | Tag | Test |
|---|---|---|---|
| D-23 | Axis = the burndown axis (first point → due date) | [M] | `curve › axis = the burndown axis…`; `model › shares the burndown axis and forecast…` |
| D-24 | Completed = delivered at the date, null where no point | [M] | `curve › completed = delivered per date…` |
| D-25 | Total scope = committed per date; last scope carried forward after the last point; `scopeProjectedFrom` = last point | [M] | `curve › completed = delivered per date; total scope = committed per date…` |
| D-26 | Ideal (guideline) rises 0 → first committed, exact on the due date; null when the span is 0 | [M] | `curve › ideal (guideline) rises…`; `a zero span → ideal null everywhere` |
| D-27 | Forecast = Completed[anchor] + open × (1 − max(0,R[i]) / R[anchor]), flat when R[anchor] ≤ 0; joins Completed, never falls, meets Total at R = 0 | [M] | `curve › forecast starts ON today's Completed point…`; `repaired point whose remaining…`; `a negative remaining at the anchor…`; `nulls in the forecast…`; `closed iteration…`; `no forecast…` |
| D-28 | projectedDone = first R ≤ 0 after the anchor (none if already done); openAtDue = Total − Forecast on the due date, only when the axis ends on it | [M] | `curve › projected completion…`; `never completing…`; `already done at the anchor…`; `open work is only reported ON the due date…`; `burnupReading › caption: nothing without a due date` |
| D-29 | Burnup uses the burndown pipeline (repaired series, axis, forecast) | [M] | `model › shares the burndown axis and forecast…` |
| D-29b | Caption and tooltip progress lines | [M] | `burnupReading › …` |

### §8 Forecasting

| # | Rule | Tag | Test |
|---|---|---|---|
| D-30 | dailyDirection: last ≤ 5 points; < 2 → 0; mean point-to-point change; `min(0, …)` — rising = flat | [M] §8.2 | `forecast › §8.2 dailyDirection` (6 tests) |
| D-31 | shapeOf: drop committed = 0; < 2 kept → no shape; start/end from unfiltered first/last; end ≤ start → no shape; f clamped; y = max(0, remaining/that day's committed); sorted by f | [M] §8.3 | `forecast › §8.3 shapeOf` (6 tests) |
| D-32 | sample: empty 0; flat beyond ends; linear between; zero-width segment no slope | [M] §8.3 | `forecast › §8.3 sample` (3 tests) |
| D-33 | canonicalShape: first ≤ 4 history entries (slice before filter); none usable → no shape; 21-point grid; MEDIAN; running minimum floored at 0 | [M] §8.3 | `forecast › §8.3 canonicalShape` (7 tests) |
| D-34 | shapeForecast returns a **distinct NOT_USABLE** for: invalid todayIndex, todayIndex ≥ endIndex, no axis entry, no point dated axis[today], no shape, end ≤ start, shapeToday ≤ 1e-9 | [M] §8.1, §8.3 | `forecast › declines for an invalid todayIndex`; `declines when no point is dated…`; `declines when the canonical shape had already collapsed…`; `declines when end ≤ start`; `§15.5: no history at all → declines…` |
| D-35 | §15.5 values: 50 → day 8 ≈ 30, due ≈ 0; 40 → day 8 ≈ 24; 0 → all zeros | [M] §15.5 | `forecast › §15.5: today 50…`; `§15.5: today 40…`; `§15.5: today 0…` |
| D-36 | Five §8.3 guarantees: exact through today; non-increasing; within [0, today]; scales ×2; finished → zeros | [M] §8.3 | `forecast › §8.3 guarantees (property-style…)` (6 tests) |
| D-37 | velocityForecast: invalid todayIndex / ≥ endIndex → **`[]`** (distinct from NOT_USABLE); today absent → all-null array | [M] §8.1, §8.4 | `forecast › returns an EMPTY array (distinct from NOT_USABLE)…`; `today = series[todayIndex] by POSITION…` |
| D-38 | Rates: first ≤ 4 history, `max(0, Δdelivered/(n−1))`, keep strictly positive; ownRate blended as one more sample; median | [M] §8.4 | `forecast › §15.4: history 10/day…`; `idle (zero-rate) history iterations are discarded…`; `uses only the first 4…`; `history iterations with fewer than 2 points…`; `historicalRate` |
| D-39 | §15.4: 22.5, 15, 7.5; slow team above zero at due date; never negative | [M] §15.4 | `forecast › §15.4: …` (3 tests) |
| D-40 | velocity 0 → `max(0, prev + trend)` (flat when no history and no burn) | [M] §8.4 | `forecast › no history and a flat or rising curve…` |
| D-41 | Closed: straight-line extension from the last point at dailyDirection, calendar days, floored at 0; no history | [M] §8.1 | `forecast › §8.1 closed-iteration straight-line extension` (5 tests); `closed → straight-line extension, never history` |
| D-42 | Strategy order: closed → extension; live & today on axis → shape, NOT_USABLE → velocity; else none | [M] §8.1 | `forecast › §8.1 strategy selection` (7 tests); `model › live iteration without usable history → velocity fallback` |
| D-43 | deviationPercent = last valued position / committedTotal × 100; committedTotal ≤ 0 → 0 | [M] §8.5 | `forecast › lastForecastValue…`; `deviationPercent = …` |
| D-44 | Forecast history: last 4 **closed** iterations that **start before** the selected one, newest-first list; selected never in its own history; raw series | [M] §6 | `forecast › §6 forecast history selection` (6 tests) |

### §9 Deviation labels (§15.6)

| # | Rule | Tag | Test |
|---|---|---|---|
| D-45 | committedTotal ≤ 0 → no labels | [M] | `deviationLabels › §15.6: committed workload 0 → no labels at all` |
| D-46 | Green `Deviation +10 %` at the tolerance level, unconditional once committed > 0 (also closed) | [M] §3.6, §9 | `deviationLabels › §15.6: committed 100…`; `the green label is always at the tolerance level` |
| D-47 | Orange `Deviation +{round(pct)} %` at the forecast's last value, only if live (unknown = live), forecast has a value, pct ≥ 1 (unrounded, inclusive) | [M] §9, ledger #17 | `deviationLabels › §15.6: …` (4 tests); `an unknown state counts as live`; `a forecast with no value → green only`; `the 1 % floor is inclusive…`; `orange text is the whole-number rounded percentage…` |
| D-48 | Gutter reserved only when ≥ 1 label | [M] | `deviationLabels › is reserved only when at least one label exists` |
| D-49 | Placement: y = toPixel(value); ordered top→bottom; push the lower one to exactly one label-height; then clamp into the plot | [M] §9 | `deviationLabels › §9 placement` (7 tests) |

### §10.5 Annotation geometry (§15.7)

| # | Rule | Tag | Test |
|---|---|---|---|
| D-50 | Constants 150 / 6 / 25 / 3 lines / 13 / 14 / 10 / min 40 × 20 / gap 20 / marker radius 5 | [M] | `annotationGeometry › match the spec` |
| D-51 | Size formulas; '' → 40 × 23; heights 23/36/49/49; 400 chars → 164; longest line, not total | [M] §15.7 | `annotationGeometry › §10.5 / §15.7 label size` (6 tests) |
| D-52 | Half-open band overlap test | [M] | `annotationGeometry › [a, a+hA) and [b, b+hB) overlap iff…` |
| D-53 | Drop off-axis dates; stack in axis order; return in input order | [M] | `annotationGeometry › annotations dated outside the axis…`; `stacks in AXIS order, returns in INPUT order…` |
| D-54 | Single label lifted by 20 (marker radius 5) | [M] §15.7 | `annotationGeometry › even a single label is lifted by one gap (20)…`; `a tall label is lifted by the same 20` |
| D-55 | 15 same-day labels never overlap; stack climbs above the range — unclamped, workload units | [M] §15.7, [KB] ledger #11 | `annotationGeometry › §15.7: fifteen annotations on one date never overlap…` |
| D-56 | Later date stacks ≥ earlier date | [M] | `annotationGeometry › stacks in AXIS order… a later date stacks at least as high…` |
| D-57 | offset = max(from earlier labels, from own marker), steps of 20 | [M] | `annotationGeometry › offset = max(…)`; `same date: input order breaks the tie`; `every offset is a multiple of the 20-unit gap`; `labels far apart vertically do not interact` |
| D-58 | Horizontal push: right half → left, left half → right | [M] §10.5, [A] centre | `annotationGeometry › right half of the axis is pushed leftwards…` |
| D-59 | Vertical: upper half → up, lower half → down | [M] §10.5, [A] midpoint | `annotationGeometry › upper half of the workload range…` |

### §11 Predictability (§15.3)

| # | Rule | Tag | Test |
|---|---|---|---|
| D-60 | Closed = state `closed` from the newest-first list, first 4 | [M] §11.2 | `predictability › takes the closed iterations from the newest-first list…` |
| D-61 | No closed → `[]` (caller issues no read) and NO_SCORE | [M] §11.2, §15.3 | `predictability › no closed iteration → closedForScore is empty…` |
| D-62 | Skip no-report / committed ≤ 0 (no back-fill); nothing recorded → NO_SCORE, distinct from zero | [M] | `predictability › skips iterations without a report…`; `nothing recordable → NO_SCORE…` |
| D-63 | §15.3 numbers: 0.0875 / 2.5 / 32 / 50 / 4 | [M] §15.3 | `predictability › numbers to the decimal` |
| D-64 | §15.3 display: `8.8 %` good, `+2.5 pts` caution, `50 %` caution, `32.0 pts` (A.6) | [M] §15.3 + A.6 | `predictability › presentation: 8.8 % good…` |
| D-65 | 5th (older) 200-pt outlier excluded: count 4, median 32 | [M] §15.3 | `predictability › a fifth, 200-point outlier…` |
| D-66 | Exactly 10 % not compliant (strict `< 0.10` on the fraction) | [M] §2.3, §11.2 | `predictability › exactly 10 % is NOT compliant` |
| D-67 | Signed difference; caption Under-delivered when ≥ 0, Over-delivered when < 0 | [M] §11.2 | `predictability › difference keeps its sign…`; `a zero difference is captioned Under-delivered…` |
| D-68 | Median velocity = median of DELIVERED | [M] | `predictability › median velocity is the median of DELIVERED…`; `stats › median…` |
| D-69 | Uses report totals only; `{n} sprint` / `{n} sprints analyzed` | [M] | `predictability › uses the report totals (weights)…`; `one analysed sprint is labelled in the singular`; `presentation…` |

### §2.3 / A.6 colours, §12 metrics, §13 formatting

| # | Rule | Tag | Test |
|---|---|---|---|
| D-70 | Deviation % ≤ 10 good · ≤ 20 caution · else poor | [M] A.6 | `colorScale › average deviation…`; `predictability › tones follow §2.3 / A.6 at the boundaries` |
| D-71 | \|difference\| ≤ 2 good · ≤ 5 caution · else poor | [M] A.6 | `colorScale › delivery difference…` |
| D-72 | Compliant % ≥ 70 good · ≥ 50 caution · else poor | [M] A.6 | `colorScale › compliant share…` |
| D-73 | Median velocity never colour-coded | [M] §11.3 | `predictability › presentation…` (`medianVelocity` has no tone) |
| D-74 | §12 strip: deviation = committed > 0 ? \|c−d\|/c × 100 : 0; difference = c − d; `Deviation: {x.x}%`, `Diff: {±x.x} pts`; tones | [M] §12 | `metrics › §12 delivery metrics strip` (3 tests) |
| D-74b | §12 open iteration: difference = remaining today − burndown ideal today, deviation = \|diff\|/committed; closed → final totals; `vsIdeal` flag | [M] §12 | `metrics › §12 open iterations are measured against the burndown Ideal on today` (5 tests) |
| D-75 | §3.2 summary: % of committed (0 when committed 0), whole-number rounded, one-decimal `… of …` | [M] §3.2, §13 | `metrics › §3.2 delivery summary strip` (3 tests) |
| D-76 | Points one decimal; difference with `+` when ≥ 0; deviation one decimal %; compliant whole %; dates `start → due` | [M] §13 | `format › §13 number formatting` (6 tests) |

### Integration

| # | Rule | Tag | Test |
|---|---|---|---|
| D-77 | Full burndown pipeline (repairs → axis → series → history → forecast → labels → gutter) | [M] §7–§9 | `model › burndown model wiring (§7–§9)` (5 tests) |

---

## Ambiguities and the resolutions pinned by the tests

1. **Ideal line "exactly 0"** (§7.4): the literal float expression leaves ~3.5e-15 for some inputs. Pinned exact 0; builder uses the algebraically equal form (D-19).
2. **"Last known point"** for the trailing fill (§7.3): pinned as the *latest date* in the series (same as the array's last element for real, sorted GitLab data plus an appended today point). For the closed repair (§7.2) the literal *array last* point is used.
3. **Live repair identity** (§7.2 only requires identity for the closed repair): pinned for the live repair too — harmless, and lets callers use one rule.
4. **Ledger #10** (mixed local/UTC axis days): not reproduced; all calendar arithmetic is UTC (D-15). Reproducing a time-zone-dependent off-by-one is untestable and non-deterministic.
5. **History series are raw** (no §7.2 repair applied to past iterations). Applying the due-date repair would change `end` in `shapeOf` and therefore every fraction — different numbers.
6. **History slots** (§6 / §8.3): a closed, earlier iteration without a report still takes one of the 4 slots (selection is by state and start date only; usability filtering happens after the slice).
7. **History rate with < 2 points** (§8.4 divides by n − 1): returns no rate (discarded), not NaN/Infinity.
8. **`median([])` = 0** — makes §8.4 with no rates fall into the trend branch, matching "with no history … extended at the current daily direction".
9. **Closed straight-line extension** (§8.1): the result includes the last point's own value at its index, nulls before it, and is computed in calendar days via `daysBetween`. With the due-date repair the last point usually *is* the last axis position, so the extension is usually a single value.
10. *(Obsolete — Amendment B replaced §7.6; the burnup uses the burndown axis.)*
11. **Deviation-label placement**: positions are label *centres*; ties keep input order (green above orange); clamping happens after the push-down and **can re-create overlap at a bound** (literal order of §9). An alternative "clamp then re-stack upwards" reading gives different pixels.
12. **Annotation push direction at the exact centre / midpoint**: centre index counts as the left half (pushed right); midpoint value counts as the lower half (offset down).
13. **Annotation stacking**: single pass over earlier labels in processing order, bands based on the point value + offset (workload units); off-axis items are *absent* from the output (output carries `index` back to the input).
14. **Percent spacing**: score panel uses `8.8 %` / `50 %` (from §15.3 "shown `8.8 %`"); the §12 strip uses `Deviation: 10.0%` (literal `{…}%`); the summary strip share uses `90%` (unspecified; follows the neighbouring §12 strip). Two readings give different strings.
15. **Summary `… of …`**: no `pts` suffix (`45.0 of 50.0`) — "in points" read as the unit of the numbers, not a suffix.
16. **Negative zero**: `signedOneDecimal(-0)` → `+0.0`. A small negative such as −0.04 would render `-0.0` (literal rule); not pinned.
17. **Float edge at 10 %**: an *average* deviation that is mathematically 10 % can compute to 10.000000000000002 % (e.g. mean of three 0.1s) and would be coloured caution. Not pinned; the §15.3 vector and single-iteration boundaries compute exactly.
18. **Colour boundaries** follow A.6 (inclusive `≤ 10`, `≤ 20`, `≥ 70`, `≥ 50`); §15.3's colour words are errata.

---

## Conformance check (round 1)

Checker: independent re-derivation of SPEC §2.3, §6, §7, §8, §9, §10.5, §11, §12, §13, §15.3–15.7, §15.10,
§16 (#7–12, #17, #19, #21), A.6 against `frontend/src/domain/*.ts` (non-test). Evidence = `file:line`
(all under `frontend/src/domain/`). "Probe" = ad-hoc script run against the real modules from the scratchpad
(not in the repo); "mutant" = scratch copy of `src/` with one rule altered, domain tests re-run.

Commands: `npx vitest run src/domain` → **12 files, 199 tests passed**. `npx tsc -b --noEmit` → **FAILS, exit 2**:
`src/domain/testkit.ts(47,3): TS2741 Property 'reportError' is missing … required in type 'IterationReport'`.

### Rule-by-rule

| Item | Spec § | Verdict | Evidence | Note |
|---|---|---|---|---|
| Today = UTC calendar day, injectable | §7.2, #9 | MATCH | dates.ts:17-19 | `toISOString().slice(0,10)` |
| Calendar-day arithmetic (UTC) | §7.3, #10 | AMBIGUOUS (accepted) | dates.ts:22-29 | Ledger #10 (mixed local/UTC) deliberately NOT reproduced; recorded as resolution #4 — allowed by §16 "change it deliberately and record the change". |
| Unknown / null state = live | §9, #17 | MATCH | state.ts:7-14 | |
| Live repair: not closed ∧ report ∧ no point today → append {today, committed, delivered, remaining = inProgress} at END | §7.2 | MATCH | curve.ts:57-61, 21-28 | Mutant "remaining = c−d" killed. |
| Live repair identity when nothing added | §7.2 (res. #3) | MATCH (extension) | curve.ts:59 | Spec only demands identity for the closed repair; harmless. |
| Closed repair: no points / no due / no report → unchanged | §7.2 | MATCH | curve.ts:71 | |
| Closed repair: last point ≥ due → unchanged, **same reference** | §7.2, §15.10 | MATCH | curve.ts:72 | Uses array-last point (literal). Probe: `=== s2` true; `completeSeries(...) === report.series` true. Mutant `[...series]` killed. |
| Closed repair appends due-date point with report totals | §7.2, §15.10 | MATCH | curve.ts:73 | Probe §15.10: 6th, 23rd → + 24th {12, 9, 3}. |
| Additive only, input not mutated | §7.2 | MATCH | curve.ts:60, 73 | spread copies |
| `completeSeries` dispatch | §7.2 | MATCH | curve.ts:81-84 | |
| Axis = every series date | §7.3 | MATCH | curve.ts:98 | |
| Trailing fill from LAST known point to due (inclusive), due date present | §7.3 | MATCH | curve.ts:99-104 | "Last" = latest date (res. #2); identical to array-last for real data + appended today point. Mutant "fill from first point" killed. Probe: 03-03, 03-05, due 03-08 → no 03-04, trailing 06–08 filled. |
| Leading / interior holes not filled; weekends ordinary | §7.3 | MATCH | curve.ts:97-106 | |
| Sort ascending as text | §7.3 | MATCH | curve.ts:105 | |
| firstIndex, totalDays = max(last − firstIndex, 1) | §7.3 | MATCH | curve.ts:116-120 | |
| Remaining: value or null (gap breaks), never clamped | §7.4, §7.1, #7 | MATCH | curve.ts:131-134 | |
| Ideal: null before firstIndex; max(0, r − r/n·k); exactly 0 at end | §7.4 | MATCH | curve.ts:143-151 | Algebraically equal `r(1 − k/n)` (res. #1). Probe r=30,n=11 → last 0. Mutant "literal formula" killed (3.55e-15). |
| committedTotal = report committed, else first point committed, else 0 | §7.5 | MATCH | curve.ts:164-167; model.ts:68 | Model passes date-sorted copy so "first" = chronological first. |
| tolerance = committed × 10 %; ≤ 0 → no line | §7.5, §2.3 | MATCH | curve.ts:158, 170-172 | |
| Burnup (all series) | Amendment B | REPLACED | curve.ts `burnup` | The §7.6 audit rows no longer apply; see the Amendment B table above. |
| dailyDirection: last ≤5, <2 → 0, Σ changes ÷ (count−1), min(0, …) | §8.2 | MATCH | forecast.ts:48-54 | Mutant "no clamp" killed. |
| shapeOf: filter committed ≠ 0; <2 → none | §8.3 | MATCH | forecast.ts:63-64 | |
| shapeOf: start/end from UNFILTERED first/last; end ≤ start → none | §8.3 | MATCH | forecast.ts:65-67 | Probe: first point committed 0 at 03-01 still sets start → f = 0.5 for 03-03. Mutant "filtered start" killed. |
| shapeOf: f clamped, y = max(0, remaining / THAT day's committed), sort by f | §8.3 | MATCH | forecast.ts:68-70 | Mutants "divide by first committed", "no y floor" killed. |
| sample: empty 0; flat beyond ends; linear; zero-width no slope | §8.3 | MATCH | forecast.ts:78-93 | Bracket chosen so b.f > a.f strictly. Interior duplicate-f (only with duplicate dates) returns the later point's y — spec silent, unreachable for real data. |
| canonicalShape: first ≤4 THEN shape & keep usable | §8.3, §6 | MATCH | forecast.ts:102-106 | Probe: `[[],[],[],[],usable]` → null. Mutant "filter before slice" killed. |
| canonicalShape: 21-point grid, MEDIAN per point | §8.3, §2.3 | MATCH | forecast.ts:108-110 | Mutant "mean" killed. |
| canonicalShape: single forward running-min sweep, floored at 0 | §8.3 | MATCH | forecast.ts:107-111 | Probe 10→8→2 shape: 1, .92 … .2 then flat .2 (never rises). Mutant "no running min" killed; "no floor" equivalent (y ≥ 0 already). |
| shapeForecast: invalid / today ≥ end / no axis entry → NOT_USABLE | §8.3 | MATCH | forecast.ts:134 | |
| shapeForecast: today looked up BY DATE; absent → NOT_USABLE | §8.3 | MATCH | forecast.ts:135-136 | |
| shapeForecast: result length end+1, result[today] = today.remaining | §8.3 | MATCH | forecast.ts:138-139 | See "live anchors" ambiguity below. |
| shapeForecast: remaining ≤ 0 → zeros after today, BEFORE history | §8.3 | MATCH | forecast.ts:140 | Mutant "after history" killed. |
| shapeForecast: no shape → NOT_USABLE; start = series first; end = axis[end]; end ≤ start → NOT_USABLE | §8.3 | MATCH | forecast.ts:142-148 | |
| shapeForecast: shapeToday ≤ 1e-9 → NOT_USABLE | §8.3 | MATCH (code) / test gap | forecast.ts:18, 151-152 | Mutant `shapeToday <= 0` **SURVIVES** — see MISSING T-1. |
| shapeForecast: clamp(today × s(f)/shapeToday, 0, today.remaining) | §8.3 | MATCH | forecast.ts:153-155 | Mutant "no upper clamp" killed. |
| velocityForecast: invalid / today ≥ end → EMPTY `[]` (≠ NOT_USABLE) | §8.1, §8.4 | MATCH | forecast.ts:190 | Mutant "null array" killed. |
| velocityForecast: today = series[todayIndex] (by position), absent → unchanged array | §8.4 | MATCH | forecast.ts:191-194 | Mutant "by last point" killed. |
| Rates: first ≤4 history, max(0, Δdelivered/(n−1)), strictly positive kept | §8.4 | MATCH | forecast.ts:164-169, 196-199 | n<2 → null (NaN in the literal formula is also discarded, same outcome). Mutant "keep zeros" killed. |
| ownRate = max(0, −dailyDirection); appended if > 0; MEDIAN | §8.4 | MATCH | forecast.ts:200-203 | Mutant "no blend" killed. |
| Loop: skip if previous has no value; velocity > 0 → max(0, r − v·k) else max(0, prev + trend) | §8.4 | MATCH | forecast.ts:205-210 | Skip rule present (line 207); it is never triggerable (result[today] always set) — mutant equivalent. |
| Closed: straight-line extension of last direction, calendar days, no history | §8.1 | MATCH | forecast.ts:221-232, 259 | Mutant "continuation not floored" killed. |
| Closed: "floored at zero" at the extension's FIRST position | §8.1, §2.3 ("a forecast never goes negative"), §15.4 | **MISMATCH** | forecast.ts:229 | Probe: last remaining −2 → `[null, -2, 0]`. See X-1. |
| Strategy order: closed → ext; live ∧ today on axis → shape, NOT_USABLE → velocity; else none | §8.1 | MATCH | forecast.ts:257-266 | Probe §15.5 no history → strategy `velocity`. |
| lastForecastValue / deviationPercent (≤ 0 → 0) | §8.5 | MATCH | forecast.ts:269-285 | |
| History: last 4 closed that START BEFORE the selected one | §6 | MATCH | forecast.ts:293-305 | Strict `startDate < selected.startDate` filter, then first 4 of the newest-first list. Probe: closed iteration newer than selected and closed iteration with the SAME start both excluded. Mutants "ignore startDate", "≤" killed. Relies on caller's newest-first order (backend sorts: backend/internal/gitlab/http.go:192-196). |
| Selected never in its own history | §6 | MATCH | forecast.ts:302 | Id check redundant with strict start filter (mutant equivalent). |
| History series raw (no repair) | §6/§8 (res. #5) | MATCH | forecast.ts:308-310 | Spec never asks for history repair. |
| No committed → no labels | §9, §7.5 | MATCH | deviationLabels.ts:37 | |
| Green label at tolerance, unconditional | §9 | MATCH | deviationLabels.ts:38-40 | |
| Orange only live, forecast has value, pct ≥ 1, text round(pct) | §9, #17 | MATCH (literal) | deviationLabels.ts:41-46 | But see X-2 (float noise at exactly 1 %). |
| Gutter only when ≥ 1 label | §9 | MATCH | deviationLabels.ts:52-54 | |
| Placement: map, order top→bottom, push lower to exactly one height, then clamp | §9 | MATCH | deviationLabels.ts:79-92 | Literal order (res. #11). |
| Label size formulas & constants | §10.5, §15.7 | MATCH | annotationGeometry.ts:6-45 | |
| Band overlap test half-open | §10.5 | MATCH | annotationGeometry.ts:48-50 | |
| Drop off-axis; axis order; return input order | §10.5 | MATCH | annotationGeometry.ts:86-93, 105 | Probe: [B, X, A] → X dropped, A stacked first (20), B on top (60), returned B, A. Mutant "input order" killed. |
| Per-earlier-label while loop; pointOffset loop on marker band ±5; offset = max | §10.5 | MATCH | annotationGeometry.ts:95-101 | Mutant "pointOffset ignored" killed. |
| Unclamped, workload units | §10.5, #11 | MATCH | annotationGeometry.ts:65, 78 | Probe: 15 labels top at 653 for value 50. |
| Uniform horizontal push; vertical half rule | §10.5, #12 | MATCH | annotationGeometry.ts:113-123 | Centre/midpoint tie (res. #12) reasonable. |
| Guarantee "later date stacks at least as high as earlier" | §10.5 | AMBIGUOUS | annotationGeometry.ts:93-101 | Holds only when labels interact. Probe: A,A at value 10 (offsets 20, 60), B at value 500 → offset 20. The pseudo-code (followed literally) cannot guarantee it universally; spec text over-states it. |
| closedForScore: closed, newest-first, FIRST 4 | §11.2 | MATCH | predictability.ts:35-37 | Mutant "last 4" killed. |
| Skip no report / committed ≤ 0 (no back-fill) | §11.2 | MATCH | predictability.ts:47-48 | |
| Signed difference; unsigned deviation fraction | §11.2 | MATCH | predictability.ts:49-52 | Mutant "abs diff" killed. |
| Compliant STRICTLY < 0.10 | §11.2, §2.3 | MATCH (judgement) | predictability.ts:56 | Compared after 9-decimal rounding; preserves "exactly 10 % not compliant" against float noise. Comment cites "ambiguity #13" — should be #17. |
| Mean / mean / MEDIAN of delivered / share / count | §11.2 | MATCH | predictability.ts:57-63 | Mutant "median of committed" killed. |
| No closed → `[]` (no read); nothing recorded → NO_SCORE (distinct) | §11.2 | MATCH | predictability.ts:14, 36, 54 | |
| Presentation texts, caption ≥ 0 Under-delivered, velocity uncoloured, `{n} sprint(s)` | §11.3, #19 | MATCH | predictability.ts:88-101; strings.ts:62 | |
| Tones A.6 inclusive (≤10/≤20, ≤2/≤5 on \|d\|, ≥70/≥50) | §2.3, A.6 | MATCH | colorScale.ts:13-28 | 9-decimal `settle` is a builder judgement; does not change any value away from a boundary. Mutants on each boundary killed. |
| §12 strip deviation/difference/texts/tones | §12 | MATCH | metrics.ts:17-42 | |
| §3.2 summary percentages (0 when committed 0), whole %, one-decimal "of" | §3.2, §13 | MATCH | metrics.ts:59-74 | |
| §13 formats (one decimal, signed `+` when ≥ 0, whole %, dates `start → due`) | §13 | MATCH | format.ts:6-44 | |
| Score timeout 30 s | §2.3, #21 | N/A (UI) | — | Not a domain-module concern. |
| Model wiring (sorted copy for forecast/committed; series identity; todayIndex only live) | §7–§9 | MATCH | model.ts:60-89 | |
| Live forecast anchor value when today.remaining < 0 | §8.3/§8.4 vs §2.3, §15.4 | AMBIGUOUS | forecast.ts:139, 194 | Pseudo-code says `result[todayIndex] = today.remaining` and guarantee 1 says "exactly through today's real value", but §2.3 "a forecast never goes negative" / §15.4 "a forecast value is never negative". Code follows the pseudo-code (probe: `[null,-2,0]`). Spec owner to decide; no change requested. |
| `tsc -b --noEmit` clean | build | **MISMATCH** | testkit.ts:38-56 | See X-3. |

### §15 acceptance vectors (computed independently by probe)

| Item | Spec § | Verdict | Evidence | Note |
|---|---|---|---|---|
| (50,45)(40,40)(30,24)(20,21) → 0.0875 / 2.5 / 32 / 50 % / 4 | §15.3 | MATCH | probe | averageDeviation = 0.08750000000000001 |
| Display `8.8 %` good · `+2.5 pts` caution · `50 %` caution · `32.0 pts` | §15.3 + A.6 | MATCH | probe | |
| 5th (older) 200-pt outlier → count 4, median 32 | §15.3 | MATCH | probe | (If the outlier were the NEWEST closed one it would be scored: median 42.5 — consistent with "first 4 from newest-first"; the spec example implies an older fifth.) |
| No closed iteration → `[]`, NO_SCORE | §15.3 | MATCH | probe | |
| History 10/day, today 30, direction −5 → 22.5, 15, 7.5 | §15.4 | MATCH | probe | `[…,30,22.5,15,7.5]` |
| 5/day vs 40 remaining → above zero at due | §15.4 | MATCH | probe | no history: 35…5 at due (7 days) |
| Never negative | §15.4 | MATCH (projections) | probe | Anchors: see X-1 / live-anchor ambiguity. |
| Shape: 50 on day 6/11 → 50, day 8 = 30, due = 0 | §15.5 | MATCH | probe | exact 30 / 0 |
| Shape: 40 → day 8 = 24, due 0 | §15.5 | MATCH | probe | |
| Shape: 0 → zeros | §15.5 | MATCH | probe | |
| No history → shape declines, velocity answers | §15.5 | MATCH | probe | NOT_USABLE; strategy `velocity` |
| Labels: 100/live/10 → green+orange at 10; 0.5 → green; closed → green; committed 0 → none | §15.6 | MATCH | probe | |
| Sizes 40×23, 23/36/49/49, 400 chars → 164 | §15.7 | MATCH | probe | |
| 15 same-day labels: no overlap, stack above range | §15.7 | MATCH | probe | offsets 20…580, no overlap |
| Closed 6th/23rd due 24th → +24th with totals; already reaching → same ref; live → today point | §15.10 | MATCH | probe | |

### Analyst resolutions / builder judgement calls

| Item | Spec § | Verdict | Evidence | Note |
|---|---|---|---|---|
| Res. #1–#3, #5–#9, #11–#16, #18 | various | MATCH / acceptable | — | None contradicts spec text. |
| Res. #4 (ledger #10 not reproduced) | §16 #10 | AMBIGUOUS (accepted) | dates.ts | Deliberate change, recorded here; §16 permits it if recorded. |
| Res. #9 closed extension "includes the last point's own value" | §8.1 | MISMATCH (partly) | forecast.ts:229 | Including the anchor is fine; leaving it UNFLOORED is not — X-1. |
| Res. #17 "Not pinned … would be coloured caution" | §2.3 | Stale doc | colorScale.ts:7-10 | Builder now settles to 9 decimals, so a mean of three 0.1s is coloured GOOD. Code is the better reading; update the resolution text. |
| Builder: 9-decimal `settle` on tones and compliance | §2.3, §11.2, A.6 | MATCH (judgement) | colorScale.ts:10; predictability.ts:56 | Protects the stated boundaries from float noise. |
| Should the 1 % orange floor also settle? | §2.3, §9 | **Yes → MISMATCH** | deviationLabels.ts:43-45 | Same kind of inclusive business threshold; without it a forecast mathematically at exactly 1 % is suppressed. Probe: 87 integer committed values c ≤ 1000 (e.g. 29, 57, 58, 69) with forecast end c/100 give pct = 0.9999999999999999 → no label; velocity-produced ends (e.g. r=0.3, v=0.1, k=2, c=10) likewise. — X-2. |
| Negative value at closed-extension first position | §8.1 | **Not acceptable → MISMATCH** | forecast.ts:229 | §8.1 has no pseudo-code for closed; its prose says "floored at zero", reinforced by §2.3 "a forecast never goes negative" and §8.4/§15.4. Unlike the live strategies, no pseudo-code line forces an unfloored anchor. — X-1. |
| History = last 4 closed that START BEFORE selected (not just "older in list") | §6 | MATCH | forecast.ts:300-304 | Implemented by start-date comparison; list order only decides which 4 are "last". |

### Test vacuity audit (mutation probes on a scratch copy)

45 mutants on the rules above; 40 killed. Survivors: M9 `shapeToday <= 0` instead of `<= 1e-9` (**real gap**);
M26 velocity skip rule, M27 `f > last.f`, M30 drop selected-id check, M40 drop canonical floor — all
**equivalent** (unobservable). Existing test "declines when the canonical shape had already collapsed" uses
shapeToday = 0 exactly, so the 1e-9 boundary is unverified.

### Fixes required (round 1)

| Item | Spec § | Verdict | Evidence | Fix |
|---|---|---|---|---|
| X-1 closed-extension anchor unfloored | §8.1, §2.3 | MISMATCH | forecast.ts:229 | `if (i === lastIndex) return Math.max(0, last.remaining)` (equivalently use the uniform `max(0, last.remaining + d × days)` for all i ≥ lastIndex); add a test: closed series ending at remaining −2 → anchor 0. |
| X-2 1 % floor not float-settled | §2.3, §9 | MISMATCH | deviationLabels.ts:43-45 | Settle pct to 9 decimals (share the `settle` helper from colorScale.ts) before both `≥ 1` and `Math.round`; test: committed 29, forecast ends 0.29 → orange `Deviation +1 %`. |
| X-3 typecheck fails | build | MISMATCH | testkit.ts:47 | Add `reportError: null` (optionally a `reportError?` param) to `makeIteration`. |
| T-1 1e-9 collapse boundary untested | §8.3 | MISSING (test) | forecast.test.ts:265-269 | Add a case where canonical shapeToday ∈ (0, 1e-9] → NOT_USABLE and one just above (e.g. 2e-9) → usable. |

**Round-1 summary.** Rows: ~92 MATCH (incl. judgement/extension variants), 5 AMBIGUOUS (3 accepted
resolutions, live-anchor sign, "later stacks higher" guarantee), 1 N/A, 1 stale-doc note; distinct defects:
**3 MISMATCH** (X-1 closed-extension anchor unfloored, X-2 1 % floor not float-settled, X-3 `tsc` fails in
testkit.ts) and **1 MISSING** (T-1 test for the 1e-9 collapse boundary). All §15.3–15.7 and §15.10 vectors
reproduce exactly.

### Round 1 fixes (orchestrator)

| Finding | Fix | Pinning test |
|---|---|---|
| X-1 closed extension negative at last point | `forecast.ts` `closedExtension`: `Math.max(0, last.remaining)` | `never negative, including at the last recorded point` |
| X-2 1 % floor flipped by float noise | `deviationLabels.ts`: `settle()` (shared in `stats.ts`, also used by `colorScale.ts`, `predictability.ts`) before `≥ 1` and `Math.round` | `a forecast at exactly 1 % in maths is not hidden by float noise` |
| X-3 `reportError` missing in testkit | `testkit.ts` `makeIteration`: `reportError: null` | `tsc` |
| T-1 1e-9 threshold untested | — | `declines when shapeToday is positive but ≤ 1e-9, and answers just above it` |

Result: 202/202 domain tests pass. Ambiguity #17 is superseded: a mean of three 0.1 deviations is coloured **good**.
