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
| `curve.ts` | `type Value = number \| null`; `interface CurveIteration {state, dueDate, report}`; `withTodayPoint(series, iteration, today)`; `withDueDatePoint(series, iteration)`; `completeSeries(iteration, today)`; `buildAxis(series, dueDate)`; `axisMetrics(axis, series): {firstIndex, totalDays}`; `remainingSeries(series, axis)`; `idealSeries(series, axis)`; `TOLERANCE_RATIO = 0.1`; `committedTotal(report, series)`; `toleranceLevel(committedTotal): number \| null`; `BURNUP_EXTENSION_DAYS = 7`; `buildBurnupAxis(series, dueDate)`; `interface BurnupModel {axis, maxScope, completed, totalScope, ideal, forecast}`; `burnup(series, dueDate): BurnupModel` |
| `forecast.ts` | constants `TREND_WINDOW = 5`, `HISTORY_MAX = 4`, `SHAPE_GRID_POINTS = 21`, `SHAPE_COLLAPSE_EPSILON = 1e-9`; `NOT_USABLE` (unique symbol) + `type NotUsable`; `type ForecastSeries = Value[]`; `ShapePoint {f, y}`, `Shape`; `type History = SeriesPoint[][]`; `dailyDirection(series, window = 5)`; `shapeOf(series): Shape \| null`; `sample(shape, f)`; `canonicalShape(history, maxIterations = 4): Shape \| null`; `shapeForecast(series, history, axis, todayIndex, endIndex, maxIterations = 4): ForecastSeries \| NotUsable`; `historicalRate(series): number \| null`; `velocityForecast(series, history, todayIndex, endIndex, maxIterations = 4): ForecastSeries` (`[]` when invalid); `closedExtension(series, axis)`; `type ForecastStrategy = 'closed-extension' \| 'shape' \| 'velocity' \| 'none'`; `selectForecast({state, series, axis, history, today}): {strategy, values}`; `lastForecastValue(f)`; `deviationPercent(f, committedTotal): number \| null`; `forecastHistory(iterations, selected, max = 4)`; `historySeries(iterations): History` |
| `deviationLabels.ts` | `FORECAST_LABEL_MIN_PERCENT = 1`; `DeviationLabel {kind: 'tolerance' \| 'forecast', text, value}`; `deviationLabels({committedTotal, state, forecast})`; `reservesGutter(labels)`; `placeDeviationLabels({values, toPixel, plotTop, plotBottom, labelHeight}): number[]` (label-centre pixel y, input order) |
| `annotationGeometry.ts` | `ANNOTATION_LABEL` constants; `annotationLabelSize(text): {width, height}`; `bandsOverlap(a, hA, b, hB)`; `StackItem {date, value, height}`; `StackedItem {index, date, offset}`; `stackAnnotationLabels(items, axis): StackedItem[]`; `horizontalPushSign(axisIndex, axisLength): -1 \| 1` (−1 = leftwards); `verticalPushSign(value, min, max): -1 \| 1` (+1 = upwards) |
| `predictability.ts` | `PREDICTABILITY_WINDOW = 4`; `COMPLIANT_THRESHOLD = 0.1`; `NO_SCORE` (unique symbol) + `type NoScore`; `PredictabilityScore {averageDeviation (fraction), averageDifference, medianVelocity, compliantShare (percent), analysedCount}`; `closedForScore(iterations, max = 4)`; `predictability(closed): PredictabilityScore \| NoScore`; `presentScore(score): ScorePresentation` (texts, tones, caption, analysed) |
| `metrics.ts` | `deliveryMetrics(report): {committed, delivered, deviation (percent), difference}`; `presentMetrics(m): {deviationText, deviationTone, diffText, diffTone}`; `deliverySummary(report): {completedPercent, inProgressPercent, completedShare, inProgressShare, completedOf, inProgressOf}` |
| `format.ts` | `oneDecimal`; `signedOneDecimal`; `formatPoints`; `formatSignedPoints`; `formatPercentOneDecimal` ("8.8 %"); `formatWholePercent` ("50 %"); `formatShare` ("67%"); `formatDateRange(start, due)` (delegates to `S.dateRange`) |
| `colorScale.ts` | `type Tone = 'good' \| 'caution' \| 'poor'`; `deviationTone(percent)`; `differenceTone(points)`; `compliantTone(percent)` |
| `model.ts` | `BurndownModel {series, axis, live, todayIndex, remaining, ideal, forecast, forecastStrategy, committedTotal, tolerance, labels, reserveGutter}`; `buildBurndownModel({iteration, iterations, today})`; `buildBurnupModel(iteration, today): BurnupModel` |

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

### §7.6 Burnup (KNOWN BEHAVIOUR, ledger #8)

| # | Rule | Tag | Test |
|---|---|---|---|
| D-23 | maxScope = largest committed of any point | [M] | `curve › completed, total scope…`; `realistic data…` |
| D-24 | Axis = series dates + up to 7 days after the last point that are ≤ due date | [M] | `curve › axis = series dates + up to 7 days…`; `axis extension stops at the due date`; `no extension when…` |
| D-25 | Completed = delivered at the date, null where no point | [M] | `curve › completed, total scope…` |
| D-26 | Total scope = constant maxScope | [M] | `curve › completed, total scope…` |
| D-27 | Ideal **descends** from the first point's remaining (burndown formula), null when span is 0 | [KB] | `curve › ideal DESCENDS…`; `realistic data…`; `a zero span → ideal is null everywhere` |
| D-28 | Forecast null on/before the last recorded date; then `min(maxScope, lastDelivered + firstCommitted × daysAfterLast)` (saturates) | [KB] | `curve › completed, total scope… per-day forecast slope`; `realistic data: forecast saturates…`; `no projected positions…` |
| D-29 | Burnup uses the repaired series | [M] | `model › uses the repaired series (today point included) and the 7-day extension` |

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
10. **Burnup without a due date**: no 7-day extension ("on or before the due date" cannot hold). The `maxScope / daysRemaining` fallback is unreachable (no points ⇒ empty axis) and is not implemented.
11. **Deviation-label placement**: positions are label *centres*; ties keep input order (green above orange); clamping happens after the push-down and **can re-create overlap at a bound** (literal order of §9). An alternative "clamp then re-stack upwards" reading gives different pixels.
12. **Annotation push direction at the exact centre / midpoint**: centre index counts as the left half (pushed right); midpoint value counts as the lower half (offset down).
13. **Annotation stacking**: single pass over earlier labels in processing order, bands based on the point value + offset (workload units); off-axis items are *absent* from the output (output carries `index` back to the input).
14. **Percent spacing**: score panel uses `8.8 %` / `50 %` (from §15.3 "shown `8.8 %`"); the §12 strip uses `Deviation: 10.0%` (literal `{…}%`); the summary strip share uses `90%` (unspecified; follows the neighbouring §12 strip). Two readings give different strings.
15. **Summary `… of …`**: no `pts` suffix (`45.0 of 50.0`) — "in points" read as the unit of the numbers, not a suffix.
16. **Negative zero**: `signedOneDecimal(-0)` → `+0.0`. A small negative such as −0.04 would render `-0.0` (literal rule); not pinned.
17. **Float edge at 10 %**: an *average* deviation that is mathematically 10 % can compute to 10.000000000000002 % (e.g. mean of three 0.1s) and would be coloured caution. Not pinned; the §15.3 vector and single-iteration boundaries compute exactly.
18. **Colour boundaries** follow A.6 (inclusive `≤ 10`, `≤ 20`, `≥ 70`, `≥ 50`); §15.3's colour words are errata.
