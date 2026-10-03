# Conformance checklist — screens & charts (wave 2)

Scope: SPEC §3 (both screens, every state, dialogue / list / overlap warning / chart labels), §5.2–§5.3,
§9 (rendering), §10.3 (wiring), §10.5 (rendering), §11.3 (presentation), §12, §13, §14.2, §14.3,
ledger #3, #6, #13, #16, #19, #20, #21, Amendment A.3/A.4/A.6, Implementation notes (HTTP contract, `reportError`).

Tags: **[M]** spec MUST / literal · **[KB]** known behaviour reproduced on purpose · **[A]** analyst decision
(see "Ambiguities"). Tests are referenced by ID (`SGxx`, `SRxx`, `SCxx`, `SAxx`, `SNxx`); the ID is the first
token of the test name.

| File | IDs |
|---|---|
| `frontend/src/screens/GroupList.test.tsx` | SG01–SG10 |
| `frontend/src/screens/IterationReview.test.tsx` | SR01–SR23 |
| `frontend/src/screens/Chart.test.tsx` | SC01–SC15 |
| `frontend/src/screens/Annotations.test.tsx` | SA01–SA18 |
| `frontend/src/app.test.tsx` | SN01–SN02 |

68 tests. Run: `cd frontend && npx vitest run src/screens src/app.test.tsx` and `npx tsc -b --noEmit`.
Test-only helpers (do **not** import from production code): `src/test/fixtures.ts`, `src/test/fakeApi.ts`,
`src/test/chartMock.tsx`, `src/test/renderApp.tsx`.

---

## Builder brief

### 0. Ground rules

- `src/App.tsx` default-exports `App`, which renders the whole product with **no props** and creates its
  own `QueryClient` **per mount** (`useState(() => new QueryClient(...))`) — never a module singleton
  (SN02; tests mount `<App />` many times).
- Every literal comes from `src/strings.ts` (`S`). Nothing is missing there for this wave. The state badge
  shows the iteration's `state` value verbatim (data, not a literal).
- Use the built domain (`src/domain/*`) and annotations (`src/annotations/*`) modules; do not re-implement.
- No router, no `history.pushState/replaceState`, no `location` writes, no hash (SN01). Screen choice is
  React state in `App`.
- jsdom has no canvas: the tests replace `react-chartjs-2` with `src/test/chartMock.tsx`. Production code
  MUST render both views with **`<Line data={…} options={…} />` imported from `react-chartjs-2`** (not
  `Chart`, not raw `new Chart`) and must not crash when the chart instance/ref is `null`.

### 1. Recommended file layout

```
src/App.tsx                       QueryClientProvider + screen switch (group list ⇄ review)
src/api/client.ts                 fetch wrappers (getJson, getConfig, getGroups, getIterations, getReports)
src/api/queries.ts                useConfig, useGroups, useIterations, useReports (TanStack Query)
src/screens/GroupListScreen.tsx   screen 1
src/screens/ReviewScreen.tsx      screen 2: header, iteration rail, centre, annotations rail; owns selection,
                                  view, refresh generation, useAnnotations(...)
src/components/GroupCard.tsx      card + tiles
src/components/IterationRail.tsx  back control, heading, placeholders/error/none/rows
src/components/ChartCard.tsx      iteration header, score panel, centre states, strips, chart, dialogue
src/components/BurndownChart.tsx  <Line> + annotation-plugin config + gutter overlay
src/components/BurnupChart.tsx    <Line> + point markers in the annotation type colour
src/components/ScorePanel.tsx     compact (used) + expanded (implemented, unreachable — ledger #19)
src/components/DeliverySummary.tsx, MetricsStrip.tsx
src/components/AnnotationDialog.tsx, AnnotationsRail.tsx
src/components/chartSetup.ts      useChartTheme(): token values read at runtime (STYLEGUIDE.md; no colour in code)
```

Layout is free; the **observable contracts below are not**.

### 2. Data layer (TanStack Query) and the HTTP contract

`getJson(url)`: `const res = await fetch(url)`; parse JSON; if `!res.ok` throw `new Error(body.error)` (the
verbatim message; fall back to `HTTP <status>` only when there is no body). Messages are shown verbatim
everywhere (§13, §14.3). Group paths go in the query string URL-encoded (`encodeURIComponent` or
`URLSearchParams` — the fake parses either).

| Read | URL | Query key (recommended) | Notes |
|---|---|---|---|
| config | `GET /api/config` | `['config']` | `{ groupTerm, rootGroup }` — the term and root are NEVER hard-coded (SG09, SG10) |
| groups | `GET /api/groups`, `GET /api/groups?refresh=1` | `['groups', gen]` | `gen` lives in `App` state; `Refresh` / `Retry` → `gen + 1`; queryFn uses `refresh=1` when `gen > 0` |
| iterations | `GET /api/iterations?group=<path>` | `['iterations', path, entry]` | `entry` = counter incremented every time a group is opened ⇒ re-entering a group re-reads (SR23); never a `refresh` param; never re-read by review `Refresh` (SR22) |
| reports | `GET /api/reports?group=<path>[&refresh=1]` | `['reports', path, gen]` | ONE query shared by chart, forecast history and score (SR21); review `Refresh` → `gen + 1` → `refresh=1` (SR22); selecting another iteration reuses it (SR13) |

QueryClient defaults: `retry: false` (errors must show at once), `refetchOnWindowFocus: false`,
`refetchOnReconnect: false`, `staleTime: 5 * 60_000` (§2.3 freshness; the backend owns real caching).
`enabled` for reports: `selectedIteration !== null || closedForScore-candidates.length > 0` — when the
iteration list has no closed iteration and nothing is selected, **no reports read is issued at all**
(SR08, SR19; §11.2 "issue no data read at all").

Using a refresh generation in the key makes every refresh a fresh request (loading state per §13, and a new
identity for the score's 30 s timer). An equivalent design is acceptable if the fetch counts in SR21–SR23 /
SG02 / SG03 / SG08 hold exactly.

### 3. Screen 1 — group list (`App` shows it first and after `← Back`)

Always: `<h1>` `S.productTitle`.

| State | Render (tests) |
|---|---|
| loading (config or groups pending) | exactly 3 elements `data-testid="group-placeholder"`, each with **empty** `textContent` (SG01) |
| groups failed (or config failed) | heading (`h2`) `S.groupLoadingError`, the verbatim message, `<button>` `S.retry` → groups `gen+1` (`refresh=1`) (SG02) |
| `[]` | heading `S.noGroupHeading(term)`; paragraph = `noGroupBody.before` + `<code>{rootGroup}</code>` + `after`; `<button>` `S.refresh` (`refresh=1`) (SG03, SG10) |
| populated | heading `S.availableGroups(term, cards.length)` (**cards**, ledger #3); guidance paragraph `groupGuidance.before` + `<code>{rootGroup}</code>` + `after`; `<button>` `S.refresh`; one `data-testid="group-card"` per card in response order (SG04, SG05) |

Card (`data-testid="group-card"`): category label = `card.segment`, display name = `card.name`, full path =
`card.fullPath`, each as its own text element. Clicking the card (anywhere on its label/name/path) selects
the card's own group. Inside it, one `data-testid="group-tile"` per child showing `tile.name` and
`tile.segment` (never the tile's full path); clicking a tile selects **that child only** — do not nest the
tile inside the card's clickable element, or `stopPropagation` (SG06, SG07).

### 4. Screen 2 — review (`<ReviewScreen key={entry} group={tile|card} />`)

Keying the screen on the entry counter resets selection, view, refresh generation and the annotation
dialogue whenever a group is (re-)entered; going back unmounts it (§10.3 "leave the group → everything
cleared", SA16).

**Header** `data-testid="review-header"`: `<h1>` `S.productTitle`, `group.name`, `group.fullPath` (separate
text elements), `<button>` `S.refresh`, and the score panel **only while no iteration is selected** (SR18).

**Iteration rail** `data-testid="iteration-rail"`: `<button>` `S.backToGroups(term)`, heading
`S.iterationsHeading`, then:

| State | Render |
|---|---|
| loading | 3 × `data-testid="iteration-placeholder"` (SR02) |
| failed | the verbatim message (no retry required) (SR03) |
| no listable iteration (empty, or all upcoming) | `S.noIterations(term)` (SR04, SR08) |
| rows | one `data-testid="iteration-row"` per iteration with `state !== 'upcoming'`, API order (newest-first): title, `S.dateRange(start, due)`, `data-testid="state-badge"` with the state text; the selected row has `aria-current="true"` (others none/false); clicking selects (SR05, SR06, SR13) |

**Auto-selection** (§5.3): `selected = userChoice ?? unfiltered.find(it => it.state !== 'upcoming') ?? null`
— scan the **unfiltered** list from `/api/iterations` (SR06, SR07). All upcoming ⇒ nothing selected ⇒ centre
`S.selectIteration`, no chart card (SR08). Identify the selection by `id`; annotations use `iid`.

**Centre**: when nothing is selected: the text `S.selectIteration` (no `chart-card`). When an iteration is
selected: `data-testid="chart-card"` containing, in order:

1. iteration header: title, `S.dateRange`, `data-testid="state-badge"` (SR06);
2. the score panel (compact) (SR17, SR18);
3. the body, by the first matching rule (§14.3; SR09–SR12):
   - reports pending → `S.loadingData`;
   - reports failed → the verbatim error;
   - selected iteration not in the reports list → `S.noBurnupData`;
   - `it.reportError` non-null → `it.reportError` verbatim;
   - `it.report === null` or `it.report.series.length === 0` → `S.noBurnupData`;
   - otherwise: view switch (`<button>` `S.viewBurndown`, `<button>` `S.viewBurnup`; default Burndown),
     `data-testid="metrics-strip"`, `data-testid="delivery-summary"`, the chart, and the annotation dialogue
     (when open) directly **under** the chart.

   No `<Line>` is rendered in any other case (never an empty chart frame).

**Delivery summary** (`deliverySummary(report)`), in this order: green dot, `S.summaryCompleted`,
`completedShare`, `completedOf`, blue dot, `S.summaryInProgress`, `inProgressShare`, `inProgressOf`
(SR15 checks the order in `textContent`: `Completed … 90% … 45.0 of 50.0 … In Progress … 10% … 5.0 of 50.0`).

**Metrics strip** (`presentMetrics(deliveryMetrics(report))`): two elements whose text is **exactly**
`deviationText` / `diffText` (e.g. `Deviation: 10.0%`, `Diff: +5.0 pts`), each with `data-tone="good|caution|poor"` (SR16).

**Colour convention for tests:** every colour-coded figure is the element whose text is the figure and carries
`data-tone` = the domain `Tone`. Never-coloured figures (median velocity) carry no `data-tone`.

### 5. Score panel (`data-testid="score-panel"`, compact layout; exactly one in the document)

Inputs: the iterations query (closed set) and the shared reports query.

```
iterations pending                         → S.scoreLoading
closed = iterations.filter(state==='closed').slice(0, 4)      (closedForScore semantics, §11.2)
closed is empty                            → S.scoreNone                — and the reports query is NOT enabled for the score
timed out for this request                 → S.scoreTimeout             (sticky for this request; late data discarded)
reports pending                            → S.scoreLoading
reports failed                             → S.scoreError(message)
score = predictability(closed mapped to their IterationReport by id)
score === NO_SCORE                         → S.scoreNone
else presentScore(score):
   heading S.scoreCompactHeading; four rows label + figure:
   S.scoreAvgDeviation  averageDeviation.text  data-tone
   S.scoreDeliveryDiff  deliveryDiff.text      data-tone   (no caption in compact)
   S.scoreCompliant     compliant.text         data-tone
   S.scoreMedianVelocity medianVelocity.text   (no data-tone)
```

Timeout (§11.3, ledger #21): request identity = `${path}|${gen}` (the reports query key). Sketch:

```ts
function useTimedOut(requestKey: string, pending: boolean, ms = 30_000) {
  const [timedOut, setTimedOut] = useState<string | null>(null)
  useEffect(() => {
    if (!pending) return
    const t = setTimeout(() => setTimedOut(requestKey), ms)
    return () => clearTimeout(t)
  }, [requestKey, pending])
  return timedOut === requestKey
}
```

Use the global `setTimeout` (the test fakes it). The chart keeps rendering the late data (independent region,
SR20); a new `Refresh` (new `gen`) restarts the timer and may succeed.

The expanded layout (`S.scoreExpandedHeading`, `S.scoreAnalyzed(n)`, captions, `S.scoreCalculating`,
`S.scoreNoData`) is implemented in `ScorePanel` behind a `layout` prop but **never rendered** (ledger #19;
SR17 asserts its literals are absent).

### 6. Charts (react-chartjs-2 `<Line>`; chart.js + chartjs-plugin-annotation registered at module load)

`today = todayUtc()` per render. Burndown: `m = buildBurndownModel({ iteration, iterations: reports, today })`.
Burnup: `b = buildBurnupModel(iteration, today)`. Exact props the tests read:

**Burndown** (`data.labels = m.axis` — ISO strings; datasets in this order, nothing else):

| `label` | `data` | required props |
|---|---|---|
| `S.legendRemaining` | `m.remaining` | `spanGaps: false`, `fill` truthy, `pointRadius` ≠ 0, no `borderDash`, `borderColor` `--remaining` (blue), `pointBackgroundColor`: array of `m.axis.length`, `--today` (red) at `m.todayIndex`, `--remaining` (= `borderColor`, same value) elsewhere |
| `S.legendIdeal` | `m.ideal` | `borderDash` non-empty, `pointRadius: 0`, `--ideal` (gray) |
| `S.legendForecast` | `m.forecast` | `borderDash` non-empty, `pointRadius: 0`, `spanGaps: true`, `borderColor` `--forecast` (orange; distinct from today's red dot — STYLEGUIDE.md wins over §13, see SPEC Implementation notes) |

`options.plugins.title = { display: true, text: S.burndownTitle }`.
`options.plugins.annotation.annotations` (object map or array):
- tolerance (when `m.tolerance !== null`): `{ type: 'line', yMin: m.tolerance, yMax: m.tolerance, borderDash: [..], borderColor: GREEN }` — no other horizontal line with `yMin === yMax` (SC05, SC08, SC09);
- one callout per annotation on the axis, from `stackAnnotationLabels(items, m.axis)` with
  `items = annotations.map(a => ({ date: a.date, value: remainingAt(a.date) ?? 0, height: annotationLabelSize(a.text).height }))`:
  `{ type: 'label', xValue: date, yValue: m.remaining[idx] (the point), content: text.split('\n').slice(0, 3), drawTime: 'beforeDatasetsDraw', callout: { display: true, borderDash: [..] }, borderColor/backgroundColor: BLUE (information) | RED (risk), xAdjust: scriptable px = horizontalPushSign(idx, len) × k × chartWidth, yAdjust: scriptable px converting the workload offset (× verticalPushSign) via scales.y }` (SC13). Offsets are workload units, unclamped (ledger #11).
- the deviation labels are **never** annotation-plugin entries (SC06).

`options.plugins.tooltip.callbacks.footer(items)` → `annotationsOnDate(list, m.axis[items[0].dataIndex]).map(a => a.text)` (string[]; `[]` when none) (SC14, ledger #13).
`options.onClick(event, elements)` → if `elements[0]` then `clickPoint(axis[elements[0].index])` — use the
`elements` argument, not `chart.getElementsAtEventForMode` (SC15, SA02…).

**Gutter** (§9): rendered **only when `m.reserveGutter`**: `data-testid="deviation-gutter"` beside the
canvas, containing one `data-testid="deviation-label"` per `m.labels` entry, in order, with
`data-kind={label.kind}` and `textContent === label.text` (green tolerance / orange forecast). Reserve the
width (e.g. `options.layout.padding.right` or a flex column) only then. Vertical positions come from
`placeDeviationLabels({ values, toPixel: v => chart.scales.y.getPixelForValue(v), plotTop: chartArea.top,
plotBottom: chartArea.bottom, labelHeight })`, read from the chart instance after layout (ref or an inline
plugin `afterLayout`; update state only when positions change — avoid render loops); horizontal anchor =
outer edge of the gutter. Labels must render (unpositioned) when there is no chart instance (SC05–SC09).

**Burnup** (`data.labels = b.axis`; datasets in order): `S.legendCompleted` (`b.completed`, GREEN, `fill`
truthy, `tension > 0`, `pointRadius` ≠ 0), `S.legendTotalScope` (`b.totalScope`, NEUTRAL, dashed,
`pointRadius: 0`), `S.legendIdeal` (`b.ideal`, dashed), `S.legendForecast` (`b.forecast`, `--forecast`, dashed).
Title `S.burnupTitle`. Annotations: one `{ type: 'point', xValue: date, yValue: completedAt(date) ?? 0,
backgroundColor: <type colour: --risk if any annotation of that date is a Risk, else --info>, radius: 5 }` per distinct annotated date on the axis — **no** `label` entries, no
text anywhere in the config, no tolerance line, no gutter (SC10–SC12). Same `onClick`.

### 7. Annotations wiring

In `ReviewScreen`: `const ann = useAnnotations({ groupPath: group.fullPath, iterationId: selected?.iid ?? null })`
(default storage = `localStorage`, default confirm = `window.confirm`, default clock = `Date.now` — the tests
rely on these defaults). Changing the selected iteration resets the dialogue without a prompt (SA15).

**Rail** `data-testid="annotations-rail"`: heading `S.annotationsHeading(ann.annotations.length)`; when
empty `S.noAnnotations`; else one `data-testid="annotation-item"` per annotation in list order (neutral card, 3 px left edge in the type colour):
date, `S.byAuthor(a.author)`, `<button>` `S.edit` → `ann.editFromList(a.id)`, `<button>` `S.delete` →
`ann.remove(a.id)`, text (`white-space: pre-wrap`). Help box: `S.helpHeading`, `S.helpClick`, `S.helpLocal`
as three text elements. The rail renders regardless of the chart's state (SR10).

**Dialogue** `data-testid="annotation-dialog"` inside `chart-card`, under the chart, when `ann.dialogue`:
heading (`h3`) `S.addAnnotation` / `S.editAnnotation` by `mode`; text `S.dialogDate(date)`; label `S.typeLabel`;
`<button aria-pressed>` `S.typeInformation` (blue) and `S.typeRisk` (red) → `ann.setType`; `<textarea
placeholder={S.textPlaceholder}>` → `ann.setText` (Enter = newline, never submit); `<button>` `S.cancel` →
`ann.cancel`; `<button disabled={!ann.canSave}>` `S.add` / `S.edit` → `ann.save`.

### 8. How the tests drive the app (what the builder can rely on)

- `renderApp()` (src/test/renderApp.tsx): `vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })`
  + `vi.setSystemTime('2026-03-12T10:00:00Z')` ⇒ `todayUtc()` = `2026-03-12` (`TODAY`). Real
  `setTimeout`/`setInterval` except in SR20, which also fakes them (still advancing with real time) and
  jumps with `vi.advanceTimersByTimeAsync`.
- `fetch` is replaced (`vi.stubGlobal`) by `createFakeApi` (src/test/fakeApi.ts): serves the estate, records
  every call as `{ path, group, refresh }`; `count(path, { group?, refresh? })`. Errors are `502 {error}`.
- `window.confirm` is a spy (default answer `true`; some tests answer `false`); `history.pushState` /
  `replaceState` are spied (SN01). `localStorage` is real jsdom storage, cleared after each test.
- `react-chartjs-2` is replaced by `chartMock.tsx`: `Line` records its latest props and renders
  `<div data-testid="chart-line" />`. Helpers: `lastLineProps`, `datasetByLabel`, `datasetLabels`,
  `annotationEntries`, `contentText`, `clickChartAt(i)` (= `options.onClick(evt, [{ index: i, datasetIndex: 0 }], {})`),
  `tooltipFooterAt(i)` (= `options.plugins.tooltip.callbacks.footer([{ dataIndex: i, label, … }])`), `indexOfDate`.
- Expected chart data are computed in the tests with the domain (`buildBurndownModel` / `buildBurnupModel`),
  so pass model arrays through unchanged.

### 9. Fixture estate (src/test/fixtures.ts, ROOT_GROUP `org/delivery`, term `ART`)

Cards: `alpha` (tile `team-1` "Team One"), `beta` (tile `x` "Xray"), `delta`. Iterations (newest-first,
unfiltered):
- **alpha**: 8 upcoming · 7 current (2026-03-02→03-15, series to 03-11, totals 50/20/30) · 6 5 4 3 closed =
  §15.3 vector (50,45) (40,40) (30,24) (20,21) · 2 closed 200-pt outlier. Score `8.8 %` good / `+2.5 pts`
  caution / `50 %` caution / `32.0 pts`. Live labels: `Deviation +10 %` + `Deviation +11 %`.
- **beta**: 7 current, finished (forecast 0 ⇒ green only) · 6 closed committed 0 (no labels) · 5 closed
  `reportError` · 4 closed empty series · 3 closed `report: null`.
- **team-1**: 4 upcoming · 3 2 1 closed (auto-select = `T1 Sprint 3`).
- **x**: 2 upcoming · 1 upcoming. **delta**: no iterations.
- alpha and beta share iids 3–7 (scoping, SA17).

---

## Checklist

### Shell & navigation

| # | Rule | § | Tag | Test |
|---|---|---|---|---|
| N-1 | Two screens; no routing, deep links or history entries; URL never changes | §3, ledger #20 | [M] | SN01 |
| N-2 | A mount always starts on the group list and reads afresh (per-mount data client) | ledger #20 | [M]/[A] | SN02 |

### Screen 1 — group list (§3.1, A.3, A.4)

| # | Rule | § | Tag | Test |
|---|---|---|---|---|
| G-1 | Product title `Heimdall` | §3.1, §13 | [M] | SG01 |
| G-2 | Loading = three placeholder cards, no text | §3.1, §13 | [M] | SG01 |
| G-3 | Failure: heading `Loading error`, verbatim message, `Retry` | §3.1, §13 | [M] | SG02 |
| G-4 | `Retry` re-reads with the cache bypassed (`/api/groups?refresh=1`) | §3.1, §14.2 | [M] | SG02 |
| G-5 | Nothing eligible: `No {TERM} found` + A.4 body with `{ROOT_GROUP}` as code + `Refresh` (refresh=1) | A.4 | [M] | SG03, SG10 |
| G-6 | Populated heading `Available {TERM}s (n)`, n = **cards** | §3.1, ledger #3, A.3.8 | [M]/[KB] | SG04 |
| G-7 | Guidance `Select a {TERM} under {ROOT_GROUP} to view its iterations.` with root as code | A.4 | [M] | SG04, SG09 |
| G-8 | Card: own segment label, display name, full path; cards in contract order | §3.1, A.3.6–7 | [M] | SG05 |
| G-9 | Tile: name + own last segment only | A.3.7 | [M] | SG05 |
| G-10 | Click card → the parent group; click tile → that child only | §3.1 | [M] | SG06, SG07 |
| G-11 | Group-list `Refresh` re-reads groups with refresh=1, nothing else | §14.2 | [M] | SG08 |
| G-12 | Term / root come from `/api/config` | A.2 | [M] | SG09, SG10 |

### Screen 2 — header and chooser (§3.2, §5.3)

| # | Rule | § | Tag | Test |
|---|---|---|---|---|
| R-1 | Header: product title, group name, full path, `Refresh` | §3.2 | [M] | SR01, SG06, SG07 |
| R-2 | Back control `← Back to {TERM}s` and heading `Iterations` | §3.2, §13 | [M] | SR01 |
| R-3 | Rail loading: three placeholder rows | §3.2 | [M] | SR02 |
| R-4 | Rail failure: the verbatim error text | §3.2, §14.3 | [M] | SR03 |
| R-5 | None: `No iteration found for this {TERM}.` | §3.2, §13 | [M] | SR04, SR08 |
| R-6 | Row = title, `start → due`, state badge; newest-first | §3.2, §13 | [M] | SR05 |
| R-7 | Upcoming never listed | §5.3 | [M] | SR05, SR07, SR08 |
| R-8 | Chosen row highlighted (`aria-current="true"`), exactly one | §3.2 | [M] | SR06, SR13 |
| R-9 | Auto-select most recent non-upcoming from the **unfiltered** list | §5.3, ledger #6 | [M]/[KB] | SR06, SR07 |
| R-10 | All upcoming ⇒ nothing selected, centre placeholder | §5.3 | [M] | SR08 |
| R-11 | Back returns to the group list; leaving clears the selection | §3, §10.3 | [M] | SR23, SA16 |

### Centre column (§3.2, §14.3)

| # | Rule | § | Tag | Test |
|---|---|---|---|---|
| C-1 | No iteration chosen: `Select an iteration to display the charts.` | §3.2 | [M] | SR03, SR04, SR08 |
| C-2 | Loading: `Loading data…`, no chart frame | §3.2, §14.3 | [M] | SR09, SR20 |
| C-3 | Read failure: verbatim message, no chart | §14.3 | [M] | SR10 |
| C-4 | `reportError` shown verbatim as the chart error | Impl. notes | [M] | SR11 |
| C-5 | No report / empty series: `No burnup data found for this iteration (check permissions or format).` | §3.2, §14.3 | [M]/[A] | SR12 |
| C-6 | Iteration header in the card: title, range, state badge | §3.2 | [M] | SR06, SR07, SR13 |
| C-7 | Chart renders only when data arrived, no failure, non-empty series | §14.3 | [M] | SR09–SR12 |
| C-8 | Changing iteration replaces the chart at once (no re-read) | §14.3, §5.2 | [M] | SR13 |
| C-9 | View switch `Burndown` / `Burnup`; titles `Burndown Chart` / `Burnup Chart` | §3.2, §13 | [M] | SR14, SC10 |
| C-10 | Legend entries Burndown `Remaining, Ideal, Forecast`; Burnup `Completed, Total scope, Ideal, Forecast` | §3.2, §13 | [M] | SR14, SC01, SC10 |
| C-11 | Delivery summary: `Completed` share + `{delivered} of {committed}`, `In Progress` share + pair, one decimal | §3.2, §13 | [M] | SR15 |
| C-12 | Metrics strip `Deviation: x.x%`, `Diff: ±x.x pts` for the displayed iteration, coloured (A.6) | §12, A.6 | [M] | SR16, SR22 |
| C-13 | Independent regions: failed chart keeps the annotation rail; score fails in its own panel | §14.3 | [M] | SR10, SR20 |

### Predictability score presentation (§11.3)

| # | Rule | § | Tag | Test |
|---|---|---|---|---|
| P-1 | Compact panel `Average over the last 4 sprints` with the four figures | §11.3 | [M] | SR17 |
| P-2 | §15.3 figures `8.8 %` good, `+2.5 pts` caution, `50 %` caution, `32.0 pts` uncoloured | §15.3, A.6 | [M] | SR17 |
| P-3 | Expanded layout implemented but unreachable | §11.3, ledger #19 | [KB] | SR17 (absence); implementation by code review |
| P-4 | In the header only while no iteration is chosen; in the chart card once one is; never both | §3.2 | [M] | SR18 |
| P-5 | No closed iteration ⇒ `No score available` and no data read at all | §11.2, §15.3 | [M] | SR19, SR08 |
| P-6 | Loading `Predictability scores...` | §11.3 | [M] | SR20 |
| P-7 | Failure `Error: {message}` | §11.3 | [M] | SR10 |
| P-8 | 30 s ⇒ `Timeout exceeded (30s)`; a later result for the same request discarded | §11.3, ledger #21 | [M] | SR20 |
| P-9 | Refresh after a timeout starts a new request | ledger #21 | [M] | SR20 |

### Reads and refresh (§5.2, §14.2)

| # | Rule | § | Tag | Test |
|---|---|---|---|---|
| F-1 | One report read per group serves chart, history and score | §5.2 | [M] | SR21, SR13 |
| F-2 | Review `Refresh` re-reads reports with refresh=1; never iterations, never groups; selection kept | §14.2, ledger #16 | [M] | SR22, SR20 |
| F-3 | Re-entering a group re-reads its iterations | §14.2 | [M]/[A] | SR23 |

### Chart rendering (§7.4–§7.6, §9, §10.5, §3.6, §13)

| # | Rule | § | Tag | Test |
|---|---|---|---|---|
| CH-1 | Axis / Remaining / Ideal / Forecast data = domain model | §7.3–§7.4, §8 | [M] | SC01 |
| CH-2 | Remaining solid, filled, dots, gaps break (`spanGaps:false`); Ideal dashed no dots; Forecast dashed no dots, bridges gaps (`spanGaps:true`) | §7.4 | [M] | SC02 |
| CH-3 | Live: today's dot in `--today` (red, distinct from Remaining and Forecast); closed: none | §7.4, §13 + STYLEGUIDE.md | [M] | SC03, SC04 |
| CH-4 | Tolerance line dashed at 10 % of committed; none when committed 0 | §7.5 | [M] | SC05, SC08, SC09 |
| CH-5 | Green `Deviation +10 %` / orange `Deviation +{n} %` visibility per §15.6 | §9, §15.6 | [M] | SC05, SC07, SC08, SC09 |
| CH-6 | Labels in a gutter outside the plot, never in-plot | §9 | [M] | SC06 |
| CH-7 | Gutter reserved only when ≥ 1 label | §9 | [M] | SC09 (absence), SC05 (presence) |
| CH-8 | Label placement via `placeDeviationLabels`, anchored to the gutter's outer edge | §9 | [M] | code review (needs a real canvas) |
| CH-9 | Burnup datasets = burnup model; Completed filled, gentle curve, dots; Total scope dashed | §7.6, ledger #8 | [M]/[KB] | SC10 |
| CH-10 | Burnup: annotations = dots only, in the type colour (no text, no callout, no stacking) | §7.6 + STYLEGUIDE.md | [M] | SC12, SC16 |
| CH-11 | Burnup: no tolerance line, no deviation gutter | §7.6, §9 | [A] | SC11 |
| CH-12 | Callout per annotation anchored to its point, behind the data lines; blue info / red risk | §3.6, §10.5, §13 | [M] | SC13 |
| CH-13 | Stacking / size / push directions from `annotationGeometry` (workload units, unclamped) | §10.5, ledger #11–#12 | [M]/[KB] | domain tests + code review |
| CH-14 | Tooltip lists all annotation texts of that date, one per line | §3.6, ledger #13 | [M] | SC14 |
| CH-15 | Clicking a point opens the dialogue on that date | §3.3, §10.3 | [M] | SC15, SA02 |

### Annotations UI (§3.2–§3.5, §10.2–§10.4, §15.8)

| # | Rule | § | Tag | Test |
|---|---|---|---|---|
| A-1 | Rail heading `Annotations ({n})`, empty `No annotation for this iteration` | §3.2, §3.4 | [M] | SA01, SA03, SA09 |
| A-2 | Help box `How to use`, `- Click a point to annotate`, `- Annotations stored locally` | §3.2, §10.4 | [M] | SA01 |
| A-3 | Dialogue under the chart: `Add annotation` / `Edit annotation`, `Date: {date}` | §3.3 | [M] | SA02, SA07, SA08 |
| A-4 | `Type`: `Information` / `Risk`, chosen one filled (`aria-pressed`) | §3.3 | [M] | SA02, SA04 |
| A-5 | Placeholder `Explain the deviation...`; required (action disabled while blank) | §3.3 | [M] | SA02 |
| A-6 | Newlines allowed | §3.3 | [M] | SA05 |
| A-7 | Actions `Cancel`, `Add` / `Edit`; closes on save or cancel | §3.3 | [M] | SA03, SA06, SA07 |
| A-8 | Save writes through to storage scoped (group path, iid), re-read | §10.2, §10.3 | [M] | SA03, SA17 |
| A-9 | List item: date, `by Current User`, `Edit`, `Delete`, text; neutral card with a type-colour edge | §3.4 + STYLEGUIDE.md | [M] | SA03 |
| A-10 | List keeps save order | §3.4 | [M] | SA10 |
| A-11 | Point with annotations opens the first for editing | §10.3, ledger #13 | [M] | SA08 |
| A-12 | Delete removes within the pair, no prompt | §10.3 | [M] | SA09, SA17 |
| A-13 | Overlap prompt `Unsaved changes will be lost. Continue?` on another point; declining aborts entirely | §3.5 | [M] | SA11, SA12 |
| A-14 | Same prompt on `Edit` of another annotation | §3.5 | [M] | SA13 |
| A-15 | No prompt without unsaved changes | §3.5 | [M] | SA14 |
| A-16 | Changing iteration discards selection and unsaved text (no prompt) | §14.3, §10.3 | [M] | SA15 |
| A-17 | Back to the group list clears everything | §10.3 | [M] | SA16 |
| A-18 | Annotations scoped per (group, iid): same iid in two groups never leaks | §10.2, §15.8 | [M] | SA17 |
| A-19 | List follows the selected iteration | §10.2 | [M] | SA18 |

### Display conventions (§13)

| # | Rule | § | Tag | Test |
|---|---|---|---|---|
| D-1 | Loading = placeholders in the region, no global spinner | §13 | [M] | SG01, SR02, SR09 |
| D-2 | Failure in the region that failed, message verbatim; retry control on the group list | §13 | [M] | SG02, SR03, SR10, SR11 |
| D-3 | Absence = distinct worded state | §13 | [M] | SG03, SR04, SR08, SR12, SR19, SA01 |
| D-4 | Colours: tone-coded figures via `data-tone`; semantic colours per §13 | §13, A.6 | [M] | SR16, SR17, SC03; rest code review |

---

## Ambiguities and resolutions pinned by the tests

1. **Ledger #6 vs §5.3.** Both rules exclude `state === 'upcoming'` from the same newest-first list, so the
   auto-selected iteration is always the chooser's top row; the divergence the ledger describes cannot occur
   under the written rules. Pinned instead: selection = first non-upcoming of the **unfiltered** list, with a
   list whose first entry is upcoming and that has no `current` iteration (SR07) — this fails "select
   `list[0]`" and "select the current one".
2. **"Series non-empty" (§14.3)** is read on the report's raw `series` (consistent with the §4.4 data check).
   Pinned only for closed iterations (SR12), where the repair never adds points; a live iteration with an
   empty series but totals is left to the builder (raw reading recommended).
3. **Score source of the closed set.** Taken from `/api/iterations`, so "no closed ⇒ no data read" is
   observable (SR19); the figures come from the one shared reports read.
4. **Where the score sits while an iteration is chosen but loading/failing.** The chart card (and its score
   panel) is shown as soon as an iteration is chosen, whatever the chart state (SR10, SR20).
5. **Score loading / none literals.** Compact uses `Predictability scores...` and `No score available`;
   `Calculating…` / `No data available` belong to the expanded layout (§13 lists both pairs as alternates).
6. **Timeout "same request".** Identity = reports query key incl. refresh generation; once timed out, the panel
   stays on the timeout literal for that request even after the data arrives (the chart still renders it);
   `Refresh` creates a new request (SR20).
7. **Burnup has no tolerance line and no deviation gutter** (SC11): the labels' values are burndown
   remaining-work levels and are meaningless on an accumulation axis; §7.6 calls the view deliberately simpler.
8. **Burnup point marker** = one `point` annotation per distinct annotated date, at the Completed value
   (`0` where there is none). Tooltip footer pinned on the burndown only.
9. **Iterations re-read on re-entry** (SR23) follows from §14.2's "leave the review screen and re-enter the
   group" to see new iterations; reports are not required to be re-read on re-entry (unpinned).
10. **No re-read when switching iteration** (SR13, SR21): §5.2's "one read per group" is pinned at the HTTP
    level too (frontend `staleTime` 5 min), which also gives the "immediately" of §14.3.
11. **Selection kept across review `Refresh`** (SR22): Refresh re-reads "the displayed iteration's curve".
12. **Text-required rule in the UI**: the `Add`/`Edit` button is `disabled` while the trimmed text is empty (SA02).
13. **State badge text** = the raw `state` value (no literal exists in §13).
14. **Second annotation on one date** can only arise from storage (a point click edits the first); SC14 seeds it
    in `localStorage` and re-enters the iteration to re-read.
15. **Delete never prompts** and closes the dialogue only when it was editing that annotation (annotations
    brief D8) — SA09 checks no prompt.
16. **Gutter positioning** cannot be observed without a canvas; only presence, order, kind and text are pinned.

Missing literals in `strings.ts`: **none**.
