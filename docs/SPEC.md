# Group Iteration Review — Product & Algorithm Specification

> **READ FIRST — Amendments A (2026-10-01) and B (2026-10-03) override parts of this document.** See the
> sections "Amendment A — Group selection by ROOT_GROUP" and "Amendment B — Burnup view" at the end.
> Wherever the body below and an amendment disagree, **the amendment wins**. Implementation decisions (stack, API contract) are in
> "Implementation notes" after Amendment A.

A complete, self-contained specification of the application, written for someone who must **rebuild the
behaviour exactly** without ever seeing the original code. It describes *what the product does* and *the
algorithms that produce it*. It deliberately says nothing about frameworks, languages, build tooling,
packaging, deployment or pipelines: those are implementation choices, not product behaviour.

**Scope of this document.** Business rules, screen behaviour, literal on-screen wording, and every algorithm
and threshold needed to reproduce identical numbers and identical layout.

**Conformance vocabulary.** *MUST* = required. *SHOULD* = strongly recommended. *KNOWN BEHAVIOUR* = the way
the product works today, sometimes arguably wrong; reproduce it unless the change is explicit (§16).

---

## 1. Purpose, users, jobs to be done

### 1.1 The problem

An iteration (a fixed-length delivery timebox) is planned with a workload estimate. During the iteration the
planned workload and the delivered workload both move. GitLab shows the raw curve, but a curve alone cannot
explain itself: at the end of an iteration nobody can tell from the picture whether the deviation was scope
added late, work that slipped, or an incident. Retrospectives therefore spend time re-deriving facts that
were obvious to whoever was watching on the day.

### 1.2 What the product does

The product reads GitLab iteration data, draws the deviation curve, and lets the team **pin a short written
explanation to the exact day the curve moved**. Those notes travel with the chart. On top of the raw curve it
adds two things GitLab does not provide:

1. a **forecast** — where the iteration is heading, projected from the team's *own* historical working shape,
   and
2. a **predictability score** — how far this team's delivery has historically drifted from what it committed,
   averaged over its last four closed iterations.

### 1.3 Users and jobs

| User | Job |
|---|---|
| Delivery lead / release manager | see at a glance whether an in-flight iteration will land, and where it deviated |
| Team member | record *why* the curve moved, at the moment it moved, without leaving the chart |
| Coordinator across several groups | compare groups on the same axis, and find the ones actually carrying data |
| Retro / review facilitator | show a curve with its explanations, and the group's recent predictability |

### 1.4 What it is not

Read-only against GitLab. It never writes back, never creates or edits issues, iterations or scope. It has no
user accounts, no permissions model of its own (it sees exactly what the supplied GitLab credential sees), no
server-side storage, and no notification or scheduling. Annotations live in the individual's browser.

---

## 2. Concepts, vocabulary and parameters

### 2.1 Concepts

| Term | Meaning |
|---|---|
| **GitLab group** | A namespace in GitLab identified by a path such as `group/sub/name`. The product's unit of review. |
| **Group pattern** | The configurable rule that decides which GitLab groups the product offers. See §4.1. *(Superseded by Amendment A.)* |
| **Iteration** | A GitLab timebox with a start date, a due date, a state, and a per-day report. |
| **Scope** | The planned workload of the iteration on a given day, in points/weight. |
| **Delivered** | The completed workload on a given day. |
| **Remaining** | Scope minus delivered. This is the curve the product burns down. |
| **Deviation** | How far delivered is from committed, as a percentage of the committed workload. |
| **Tolerance** | The accepted deviation band. Anything the forecast leaves above it is called out. |
| **Annotation** | A dated written explanation pinned to one point of the curve. |
| **Predictability** | The group's recent history of deviation, over its last four closed iterations. |

### 2.2 Vocabulary parameters

The product ships with one organisation's vocabulary. To reuse it elsewhere, only these change:

| Parameter | Shipped value | Where it is used |
|---|---|---|
| `{{GROUP_TERM}}` | `ART` | every user-facing sentence that names the reviewed group (§3) |
| `{{GROUP_EXAMPLE}}` | a second, organisation-chosen example group name | the two help sentences that illustrate the group pattern *(REMOVED by Amendment A)* |
| **Group pattern** | path has 2–3 segments, and one segment carries `art` as a whole hyphen-separated token | group eligibility (§4.1) *(REPLACED by Amendment A)* |

Throughout this document, `{{GROUP_TERM}}` stands in for the noun, `{{GROUP_EXAMPLE}}` for that illustrative
name, and **group pattern** for the rule. No behaviour depends on any of them beyond the literal wording and
the match test.

### 2.3 Parameter & threshold register (business values)

| Parameter | Value | Meaning |
|---|---|---|
| Tolerance band | **10 %** of committed workload | the green "acceptable remaining work" line |
| Deviation-label visibility | forecast deviation **≥ 1 %** | below that, no callout |
| Deviation label on closed iterations | **hidden** | projecting over a finished iteration is meaningless |
| Predictability window | last **4** closed iterations | |
| Compliant iteration | deviation **strictly < 10 %** | exactly 10 % is *not* compliant |
| Colour scale — average deviation | ≤ 10 % good · ≤ 20 % caution · above poor | |
| Colour scale — delivery difference | ≤ 2 pts good · ≤ 5 pts caution · above poor | on the absolute value |
| Colour scale — compliant share | ≥ 70 % good · ≥ 50 % caution · below poor | |
| Forecast trend window | last **5** points | for the daily-rate estimate |
| Forecast history window | last **4** closed, earlier iterations | for both forecast strategies |
| Forecast shape grid | **21** points (0 %, 5 %, … 100 % of elapsed time) | |
| Historical sample cap | 4 iterations | |
| Data freshness | **5 minutes** | identical reads are served from cache for this long |
| Score timeout | **30 seconds** | after which the score reports a timeout instead of hanging |
| Minimum forecast round | **0** | a forecast never goes negative |

---

## 3. The journey: screens, states, and the exact wording

Two screens, no deep links, no bookmarks, no browser history entries. Navigation is forward by selection and
backward by an explicit back control.

### 3.1 Screen 1 — group list

**Purpose.** Choose which GitLab group to review.

*(The guidance and "nothing eligible" wording below are REPLACED by Amendment A.)*

| State | What the user sees (literal) |
|---|---|
| Product title | `Heimdall` |
| Guidance line | *"Select a {{GROUP_TERM}} (sub-group with an `art` segment, such as `art-foo` or `{{GROUP_EXAMPLE}}`) to view its iterations."* — the sentence restates the group pattern and gives two examples |
| Loading | three placeholder cards, no text |
| Failure | heading `Loading error`, the error text, and a `Retry` control that re-reads with the cache bypassed |
| Nothing eligible | heading `No {{GROUP_TERM}} found`, body *"No group whose fullPath has an `art` path segment (such as `art-foo` or `{{GROUP_EXAMPLE}}`) was found. Check that your token has access to the relevant groups."*, plus a `Refresh` control |
| Populated | heading `Available {{GROUP_TERM}}s (n)` where **n counts the displayed cards, not the groups** (§16), a `Refresh` control, then one card per card-group |

**Card content.** Each card shows a small category label = the path segment that matched the group pattern
(so a path ending in `cross-art-platform` is labelled `cross-art-platform`, not `platform`), then the group's
display name, then its full path. Where several eligible groups share a parent, the parent is the card and
its children appear as a row of tiles inside the card, each tile showing the child's name and only its own
path segment. Clicking the parent selects the parent; clicking a tile selects that child. See §4.3.

### 3.2 Screen 2 — iteration review

Layout: a left rail (iteration chooser), a wide centre column (the chart), a right rail (the annotations).

**Header.** Product title, the selected group's name and full path, and a `Refresh` control (§14.2). The
predictability summary appears in the header **only while no iteration is chosen**, and inside the chart card
once one is chosen — never both at once.

**Left rail — iteration chooser.** A `← Back to {{GROUP_TERM}}s` control and the heading `Iterations`.

| State | Literal |
|---|---|
| Loading | three placeholder rows |
| Failure | the error text |
| None | *No iteration found for this {{GROUP_TERM}}.* |
| Populated | one row per iteration: title, `startDate → dueDate`, and a state badge; the chosen row is highlighted |

Rows for iterations that have not started yet are **never listed** (§5.3).

**Centre column.**

| State | Literal |
|---|---|
| No iteration chosen yet | *Select an iteration to display the charts.* |
| Loading | `Loading data…` |
| Failure | the error text — most commonly *No burnup data found for this iteration (check permissions or format).* |
| Chosen, iteration header | the iteration title, `startDate → dueDate`, and its state badge |
| Chosen, chart | a view switch (`Burndown` / `Burnup`); then a centred head — the chart title, the delivery summary strip under it, and the metrics strip (§12) under that; then the chart |

**Delivery summary strip** (shown when the iteration carries a report): a green dot `Completed` with the
percentage and `{delivered} of {committed}` in points; a blue dot `In Progress` with its percentage and the
same `… of …` pair. Percentages are of the committed workload and are `0` when it is zero; point values are
always shown with one decimal.

**Chart legend entries.** Burndown: `Remaining`, `Ideal`, `Forecast`. Burnup: `Completed`, `Total scope`,
`Ideal`, `Forecast`. Chart titles: `Burndown Chart` and `Burnup Chart`.

**Right rail.** Heading `Annotations ({n})`, the annotation list, and a help box headed `How to use` with the
two lines `- Click a point to annotate` and `- Annotations stored locally`.

### 3.3 Annotation dialogue

Appears directly under the chart when a point is selected, and closes on save or cancel.

| Element | Literal |
|---|---|
| Heading | `Add annotation` (new) / `Edit annotation` (existing) |
| Context line | `Date: {date}` |
| Type label | `Type`, with two choices: `Information` (blue) and `Risk` (red); the chosen one is filled |
| Text field | placeholder `Explain the deviation...`, required, free text, newlines allowed |
| Actions | `Cancel`, and `Add` or `Edit` |

### 3.4 Annotation list item

Amber card per annotation showing its date, `by {author}`, an `Edit` and a `Delete` control, and the text.
Order is the order in which they were saved — nothing re-sorts them. When there are none: `No annotation for
this iteration`.

### 3.5 Overlap warning

If the user has unsaved text in the dialogue and clicks a different point, or clicks `Edit` on another
annotation, the product asks: **`Unsaved changes will be lost. Continue?`** Declining aborts the navigation
entirely — the selection, the dialogue and its text all stay exactly as they were.

### 3.6 Labels drawn on the chart

- Green label at the tolerance level: `Deviation +10 %`.
- Orange label at the forecast's end value: `Deviation +{n} %`, rounded to a whole number.
- Hovering a point that carries annotations appends their texts to the tooltip, one per line.
- Annotation text is drawn as a callout box anchored to its point, on one of up to three lines.

---

## 4. Which GitLab groups are listed

> **§4.1, §4.2 and §4.3 are REPLACED by Amendment A.** They are kept below for reference only. §4.4 still
> applies (as restated in Amendment A).

### 4.1 The group pattern *(superseded)*

A group is offered for review **if and only if**:

1. its path has **exactly 2 or 3** `/`-separated segments, **and**
2. at least one segment contains the marker word as a **whole token**, after lowercasing the segment and
   splitting it on every run of characters outside `a–z0–9` (so hyphens, underscores, dots and spaces all
   separate tokens).

The shipped marker word is `art`. The depth limits are meaningful, not incidental: a one-segment path is a
root namespace, and a path of four or more segments is a team sub-group living *under* a reviewed group.

**Conformance table** — each row must classify identically (examples use the shipped marker `art`):

| Path | Offered? | Why |
|---|---|---|
| `group/pattern-foo` | ✅ | 2 segments, marker is a whole token |
| `group/cross-art-platform` | ✅ | tokens `[cross, art, platform]` |
| `group/sub/pattern-alpha` | ✅ | 3 segments |
| `group/pattern-foo/team-bar` | ✅ | 3 segments, marker sits on the *parent* segment |
| segment `root-art`, `art`, `Art-rename` | ✅ | case-insensitive, whole-token match |
| `group/smart-team` | ❌ | tokens `[smart, team]` — the letters are inside a word |
| `group/chart-tools`, `group/start-up`, `part-2`, `department` | ❌ | same |
| `group/tools`, `group/team-x` | ❌ | no marker token at all |
| `pattern-alone`, `pattern-root` | ❌ | 1 segment |
| `group/pattern-foo/team/sub`, `pattern-root/too/deep/here` | ❌ | 4+ segments |

### 4.2 Finding candidate groups *(superseded)*

1. Ask GitLab for groups matching a **coarse substring** derived from the marker word, capped at the first
   **100** matches. This is a substring search only, so it deliberately over-matches (`smart-team` contains
   the substring too).
2. Apply the group pattern of §4.1 locally — **this is the authoritative filter**, the search is only a
   pre-narrowing step. Do not "optimise" the search string, and never remove the local filter.
3. Remove duplicates by group identity, keeping the first occurrence.
4. Order by **path, ascending**, using a locale-aware comparison. This order is load-bearing for the card
   grouping of §4.3.

> **Known limits (accepted):** the search returns at most 100 candidates, so an estate larger than that is
> silently truncated; and the substring must be chosen so that every eligible path contains it.

### 4.3 Grouping into cards *(superseded)*

Consecutive eligible groups sharing a parent are folded into one card.

```
for each eligible group, in path order:
    if the path has 2 segments:
        start a card for that group, with no child tiles
    else if the path has 3 segments:
        parentPath = first two segments
        if a card already exists for parentPath:
            add this group as a child tile
        else:
            create a card for parentPath, synthesising the parent's display
            information from the path alone (name = the middle segment)
            and place this group in it as the first child tile
sort the cards by parent path, ascending
```

Three consequences to reproduce:

1. **The heading counts cards, not groups.** A single card may represent five groups; the number understates.
2. A three-segment group whose parent is *not itself* eligible produces a **synthetic parent card** built
   purely from the path. Selecting it still works — the parent is a real GitLab group, it simply is not
   offered in its own right. This is deliberate: it keeps nested groups reachable.
3. A card created for a two-segment group **replaces** any card with the same parent path. This only stays
   harmless because §4.2 sorts by path and a path always sorts before its own extension. Changing that sort
   order silently drops child tiles.

### 4.4 Only groups that actually have a curve

The landing screen must not offer a group that would render an empty chart.

```
for each eligible group (at most 8 in flight, results kept in input order):
    fetch that group's iteration reports          ← the very same read the chart later uses
    if ANY iteration has a non-empty day-by-day series: keep the group
    else:                                            hide the group
    if the read FAILS for any reason:                keep the group   ← fail OPEN
```

| Group situation | Outcome |
|---|---|
| at least one iteration carries day-by-day data | **offered** |
| every iteration returns an empty series | **hidden** |
| the read fails (no permission, outage, error) | **offered — fail open** |
| no eligible group at all | screen 1 shows the "nothing eligible" state of §3.1 |

**Fail-open is a requirement, not an accident.** A group that silently disappears is indistinguishable from a
group that does not exist; a transient permission or availability blip must never erase a group the user
knows about.

No separate catalogue or health signal may be introduced for this check: "does it have data" is decided from
the same report read that produces the chart, so the answer is always consistent with what the user will see.

---

## 5. Which iterations are listed, ordered, and pre-selected

### 5.1 Listing and ordering

Read the group's iterations and order them **newest first**:

```
1. primary key: start date, DESCENDING
2. tie-break for identical start dates: iteration number, numeric, DESCENDING
   (a non-numeric identifier orders as 0)
```

A group that does not exist, or that exposes no iterations, yields an empty list — never an error.

This newest-first order is assumed by three later rules (the four-closed window, the previous-iteration
history, the grouping of §4.3). Changing it changes those numbers.

> **Known limit (accepted):** the iteration read is unpaginated, so a group with a long history only ever
> shows the first page GitLab returns.

### 5.2 Report data: one read per group

Every day-by-day series, every committed/delivered total and every forecast input for a group comes from a
**single read of that group**, which returns all of its iterations at once (up to 50). The chart, the history
comparison and the predictability score are then *slices of that one response*.

The observable requirement: **one read per group per freshness window** — not one per iteration, and not one
per feature. Opening a second iteration of the same group must not re-read it.

### 5.3 Upcoming iterations are hidden, and one iteration is chosen for you

- The chooser never lists an iteration whose state is `upcoming`.
- On opening a group, the product automatically selects the **most recent iteration that is not upcoming**
  (using the *unfiltered* newest-first list) and loads its chart. If every iteration is upcoming, nothing is
  selected and the centre column keeps its placeholder.
- Only two states carry meaning anywhere in the product: `upcoming` (excluded from the list) and `closed`
  (treated as finished — see §7.2, §9, §11). Every other state is treated as a live, in-flight iteration.

---

## 6. The data windows

Every "recent history" number in the product, in one place:

| Window | Size | Used by |
|---|---|---|
| Closed iterations scored | last **4** | predictability score (§11) |
| Previous closed iterations used as forecast history | last **4** that **start before** the selected iteration | both forecast strategies (§8) |
| Sprint shapes blended into the canonical shape | last **4** of those | shape forecast |
| Daily-rate samples | last **5** points of the current curve | trend, and the blended velocity |
| Iterations returned per group read | up to **50** | everything |
| Candidate groups returned | up to **100** | §4.2 *(superseded by Amendment A: descendants are paginated, no cap)* |

The selected iteration's own data is **never** part of its own forecast history.

---

## 7. Building the curve

### 7.1 From committed/delivered to remaining

GitLab publishes, for each day of the iteration, the **committed workload** (scope) and the **delivered
workload** on that day. Everything the product draws is derived from those two:

```
for each day:
    total     = committed workload that day
    delivered = delivered workload that day
    remaining = total − delivered          ← this is the burned-down curve
```

`remaining` is **not** clamped: if GitLab ever reports more delivered than committed, the curve shows a
negative value (§16).

The report also carries, for the iteration as a whole, three totals — committed, delivered, and still in
progress — each as a workload and an item count. These drive the summary strip, the tolerance line and the
forecast anchoring.

### 7.2 Completing an incomplete curve

GitLab's series is frequently missing days at the edges. Two different repairs apply, depending on whether the
iteration is finished.

```
if the iteration is NOT closed and it has a report and there is no point for today:
    append a "today" point whose values are the report's current totals
    (committed = committed total, delivered = delivered total,
     remaining = still-in-progress total)

if the iteration IS closed:
    append the iteration's final day, so the curve reaches the due date:
        if there are no points, or there is no due date, or no report → change nothing
        if the last point's date is already on or after the due date  → change nothing
        otherwise append a point dated the due date with
            committed  = committed total
            delivered  = delivered total
            remaining  = still-in-progress total
```

Both repairs are additive only; the recorded history is never rewritten. The closed-iteration repair must
return the **original, unchanged series** when there is nothing to add — callers rely on identity to know
nothing changed.

For a live iteration the "today" point is placed at the end of the series and the axis sort (§7.3) puts it in
the right position. "Today" means **the current calendar day in UTC** (§16).

### 7.3 The horizontal axis

```
axis = every date present in the (possibly repaired) series
if the iteration has a due date:
    walk forward one day at a time from the LAST known point,
    adding each date up to and including the due date
    then make sure the due date itself is present
sort the dates ascending   (an ISO date sorts chronologically as text)
```

Only the **trailing** gap is filled. A hole at the start of the iteration is left alone, and interior gaps are
already present in the series. Days are calendar days — weekends and holidays are on the axis like any other
day.

Two derived quantities used by the ideal line:

```
firstIndex = position of the first real data point on the axis
totalDays  = max( lastAxisPosition − firstIndex , 1 )
```

### 7.4 The three burndown series

| Series | Value at each axis position | Appearance |
|---|---|---|
| **Remaining** | the point's remaining work at that date; **nothing** where there is no point | solid, filled beneath, visible dots; a gap **breaks** the line rather than bridging it |
| **Ideal** | nothing before `firstIndex`; otherwise `max(0, firstRemaining − (firstRemaining / totalDays) × (position − firstIndex))` | thin dashed reference line, no dots |
| **Forecast** | §8 | dashed, no dots, bridges gaps |

The ideal line therefore starts at the first real data point and reaches exactly zero on the last axis
position. A gap in the recorded series must break the remaining line — it must not be interpolated across.

On a live iteration the dot for today is drawn in the accent colour to distinguish "now" from history.

### 7.5 The tolerance line

```
committedTotal = the report's committed workload, or — when there is no report —
                 the committed workload of the first point, or 0
tolerance      = committedTotal × 10 %
```

When `committedTotal > 0`, draw a horizontal dashed line at `tolerance`. It reads as "if this much work is
still open on the last day, you are still inside the agreed band". When there is no committed workload at
all, no line and no deviation labels are drawn anywhere.

### 7.6 The burnup view

> **REPLACED by Amendment B (the text below was wrong and is kept for reference only).** The burnup view
> follows the GitLab / Jira burnup charts; see "Amendment B — Burnup view".

The second tab shows the same data as accumulation instead of depletion.

```
maxScope = the largest committed workload seen on any day
axis     = every date in the series, plus up to the 7 days after the last point that are on or before the due date
```

| Series | Value at each axis position | Appearance |
|---|---|---|
| **Completed** | delivered work that date; nothing where there is no point | solid, filled, gentle curve, visible dots |
| **Total scope** | constant `maxScope` | dashed horizontal |
| **Ideal** | nothing before `firstIndex` or when the span is zero; otherwise `max(0, firstRemaining − (firstRemaining / totalDays) × (position − firstIndex))` | thin dashed |
| **Forecast** | nothing on or before the last recorded date; otherwise `min(maxScope, lastDelivered + slope × daysAfterLast)` where `daysAfterLast` counts calendar days and the slope is the first point's committed workload, or `maxScope / daysRemaining` when there is no first point | dashed |

> **KNOWN BEHAVIOUR — the burnup reference lines are cosmetically wrong and must not be "corrected" silently.**
> The burnup *Ideal* line **descends** from the remaining workload (it is the burndown formula reused), and the
> *Forecast* slope uses a whole committed workload **per day**, so it saturates at the maximum almost
> immediately. Both have been visible for a long time and are relied upon by the acceptance examples. Fixing
> either is a product decision, recorded in §16.

Annotations in the burnup view are marked only by a dot on the affected point (no text, no callout, no
anti-overlap stacking) — this view is deliberately simpler.

---

## 8. Forecasting

### 8.1 Which strategy applies

```
if the iteration is closed:
    no forward projection from history at all — extend the last observed daily direction in a straight line
else if today is on the axis:
    try the SHAPE forecast; if it declines (returns "not usable"), use the VELOCITY forecast
else:
    no forecast
```

The two live strategies are tried strictly in this order, and the first one **must** be able to signal
"not usable" in a way the caller can distinguish from "usable but empty" — a strategy that returns an empty
series instead of declining will silently suppress the other one.

For a closed iteration the projection is simply: from the last recorded point, continue at the last observed
daily direction (§8.4), in calendar days, floored at zero.

### 8.2 Daily direction (shared primitive)

```
dailyDirection(series, window = 5):
    take the last ≤ 5 points
    if fewer than 2: return 0
    sum the day-to-day changes of remaining work over that window
    return min(0, sum ÷ (count − 1))
```

The clamp at zero is deliberate: a curve that went **up** over the window is treated as **flat**, never as
"forecast upward". A forecast may stay level, but may never be drawn rising.

### 8.3 Primary strategy — the group's canonical shape

The idea: reduce each past iteration to a unit-free curve — *how much of the day's committed work was still
open, as a function of how much of the iteration had elapsed* — blend the last few of those curves robustly,
then hang the current iteration's projection off today's real value.

```
shapeOf(iteration):                       // one past iteration → unit-free curve
    keep only the days with a non-zero committed workload
    if fewer than 2 such days: return "no shape"
    start = date of the iteration's FIRST point     (unfiltered)
    end   = date of the iteration's LAST point      (unfiltered)
    if end ≤ start: return "no shape"
    for each kept day:
        f = clamp( (date − start) / (end − start), 0, 1 )        // fraction elapsed
        y = max(0, remaining / committedWorkloadOfThatDay)       // fraction still open
    sort by f ascending
```

Dividing by **that day's** committed workload — not the iteration's original commitment — is what makes the
shape immune to work added mid-iteration.

```
sample(shape, f):                         // piecewise-linear, flat beyond both ends
    empty → 0
    f at or before the first point → first value
    f at or after the last point   → last value
    otherwise interpolate linearly between the bracketing pair
              (a zero-width segment contributes no slope)

canonicalShape(history, maxIterations = 4):
    shapes = the first ≤4 iterations of history, shaped, keeping only usable ones
    if none: return "no shape"
    for i in 0…20:                                  // a 21-point grid: 0, 0.05, … 1
        value = MEDIAN over all shapes of sample(shape, i/20)
    then sweep the grid once forwards, replacing each value with the running minimum (floored at 0)
    return the 21-point curve
```

Two deliberate choices: the **median**, not the mean, so one abnormal iteration cannot drag the projection;
and the **running minimum**, which guarantees the canonical curve can never rise.

```
shapeForecast(series, history, axis, todayIndex, endIndex, maxIterations = 4):
    if todayIndex is invalid, or todayIndex is at or beyond endIndex, or the axis has no entry there:
        return "not usable"
    today = the point whose date is axis[todayIndex]; if absent → "not usable"
    result = array of length endIndex+1, all "no value"
    result[todayIndex] = today.remaining
    if today.remaining ≤ 0:
        every position after todayIndex = 0        // already finished
        return result
    shape = canonicalShape(history, maxIterations); if "no shape" → "not usable"
    start = date of the series' FIRST point
    end   = date of axis[endIndex]
    if end ≤ start: → "not usable"
    fractionOf(date) = clamp((date − start) / (end − start), 0, 1)
    shapeToday = sample(shape, fractionOf(axis[todayIndex]))
    if shapeToday ≤ 0.000000001: → "not usable"     // the shape had already collapsed to zero
    for each position i after todayIndex:
        result[i] = clamp( today.remaining × sample(shape, fractionOf(axis[i])) / shapeToday , 0 , today.remaining )
    return result
```

**Guarantees the shape forecast must satisfy** (each is a conformance case in §15):

1. it passes **exactly** through today's real value;
2. it is **monotonically non-increasing**;
3. it is **never above** today's remaining and never below zero;
4. it **scales with commitment** — same shape, twice the remaining work ⇒ every projected value doubles;
5. an iteration that has already finished projects zeros for the rest of the axis.

### 8.4 Fallback strategy — blended daily velocity

Used when there is no usable history (or the shape declined).

```
velocityForecast(series, history, todayIndex, endIndex, maxIterations = 4):
    if todayIndex is invalid or at/after endIndex: return an EMPTY result   // distinct from "not usable"
    result = array of length endIndex+1, all "no value"
    today = series[todayIndex]; if absent, return the array unchanged
    result[todayIndex] = today.remaining
    rates = for the first ≤4 iterations of history:
                max(0, (lastDelivered − firstDelivered) / (numberOfPoints − 1))
            keep only the strictly positive ones                 // idle iterations are discarded
    ownRate = max(0, −dailyDirection(series, 5))
    if ownRate > 0: append ownRate to rates                      // ← the blend
    velocity = MEDIAN(rates)
    trend    = dailyDirection(series, 5)
    for each position i after todayIndex:
        if the previous position has no value: skip
        if velocity > 0: result[i] = max(0, today.remaining − velocity × (i − todayIndex))
        else:            result[i] = max(0, result[i−1] + trend)
```

**The blend in words:** the current iteration's own daily rate is added to the historical rates as **one more
sample before the median is taken**. A team running slower or faster than its history therefore *pulls* the
projection without overriding it, and a single strange past iteration cannot dominate. With no history at all,
the projection is today's value extended at the current daily direction.

The result is always floored at zero, so a forecast can never dip below the axis and can never claim the work
finished before the due date.

### 8.5 Anchoring the deviation callout

```
lastForecastValue = the value of the LAST position of the forecast that has a value
deviationPercent  = committedTotal ≤ 0 ? 0 : lastForecastValue / committedTotal × 100
```

That is the number quoted in the orange label and the number compared against the 1 % visibility floor.

---

## 9. Deviation call-outs beside the chart

Two labels may appear in the reserved gutter beside the plot — deliberately **outside** the plotting area, so
they never cover the curves.

```
if committedTotal ≤ 0:      no labels at all
always (committedTotal > 0): GREEN label, at the tolerance level, text "Deviation +10 %"
if the iteration is NOT closed:
    if the forecast has any value:
        pct = deviationPercent                       (§8.5)
        if pct ≥ 1: ORANGE label, at the forecast's end value, text "Deviation +{round(pct)} %"
```

- The green label is unconditional once there is a committed workload.
- The orange label appears **only while the iteration is live** and **only at or above 1 %**; below that it is
  suppressed as noise. An iteration whose state is simply *unknown* counts as live.
- A **closed** iteration never shows the orange label.
- The gutter is reserved **only when at least one label exists**; otherwise the plot uses the full width.

**Placement rules** (behaviour, not rendering mechanics):

```
each label's vertical position = the value it annotates, mapped to the plot
labels are ordered top-to-bottom by that value
if two labels are closer than one label-height apart, push the lower one down to exactly one label-height
then pull every label back inside the vertical bounds of the plot
horizontal position is anchored to the OUTER edge of the reserved gutter, so a label can never be pushed
off-screen by a long number or a wide axis
```

---

## 10. Annotations

### 10.1 Model

An annotation carries: an identifier, the **group path**, the **iteration number**, the date of the point it
is pinned to, an author, free text, a type (information / risk; absence means information), and a creation
timestamp preserved across edits.

### 10.2 The scoping rule — the most important sentence in this document

**An annotation belongs to a (group, iteration) pair — never to an iteration number alone.**

GitLab iteration numbers are unique only *within a group*, so two different groups can both have iteration
`42`. Keying annotations on the iteration number alone made them appear in unrelated groups; this was a real
defect, and regressions are pinned against it. Therefore:

- every annotation stores **both** the group path and the iteration number;
- saving matches on **identifier AND the pair** — two groups may legitimately hold annotations with the same
  identifier;
- deleting matches on **identifier AND the pair**;
- the list shown for a group that is not fully selected (no group, or no iteration) is **empty**, never "all".

**Forward requirement:** when annotations eventually move to a database, the uniqueness constraint must be on
`(group path, iteration number, …)` — never on the iteration number alone.

### 10.3 Lifecycle

```
open a group            → no annotation is selected; any open dialogue closes
select an iteration     → same
click a point on the curve
    if the dialogue holds unsaved changes → ask "Unsaved changes will be lost. Continue?"
                                            declining aborts: nothing at all changes
    otherwise → select that date; the dialogue opens, pre-filled with the FIRST
                annotation already attached to that date if there is one
type / change text or type → the dialogue reports itself "unsaved"
save                    → write through to storage, then re-read the list from storage
                          (storage is the source of truth, never optimistic state); close the dialogue
cancel                  → close the dialogue, discard
edit from the list      → same unsaved-changes guard, then open the dialogue on that annotation
delete from the list    → remove by identifier within the current (group, iteration) pair, re-read
leave the group / back to the group list → everything about the selection is cleared
```

**Newline and dirty rules.** Text is compared **trimmed** — typing only spaces does not mark the dialogue
dirty. The type choice is compared exactly. The dialogue must not report itself dirty merely because it was
just opened with existing values.

**Identifiers and authorship.** A new annotation's identifier is derived from the current clock time; a saved
annotation keeps its identifier and creation timestamp when edited. The author is a fixed placeholder string
(`Current User`) — there is no identity integration.

**Several annotations on one date.** All of them are listed, all of them appear in that point's tooltip (one
per line), but editing opens only the **first** one.

### 10.4 Where they are kept

Annotations are stored **in the individual's own browser**, per browser and per machine — they are not
shared between teammates, and clearing browser storage loses them. This is an accepted MVP property; the
product copy states it plainly (`Annotations stored locally`).

All annotations for every group and every iteration live in **one flat collection** under a single storage
key. Three keys are involved:

| Key | Role |
|---|---|
| `heimdall-annotations.v1` | current collection |
| `burndown-annotations.v2` | collection from before the product was renamed — same shape, adopted once |
| `burndown-annotations` | oldest shape, keyed on iteration number only ⇒ cannot be attributed to a group ⇒ **deleted** |

**Read sequence, in this exact order:**

```
1. if running where no browser storage exists → empty list
2. delete the oldest key, unconditionally
3. adopt the pre-rename key: read it; if absent, stop
       always delete it afterwards (even on failure)
       if the current key already has data → stop (current wins)
       if its payload is not valid, or is not a collection → stop (dropped, not adopted)
       otherwise copy it into the current key
4. read the current key; unreadable or not-a-collection → empty list
```

**Write sequence.** Save replaces the matching entry in place (identifier **and** pair) or appends; delete
filters it out. Every operation is a silent no-op when no browser storage exists, and deleting something that
isn't there never fails. Corrupted content degrades to an empty list, and the next save replaces it.

### 10.5 Drawing an annotation: size and anti-overlap

Label sizes are **estimated from the text** rather than measured, so layout is deterministic.

```
label width  = 150 units          (the wrap budget used to size the box)
char width   = 6 units            (font size 10 × 0.6)
max characters per line = 25

lines          = the text split on newlines
lineCount      = min(number of lines, 3)              // beyond 3 the box stops growing
longestLineLen = max(longest line length, 1)
width          = max( round( min(longestLineLen, 25) × 6 + 14 ), 40 )
height         = max( round( lineCount × 13 + 10 ), 20 )
```

Reference values: empty text → 40 × 23 (width floored) · one line → height 23 · two lines → 36 · three or
more → 49. Width counts the **longest line**, never the total text length, and saturates at 25 characters.

**Stacking:**

```
1. drop any annotation whose date is not on the axis
2. work in left-to-right axis order (NOT list order)
3. for each label in that order:
       start offset 0
       for every earlier label:
           while this label's band overlaps that one's band:  offset += 20
       additionally, while this label's band overlaps its own point's marker band (radius 5):
           pointOffset += 20
       offset = max(offset, pointOffset)
4. return the results in the caller's original list order
```

Overlap test for two vertical bands `[a, a+heightA)` and `[b, b+heightB)`: `a < b+heightB and b < a+heightA`.

Guaranteed, and separately verified: annotations dated outside the axis are silently ignored; the returned
order matches the input order even though stacking used axis order; **even a single** label is lifted by one
gap (20) so it never sits on its own dot; fifteen annotations on one date never overlap; a label at a later
date always stacks at least as high as one at an earlier date.

> **KNOWN BEHAVIOUR.** Those vertical offsets are expressed in **workload units, not pixels**, and nothing
> clamps the stack to the visible range. On an iteration crowded with annotations, labels are pushed above the
> top of the chart and vanish. Documented and unfixed (§16).

**Horizontal placement.** A label is pushed toward the nearer side of the chart: labels on the right half of
the axis are pushed leftwards, labels on the left half rightwards, by a distance proportional to the chart
width. Vertically, a label sitting in the upper half of the workload range is offset upwards from its point,
one in the lower half downwards. A thin dashed callout connects the label to its point, and labels are drawn
**behind** the data lines.

---

## 11. Predictability score

### 11.1 What it answers

"Over the last four iterations this team closed, how far did delivery drift from what was committed?"

### 11.2 Algorithm

```
closed = the iterations whose state is "closed", taken from the newest-first list, at most the FIRST 4
         ⇒ "the four most recently closed iterations"
if there are none:  report NO SCORE  (and issue no data read at all)

for each of those, from the group's already-read report data:
    skip it unless it has a report AND its committed workload is greater than zero
    committed  = committed workload
    delivered  = delivered workload
    difference = committed − delivered                  ← SIGNED
    deviation  = |difference| / committed               ← UNSIGNED fraction of the commitment
    record { deviation, difference, delivered }

if nothing was recorded: report NO SCORE

averageDeviation = mean of the deviations                    (a FRACTION, e.g. 0.0875)
averageDifference = mean of the differences                  (SIGNED; positive ⇒ under-delivered)
medianVelocity    = MEDIAN of the delivered workloads
compliantShare    = (count of records with deviation STRICTLY LESS THAN 0.10) ÷ records × 100
analysedCount     = number of records
```

Definitions that must match exactly:

- **Compliant** means deviation **strictly below 10 %**. An iteration at exactly 10.0 % is *not* compliant.
- The delivery difference keeps its **sign**; the caption "Under-delivered" is shown when it is zero or
  positive, "Over-delivered" when negative.
- Median velocity is the median of **delivered** workload — not committed, not remaining. The median (not the
  mean) is what stops one huge outlier iteration from misrepresenting the team.
- "No score" is a distinct state, not zero. It renders as *No score available* / *No data available*.

### 11.3 Presentation

Two layouts are supported; the product uses the compact one everywhere today.

**Compact (in use).** A bordered panel headed `Average over the last 4 sprints` with four KPI tiles (label
above, figure right below it, tiles separated by hairlines; 2 × 2 when the panel is narrow), placed at the right of the iteration header
(it wraps under the header, still right-aligned, when the card is narrow): `Average deviation` as a percentage to one decimal · `Delivery diff.` as a signed value to one
decimal followed by `pts` · `Compliant sprints` as a whole-number percentage · `Median velocity` to one
decimal followed by `pts`.

**Expanded (implemented, currently unreachable).** A panel headed `Predictability score` with `{n} sprint` /
`{n} sprints analyzed` alongside it, then four blocks: average deviation; delivery difference with the
under/over-delivered caption; compliant sprints captioned `(< 10% average deviation)`; median velocity
captioned `Points delivered per sprint (median)`.

**Colour semantics.** Each figure is coloured good / caution / poor by the scales in §2.3: deviation 10 / 20
%, absolute delivery difference 2 / 5 points, compliant share 70 / 50 % (inverted — higher is better). Median
velocity is never colour-coded.

**Failure and timeout.** While it is being computed the panel reads `Predictability scores...`. If it cannot
be computed, the panel shows `Error: {message}`. If it has not completed within **30 seconds**, the panel
stops waiting and reports the literal `Timeout exceeded (30s)`; a later result for the same request is
discarded.

---

## 12. The in-chart delivery metrics strip

Centred under the delivery summary strip (itself under the chart title), when the iteration carries a report.

**Closed iteration** — the final totals:

```
committed  = report committed workload
delivered  = report delivered workload
difference = committed − delivered
deviation  = committed > 0 ? |difference| / committed × 100 : 0
```

**Open iteration** (any state but `closed`; user decision 2026-10-03) — measured against the **burndown Ideal**
(§7.4) on today's date (UTC), on the repaired series (§7.2) and the burndown axis (§7.3):

```
difference = remaining today − ideal remaining today      (positive = behind the ideal)
deviation  = committed > 0 ? |difference| / committed × 100 : 0
```

followed by a small secondary mention `vs ideal`. If today has no remaining or ideal value on the axis, the
closed formula applies (no mention). On the due date the ideal remaining is 0, so both formulas agree.

Rendered as `Deviation: {deviation to 1 decimal}%` and `Diff: {signed difference to 1 decimal} pts`, each
coloured good / caution / poor by the same scales as §11.3. Unlike the score, this strip describes the
**currently displayed** iteration, not a history.

---

## 13. Display conventions

**Number formatting.**

| Quantity | Format |
|---|---|
| Deviation percentages | one decimal, `%` |
| Compliant share | whole number, `%` |
| Summary-strip shares | whole number, rounded, `%` |
| Workload / points | one decimal |
| Delivery difference | one decimal, with an explicit `+` when zero or positive |
| Forecast deviation label | whole number, `%` |
| Dates | `YYYY-MM-DD`, shown `start → due` |

**Colour semantics (not hex values).** Remaining and primary accents are blue; today on a live iteration is
the warm accent; the ideal reference is a neutral grey; the forecast and the forecast-deviation label are the
warm accent; the tolerance line and the tolerance label are green; delivered work is green on the burnup view;
the committed-workload reference is a neutral dashed line; annotations are blue for *Information* and red for
*Risk*; annotation list cards and burnup markers are amber.

**State conventions, consistently applied.** Loading is always expressed by placeholders in the region that
would be populated, never a global spinner. Failure is always expressed *in* the region that failed, with the
underlying message quoted verbatim, and — on the group list — a control to try again. Absence of data is
always a distinct, worded state, never a blank area.

**Every user-facing string, in one place.** *(Group-list guidance and "Nothing eligible" rows are REPLACED by
Amendment A.)*

| Situation | Literal |
|---|---|
| Product title | `Heimdall` |
| Group list guidance | *Select a {{GROUP_TERM}} (sub-group with an `art` segment, such as `art-foo` or `{{GROUP_EXAMPLE}}`) to view its iterations.* |
| Group list loading | *(no text)* |
| Group list failure | `Loading error` + the message, control `Retry` |
| Nothing eligible | `No {{GROUP_TERM}} found` + *No group whose fullPath has an `art` path segment (such as `art-foo` or `{{GROUP_EXAMPLE}}`) was found. Check that your token has access to the relevant groups.*, control `Refresh` |
| Group list heading | `Available {{GROUP_TERM}}s (n)`, control `Refresh` |
| Back control | `← Back to {{GROUP_TERM}}s` |
| Iteration chooser heading | `Iterations` |
| No iterations | *No iteration found for this {{GROUP_TERM}}.* |
| No iteration chosen | *Select an iteration to display the charts.* |
| Chart loading | `Loading data…` |
| No curve data | *No burnup data found for this iteration (check permissions or format).* |
| View switch | `Burndown`, `Burnup` |
| Chart titles | `Burndown Chart`, `Burnup Chart` |
| Legend entries | `Remaining`, `Ideal`, `Forecast`, `Completed`, `Total scope` |
| Burnup reading *(Amendment B)* | y-axis `Weight (pts)`; markers `Done ≈ {date}`, `{pts} open`; caption `Forecast: all work done by {date}, {n} day(s) before the due date.` / `… on the due date.` / `Forecast: {pts} still open on the due date ({due}).` / closed: `{pts} left open on the due date ({due}).`; tooltip `Remaining: {pts}`, `{n}% complete` |
| Delivery summary | `Completed`, `In Progress`, `of` |
| Metrics strip | `Deviation:`, `Diff:`, `vs ideal` (open iterations) |
| Score, loading | `Predictability scores...` / `Calculating…` |
| Score, failure | `Error: {message}` |
| Score, timeout | `Timeout exceeded (30s)` |
| Score, nothing to score | `No score available` / `No data available` |
| Score panel heading | `Average over the last 4 sprints` / `Predictability score` |
| Score figures | `Average deviation`, `Delivery diff.`, `Compliant sprints`, `Median velocity` |
| Score captions | `Under-delivered`, `Over-delivered`, `(< 10% average deviation)`, `Points delivered per sprint (median)`, `{n} sprint` / `{n} sprints analyzed` |
| Tolerance label | `Deviation +10 %` |
| Forecast label | `Deviation +{n} %` |
| Annotations heading | `Annotations ({n})` |
| No annotations | `No annotation for this iteration` |
| Annotation author prefix | `by {author}` |
| Annotation actions | `Edit`, `Delete`, `Cancel`, `Add`, `Edit` |
| Annotation dialogue heading | `Add annotation` / `Edit annotation` |
| Annotation dialogue context | `Date: {date}` |
| Annotation type control | `Type`, choices `Information` and `Risk` |
| Annotation text placeholder | `Explain the deviation...` |
| Unsaved-changes prompt | `Unsaved changes will be lost. Continue?` |
| Help box | `How to use`, `- Click a point to annotate`, `- Annotations stored locally` |

---

## 14. Data freshness, refresh, and what each control re-reads

### 14.1 Freshness

Identical reads of GitLab data are re-used for **5 minutes** without going back to GitLab. Consequences the
user must be able to rely on:

| Situation | Behaviour |
|---|---|
| The same data requested twice within 5 minutes | GitLab is consulted **once** |
| The same data requested simultaneously by several operations | GitLab is consulted **once** and all get the same answer |
| A response that reported an error | **never** remembered; the next request tries again |
| A failed request | never remembered |
| The user asks for fresh data | the remembered answer is discarded and GitLab is consulted again |
| Memory of recent answers | bounded to a small fixed number of the most recent distinct answers; the oldest is dropped first |

An operation's outcome must be judged per *answer*, not per *call*: the same question with different
parameters is a different question.

### 14.2 What `Refresh` re-reads — and what it does not

`Refresh` on the review screen re-reads **the displayed iteration's curve, its history inputs, and the
predictability score**. It **never** re-reads the iteration list, and never re-reads the group list.

The group list has its own `Refresh` (and, after a failure, `Retry`), which re-reads the eligible groups and
their data check with freshness forced.

A user who needs a newly created iteration to appear must leave the review screen and re-enter the group. This
is current, accepted behaviour (§16).

### 14.3 Loading, error and empty behaviour

- Every region loads independently: a slow score must not block the chart, and a failed chart must not blank
  the annotation rail.
- A region's error message is the underlying reason, verbatim — most often a GitLab permission or
  availability problem. Users see exactly what GitLab said.
- The chart renders **only** when the data has arrived, nothing failed, and the series is non-empty; any other
  combination shows the loading placeholder or the error, never an empty chart frame.
- Choosing a different iteration immediately discards the previous iteration's chart, its history, the open
  annotation selection and any unsaved text.

---

## 15. Worked examples and acceptance criteria

These are the values a correct implementation must produce. Each is independently checkable.

### 15.1 Group eligibility

*(REPLACED by Amendment A — see A.5.)* See the full table in §4.1 — all 16 rows must classify identically.

### 15.2 Iteration ordering

Inputs (start, number): `(2026-01-01, 1)`, `(2026-03-01, 3)`, `(2026-02-01, 2)` → order **3, 2, 1**.
Tied starts `(2026-02-01, 7)`, `(2026-02-01, 9)`, `(2026-02-01, 8)` → order **9, 8, 7**.
A group that does not exist → empty list, no error.

### 15.3 Predictability — full conformance vector

Closed iterations with (committed, delivered) = `(50,45) (40,40) (30,24) (20,21)`:

| Quantity | Derivation | Expected |
|---|---|---|
| deviations | `5/50, 0/40, 6/30, 1/20` | `0.10, 0, 0.20, 0.05` |
| average deviation | mean | **0.0875** → shown `8.8 %`, coloured caution |
| delivery difference | mean of `5, 0, 6, -1` | **2.5** → shown `+2.5 pts`, coloured caution |
| median velocity | sorted delivered `21,24,40,45` → (24+40)/2 | **32** → shown `32.0 pts` |
| compliant share | only `0` and `0.05` are strictly under 0.10 | **50 %**, coloured poor |
| analysed count | | **4** |

> Orchestrator note: the "coloured caution" for 8.8 % average deviation and "coloured poor" for 50 % compliant
> share contradict the §2.3 thresholds as literally written (8.8 ≤ 10 ⇒ good; 50 ≥ 50 ⇒ caution). This
> inconsistency is resolved in **A.6** below (colours follow §2.3; the colour words here are errata).

Add a fifth, 200-point outlier iteration: the count stays **4** and the median velocity is unaffected.
No closed iteration → **no score, and no data read at all**.

### 15.4 Blended velocity forecast

History burns 10 points/day. Today's remaining is 30 and the current daily direction is −5.
Rates = `[10, 5]` → median **7.5** → the next three days are **22.5, 15, 7.5**.
A team burning only 5/day against 40 remaining must still be **above zero** at the due date — never falsely
on time. A forecast value is never negative.

### 15.5 Shape forecast

History: two identical linear iterations (100 → 0 over 11 days). Today's remaining is 50 on day 6 of 11 →
today's projection is exactly **50**, day 8 ≈ **30**, the due date ≈ **0**.
Same history, but today's remaining is 40 → day 8 ≈ **24**, due date ≈ **0** (proportional scaling).
Today's remaining is 0 → every remaining day is **0**.
No history at all → the shape strategy declines and the velocity strategy answers instead.

### 15.6 Deviation labels

Committed workload 100, live iteration, forecast ends at 10 → green `Deviation +10 %` at level 10 **and**
orange `Deviation +10 %` at level 10. Ends at 0.5 → **green only** (below the 1 % floor). Ends at 10 on a
**closed** iteration → **green only**. Committed workload 0 → **no labels**.

### 15.7 Annotation geometry

Empty text → 40 × 23. One line → height 23; two lines → 36; three or ten lines → 49. A 400-character single
line caps at width **164**. Fifteen annotations dated the same day stack without any overlap, and the stack
climbs past the top of the workload range (it is not clamped).

### 15.8 Annotation scoping

Save an annotation for group A / iteration 42 and another for group B / iteration 42. Viewing A must show
only A's; deleting A's must leave B's untouched; two annotations that happen to share an identifier in
different groups must not overwrite each other.

### 15.9 Freshness

Request the same group's data twice → one read. Request it with `refresh` → a second read. Two operations ask
at the same moment → one read, both answered. An erroring response is asked again immediately.

### 15.10 Data completeness repair

A closed iteration with points on the 6th and 23rd and a due date on the 24th gains a third point dated the
24th carrying the report totals. A closed iteration already reaching its due date is returned **unchanged**
(same series, not a copy). A live iteration with no point for today gains one built from the current report
totals.

---

## 16. Known-behaviour ledger

Current, observable behaviour. Reproduce it, or change it deliberately and record the change.

| # | Behaviour | Effect |
|---|---|---|
| 1 | Group search is capped and substring-based | estates larger than 100 candidates are truncated *(REMOVED by Amendment A)* |
| 2 | Iteration reads are unpaginated | groups with long histories show only the first page |
| 3 | The group-list heading counts **cards**, not groups | the number understates how many groups exist |
| 4 | A nested group under a non-eligible parent gets a **synthetic parent card** | the parent card navigates to a group that is not itself offered — intentional *(restated by Amendment A, A.3)* |
| 5 | Replacing a card that already holds children would drop them | only harmless because of the path sort order *(no longer applicable, Amendment A builds cards from the hierarchy)* |
| 6 | The chooser hides not-yet-started iterations, but auto-selection scans the **unfiltered** list | the pre-selected iteration may not be the top row of the chooser |
| 7 | Remaining work is never floored at zero | a negative segment can appear if GitLab reports over-completion |
| 8 | Burnup *Ideal* descends and burnup *Forecast* saturates immediately | both visually wrong on that tab (§7.6) *(CHANGED by Amendment B: no longer reproduced)* |
| 9 | "Today" is the UTC calendar day | the highlighted point can differ from the user's local day |
| 10 | Axis days are generated with mixed local/UTC conventions | the axis can shift by a day for users far from UTC |
| 11 | Annotation offsets use workload units, unclamped | crowded iterations push labels off the top |
| 12 | Labels never move horizontally per-annotation; the push is uniform | two labels on one date separate vertically only |
| 13 | Several annotations on one date: the tooltip shows all, editing opens the first | ambiguous to discover |
| 14 | Author is a fixed placeholder; identifiers come from the clock | no attribution; two saves in the same instant could collide |
| 15 | Annotations live in one browser only | teammates do not see each other's notes; clearing storage loses them |
| 16 | `Refresh` re-reads the curve and the score only | newly created iterations require leaving and re-entering the group |
| 17 | An unknown iteration state counts as "live" | deviation call-outs appear for stateless data |
| 18 | Data can be up to 5 minutes stale | a change made in GitLab may not appear immediately |
| 19 | The expanded score layout is implemented but never used | supported, unreachable |
| 20 | Nothing is deep-linkable | no sharing, no browser back/forward, reload returns to the group list |
| 21 | The score gives up after 30 seconds | on a very large group the user may have to press Refresh again |

---

## 17. Build sequence

Functional order; each stage is verifiable before the next, and none depends on a particular technology.

1. **Vocabulary and parameters** — fix `{{GROUP_TERM}}`, the group pattern, and the §2.3 register as
   configurable values with the shipped defaults.
2. **Group eligibility** — implement the group pattern and its conformance table (§4.1) and prove it on the
   table before anything else touches it.
3. **Candidate discovery** — coarse search, local eligibility filter, de-duplication, path-ascending order
   (§4.2).
4. **Data availability** — the has-a-curve test with fail-open and bounded concurrency (§4.4), and the
   card grouping (§4.3).
5. **Iteration listing** — newest-first order with the numeric tie-break, upcoming exclusion, auto-selection
   (§5).
6. **Single per-group read** — one read supplying every iteration's series and totals, including all the
   tolerated shapes of incomplete data (§5.2, §7.1).
7. **Freshness layer** — the §14.1 rules: reuse within the window, share simultaneous identical reads, never
   remember an error, honour a forced refresh.
8. **Curve construction** — derive remaining, apply the two completeness repairs, build the axis, the ideal
   line and the tolerance line (§7).
9. **Forecasting** — daily direction, then the velocity fallback, then the canonical shape, with the
   decline/empty distinction and the §8.3 guarantees (§8).
10. **Deviation call-outs** — the two labels, their visibility rules and their placement constraints (§9).
11. **Predictability** — the four metrics, the strict-compliance rule, the signed difference, the no-score
    state, the 30-second give-up (§11). Verify against §15.3 to the decimal.
12. **Annotations** — the model and the (group, iteration) scoping rule first (§10.2), then storage and the
    migration order, then the lifecycle and the unsaved-changes guard, then label sizing and stacking (§10.3–
    §10.5).
13. **Screens and wording** — assemble the two screens with every state and every literal string of §3 and
    §13.
14. **Acceptance pass** — run §15 end to end; every number and every layout outcome must match, and §16 must
    hold item by item.

---

## Amendment A — Group selection by ROOT_GROUP (decided 2026-10-01, overrides the body)

### A.1 What is removed
- The `art` marker / group pattern of §4.1, the substring search of §4.2, the 100-candidate cap (ledger #1),
  and the `{{GROUP_EXAMPLE}}` parameter. None of these exist any more.

### A.2 Configuration
| Parameter | Default | Meaning |
|---|---|---|
| `ROOT_GROUP` | *(required)* | full path of the parent GitLab group, e.g. `my-org/delivery` |
| `GROUP_TERM` | `Team` | the `{{GROUP_TERM}}` noun (singular; changed from `ART` on 2026-10-03) |

### A.3 Which groups are offered, and how they are grouped
1. Read **all** descendant groups of `ROOT_GROUP` (paginate until exhausted — no cap).
2. Depth is relative to `ROOT_GROUP`: depth 1 = direct sub-group, depth 2 = sub-group of a depth-1 group.
   Only depth 1 and depth 2 groups are candidates. `ROOT_GROUP` itself (depth 0) and depth ≥ 3 are never
   offered.
3. Remove duplicates by group identity, keeping the first occurrence.
4. Apply the §4.4 data check to every candidate (at most 8 in flight, results kept in input order, fail-open).
5. **Cards:** one card per depth-1 group; its **tiles** are its depth-2 children that passed the data check.
   - A depth-1 group that passed the data check → card (with whatever tiles passed).
   - A depth-1 group that did **not** pass, but has ≥ 1 depth-2 child that passed → card is still shown
     (keeps the child reachable; clicking the card still selects that real group — analogous to old §4.3 #2).
   - A depth-1 group that did not pass and has no passing child → hidden.
6. Order cards by full path ascending (locale-aware), and tiles within a card by full path ascending.
7. Card content: category label = the group's **own last path segment**, then display name, then full path.
   Tiles show the child's name and its own last path segment.
8. The heading still counts **cards** (ledger #3 kept).

### A.4 Wording changes (replace the §3.1 / §13 rows)
| Situation | Literal |
|---|---|
| Group list guidance | *Select a {{GROUP_TERM}} under `{ROOT_GROUP}` to view its iterations.* |
| Nothing eligible | heading `No {{GROUP_TERM}} found` + *No {{GROUP_TERM}} with iteration data was found under `{ROOT_GROUP}`. Check that your token has access to the relevant groups.*, control `Refresh` |

(`{ROOT_GROUP}` is the configured full path, rendered as code.)

### A.5 Replacement for §15.1 (group eligibility acceptance)
With `ROOT_GROUP = org/delivery`:
| Group | Data? | Outcome |
|---|---|---|
| `org/delivery` | any | never offered (root) |
| `org/delivery/alpha` | yes | card `alpha` |
| `org/delivery/alpha/team-1` | yes | tile inside `alpha` |
| `org/delivery/alpha/team-2` | no (all series empty) | hidden |
| `org/delivery/alpha/team-1/sub` | yes | never offered (depth 3) |
| `org/delivery/beta` | no | card shown, because `beta/x` has data |
| `org/delivery/beta/x` | yes | tile inside `beta` |
| `org/delivery/gamma` | no, no children with data | hidden |
| `org/delivery/delta` | read fails | card shown (fail open) |
| `org/other/zeta` | yes | never offered (not under root) |
Heading: `Available Teams (3)` (alpha, beta, delta).

### A.6 Colour-scale boundary resolution (§2.3 vs §15.3)
§15.3's colour words contradict §2.3/§11.3. **Decision (user, 2026-10-01): §15.3 is authoritative for the
computed numbers only; colours follow §2.3 exactly.** The colour words in §15.3 are errata.
- average deviation, percent `v` (fraction × 100): `v ≤ 10` good · `v ≤ 20` caution · else poor
- delivery difference, on `|d|` points: `≤ 2` good · `≤ 5` caution · else poor
- compliant share, percent `s`: `s ≥ 70` good · `s ≥ 50` caution · else poor
- metrics strip (§12) uses the deviation and difference scales above.
So for §15.3: `8.8 %` → **good**, `+2.5 pts` → **caution**, `50 %` → **caution**.

---

## Amendment B — Burnup view (decided 2026-10-03, replaces §7.6)

The original §7.6 (constant `maxScope`, descending ideal, forecast saturating on the first projected day,
7-day axis) was wrong and is **not** a reference. The burnup view is modelled on the **GitLab and Jira burnup
charts**, plus one Heimdall-specific addition: the forecast. Ledger #8 is no longer reproduced.

### B.1 Shared with the burndown

The burnup uses the **same repaired series (§7.2), the same axis (§7.3) and the same forecast (§8)** as the
burndown of the same iteration. Both tabs therefore tell the same story; only the presentation differs
(accumulation instead of depletion).

### B.2 Series

```
firstIndex, totalDays  as §7.3;   last = axis position of the last recorded point
Completed[i]   = delivered on that date; nothing where there is no point
Total scope[i] = committed on that date (the real scope, day by day — scope changes are visible);
                 after `last`, the last point's committed carried forward (projected scope)
Ideal[i]       = nothing before firstIndex, or everywhere when the span (lastAxisPosition − firstIndex) is 0;
                 otherwise firstCommitted × (i − firstIndex) / totalDays
                 — the GitLab / Jira guideline: 0 at the start, the starting scope exactly on the due date
R              = the §8 burndown forecast (remaining work per position)
anchor         = first position where R has a value (today on a live iteration, the last point on a closed one)
open           = max(0, Total scope[anchor] − Completed[anchor])        (the work still to do at the anchor)
Forecast[i]    = nothing before the anchor; otherwise
                 Completed[anchor] + open × (1 − max(0, R[i]) / R[anchor])     when R[anchor] > 0
                 Completed[anchor]                                             when R[anchor] ≤ 0 (done, or over-delivered)
                 (nothing at all when R is empty, or Completed / Total scope has no value at the anchor)
```

The forecast **starts on the Completed curve** at the anchor — the join between work done and work remaining —
and burns the open work at the pace of the burndown forecast. It never falls, and it meets the Total line
exactly where the forecast remaining reaches zero — even when the anchor is a §7.2 repair point whose remaining
is the in-progress total rather than committed − delivered.

```
projected completion = first position after the anchor where R ≤ 0     (none when R[anchor] ≤ 0 or open = 0)
open at due date     = Total scope − Forecast on the due date, when there is no projected completion, the axis
                       ends on the due date, and the result is > 0     (else none)
```

The caption and the open-at-due bracket refer to the iteration's **due date**; without a due date (or when the
axis does not end on it) neither is shown.

### B.3 Appearance

| Element | Appearance |
|---|---|
| **Completed** | green, solid, filled beneath, monotone curve (never overshoots a recorded value), visible dots; today's dot red on a live iteration |
| **Total scope** | secondary neutral, solid 2 px over the recorded days, finely dashed where it is only carried forward |
| Remaining work | the band between Total scope and Completed, shaded in the burndown's Remaining blue (no legend entry) |
| **Ideal** | gray, thin dashed, no dots |
| **Forecast** | orange, dashed, no dots |
| Projected completion | an orange dot where the forecast meets Total, labelled `Done ≈ {date}` |
| Open at due date | an orange vertical bracket on the due date from the forecast's end to Total, labelled `{pts} open` |
| Caption | one line above the chart (orange dot): the completion date and days before the due date, or the points still open on the due date (factual wording for a closed iteration); none without a forecast. Also part of the chart's accessible name. |
| Tooltip | per date: each series in points, then `Remaining: {pts}` (Total − Completed) and `{n}% complete`, then the annotation texts |
| Axes | y from 0, titled `Weight (pts)`, with headroom for the labels; x with half a day of margin at both ends so the due-date bracket is never clipped |

Legend entries stay `Completed`, `Total scope`, `Ideal`, `Forecast`. There is no tolerance line and no
deviation gutter on the burnup. Annotations are dots on the Completed value in their type colour (no text, no
callout); a point click opens the annotation dialogue only where Completed has a value.

## Implementation notes (orchestrator decisions, not product behaviour)

- Backend: Go 1.22 + Gin in `backend/` (module `heimdall`). Holds `GITLAB_URL` / `GITLAB_TOKEN`; the browser
  never sees the token. All GitLab access is GraphQL. Freshness cache (§14.1) lives in the backend.
- Frontend: Vite + React + TypeScript in `frontend/`, Chart.js + react-chartjs-2 + chartjs-plugin-annotation.
  All §7–§12 algorithms are pure TS in `frontend/src/domain/`.
- HTTP contract (JSON):
  - `GET /api/config` → `{ groupTerm, rootGroup }`
  - `GET /api/groups[?refresh=1]` → `GroupCard[]` = `{ fullPath, name, segment, children: GroupTile[] }`,
    `GroupTile = { fullPath, name, segment }`
  - `GET /api/iterations?group=<fullPath>` → `Iteration[]` newest-first, **unfiltered** (upcoming included):
    `{ id, iid, title, startDate, dueDate, state }`
  - `GET /api/reports?group=<fullPath>[&refresh=1]` → `IterationReport[]` (≤ 50, newest-first):
    `{ id, iid, title, state, startDate, dueDate, report: Report | null, reportError: string | null }`
    (`reportError` = GitLab's verbatim `TimeboxReport.error.message`; the chart shows it as the region error;
    the §4.4 data check treats a group whose iterations have no series but ≥1 reportError as a FAILED read ⇒ kept),
    `Report = { series: SeriesPoint[], totals: { committed: Total, delivered: Total, inProgress: Total } }`,
    `SeriesPoint = { date, committed, delivered, remaining }`, `Total = { weight, count }`
  - Errors: non-2xx with `{ error: "<verbatim message>" }`.
- §5.2 "one read per group" is realised as ONE logical, cached read per group per freshness window: the
  backend lists the group's iterations (all pages), keeps the newest 50 by the §5.1 order, then fetches each
  report in its own GraphQL request (a `report` field costs ≈175 of GitLab's 250 complexity budget, so
  batching two per request is rejected), with bounded concurrency. Any failed request fails the whole read
  (never cached). Iterations older than the newest 50 have no report entry; the chart region shows
  `No burnup data found for this iteration (check permissions or format).` for them.
- Recorded deviations from the body (decided by the orchestrator, see docs/conformance/*):
  - Ledger #10 is NOT reproduced: all date arithmetic (today, axis days, calendar-day differences) is UTC,
    so the axis never shifts by a day for users far from UTC. Ledger #9 (today = UTC day) still holds.
  - §14.1 "oldest dropped first" is implemented as least-recently-used eviction (a cache hit counts as a use;
    hits never extend the 5-minute TTL).
  - §14.1 forced refresh: a refresh that arrives while an identical read is already in flight joins that
    in-flight read (which is by definition fresh) instead of issuing a duplicate GitLab request.
  - Ledger #11 CHANGED (user decision, 2026-10-02): annotation offsets stay in workload units (§10.5 stacking
    unchanged), but the burndown y-axis widens to include every label's band, so labels never leave the chart —
    even on crowded iterations. The "labels vanish off the top" behaviour no longer exists.
  - Ledger #18 (≤ 5 minutes stale) is guaranteed end-to-end: the browser does not add its own freshness window
    on top of the backend's.
- Visual design follows `STYLEGUIDE.md` (Apple-HIG-style tokens, system font, hairlines, translucent toolbar).
  Where it conflicts with the §13 colour words, the guide wins (user decision, 2026-10-03): today's dot is
  **red** (the guide's "red = today"), distinct from the **orange** forecast and forecast label; annotation list
  cards are neutral cards with a 3 px left edge in the type colour (blue *Information*, red *Risk*) — no amber
  anywhere; burnup annotation markers take the type colour (red when any annotation of that date is a Risk);
  figure tones good / caution / poor map to the guide's on-track green / at-risk orange / late red; the ideal
  reference is the guide's gray, tolerance and burnup delivered are green, the committed-workload reference is
  the secondary neutral. Components expose states (`data-*`) and the stylesheet maps them to tokens; the
  canvas reads the same tokens at runtime.
- Dark mode added: an **Automatic / Light / Dark** switch in the toolbar of both screens (preference in
  `localStorage['heimdall-appearance']`, default Automatic, which follows the system live). The choice sets
  `data-theme="light|dark"` on `<html>`, applied by an inline script before first paint.
- GitLab GraphQL mapping: `burnupTimeSeries { date scopeWeight completedWeight }` → committed = scopeWeight,
  delivered = completedWeight, remaining = committed − delivered (not clamped).
  `stats { total complete incomplete { count weight } }` → committed / delivered / inProgress.
  Iteration number = `iid`. State: `upcoming` | `current` | `closed` (anything else = live).
