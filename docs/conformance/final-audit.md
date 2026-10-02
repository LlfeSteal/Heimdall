# Final conformance audit — wave 3 (screens, strings, ledger)

Checker: independent SPEC → code comparison (2026-10-02). I read the code myself. I did not rely on tests or
builder reports to decide a verdict. Precedence: Amendment A and "Implementation notes" override the body.
Paths are relative to `frontend/src/` unless stated otherwise. Verdicts: **MATCH**, **MISMATCH**,
**MISSING**, **AMBIGUOUS**. Ledger: **REPRODUCED**, **CHANGED-BY-AMENDMENT**, **DEVIATION**.

---

## 1. Screens table

### Shell and group list (§3, §3.1, A.3, A.4, §14.2)

| # | Rule | § | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| S-01 | Two screens chosen by state. No router, deep link, `history` or `location` writes | §3, #20 | MATCH | App.tsx:20-43 | grep: no `history.`/`location.`/router in production code |
| S-02 | Title `Heimdall` | §3.1 | MATCH | screens/GroupList.tsx:24 | |
| S-03 | Guidance `Select a {TERM} under {ROOT} to view its iterations.`, root shown as code | A.4 | MATCH | GroupList.tsx:79-91; strings.ts:7 | |
| S-04 | Guidance line is a screen element (§3.1 lists it next to the title, not as a state) | §3.1 | AMBIGUOUS | GroupList.tsx:79-91 | Shown only in the populated state. In the empty state the A.4 body replaces it, and during loading the root is not yet known. Defensible either way. |
| S-05 | Loading = three placeholder cards with no text | §3.1, §13 | MATCH | GroupList.tsx:35-40 | Covers both the config read and the groups read |
| S-06 | Failure = `Loading error`, verbatim message, `Retry` that bypasses the cache | §3.1 | MATCH | GroupList.tsx:16-19, 27-34; api/queries.ts:22-23 | `gen+1` ⇒ `?refresh=1`. A failed config read is re-fetched too. |
| S-07 | Nothing eligible: `No {TERM} found` + A.4 body with `{ROOT}` as code + `Refresh` | A.4 | MATCH | GroupList.tsx:64-77 | |
| S-08 | `Available {TERM}s (n)`, n = **cards**, plus `Refresh` | §3.1, #3, A.3.8 | MATCH | GroupList.tsx:82-86 | |
| S-09 | Card shows its own segment, display name and full path, in contract order | A.3.6-7 | MATCH | GroupList.tsx:93-99 | Order comes from the backend |
| S-10 | Tiles show name + own segment. Clicking a tile selects that child only | §3.1, A.3.7 | MATCH | GroupList.tsx:100-115 | Tiles are siblings of the card button, not nested in it |
| S-11 | Group-list `Refresh`/`Retry` re-read groups with freshness forced, nothing else | §14.2 | MATCH | GroupList.tsx:58-62; queries.ts:22-23 | |
| S-12 | Re-entering a group re-reads its iterations (the only way to see new ones) | §14.2, #16 | MATCH | App.tsx:26-35; queries.ts:26-27 | The `entry` counter is part of the key |

### Review screen: header, chooser, centre (§3.2, §5.3, §14.3)

| # | Rule | § | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| S-13 | Header: title, group name, full path, `Refresh` | §3.2 | MATCH | screens/IterationReview.tsx:53-64 | |
| S-14 | Score in the header **only** while no iteration is chosen, in the chart card once one is, never both | §3.2 | MATCH | IterationReview.tsx:50, 60, 145 | One `scorePanel` element, rendered in exactly one of the two places |
| S-15 | `← Back to {TERM}s` and `Iterations` | §3.2 | MATCH | components/IterationChooser.tsx:18-21 | |
| S-16 | Rail loading shows three placeholder rows | §3.2 | MATCH | IterationChooser.tsx:22-27 | |
| S-17 | Rail failure shows the verbatim error | §3.2 | MATCH | IterationChooser.tsx:28-29 | |
| S-18 | None shows `No iteration found for this {TERM}.` (also when every iteration is upcoming) | §3.2 | MATCH | IterationChooser.tsx:30-31 | |
| S-19 | Row = title, `start → due`, state badge. The chosen row is highlighted | §3.2 | MATCH | IterationChooser.tsx:34-48; App.css:128 | `aria-current="true"` + CSS |
| S-20 | Upcoming iterations are never listed | §5.3 | MATCH | IterationChooser.tsx:15 | |
| S-21 | Auto-select the first non-upcoming iteration of the **unfiltered** list. All upcoming ⇒ nothing selected | §5.3, #6 | MATCH | IterationReview.tsx:40, 83-85 | |
| S-22 | Nothing chosen shows `Select an iteration to display the charts.` | §3.2 | MATCH | IterationReview.tsx:84 | |
| S-23 | Loading shows `Loading data…` placeholder in the region, with no global spinner | §3.2, §13 | MATCH | IterationReview.tsx:163-170 | |
| S-24 | Failure shows the verbatim text. `reportError` is shown verbatim. Missing report or empty series shows `No burnup data found…` | §3.2, §14.3, Impl. notes | MATCH | IterationReview.tsx:171-176 | A missing report entry (older than the newest 50) also shows `noBurnupData` |
| S-25 | Chart only when data has arrived, nothing failed and the series is non-empty. Never an empty frame | §14.3 | MATCH | IterationReview.tsx:162-177 | No `<Line>` in any other branch. Keys are per refresh generation, so no stale data is shown |
| S-26 | Iteration header in the card: title, range, badge | §3.2 | MATCH | IterationReview.tsx:140-144 | |
| S-27 | View switch `Burndown` / `Burnup` | §3.2 | MATCH | IterationReview.tsx:181-188 | `aria-pressed` |
| S-28 | Delivery summary: green dot `Completed` % + `d of c`, blue dot `In Progress` % + pair. Percent 0 when committed is 0. One decimal | §3.2 | MATCH | components/DeliverySummary.tsx:6-23; domain/metrics.ts:59-74; App.css:160-162 | |
| S-29 | Summary and metrics strips "shown when the iteration carries a report" | §3.2, §12 | AMBIGUOUS | IterationReview.tsx:176-191 | A report whose series is empty shows `noBurnupData` and hides both strips. §14.3 puts the failure state in place of the whole chart row, so this is a defensible reading. |
| S-30 | Metrics strip next to the view switch: `Deviation: x.x%`, `Diff: ±x.x pts`, tones per A.6, for the **displayed** iteration | §12, A.6 | MATCH | components/MetricsStrip.tsx:5-16; metrics.ts:17-42; IterationReview.tsx:180-190 | |
| S-31 | Every region loads and fails on its own: a slow score does not block the chart, and a failed chart keeps the rail | §14.3 | MATCH | IterationReview.tsx:66-87, 99-107 | Chart and score share one read (§5.2), so the score can never be slower than the chart. The rail is rendered in every state. |
| S-32 | Choosing another iteration at once discards the chart, its history, the selection and unsaved text | §14.3, §10.3 | MATCH | IterationReview.tsx:40, 47, 174; annotations/useAnnotations.ts:93-98 | Reset happens during render with no prompt |
| S-33 | Review `Refresh` re-reads the reports (curve, history, score) with `refresh=1`. It never re-reads iterations or groups | §14.2, #16 | MATCH | IterationReview.tsx:61; queries.ts:26-33 | The selection is kept |
| S-34 | One report read per group serves chart, history and score. Switching iteration does not re-read | §5.2 | MATCH | IterationReview.tsx:43, 194-200; queries.ts:32-33 | |
| S-35 | End-to-end freshness ≤ 5 min ("data can be up to 5 minutes stale") | §14.1, #18 | **MISMATCH** (low) | api/queries.ts:13; App.tsx:12 | Browser `staleTime: 5 min` sits on top of the backend TTL of 5 min. On re-entering a group, or going back to the list, the browser cache serves an answer that the backend may have produced up to 5 min before. Total staleness can reach about 10 min. |

### Predictability score panel (§11.2, §11.3)

| # | Rule | § | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| S-36 | Compact panel `Average over the last 4 sprints` with four right-aligned figures | §11.3 | MATCH | components/ScoreCompact.tsx:5-28; App.css:186-188 | |
| S-37 | Formats: `8.8 %`, `+2.5 pts`, `50 %`, `32.0 pts` | §11.3, §15.3 | MATCH | domain/predictability.ts:88-101; domain/format.ts:17-34 | |
| S-38 | Tones good/caution/poor (A.6). Median velocity is never coloured | §11.3, A.6 | MATCH | ScoreCompact.tsx:12-24; domain/colorScale.ts:14-28 | |
| S-39 | Expanded layout is implemented and unreachable | §11.3, #19 | MATCH | ScorePanel.tsx:17, 20-29; ScoreExpanded.tsx | No caller passes `layout` (grep) |
| S-40 | Loading shows `Predictability scores...` | §11.3 | MATCH | ScorePanel.tsx:41-42; IterationReview.tsx:99, 103 | |
| S-41 | Failure shows `Error: {message}` | §11.3 | MATCH | ScorePanel.tsx:47-48; IterationReview.tsx:100, 104 | |
| S-42 | No closed iteration ⇒ `No score available` and **no data read** for the score | §11.2, §15.3 | MATCH | IterationReview.tsx:42-43, 101 | Reports are read only when there is a selection (for the chart) or a closed iteration |
| S-43 | 30 s ⇒ `Timeout exceeded (30s)`. A late result for the same request is discarded. `Refresh` starts again | §11.3, #21 | MATCH | screens/useTimedOut.ts:7-15; IterationReview.tsx:44, 102 | Sticky per `path|gen`. The chart still renders the late data. |
| S-44 | The timeout covers the **whole** score computation | §11.3 | **MISMATCH** (low) | IterationReview.tsx:44, 99 | The timer runs only while `reports.isLoading`. The score also needs the iterations read (its closed set). If that read hangs, the panel shows `Predictability scores...` until the backend gives up after 90 s, not 30 s. |

### Charts (§7.4-§7.6, §9, §10.5, §3.6, §13)

| # | Rule | § | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| S-45 | Burndown datasets are only `Remaining`, `Ideal`, `Forecast` | §3.2, §7.4 | MATCH | components/BurndownChart.tsx:72-112 | |
| S-46 | Remaining: solid, filled, dots visible, gaps **break** the line | §7.4 | MATCH | BurndownChart.tsx:76-88 | `spanGaps:false`, `fill:'origin'` |
| S-47 | Ideal: thin dashed grey line, no dots | §7.4, §13 | MATCH | BurndownChart.tsx:89-98 | |
| S-48 | Forecast: dashed, warm accent, no dots, **bridges** gaps | §7.4, §13 | MATCH | BurndownChart.tsx:99-109 | `spanGaps:true` |
| S-49 | Today's dot in the warm accent on a live iteration only | §7.4, §13 | MATCH | BurndownChart.tsx:86-87; domain/model.ts:74 | `todayIndex = -1` when closed |
| S-50 | Tolerance line: dashed green at 10 %. None when committed ≤ 0 | §7.5 | MATCH | BurndownChart.tsx:144-154 | |
| S-51 | Titles `Burndown Chart` / `Burnup Chart`. Legend from dataset labels | §3.2 | MATCH | BurndownChart.tsx:128-129; BurnupChart.tsx:121-122 | |
| S-52 | Green `Deviation +10 %` / orange `Deviation +{n} %` visibility (live, ≥ 1 %, committed > 0) | §9, §15.6 | MATCH | domain/deviationLabels.ts:36-50; components/DeviationGutter.tsx:15-26 | |
| S-53 | Labels sit in a gutter **outside** the plot and never use annotation-plugin entries | §9 | MATCH | BurndownChart.tsx:67, 124 | Right padding = gutter width. The overlay sits in that padding. |
| S-54 | Gutter reserved **only** when a label exists | §9 | MATCH | BurndownChart.tsx:67, 124; deviationLabels.ts:53-55 | |
| S-55 | Placement: real y scale, top-to-bottom, push down by one label height, clamp to plot. Horizontal anchor = gutter's **outer** edge | §9 | MATCH | BurndownChart.tsx:203-223; DeviationGutter.tsx:22; App.css:168-180 | `right:0` in a box aligned to the canvas's right edge. Centres use `translateY(-50%)`. The 20 px label height equals the CSS 18 px line + 2 px border. `setPositions` runs only when positions change, so there is no render loop. |
| S-56 | One callout per annotation, anchored to its point, drawn **behind** data lines, blue for Information and red for Risk | §3.6, §10.5, §13 | MATCH | BurndownChart.tsx:166-189 | `drawTime:'beforeDatasetsDraw'`, `callout.display`, dashed connector |
| S-57 | Stacking offsets in workload units, unclamped. Uniform horizontal push proportional to chart width. Vertical direction by half of the range | §10.5, #11, #12 | MATCH | BurndownChart.tsx:160-170, 186-200; domain/annotationGeometry.ts | |
| S-58 | Label box sized from the §10.5 estimate (150-unit budget, 25 chars/line, ≤ 3 lines) | §10.5 | **MISMATCH** (low) | BurndownChart.tsx:171-189 | `annotationLabelSize` feeds stacking only. Chart.js measures the box it draws, so a 400-character line becomes one very wide box across the plot instead of being capped at about 164. Lines after the third are dropped, which matches the spec. |
| S-59 | Tooltip lists **all** annotation texts for the hovered date, one per line | §3.6, #13 | MATCH | BurndownChart.tsx:131-135 | |
| S-60 | Clicking "a point on the curve" opens the dialogue for that date | §3.6, §10.3 | **MISMATCH** (low) | components/chartSetup.ts:47-51; BurndownChart.tsx:123; BurnupChart.tsx:117 | With `interaction {mode:'index', intersect:false}`, a click anywhere in the plot returns the nearest index. That includes future dates where only Ideal or Forecast exist, and gap dates. The note is then pinned to a date with no recorded point and drawn at value 0 (BurndownChart.tsx:156-162). |
| S-61 | Burnup: `Completed` (green, filled, gentle curve, dots), `Total scope` (neutral, dashed), `Ideal`, `Forecast` | §7.6, #8 | MATCH | BurnupChart.tsx:44-92 | |
| S-62 | Burnup annotations are amber dots only: no text, callout or stacking | §7.6 | MATCH | BurnupChart.tsx:99-112 | One point per distinct date on the axis |
| S-63 | Burnup has no tolerance line and no gutter | §7.6 (res. 7) | MATCH | BurnupChart.tsx:113-125 | |
| S-64 | Burnup tooltip has no annotation texts | §3.6 vs §7.6 | AMBIGUOUS | BurnupChart.tsx:120-124 | §3.6 is general. §7.6 says burnup has "no text". Recorded as res. 8. |

### Annotations UI (§3.3-§3.5, §10.3, §10.4)

| # | Rule | § | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| S-65 | Rail: `Annotations ({n})`, empty-state literal, list in save order, help box with three lines | §3.2, §3.4 | MATCH | components/AnnotationList.tsx:14-42 | |
| S-66 | Item: amber card with date, `by {author}`, `Edit`, `Delete`, text (newlines kept) | §3.4, §13 | MATCH | AnnotationList.tsx:19-35; App.css:198-208 | The left border shows the type colour. The card is amber. |
| S-67 | Dialogue directly under the chart. `Add annotation`/`Edit annotation`, `Date: {date}` | §3.3 | MATCH | IterationReview.tsx:146-156; components/AnnotationDialog.tsx:26-28 | |
| S-68 | `Type`: `Information` (blue) / `Risk` (red); the chosen one is filled | §3.3 | MATCH | AnnotationDialog.tsx:29-45; App.css:218-221 | |
| S-69 | Placeholder `Explain the deviation...`. Text required. Newlines allowed (not a form) | §3.3 | MATCH | AnnotationDialog.tsx:46-61 | Action disabled while the trimmed text is empty |
| S-70 | Actions `Cancel`, `Add`/`Edit`. Closes on save or cancel | §3.3 | MATCH | AnnotationDialog.tsx:55-62; useAnnotations.ts:129-136 | |
| S-71 | Unsaved changes + click on a **different point** ⇒ `Unsaved changes will be lost. Continue?` | §3.5, §10.3 | MATCH | useAnnotations.ts:101-104, 119-121 | |
| S-72 | Same guard on list `Edit` | §3.5, §10.3 | MATCH | useAnnotations.ts:122-126 | |
| S-73 | Declining aborts everything | §3.5 | MATCH | useAnnotations.ts:103 | |
| S-74 | Point click selects the date and pre-fills with the **first** annotation of that date | §10.3, #13 | MATCH | useAnnotations.ts:120; annotations/lifecycle.ts | |
| S-75 | Save writes through and re-reads from storage. Delete re-reads. No optimistic state | §10.3 | MATCH | useAnnotations.ts:129-141 | |
| S-76 | Opening a group or leaving it clears everything | §10.3 | MATCH | App.tsx:33-39 (`key={entry}`, unmount) | |
| S-77 | Scoped by (group path, iid) | §10.2 | MATCH | IterationReview.tsx:47 | `iid` is used, not `id` |

### Display conventions (§13)

| # | Rule | § | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| S-78 | Colour semantics: blue remaining, warm today/forecast/forecast label, grey ideal, green tolerance and burnup delivered, neutral dashed committed, blue/red annotations, amber cards and markers | §13 | MATCH | chartSetup.ts:30-36; App.css:161-162, 179-180, 198-221; index.css:3-11 | The forecast label text is `#c2410c` (darker orange of the same warm accent) for contrast, with an orange border |
| S-79 | Loading = placeholders in the region. Failure = verbatim message in the region. Absence = a worded state | §13 | MATCH | see S-05/S-06/S-07, S-16-S-18, S-22-S-24, S-40-S-42, S-65 | |

**Screens totals (79 rows):** MATCH 72 · MISMATCH 4 (S-35, S-44, S-58, S-60, all low) · MISSING 0 ·
AMBIGUOUS 3 (S-04, S-29, S-64).

---

## 2. Strings table

Method: every literal in §13 (as replaced by A.4) and §3 was compared character by character with
`strings.ts`, including the special characters. A Python scan of `strings.ts` found exactly one `←`
(U+2190), one `→` (U+2192) and two `…` (U+2026, in `Loading data…` and `Calculating…`). The two `...`
are ASCII, in `Predictability scores...` and `Explain the deviation...`. Then each literal was traced to
a reachable render site.

| Literal (spec) | strings.ts | Rendered at | Verdict |
|---|---|---|---|
| `Heimdall` | :4 | GroupList.tsx:24; IterationReview.tsx:54; index.html `<title>` | MATCH |
| *Select a {TERM} under `{ROOT}` to view its iterations.* (A.4) | :7 | GroupList.tsx:79-91 | MATCH |
| `Loading error` | :8 | GroupList.tsx:29 | MATCH |
| `Retry` | :9 | GroupList.tsx:32 | MATCH |
| `Refresh` | :10 | GroupList.tsx:60; IterationReview.tsx:62 | MATCH |
| `No {TERM} found` | :11 | GroupList.tsx:68 | MATCH |
| *No {TERM} with iteration data was found under `{ROOT}`. Check that your token has access to the relevant groups.* (A.4) | :12-16 | GroupList.tsx:65-73 | MATCH |
| `Available {TERM}s (n)` | :17 | GroupList.tsx:84 | MATCH |
| `← Back to {TERM}s` | :20 | IterationChooser.tsx:19 | MATCH (U+2190) |
| `Iterations` | :21 | IterationChooser.tsx:17, 21 | MATCH |
| *No iteration found for this {TERM}.* | :22 | IterationChooser.tsx:31 | MATCH |
| *Select an iteration to display the charts.* | :23 | IterationReview.tsx:84 | MATCH |
| `Loading data…` | :24 | IterationReview.tsx:166 | MATCH (U+2026) |
| *No burnup data found for this iteration (check permissions or format).* | :25 | IterationReview.tsx:176 | MATCH |
| `start → due` | :26 | IterationChooser.tsx:44; IterationReview.tsx:142 | MATCH (U+2192) |
| `Burndown`, `Burnup` | :28-29 | IterationReview.tsx:183, 186 | MATCH |
| `Burndown Chart`, `Burnup Chart` | :30-31 | BurndownChart.tsx:128; BurnupChart.tsx:121 (Chart.js title) | MATCH |
| `Remaining`, `Ideal`, `Forecast`, `Completed`, `Total scope` | :32-36 | BurndownChart.tsx:77, 90, 100; BurnupChart.tsx:49, 60, 70, 80 (Chart.js legend) | MATCH |
| `Completed`, `In Progress`, `of` | :38-40 | DeliverySummary.tsx:12, 18; metrics.ts:71-72 | MATCH |
| `Deviation:`, `Diff:` | :42-43 | metrics.ts:37-39 → MetricsStrip.tsx:10, 13 | MATCH |
| `Predictability scores...` | :46 | ScorePanel.tsx:42 (compact) | MATCH (ASCII dots) |
| `Calculating…` | :47 | ScorePanel.tsx:42, expanded branch only | MATCH, exists and unreachable (#19, res. 5) |
| `Error: {message}` | :48 | ScorePanel.tsx:48 | MATCH |
| `Timeout exceeded (30s)` | :49 | ScorePanel.tsx:46 | MATCH |
| `No score available` | :50 | ScorePanel.tsx:44 (compact) | MATCH |
| `No data available` | :51 | ScorePanel.tsx:44, expanded only | MATCH, unreachable (res. 5) |
| `Average over the last 4 sprints` | :52 | ScoreCompact.tsx:8 | MATCH |
| `Predictability score` | :53 | ScoreExpanded.tsx:9 | MATCH, unreachable |
| `Average deviation`, `Delivery diff.`, `Compliant sprints`, `Median velocity` | :54-57 | ScoreCompact.tsx:11-23 | MATCH |
| `Under-delivered`, `Over-delivered` | :58-59 | predictability.ts:95 → ScoreExpanded.tsx:18 | MATCH, unreachable (compact has no caption) |
| `(< 10% average deviation)` | :60 | ScoreExpanded.tsx:24 | MATCH, unreachable |
| `Points delivered per sprint (median)` | :61 | ScoreExpanded.tsx:26 | MATCH, unreachable |
| `{n} sprint` / `{n} sprints analyzed` | :62 | predictability.ts:99 → ScoreExpanded.tsx:10 | MATCH, literal reading (n = 1 ⇒ `1 sprint`). Unreachable. |
| `pts` | :63 | format.ts:18, 23 | MATCH |
| `Deviation +10 %` | :66 | deviationLabels.ts:40 → DeviationGutter.tsx:24 | MATCH (space before `%`) |
| `Deviation +{n} %` | :67 | deviationLabels.ts:46 → DeviationGutter.tsx:24 | MATCH |
| `Annotations ({n})` | :70 | AnnotationList.tsx:14 | MATCH |
| `No annotation for this iteration` | :71 | AnnotationList.tsx:16 | MATCH |
| `by {author}` | :72 | AnnotationList.tsx:23 | MATCH |
| `Edit`, `Delete`, `Cancel`, `Add`, `Edit` | :73-76 | AnnotationList.tsx:27, 30; AnnotationDialog.tsx:57, 60 | MATCH |
| `Add annotation` / `Edit annotation` | :77-78 | AnnotationDialog.tsx:27 | MATCH |
| `Date: {date}` | :79 | AnnotationDialog.tsx:28 | MATCH |
| `Type`, `Information`, `Risk` | :80-82 | AnnotationDialog.tsx:17-18, 30 | MATCH |
| `Explain the deviation...` | :83 | AnnotationDialog.tsx:50 | MATCH (ASCII dots) |
| `Unsaved changes will be lost. Continue?` | :84 | useAnnotations.ts:103 (`window.confirm`) | MATCH |
| `How to use`, `- Click a point to annotate`, `- Annotations stored locally` | :85-87 | AnnotationList.tsx:39-41 | MATCH |
| `Current User` (§10.3) | :88 | lifecycle.ts:150 → AnnotationList.tsx:23 | MATCH |

Number formats from §13 and §11.3: one-decimal `8.8 %`, whole `50 %`, summary `90%`, metrics `10.0%`,
signed `+2.5 pts`, forecast label whole number. All MATCH (format.ts:6-39; domain.md res. 14).

**Hard-coded English:** none. A grep of `components/`, `screens/` and `App.tsx` found no JSX text nodes
with words and no `aria-label`/`title`/`placeholder`/`alt` string attributes. The only `aria-label` is
`S.iterationsHeading`. The only user-visible literal outside `strings.ts` is the client fallback
`HTTP <status>` (api/client.ts:16), used only when the backend sends no `{error}` body. It is not a spec
literal, so this is acceptable.

**Strings totals:** 48 rows, all MATCH. Nothing is missing. The 8 expanded-only literals exist and are
unreachable, as required.

---

## 3. Ledger table (§16)

| # | Behaviour | Verdict | Evidence |
|---|---|---|---|
| 1 | Group search capped at 100, substring-based | CHANGED-BY-AMENDMENT (A.1, A.3.1) | backend/internal/gitlab/http.go:108-112, 172-185: `descendantGroups` paginated until `hasNextPage=false` |
| 2 | Iteration reads unpaginated | REPRODUCED | http.go:190-193: `/api/iterations` reads only the first page (`first:100`). The reports read paginates by design (Implementation notes; http.go:200-232). |
| 3 | Heading counts cards | REPRODUCED (A.3.8) | GroupList.tsx:84 |
| 4 | Synthetic parent card | CHANGED-BY-AMENDMENT (A.3.5) | A depth-1 group with no data is kept when a child passes. backend/internal/groups/groups.go:166-178, 221 synthesise a card when the parent is missing from the descendants list (backend res. 2). |
| 5 | Card replacement drops children | CHANGED-BY-AMENDMENT (A.3, marked "no longer applicable") | Cards are built from the hierarchy (groups.go) |
| 6 | Chooser hides upcoming; auto-select scans the unfiltered list | REPRODUCED | IterationReview.tsx:40; IterationChooser.tsx:15. The divergence in the ledger cannot happen under the written rules (screens res. 1). |
| 7 | Remaining never floored | REPRODUCED | domain/curve.ts:131-134 (domain.md audit) |
| 8 | Burnup Ideal descends, Forecast saturates | REPRODUCED | curve.ts:228-240 → BurnupChart.tsx:69-89 |
| 9 | "Today" = UTC day | REPRODUCED | domain/dates.ts:17-19; BurndownChart.tsx:37 |
| 10 | Axis days use mixed local/UTC conventions | **DEVIATION** | dates.ts:10-29 do all calendar arithmetic in UTC, so the off-by-one is **not** reproduced. This is a deliberate change, but it is recorded only in `domain.md` res. 4, not in SPEC (no A.x and no Implementation note). |
| 11 | Annotation offsets in workload units, unclamped | REPRODUCED | annotationGeometry.ts:78-106; BurndownChart.tsx:187-199 convert workload units to px through `scales.y` with no clamp |
| 12 | Uniform horizontal push | REPRODUCED | BurndownChart.tsx:170, 186: `sign × 0.04 × chart.width` per side |
| 13 | Tooltip shows all; editing opens the first | REPRODUCED | BurndownChart.tsx:131-135; useAnnotations.ts:120 |
| 14 | Fixed author; clock ids | REPRODUCED | lifecycle.ts:146-153 |
| 15 | Annotations in one browser | REPRODUCED | annotations/storage.ts (localStorage, `heimdall-annotations.v1`) |
| 16 | `Refresh` re-reads the curve and score only | REPRODUCED | IterationReview.tsx:61; queries.ts:26-33 |
| 17 | Unknown state counts as live | REPRODUCED | domain/state.ts:7-14; model.ts:65, 74 |
| 18 | Data up to 5 minutes stale | **DEVIATION** | Backend TTL is 5 min (backend/internal/cache/cache.go:31). The extra browser cache (queries.ts:13, `staleTime` 5 min) makes it up to about 10 min. Unrecorded. Same root cause as S-35. |
| 19 | Expanded score implemented but unreachable | REPRODUCED | ScorePanel.tsx:17-29; ScoreExpanded.tsx |
| 20 | Nothing deep-linkable; reload returns to the list | REPRODUCED | App.tsx:10-43 (state only, one client per mount) |
| 21 | Score gives up after 30 s | REPRODUCED (see S-44 for the iterations-read gap) | useTimedOut.ts:7; IterationReview.tsx:44 |

**Ledger totals:** REPRODUCED 16 (#2, 3, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21) ·
CHANGED-BY-AMENDMENT 3 (#1, 4, 5) · DEVIATION 2 (#10, 18).

---

## 4. Resolutions review (all four conformance docs)

| Doc / item | Verdict | Note |
|---|---|---|
| screens res. 1 (ledger #6) | Consistent | Literal rule implemented. The ledger's effect cannot occur under the written rules. |
| screens res. 2 (raw series non-empty) | Consistent | Matches §4.4. A live iteration with an empty raw series shows `noBurnupData` even though §7.2 would add a today point. This edge is accepted. |
| screens res. 3, 4, 6, 9, 10, 11, 13, 14, 15, 16 | Consistent | |
| screens res. 5 (compact = `Predictability scores...`/`No score available`) | Consistent | §11.3 names `Predictability scores...` for the panel. Pairing `No data available` with the expanded layout is a recorded choice. |
| screens res. 7 (burnup: no tolerance/gutter) | Consistent | §7.5/§9 are written for the burndown. §7.6 says "deliberately simpler". |
| screens res. 8 (burnup markers, no burnup tooltip footer) | Recorded, AMBIGUOUS (S-64) | |
| screens res. 10 ("pinned at the HTTP level too, staleTime 5 min") | **Inconsistent side-effect** | The resolution meets §5.2, but stacking a second 5-minute cache breaks #18 and §14.1 (S-35). Not recorded. |
| screens res. 12 (empty text ⇒ disabled action) | Consistent | |
| annotations D1-D12 (incl. D3 as fixed in round 1) | Consistent | Previous checker verified these. D3 now prompts only when dirty. |
| domain res. 1-3, 5-9, 11-16, 18 | Consistent | |
| domain res. 4 (ledger #10 not reproduced) | **Recorded only in domain.md** | §16 allows "change it deliberately and record the change". The record belongs in SPEC (Implementation notes). See ledger #10. |
| domain res. 10 (burnup without due date) | Consistent (accepted) | |
| domain res. 17 | Superseded | The round-1 fix (`settle`) colours a mean of three 0.1 values as good. The text of res. 17 is stale; the fixes table notes this. |
| backend res. 1-5, 8-10 | Consistent | Res. 8 is now fixed by the Implementation notes ("keeps the newest 50 by §5.1"). |
| backend res. 6 (refresh joins an in-flight fetch) | Recorded, minor tension | §14.1 says "the remembered answer is discarded and GitLab is consulted again". Joining a fetch that started before the click can return pre-click data. Acceptable, but not in SPEC. |
| backend res. 7 (LRU instead of "oldest dropped first") | Recorded in backend.md only | This was an orchestrator decision. "Oldest" can be read as "least recently used". Add one Implementation-note line so it is on record. |

---

## 5. Quality notes (light sweep)

- **Type casts:** there are no `any` casts. One type lie: `closedForScore(list as IterationReport[])`
  at IterationReview.tsx:42 casts plain `Iteration[]` to `IterationReport[]`. Make `closedForScore` generic
  (`<T extends { state: string }>(xs: T[]) => T[]`). Non-null assertions appear only in domain code on
  invariants (curve.ts:146, 229; deviationLabels.ts:44).
- **Dead code:** `formatDateRange` (format.ts:42) and `ANNOTATION_LABEL.WIDTH_BUDGET` are never used.
  `BurndownModel.live`, `forecastStrategy` and `series`, and `UseAnnotationsResult.dirty`/`selectedDate`,
  are used only by tests. All harmless. `ScoreExpanded` is unreachable on purpose (#19).
- **Effect loops:** none found. `useAnnotations` resets state during render behind a `pairKey` guard.
  The gutter plugin calls `setPositions` only when a position moves by ≥ 0.5 px. `data`/`options` are
  memoised on `[model, annotations]`. `annotations` is state, so its identity is stable while the user
  types. Click handlers go through refs, so Chart.js options are **not** rebuilt on each keystroke
  (BurndownChart.tsx:45-62; BurnupChart.tsx:25-35). The gutter `plugins` array is created once
  (react-chartjs-2 reads it only at creation).
- **Leaks:** `useTimedOut` clears its timer (useTimedOut.ts:12). Chart.js instances are owned and destroyed
  by react-chartjs-2. Per-entry and per-generation query keys build up in the QueryClient, but TanStack
  garbage-collects them after 5 minutes of inactivity. `useForgetRefreshedReports` also drops refreshed
  report entries when you leave a group.
- **Accessibility:** every interactive element is a `<button>`: cards, tiles, rows, view switch, type
  choice and actions. Toggles use `aria-pressed`, the selected row uses `aria-current`, and the score panel
  is `aria-live`. Gaps:
  1. Focus does not move into the annotation dialogue when it opens. There is no `autoFocus` on the
     textarea, and a keyboard user editing from the list stays on the list.
  2. The textarea's accessible name is the dialogue heading (`aria-labelledby`), not its own label.
  3. The chart `<canvas>` has no text alternative, and the points cannot be reached by keyboard. Adding an
     annotation from a point therefore needs a mouse (editing from the list works by keyboard).
  4. The view-switch `role="group"` has no label.
  5. The group-list and rail errors have no `role="alert"`; the chart error does.
- **Perf:** the production bundle is 501.6 kB (162 kB gzip), just over Vite's 500 kB warning, because of
  Chart.js and the annotation plugin. Code-split the review screen (`React.lazy`) if this matters.
  `scoreState` recomputes the ≤ 4-iteration score on every render. This is trivial.
- **Lint:** oxlint reports 11 warnings, 0 errors, all in the test helper `src/test/chartMock.tsx`. Three
  `oxlint-disable react/refs` comments in production code have justifications and are correct (refs are
  read only in Chart.js callbacks).

---

## 6. Runs (2026-10-02)

| Command | Result |
|---|---|
| `cd frontend && npx vitest run` | **21 files, 372 tests passed**, 0 failed (57 s) |
| `npx tsc -b --noEmit` | exit 0 |
| `npx oxlint src` | exit 0: 11 warnings (test helper only), 0 errors |
| `npm run build` | exit 0: `dist/assets/index-*.js` 501.64 kB / gzip 162.24 kB (chunk-size warning) |
| `cd backend && GOFLAGS=-buildvcs=false go test -count=1 ./...` | **ok** in all 9 packages with tests (`api`, `cache`, `config`, `gitlab`, `groups`, `iterations`, `mock`, `reports`, `service`); `cmd/heimdall` has no tests |

---

## Summary

**Counts.** Screens: MATCH 72 · MISMATCH 4 · MISSING 0 · AMBIGUOUS 3. Strings: 48/48 MATCH; nothing
missing and no hard-coded English. Ledger: REPRODUCED 16 · CHANGED-BY-AMENDMENT 3 · DEVIATION 2.
Resolutions: one has an unrecorded side-effect (screens res. 10). Two are recorded only in the conformance
docs and not in SPEC (domain res. 4; backend res. 7, and res. 6 to a lesser degree). All runs pass.

**Items to fix, most severe first:**

1. **S-35 / ledger #18 (DEVIATION, low-medium): two caches stack, so data can be up to about 10 min old.**
   queries.ts:13 sets `staleTime: 5 min` in the browser on top of the backend's 5-minute TTL. Fix: set
   `staleTime: 0` (or a few seconds) and keep §5.2 "no re-read when switching iteration" through the
   mounted observer. The reports query key does not change when switching, and focus/reconnect refetch is
   already off. Alternatively, add `entry` to the reports key like the iterations key. Then check
   SR13/SR21-SR23 still hold. If the longer staleness is wanted, record it in SPEC instead.
2. **S-44 (MISMATCH, low): the score timeout ignores the iterations read.** Fix:
   `useTimedOut(\`${path}|${gen}\`, iterations.isPending || (closed.length > 0 && reports.isLoading))`.
3. **S-60 (MISMATCH, low): clicking any empty spot in the plot opens a dialogue for the nearest date**,
   including future dates and gap dates. Fix in `pointClickHandler`: take the first element whose index
   has a recorded value in the primary series (`remaining[i] !== null` for burndown, `completed[i] !==
   null` for burnup). Add a test that clicks an index after the last recorded point and expects no dialogue.
4. **S-58 (MISMATCH, low): the drawn callout box is measured by Chart.js, not sized from the §10.5
   estimate**, so long lines are not wrapped or capped at about 164. Fix: give the label annotation
   `width`/`height` from `annotationLabelSize(text)`, and wrap or truncate content lines at 25 characters
   (≤ 3 lines).
5. **Ledger #10 (DEVIATION, low, documentation only):** add an Implementation note to `SPEC.md`: "All
   calendar arithmetic is UTC, so ledger #10's local/UTC off-by-one is deliberately not reproduced." In the
   same edit, record backend res. 7 (LRU, capacity 256, TTL not extended by hits).
