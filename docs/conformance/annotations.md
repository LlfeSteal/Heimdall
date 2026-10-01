# Conformance — Annotations (SPEC §10.1–§10.4, §15.8, plus §3.3–§3.5, §14.3 as they touch the lifecycle)

Scope: `frontend/src/annotations/` only. Label geometry (§10.5, §15.7) is **out of scope** (another module).
Test files: `model.test.ts` (MOxx), `storage.test.ts` (STxx, ACx), `lifecycle.test.ts` (LCxx),
`useAnnotations.test.tsx` (HKxx). Run: `cd frontend && npx vitest run src/annotations`.

---

## Builder brief

Implement the four stub modules; every exported signature and its doc comment is the contract. Do not change
signatures or test files. Import UI literals from `src/strings.ts` (`S.currentUser`, `S.unsavedPrompt`) — never
retype them. `testStorage.ts` is a test-only helper (in-memory `MemoryStorage` that records calls,
`throwingStorage`, `makeAnnotation`); leave it as is.

| Module | Exports | Notes |
|---|---|---|
| `model.ts` | `AnnotationType`, `Annotation`, `DEFAULT_ANNOTATION_TYPE`, `effectiveType`, `belongsTo`, `annotationsOnDate` | Pure. `iterationId` is the iteration NUMBER (`Iteration.iid`, a string). |
| `storage.ts` | `ANNOTATIONS_KEY`, `PRE_RENAME_KEY`, `OLDEST_KEY`, `StorageLike`, `StorageArg`, `resolveStorage`, `loadAll`, `listFor`, `save`, `remove` | Optional last arg `storage`: omitted/`undefined` → `globalThis.localStorage` resolved per call inside try/catch; `null` → no storage; object → used as-is. Nothing in this module may throw. |
| `lifecycle.ts` | `DialogueMode`, `Dialogue`, `LifecycleState`, `INITIAL_LIFECYCLE_STATE`, `LifecycleAction`, `lifecycleReducer`, `isDirty`, `canSave`, `NavigationTarget`, `guardNavigation`, `buildAnnotationToSave` | Pure, framework-free. No `confirm`, no clock, no storage inside. |
| `useAnnotations.ts` | `UseAnnotationsOptions`, `DialogueView`, `UseAnnotationsResult`, `useAnnotations` | Wires lifecycle + storage. Injectable `storage`, `confirm` (default `window.confirm`), `now` (default `Date.now`). |

**Storage (`loadAll`) — implement literally, in this order:**

```
s = resolveStorage(storage); if !s → return []                                   (step 1)
try s.removeItem('burndown-annotations')                                          (step 2, unconditional)
raw = try s.getItem('burndown-annotations.v2')                                    (step 3)
if raw (non-null, non-empty):
    try {
        if s.getItem('heimdall-annotations.v1') is a non-empty string → stop      (current wins)
        parsed = JSON.parse(raw); if !Array.isArray(parsed) → stop                (dropped)
        s.setItem('heimdall-annotations.v1', raw)                                 (adopted)
    } catch {} finally { try s.removeItem('burndown-annotations.v2') }            (ALWAYS deleted)
cur = try s.getItem('heimdall-annotations.v1')                                    (step 4)
return Array.isArray(JSON.parse(cur)) ? parsed : []   (null / invalid / non-array / throw → [])
```

`listFor`, `save` and `remove` all read through `loadAll` (so the migration also runs when the first
operation is a write — otherwise pre-rename data would be lost, see ST16). `save` replaces in place by
`id && groupPath && iterationId`, else appends; `remove` filters by the same triple; both then
`setItem('heimdall-annotations.v1', JSON.stringify(list))` inside try/catch.

**Lifecycle / hook model.**
- State = `{ selectedDate, dialogue }`, invariant `selectedDate === dialogue?.date ?? null`.
- `guardNavigation(state, target)` → `'noop'` (target already open: same date / same annotation id),
  `'confirm'` (dialogue dirty), `'proceed'`. Hook: on `'confirm'` call `confirm(S.unsavedPrompt)`; `false`
  → return without touching ANY state.
- Point click opens the FIRST annotation of the current pair's list with that date (edit), else empty add
  dialogue with type `information`. `editFromList(id)` looks the id up in the current list (unknown → no-op).
- `isDirty`: `text.trim() !== initialText.trim() || type !== initialType`; `initialType` for an annotation
  without `type` is `information`.
- `save()`: `buildAnnotationToSave(dialogue, { groupPath, iterationId, now: now() })`; `null` → do nothing
  (dialogue stays open). Else `storage.save(a)`, then `listFor(...)` again (never append locally), then close.
  New: `id = String(now)`, `createdAt = new Date(now).toISOString()`. Edit: keep `id`, `createdAt`, `date`.
  Always `author = S.currentUser`, `text = text.trim()`, `type` written explicitly.
- `remove(id)`: `storage.remove(id, groupPath, iterationId)`, re-read; close the dialogue only if it was editing
  that id. Never prompts.
- When `groupPath` or `iterationId` props change: reset state (no prompt) and re-read the list for the new pair.
  Must be visible on the very next render result (adjust-state-during-render on a pair key, or equivalent);
  a same-pair re-render must NOT reset. The list is re-read on mount, pair change, save, delete — only.
- The UI disables `Add`/`Edit` when `canSave` is false (text required, §3.3).

---

## Checklist

| # | Requirement (MUST / literal) | § | Pinning test(s) |
|---|---|---|---|
| 1 | Annotation carries id, group path, iteration number, date, author, text, optional type, creation timestamp | §10.1 | LC30, HK40 (exact persisted shape) |
| 2 | Absent type means `information` (display, prefill, dirty baseline) | §10.1 | MO01, MO02, LC04, LC16 |
| 3 | Annotation belongs to a (group, iteration) pair, never to an iteration number alone | §10.2 | MO10, ST41, AC1, HK01 |
| 4 | Every stored annotation stores BOTH group path and iteration number | §10.2 | LC30, HK40 |
| 5 | Save matches on identifier AND pair; same id in two groups (or two iterations) is not overwritten | §10.2, §10.4 | ST31, ST32, AC3 |
| 6 | Delete matches on identifier AND pair | §10.2 | ST33, AC2, HK46 |
| 7 | List for an incompletely selected pair (no group / no iteration) is EMPTY, never "all" | §10.2 | MO11, ST40, HK02, HK52 |
| 8 | §15.8: A/42 + B/42 — viewing A shows only A's | §15.8 | AC1, HK03 |
| 9 | §15.8: deleting A's leaves B's untouched | §15.8 | AC2, HK03, HK46 |
| 10 | §15.8: two annotations sharing an identifier in different groups do not overwrite each other | §15.8 | AC3, HK03 |
| 11 | Opening a group → no selection, dialogue closed (no prompt) | §10.3 | LC06, HK51 |
| 12 | Selecting an iteration → same; unsaved text discarded, no prompt | §10.3, §14.3 | LC06, HK50 |
| 13 | Point click, dialogue dirty → ask literal `S.unsavedPrompt` (`Unsaved changes will be lost. Continue?`) | §10.3, §3.5 | LC22, HK30 |
| 14 | Declining aborts: selection, dialogue and its text exactly unchanged; nothing written | §3.5, §10.3 | HK31, HK32 |
| 15 | Otherwise select the date and open the dialogue | §10.3 | LC02, HK11, HK30 |
| 16 | Pre-fill with the FIRST annotation already attached to that date (edit mode); none → empty add mode | §10.3, §3.3 | LC02, LC03, HK11, HK12 |
| 17 | Several annotations on one date: all listed / returned for the tooltip, edit-by-click opens only the first | §10.3, ledger #13 | MO03, LC03, HK12 |
| 18 | Typing / changing text or type → dialogue reports "unsaved" (dirty) | §10.3 | LC12, LC15, HK20, HK21 |
| 19 | Text compared trimmed: whitespace-only typing is not dirty | §10.3 | LC13, LC14, HK20, HK22 |
| 20 | Type compared exactly | §10.3 | LC15, LC16, HK21 |
| 21 | Just-opened dialogue (incl. with existing values) is not dirty | §10.3 | LC10, HK11, HK12 |
| 22 | Save writes through to storage, then re-reads the list from storage (no optimistic state) | §10.3 | HK42, HK43 |
| 23 | Save closes the dialogue | §10.3, §3.3 | HK40 |
| 24 | Cancel closes the dialogue and discards | §10.3 | LC07, HK45 |
| 25 | Edit from the list: same unsaved-changes guard, then open the dialogue on that annotation | §10.3, §3.5 | LC05, LC22, HK13, HK32 |
| 26 | Delete from the list: remove by identifier within the current pair, re-read | §10.3 | HK46, HK47 |
| 27 | Leave the group / back to group list → everything about the selection cleared | §10.3 | LC06, HK52, HK53 |
| 28 | New identifier derived from the clock time (`String(now())`) | §10.3 | LC30, HK40, HK49 |
| 29 | Edited annotation keeps identifier and creation timestamp | §10.1, §10.3 | LC32, HK41 |
| 30 | Author is the literal `S.currentUser` (`Current User`) | §10.3 | LC30, LC32, HK40 |
| 31 | Text is required (save with empty trimmed text persists nothing) | §3.3 | LC17, LC33, HK44 |
| 32 | List order = save order; nothing re-sorts; edit replaces in place | §3.4, §10.4 | ST30, ST31, HK04, HK41 |
| 33 | Key literal `heimdall-annotations.v1` = current, one flat collection for all groups/iterations | §10.4 | ST25, ST30 |
| 34 | Step 1: no browser storage → empty list | §10.4 | ST20, ST23, ST24 |
| 35 | Step 2: delete `burndown-annotations` unconditionally, before anything else | §10.4 | ST01, ST02, ST03 |
| 36 | Step 3: read `burndown-annotations.v2`; absent → stop | §10.4 | ST11 |
| 37 | Step 3: v2 always deleted afterwards, even on failure | §10.4 | ST04, ST06, ST08, ST09, ST10 |
| 38 | Step 3: current key already has data → stop (current wins, v2 dropped) | §10.4 | ST06, ST07 |
| 39 | Step 3: v2 payload invalid / not a collection → dropped, not adopted | §10.4 | ST08, ST09, ST10 |
| 40 | Step 3: otherwise copy v2 into the current key (adopted once) | §10.4 | ST04, ST05 |
| 41 | Step 4: read current; unreadable or not-a-collection → [] | §10.4 | ST12, ST13, ST14 |
| 42 | Corrupted content degrades to []; the next save replaces it | §10.4 | ST15, ST35 |
| 43 | Every operation is a silent no-op without browser storage (incl. storage that throws) | §10.4 | ST20–ST24, HK60, HK61 |
| 44 | Deleting something that isn't there never fails | §10.4 | ST34, HK47 |
| 45 | Migration also runs before the first write (pre-rename data never lost) | §10.4 (derived) | ST16, ST17 |
| 47 | No dialogue, or a clean one → navigation never prompts | §3.5 ("unsaved text") | LC20, LC21, HK33 |
| 48 | Initial state: nothing selected, no dialogue; a same-pair re-render keeps the dialogue; setText/setType without dialogue ignored; unknown id in editFromList ignored | §10.3 (derived) | LC01, LC08, LC11, HK10, HK14, HK54 |
| 46 | Forward requirement (DB uniqueness on (group path, iteration number, …)) | §10.2 | n/a — no DB in scope; satisfied by the (id, pair) match |

### Decisions taken where the spec is silent or ambiguous (all pinned by tests)

| D# | Question | Decision | Test |
|---|---|---|---|
| D1 | "current key already has data" — present, or non-empty array? | Any non-empty string under the key counts (incl. `"[]"` and corrupt text). | ST07 |
| D2 | Should save/remove/listFor run the migration? | Yes — all read through `loadAll`, otherwise a first save would make "current wins" drop v2 data. | ST16, ST17 |
| D3 | Same point / same annotation clicked while dirty (§3.5 says "different point") | `noop`: no prompt, nothing changes, unsaved text kept. | LC23, HK34 |
| D4 | Selection after save/cancel | Cleared together with the dialogue (selection ⇔ open dialogue). | LC07, HK40, HK45 |
| D5 | Save with empty trimmed text | Ignored: nothing written, dialogue stays open; `canSave=false` so the UI disables the action. | LC33, HK44 |
| D6 | Stored text: raw or trimmed? | Trimmed (`text.trim()`), consistent with the trimmed dirty rule; inner newlines kept. | LC30, HK40 |
| D7 | Id / createdAt formats | `id = String(epochMs)`, `createdAt = ISO-8601` of the same instant. Same-instant collisions are reproduced (ledger #14). | LC30, HK03, HK49 |
| D8 | Deleting the annotation currently open in the dialogue | Dialogue closes; deleting any other leaves it untouched. Delete never prompts. | HK48, HK46 |
| D9 | Type on save | Always written explicitly (`information` when untouched). | LC31 |
| D10 | Author on edit | Overwritten with `S.currentUser`. | LC32 |
| D11 | "No storage" vs "default storage" in the API | `undefined`/omitted → default `globalThis.localStorage` (guarded); `null` → no storage. | ST20, ST23, ST24, ST25 |
| D12 | Failed write (quota) | Silent; the list re-read shows what storage really holds. | ST22, HK43 |

---

## Conformance check (round 1)

Checker: independent spec → code comparison (2026-10-01). Code read: `frontend/src/annotations/{model,storage,lifecycle,useAnnotations}.ts`,
`frontend/src/strings.ts`. Runs: `npx vitest run src/annotations` → **4 files, 97/97 passed**; `npx tsc -b --noEmit` → **exit 0, no errors**.
Context: nothing outside `src/annotations/` imports the module yet (no rail / dialogue / tooltip UI). Rules that are pure rendering
are marked **DEFERRED (UI)** — not verifiable here, not counted as MISSING for this module.

### Spec walk

| # | Item | Spec § | Verdict | Evidence (file:line) | Note |
|---|---|---|---|---|---|
| R01 | Annotations live in the individual's browser; no server-side storage | §1.4 | MATCH | storage.ts:32-40, 67-147 | localStorage only; no fetch/XHR/other store anywhere in the module |
| R02 | Read-only against GitLab | §1.4 | MATCH | (whole module) | no network access |
| R03 | Dialogue appears directly under the chart when a point is selected | §3.3 | DEFERRED (UI) | useAnnotations.ts:49-51 | hook exposes `selectedDate` / `dialogue`; placement is the screen's job |
| R04 | Dialogue closes on save or cancel | §3.3 | MATCH | useAnnotations.ts:134, 136; lifecycle.ts:78-80 | |
| R05 | Heading `Add annotation` (new) / `Edit annotation` (existing) | §3.3, §13 | MATCH | strings.ts:77-78; lifecycle.ts:62, 68 | `mode` add/edit drives it; rendering deferred |
| R06 | Context line `Date: {date}` | §3.3, §13 | MATCH | strings.ts:79 | |
| R07 | `Type` with `Information` (blue) / `Risk` (red), chosen one filled | §3.3, §13 | MATCH (literals) / DEFERRED (colour, fill) | strings.ts:80-82 | |
| R08 | Placeholder `Explain the deviation...` | §3.3, §13 | MATCH | strings.ts:83 | |
| R09 | Text required | §3.3 | MATCH | lifecycle.ts:104-106, 143; useAnnotations.ts:130-131 | save ignored when trimmed text empty (D5); UI disabling deferred |
| R10 | Free text, newlines allowed | §3.3 | MATCH | lifecycle.ts:151 | inner newlines kept; ends trimmed (D6) |
| R11 | Actions `Cancel`, `Add` / `Edit` | §3.3, §13 | MATCH | strings.ts:73, 75, 76 | |
| R12 | Amber card: date, `by {author}`, `Edit`, `Delete`, text | §3.4, §13 | MATCH (literals) / DEFERRED (card, amber) | strings.ts:72-74 | |
| R13 | List order = save order; nothing re-sorts | §3.4 | MATCH | storage.ts:112, 128-129, 146 | no `sort` anywhere in module |
| R14 | Empty list literal `No annotation for this iteration` | §3.4, §13 | MATCH | strings.ts:71 | |
| R15 | Rail heading `Annotations ({n})`; help box `How to use` / `- Click a point to annotate` / `- Annotations stored locally` | §3.2, §13, §10.4 | MATCH | strings.ts:70, 85-87 | |
| R16 | Unsaved text + click a *different* point → `Unsaved changes will be lost. Continue?` | §3.5, §10.3 | MATCH | lifecycle.ts:117-128; useAnnotations.ts:101-104, 119-121; strings.ts:84 | |
| R17 | Unsaved text + `Edit` on *another* annotation → same prompt | §3.5, §10.3 | MATCH | useAnnotations.ts:122-126 | |
| R18 | Declining aborts entirely (selection, dialogue, text unchanged) | §3.5, §10.3 | MATCH | useAnnotations.ts:103, 120, 124 | on decline: no dispatch, no read, no write |
| R19 | Prompt only when there is unsaved text | §3.5 | MATCH | lifecycle.ts:122, 127 | |
| R20 | Fields: id, group path, iteration number, date, author, text, type, createdAt | §10.1 | MATCH | model.ts:14-31; lifecycle.ts:145-154 | `iterationId` = iteration NUMBER (`iid`) as string — matches Impl. notes "Iteration number = iid" |
| R21 | Absent type means information | §10.1 | MATCH | model.ts:8, 34-36; lifecycle.ts:66 | |
| R22 | Creation timestamp preserved across edits | §10.1 | MATCH | lifecycle.ts:153 | |
| R23 | Annotation belongs to (group, iteration), never iteration alone | §10.2 | MATCH | model.ts:42-49 | |
| R24 | Every annotation stores both group path and iteration number | §10.2 | MATCH | lifecycle.ts:143, 147-148 | build refuses an incomplete pair |
| R25 | Save matches on identifier AND pair | §10.2 | MATCH | storage.ts:94-96, 127-129 | |
| R26 | Delete matches on identifier AND pair | §10.2 | MATCH | storage.ts:94-96, 146; useAnnotations.ts:138 | code correct, **test pinning weak** (T2) |
| R27 | List for an incompletely selected pair is empty, never "all" | §10.2 | MATCH | model.ts:47; storage.ts:112; useAnnotations.ts:86, 90 | |
| R28 | Forward requirement: DB uniqueness on (group path, iteration number, …) | §10.2 | N/A | — | no DB in scope |
| R29 | Open a group → no selection; dialogue closes | §10.3 | MATCH | useAnnotations.ts:88-98 | pair-key reset during render, no prompt |
| R30 | Select an iteration → same | §10.3 | MATCH | useAnnotations.ts:88-98 | |
| R31 | Click a point, dirty → ask | §10.3 | MATCH | lifecycle.ts:127 | same point while dirty → `noop` (D3), consistent with §3.5 "different point" |
| R32 | Click a point otherwise → select that date; dialogue opens pre-filled with the FIRST annotation of that date | §10.3 | **MISMATCH (edge)** | lifecycle.ts:124-126 (vs 81-84) | `guardNavigation` returns `noop` whenever `dialogue.date === date`, **even when the dialogue is clean**. Case: `Edit` from the list on the 2nd annotation of D, then click point D → dialogue stays on the 2nd annotation instead of re-opening on the first (probe confirmed: text `second`). Fix: for an already-open target return `noop` only when dirty; when clean return `proceed` (re-open is idempotent in every other case). |
| R33 | Typing / changing text or type → dialogue reports "unsaved" | §10.3 | MATCH | lifecycle.ts:98-101; useAnnotations.ts:117 | |
| R34 | Save → write through to storage, then re-read from storage; close | §10.3 | MATCH | useAnnotations.ts:129-135 | no optimistic state |
| R35 | Cancel → close, discard | §10.3 | MATCH | useAnnotations.ts:136; lifecycle.ts:78-80 | |
| R36 | Edit from the list → same guard, then open on that annotation | §10.3 | MATCH | useAnnotations.ts:122-126; lifecycle.ts:85-86 | id looked up in the current pair's list only |
| R37 | Delete from the list → remove by id within current pair, re-read | §10.3 | MATCH | useAnnotations.ts:137-141 | |
| R38 | Leave group / back to list → everything about the selection cleared | §10.3 | MATCH | useAnnotations.ts:88-98 | requires the (not yet written) screen to pass `groupPath: null` |
| R39 | Text compared trimmed; whitespace-only typing not dirty | §10.3 | MATCH | lifecycle.ts:100 | |
| R40 | Type compared exactly | §10.3 | MATCH | lifecycle.ts:100 | |
| R41 | Not dirty merely because opened with existing values | §10.3 | MATCH | lifecycle.ts:62, 68 | initial values = opened values |
| R42 | New identifier derived from clock time | §10.3 | MATCH | lifecycle.ts:146; useAnnotations.ts:130 | |
| R43 | Edited annotation keeps identifier and creation timestamp | §10.3 | MATCH | lifecycle.ts:146, 153 | |
| R44 | Author = fixed placeholder `Current User` | §10.3 | MATCH | lifecycle.ts:150; strings.ts:88 | |
| R45 | Several on one date: all listed | §10.3 | MATCH | storage.ts:112 | |
| R46 | Several on one date: all in the tooltip, one per line | §10.3 | MATCH (data) / DEFERRED (tooltip) | model.ts:55-57 | |
| R47 | Several on one date: editing (point click) opens only the first | §10.3 | MATCH | lifecycle.ts:82-83 | see R32 for the same-point edge |
| R48 | Stored in the individual's browser (per browser / machine) | §10.4 | MATCH | storage.ts:32-40 | |
| R49 | One flat collection under a single key | §10.4 | MATCH | storage.ts:16, 98-100 | |
| R50 | Key literals `heimdall-annotations.v1`, `burndown-annotations.v2`, `burndown-annotations` | §10.4 | MATCH | storage.ts:16-20 | |
| R51 | Step 1: no browser storage → empty list | §10.4 | MATCH | storage.ts:68-69, 32-40 | |
| R52 | Step 2: delete oldest key, unconditionally (before step 3) | §10.4 | MATCH | storage.ts:71 | |
| R53 | Step 3: read pre-rename key; if absent, stop | §10.4 | **MISMATCH (minor)** | storage.ts:73-74 | `if (raw)` treats a present empty string `''` as absent, so that key is never deleted (probe confirmed: still present after `loadAll`). Spec: only *absent* stops; a present-but-invalid payload is "dropped" and "always deleted". Fix: `if (raw !== null)` (the `''` then fails `JSON.parse` → dropped, and `finally` deletes it). Negligible user impact. |
| R54 | Step 3: always delete pre-rename key afterwards, even on failure | §10.4 | MATCH (except R53) | storage.ts:81-83 | `finally`; covers parse error and storage exceptions |
| R55 | Step 3: current key already has data → stop (current wins) | §10.4 | AMBIGUOUS | storage.ts:77-78 | "has data" resolved as any non-empty string, incl. `"[]"` and corrupt text (D1) |
| R56 | Step 3: payload invalid or not a collection → dropped, not adopted | §10.4 | MATCH | storage.ts:78 | |
| R57 | Step 3: otherwise copy into current key | §10.4 | MATCH | storage.ts:78 | copied verbatim |
| R58 | Step 3 internal order (current-wins check before validity check) | §10.4 | MATCH | storage.ts:77-78 | |
| R59 | Step 4: read current; unreadable / not-a-collection → [] | §10.4 | MATCH | storage.ts:86-90 | |
| R60 | Save replaces matching entry in place (id AND pair) or appends | §10.4 | MATCH | storage.ts:122-131 | |
| R61 | Delete filters it out | §10.4 | MATCH | storage.ts:146 | |
| R62 | Every operation a silent no-op without browser storage | §10.4 | MATCH | storage.ts:43-49, 123-124, 144-145 | |
| R63 | Deleting something absent never fails | §10.4 | MATCH | storage.ts:146 | |
| R64 | Corrupted content → []; next save replaces it | §10.4 | MATCH | storage.ts:86-90, 125-130 | |
| R65 | Colour semantics: annotations blue (Information) / red (Risk); list cards amber | §13 | DEFERRED (UI) | — | |
| R66 | Choosing a different iteration immediately discards the open annotation selection and unsaved text | §14.3 | MATCH | useAnnotations.ts:93-98 | visible on the same render; chart/history part is another module |
| R67 | §15.8 viewing A/42 shows only A's | §15.8 | MATCH | model.ts:42-49; storage.ts:107-113 | |
| R68 | §15.8 deleting A's leaves B's untouched | §15.8 | MATCH | storage.ts:94-96, 146 | |
| R69 | §15.8 shared identifier in different groups → no overwrite | §15.8 | MATCH | storage.ts:127 | |
| R70 | Ledger #13: tooltip shows all, editing opens the first | §16 | MATCH (data) / DEFERRED (tooltip) | model.ts:55-57; lifecycle.ts:82-83 | |
| R71 | Ledger #14: author placeholder; ids from the clock; same-instant collision possible | §16 | MATCH | lifecycle.ts:146, 150; storage.ts:127-128 | two same-instant saves in one pair → second replaces first (collision reproduced) |
| R72 | Ledger #15: annotations live in one browser only | §16 | MATCH | storage.ts:32-40 | |
| R73 | Impl. notes: iteration number = `iid` | Impl. notes | MATCH | model.ts:19-20 | integration must pass `Iteration.iid`, not `id` |

### Forbidden behaviours (searched for, none found)

| # | Forbidden behaviour | Verdict | Evidence |
|---|---|---|---|
| F1 | Optimistic UI state instead of re-reading storage | absent | useAnnotations.ts:133, 139 re-read; mutation "append locally" is caught by HK04/HK42/HK43/HK60 |
| F2 | Annotations listed when group or iteration incomplete | absent | model.ts:47; storage.ts:112 |
| F3 | Throwing when storage is unavailable / failing | absent | storage.ts:32-49 (`resolveStorage`, `attempt`), 75-83; useAnnotations.ts:145-147 |
| F4 | Re-sorting the list | absent | no sort in module |
| F5 | Keying on iteration alone | absent | model.ts:48; storage.ts:95 |

### Analyst decisions D1–D12 vs spec text

| D# | Verdict | Note |
|---|---|---|
| D1 | OK (resolves ambiguity) | "has data" is unspecified; any non-empty string is a defensible literal reading |
| D2 | OK | writes must read the collection anyway; keeps pre-rename data |
| D3 | **Partly contradicts §10.3** | dirty + same target → noop is consistent with §3.5 ("different point", "another annotation"). But applied to a *clean* dialogue it breaks §10.3 "otherwise → … pre-filled with the FIRST annotation" in the case of R32. Restrict the noop to the dirty case. |
| D4 | OK | spec silent on selection after close |
| D5 | OK | follows "required" |
| D6 | OK | inner newlines kept; leading/trailing whitespace dropped — spec silent |
| D7 | OK | |
| D8 | OK | spec silent; delete has no guard in §10.3 |
| D9 | OK | |
| D10 | OK | author is always the placeholder |
| D11 | OK | API shape only |
| D12 | OK | silent failure, list mirrors storage |

### Test strength on the key rules (mutation-probed in a scratch copy; repo untouched)

| # | Rule | Strength | Evidence |
|---|---|---|---|
| T1 | Save scoping (id AND group AND iteration) | strong | ST32 (other iteration), AC3 (other group); mutation dropping iteration from the match fails ST32 |
| T2 | **Delete scoping by iteration** | **WEAK** | every delete test that shares an id varies the **group** only (AC2, HK46, HK03). Mutating `storage.remove` to match `(id, groupPath)` only → **97/97 still pass**. Missing test: save `{id:'same',A,'42'}` and `{id:'same',A,'43'}`, `remove('same',A,'42')` → the `43` one survives. |
| T3 | List scoping / incomplete pair empty | strong | ST40, ST41, AC1, MO10, MO11, HK01, HK02 |
| T4 | §10.4 read order | mostly strong | ST03 pins step 2 < v2 read < v2 delete < final current read (moving step 2 fails 4 tests); ST06–ST10 pin drop + delete. Gaps: (a) "always delete even on failure" with a **storage** failure (setItem throws during adoption) is unpinned — moving the delete inside the `try` still passes 97/97; (b) the `''` payload case (R53) is unpinned either way. |
| T5 | Decline aborts everything | strong | HK31 compares selection, dialogue (text + type), dirty, list and raw storage; HK32 for `Edit`; LC22 |
| T6 | No optimistic state | strong | HK42 (write behind the hook), HK43 (lost write), HK46 (delete re-read) |
| T7 | Same-point re-click when clean and editing a non-first annotation (R32) | untested | HK34/LC23 only cover the dirty case |

### Totals (R01–R73)

MATCH 67 (4 of them with only the literal/data part matching while rendering is deferred: R07, R12, R46, R70) · MISMATCH 2 (R32, R53) · MISSING 0 ·
AMBIGUOUS 1 (R55) · DEFERRED (UI only) 2 (R03, R65) · N/A 1 (R28). Test gaps: T2 (weak), T4 (partial), T7 (untested).

### Round 1 fixes (builder)

| Item | Change | Pinned by |
|---|---|---|
| R32 / D3 | `guardNavigation` returns `noop` for the already-open target **only when the dialogue is dirty** (§3.5); a clean dialogue → `proceed`, so re-clicking point D re-opens it on the FIRST annotation of D (§10.3), and re-editing the open annotation re-opens it (harmless). D3 now reads: dirty + same target → `noop`; clean + same target → `proceed`. | LC24, HK35 (new); LC23, HK34 unchanged |
| R53 | `loadAll` step 3 tests `raw !== null`: a present `''` under `burndown-annotations.v2` fails `JSON.parse` → dropped, and is deleted by the `finally`. (Brief pseudo-code "if raw (non-null, non-empty)" superseded: only *absent* stops.) | ST18 (new) |
| T2 | Delete scoping by iteration: same id + group, other iteration survives. | ST36 (new) |
| T4 | v2 deleted even when the adoption `setItem` throws; `loadAll` does not throw. | ST19 (new) |

Runs after the fixes: `npx vitest run src/annotations` → 4 files, **102/102 passed**; `npx tsc -b --noEmit` → exit 0; `npx oxlint src/annotations` → exit 0.
Mutation probes (reverting each fix in place, then restored): `if (raw)` → ST18 fails; old guard → LC24, HK35 fail; remove matching `(id, group)` only → ST36 fails; v2 delete moved inside the `try` → ST19 fails.
