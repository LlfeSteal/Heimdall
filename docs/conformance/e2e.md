# Conformance — end-to-end (wave 3, real browser)

Scope: the user-visible acceptance behaviour of SPEC §3, §5.3, §7.4–§7.6, §9, §10.3–§10.5, §11.3, §12, §13,
§14, §15.6/§15.8, Amendment A and the Implementation notes (HTTP contract, `reportError`), exercised in
**headless Chromium** (Playwright) against the real SPA (`vite` dev server, `/api` proxied) and the real Go
backend in mock mode (`GITLAB_MOCK=1 ROOT_GROUP=org/delivery`, fixture `backend/internal/mock/fixture.go`,
dates relative to today UTC). These checks cover what the jsdom suites could not see: the canvas, layout,
pixel positions, the tooltip, `window.confirm`, `localStorage` across a real reload, and real network traffic.

Run:

```sh
cd frontend
npx playwright install chromium          # once
npm run e2e                              # starts backend (go run, mock) + vite itself
E2E_SHOT_DIR=/some/dir npm run e2e       # also choose where screenshots go (default test-results/screenshots)
```

The config (`frontend/e2e/playwright.config.ts`) starts both servers through `webServer` and reuses servers
that are already running locally (`reuseExistingServer` unless `CI`). The vitest config excludes `e2e/**`.

**How the canvas is inspected.** `e2e/helpers.ts` imports Chart.js from the exact URL Vite served it under
(`/node_modules/.vite/deps/chart__js.js?v=…`), so `Chart.getChart(canvas)` returns the app's live instance.
From there the tests read the chart area, scales, point pixel positions, the legend, the tooltip and the
annotation plugin's drawn elements. Points are clicked at their real pixel centres. Two further checks look at
the pixels themselves: a pixel read confirms today's dot is painted in the accent, and a variance and
colour-count test confirms the canvas is not blank. This only works with the Vite **dev** server.

A suite-wide fixture fails any test that logs an uncaught page error or a `console.error`. The browser's own
"Failed to load resource" line for delta's intended 502 is ignored.

## Results — 23 scenarios: 22 pass, 1 fails as expected (defect D1)

| ID | Scenario | SPEC | Result |
|---|---|---|---|
| E-G1 | `Available ARTs (3)`; guidance with `org/delivery` as code; cards `alpha`/`beta`/`delta` in order with paths; tiles `team-1` (Team One) in alpha, `x` in beta, none in delta; `gamma`, `team-2`, `zeta`, depth-3 `sub` absent; tile never shows a full path | §3.1, A.3–A.5 | PASS |
| E-G2 | Group-list `Refresh` issues exactly `/api/groups?refresh=1` and nothing else | §14.2 | PASS |
| E-G3 | Loading: three empty placeholder cards (groups read delayed by route) | §3.1, §13 | PASS |
| E-G4 | Navigating card → review → back never changes the URL or adds history entries | §3, ledger #20 | PASS |
| E-R1 | Opening alpha auto-selects the newest non-upcoming (`Sprint 7`, current); upcoming `Sprint 8` never listed; rows newest-first with `start → due` and badge; exactly one `aria-current` | §3.2, §5.3 | PASS |
| E-R2 | Burndown canvas non-blank (toDataURL > 20 kB, > 20 colours, luminance variance); title `Burndown Chart`; legend `Remaining, Ideal, Forecast`; axis start → due; **today's point exists** (not in the raw series, value = in-progress total, §7.2) and is the only accent-coloured dot, **painted** orange on the canvas; Remaining breaks after today; tolerance line at 10 % of committed; metrics strip + delivery summary present | §7.2–§7.5, §12, §13 | PASS |
| E-R3 | Gutter labels `Deviation +10 %` (green) and `Deviation +24 %` (warm): left edge ≥ plot right edge, right edge ≤ canvas edge (not clipped), inside the plot's vertical bounds, no overlap, centred (±2 px) on the y pixel of the value they annotate, ordered by value, forecast % = round(end/committed×100) | §9, §3.6, §13 | PASS |
| E-R4 | Closed `Sprint 6`: green label only, no accent dot; label re-placed for the new iteration's tolerance (±2 px) after switching | §7.4, §9, §15.6 | PASS |
| E-R5 | Burnup tab: title `Burnup Chart`, legend `Completed, Total scope, Ideal, Forecast`, colours green/neutral/accent, no tolerance line, no gutter, canvas non-blank; back to Burndown re-places the gutter correctly | §7.6 | PASS |
| E-R6 | Review `Refresh` (with `Sprint 5` selected): exactly one `/api/reports?group=org%2Fdelivery%2Falpha&refresh=1`, **no** `/api/iterations`, no `/api/groups`; selection kept | §14.2, ledger #16 | PASS |
| E-R7 | Switching iteration issues no read (1 reports + 1 iterations read in total); back + re-enter re-reads iterations and resets to auto-selection | §5.2, §14.2, §14.3 | PASS |
| E-R8 | delta: opens; iteration rail shows the verbatim GitLab message; centre `Select an iteration to display the charts.`; annotation rail + help box render; header score panel shows `Error: <verbatim>`; Refresh and Back present | §13, §14.3 | PASS |
| E-R9 | team-1 `Sprint 1` (`reportError`): chart region shows `Burnup chart could not be generated due to too many events` verbatim, no canvas, no view switch; score panel and annotation rail still render | Impl. notes, §14.3 | PASS |
| E-R10 | alpha `Sprint 1` (`report: null`): `No burnup data found for this iteration (check permissions or format).`, no canvas | §3.2, §14.3 | PASS |
| E-R11 | Score panel in the chart card (not the header): `Average over the last 4 sprints`, labels in order, four figures **recomputed in the test from `/api/reports`** per §11.2 (`27.9 %`, `+11.0 pts`, `25 %`, `37.0 pts` on today's fixture), tones per A.6, median velocity untoned | §11.2, §11.3, A.6 | PASS |
| E-A1 | Click a real canvas point → `Add annotation`, `Date: …`, `Type`, Add disabled while blank, dialogue below the canvas; Cancel; add Risk (2 lines) → list `by Current User`, red, text; canvas gets a red label entry, `drawTime: beforeDatasetsDraw`, content = lines; add Information (blue); storage carries the group path; **reload → group list** (no deep link), re-open → both still there; list `Edit` → `Edit annotation`, Risk pressed, text prefilled; change text → click another point → `confirm("Unsaved changes will be lost. Continue?")`; **dismiss** → dialogue, date and edited text unchanged; **accept** → `Add annotation` on the new date, edit discarded; point click on an annotated date opens the first for edit, save edit; no prompt without unsaved changes; Delete ×2 (no prompt) → `No annotation for this iteration`, storage empty | §3.3–§3.5, §10.3, §10.4, ledger #20 | PASS |
| E-A2 | Burnup: one amber `point` marker per annotated date, no text | §7.6 | PASS |
| E-A3 | Scoping: alpha and alpha/team-1 both auto-select iid 7. A note on alpha is absent from team-1 (rail and canvas). Deleting team-1's own note leaves alpha's in place, and another iteration of alpha has its own empty list. | §10.2, §15.8 | PASS |
| E-A4 | Changing iteration with unsaved text closes the dialogue without prompting | §10.3, §14.3 | PASS |
| E-V1 | Hover (real mouse) on a date with two annotations: tooltip title = date, footer = both texts in order; date without annotations: no footer; clicking it opens the **first** for edit | §3.6, ledger #13 | PASS |
| E-V2 | 1440 and 1280 px: left rail \| centre \| right rail side by side, top-aligned, centre widest; gutter labels inside the card; no horizontal scroll | §3.2 | PASS |
| E-V3 | 1024 px: grid reflows (annotations rail below); gutter labels still beside the plot and unclipped; no horizontal scroll | §9 | PASS |
| E-V4 | Lone annotation callouts are drawn inside the plot | §3.6, §10.5 | **FAIL (expected, `test.fail`) → D1** |

E-V4 is marked `test.fail`, so the suite stays green while still recording the defect. Once D1 is fixed or a
decision is made, Playwright will report the test as "unexpectedly passed". At that point, remove the marker.

## Screenshot observations

Full-page PNGs at 1440×1000 (except 06), saved to the session scratchpad
(`…/scratchpad/e2e/`): `01-group-list`, `02-review-burndown-annotations`, `03-burnup`,
`04-callouts-clipped` (and a card crop `04-closed-sprint-many-annotations`), `05-delta-error`, `06-review-1024`.

- **Group list (01).** Title, `Available ARTs (3)` + Refresh, guidance with the root as inline code, and three
  cards in a grid. Each card shows its label, name and path, plus tiles with name and segment. Clean, with no
  overlap. The category label is rendered in uppercase (`ALPHA`), see D3.
- **Review, burndown (02).** The §3.2 layout is correct: iteration rail on the left with the selected row
  highlighted and state badges, wide centre card, annotation rail on the right with the help box.
  - The header holds the title, group name and path, and Refresh. The score panel sits inside the chart card.
  - Colours follow §13:
    - Remaining is a filled blue line with dots, and today's dot is orange.
    - Ideal is dashed grey and Forecast is dashed orange.
    - The tolerance line is dashed green.
    - The gutter labels are green `Deviation +10 %` and orange `Deviation +24 %`. They sit in the reserved
      space right of the plot, aligned to their levels, outside the curves and not overlapping.
    - Metrics are tone-coloured.
  - The annotation cards in the rail are amber with a red or blue left edge.
  - **However, both annotations are invisible on the canvas.** Only their dashed callout leaders show, running
    off the top of the plot (D1).
- **Burnup (03).** Completed is a green filled curve with dots, Total scope is a dashed neutral line at 50, and
  the legend is complete. Ideal *descends* and Forecast sits flat on Total scope: this is known behaviour #8
  (§7.6) and is reproduced on purpose. The axis stops 7 days after the last point (10-09) rather than at the due
  date, which matches §7.6. There is no gutter and no tolerance line.
- **Callouts (04).** Five lone annotations were seeded on closed Sprint 6, at remaining values 46, 39, 31, 22
  and 10.
  - Points in the upper half (46, 39, 31) are pushed up by 20 workload units, roughly 105 px on a 0–50 axis.
    Their label boxes land above the plot and are clipped. The 31 label leaves only its bottom border at the
    plot's top edge.
  - The point at 10 is pushed below 0 and clipped.
  - Only the point at 22 shows a readable box. It is drawn behind the lines, with a red border for Risk, and
    its bottom border overlaps the x-axis by about 1.5 px.
  - Orphan dashed leaders cross the plot towards labels that cannot be seen.
- **Delta (05).** The error appears verbatim in red in the iteration rail. The score panel in the header shows
  `Error: …` in its own region. The centre shows its placeholder and the annotation rail is intact. Nothing is
  blanked or broken.
- **1024 px (06).** Two columns, with the annotation rail moved below. The chart and gutter are fine. In the
  narrower rail the `start → due` range wraps in the middle of a date (`2026-10-` / `10`), see D4.
- **Legend swatches (all charts).** The dashed series (Ideal, Forecast, Total scope) show up in the legend as
  solid filled blocks with a jagged border, not as dashed lines (D2).

## Defects

### D1 — High (needs a product decision). Lone annotation callouts are pushed outside the plot and vanish

- **Reproduce:**
  1. `npm run e2e -- --grep E-V4`, or by hand: open `alpha`. `Sprint 7` is auto-selected.
  2. Click the 2nd point (remaining 40), type text and press Add.
  3. The rail lists the note and the tooltip shows it. On the canvas there is only a dashed leader running off
     the top edge, and no label box.
  4. On closed `Sprint 6`, 4 of 5 lone notes are hidden (values 46/39/31 go above the plot, 10 goes below).
- **Expected (§3.6, §10.5):** "Annotation text is drawn as a callout box anchored to its point". §10.5 KNOWN
  BEHAVIOUR and ledger #11 accept labels being pushed off the top only on an **iteration crowded with
  annotations**.
- **Actual:** the fixed lift of 20 **workload units** applies even to a single label (§10.5 says "even a single
  label is lifted by one gap"). Upper-half points are pushed up and lower-half points down. On a team whose
  range is about 50 points, that is about 40 % of the plot height, so almost every lone label leaves the chart
  area. The annotation plugin clips it there (`clip` defaults to true). Labels are visible only for points near
  mid-range.
- **Likely file:** `frontend/src/components/BurndownChart.tsx`.
  - `workloadOffsetToPixels` turns the unit offset into a pixel `yAdjust`.
  - `yValue` stays at the point, so the plugin's `adjustScaleRange` cannot widen the y axis to include the label.
  - This literally follows §10.5 / ledger #11 (units, unclamped), but it defeats §3.6 for ordinary data.
- **Options:** this is a product decision; record it in §16.
  - Put the offset into `yValue` (value ± offset) so the y scale widens to hold the labels. This keeps
    workload units and no clamp.
  - Treat the gap as pixels.
  - Clamp to the chart area.

### D2 — Low (cosmetic). Legend swatches of dashed series render as filled blocks

- **Reproduce:** open any burndown or burnup chart and look at the legend entries `Ideal`, `Forecast`,
  `Total scope`.
- **Expected (§7.4, §7.6, §13):** "thin dashed reference line" / "dashed". A legend should read as the line it
  stands for.
- **Actual:** a 40×12 box filled solid with the line colour, outlined with a thick dashed stroke. It looks like
  a jagged blob.
- **Likely file:** `frontend/src/components/BurndownChart.tsx` and `BurnupChart.tsx`.
  - The datasets set `backgroundColor` equal to `borderColor` together with `borderDash`.
  - Fix with a transparent `backgroundColor` on unfilled datasets, or `plugins.legend.labels.usePointStyle` with
    `pointStyle: 'line'`.

### D3 — Low (cosmetic). Group-card category label is shown uppercased

- **Reproduce:** group list. The cards read `ALPHA`, `BETA`, `DELTA`.
- **Expected (§3.1, A.3.7):** the category label is the group's own last path segment (`alpha`). GitLab paths
  are case-sensitive.
- **Actual:** the DOM text is correct, but CSS `text-transform: uppercase` changes what users see.
- **Likely file:** `frontend/src/App.css` (`.category`).

### D4 — Low (cosmetic). Iteration-row date range wraps mid-date at widths ≤ 1100 px

- **Reproduce:** set the viewport to 1024 px and open `alpha`. A row reads `2026-09-27 → 2026-` / `10-10`.
- **Expected (§13):** dates are `YYYY-MM-DD`, shown `start → due`. They should not be split.
- **Actual:** the 220 px rail wraps the range inside a date.
- **Likely file:** `frontend/src/App.css` (`.iteration-dates`). Use `white-space: nowrap` or a break after
  `→`.

## Checked and found conformant (beyond the list above)

- No console errors and no uncaught exceptions across all scenarios.
- No URL or history changes.
- Reload starts on the group list, and annotations survive it.
- The `confirm` prompt text is exact. Declining aborts entirely.
- Tooltip footers list every annotation of a date.
- Callouts that are visible are drawn behind the datasets, with blue for Information and red for Risk.
- Burnup markers are amber points.
- Known behaviour reproduced on purpose and not reported as defects: the burnup Ideal descends and the Forecast
  saturates (#8), and the group-list heading counts cards (#3).

## Limitations

- Only Chromium was run (no Firefox or WebKit).
- The mock's "today" is fixed when the backend starts, so a run that crosses midnight UTC could disagree with
  the browser's today.
- The Chart.js instance hook relies on the Vite dev server's dependency URL, so it does not work against
  `vite preview` or the nginx build.
- The 30 s score timeout and the "slow score does not block the chart" path are left to the vitest suite
  (SR20).
