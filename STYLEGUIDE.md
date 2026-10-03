# Nornir style guide

Everything needed to rebuild Nornir's look elsewhere: another app, another framework, or a design tool. This guide covers the visual design only; for behavior, see `AGENTS.md`.

The source of truth is `frontend/src/styles/theme.css` (every token is a CSS custom property) and `frontend/src/components/Icons.tsx`. Every value below is copied from those two files. **Keep this guide in sync when they change.**

---

## 1. Principles

Nornir transposes **Apple's Human Interface Guidelines** (macOS / iOS) to the web.

- **Native feel**: system font, Apple system colors, and a light **and** a dark appearance. Separators are hairlines (0.5 px). Bars use a translucent material, cards are rounded, and motion is short and soft.
- **Sober**: meaning comes from contrast, position and shape, not from extra hues, outlines or badges. When in doubt, take something away.
- **Self-contained**: no web fonts, no CSS framework and no icon font. The app must look the same offline.
- **Colors carry meaning, and only one meaning each**:
  - **Green** only ever means *on track*. That is why issues are **teal**, not green.
  - **Orange** means *slightly behind* or *needs attention*. **Red** means *late*, *at risk*, *a conflict* or *today*.
  - A bar's color is its **schedule**. The GitLab health status never tints a bar: it is a separate icon in the list.
  - The critical path has **no hue of its own**: it is the strongest neutral (the text color), and everything else fades.
  - Gray means *made up*, *outside* or *closed*.
- **No color in code**: components only expose states (`data-type`, `data-schedule`, `data-closed`…), and the stylesheet maps those states to tokens.

---

## 2. Color

### 2.1 Neutrals

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#f5f5f7` | `#000000` | Page (grouped) background, dialog sheet |
| `--card` | `#ffffff` | `#1c1c1e` | Cards, chart rows, calendar header |
| `--row-alt` | `#fafafc` | `#202022` | Every other chart row |
| `--row-hover` | `rgba(0,0,0,0.035)` | `rgba(255,255,255,0.05)` | Row hover tint |
| `--text` | `#1d1d1f` | `#f5f5f7` | Primary text, critical path |
| `--text-secondary` | `rgba(60,60,67,0.6)` | `rgba(235,235,245,0.6)` | Secondary text, labels, legend |
| `--text-tertiary` | `rgba(60,60,67,0.3)` | `rgba(235,235,245,0.3)` | Placeholders, tree lines, scrollbars, details |
| `--separator` | `rgba(60,60,67,0.12)` | `rgba(84,84,88,0.45)` | Hairlines (0.5 px), calendar column lines |
| `--fill` | `rgba(120,120,128,0.12)` | `rgba(118,118,128,0.24)` | Control backgrounds (buttons, fields, segmented controls) |
| `--fill-pressed` | `rgba(120,120,128,0.2)` | `rgba(118,118,128,0.36)` | Hover / pressed controls |
| `--material` | `rgba(255,255,255,0.72)` | `rgba(28,28,30,0.72)` | Translucent toolbar and tooltip (with blur, see §5) |
| `--menu-bg` | `rgba(246,246,248,0.97)` | `rgba(44,44,46,0.97)` | Menus and popovers (near opaque) |
| `--segment-thumb` | `#ffffff` | `#636366` | Selected segment, pressed toggle |

### 2.2 System hues

These are Apple system colors, with a brighter variant in dark mode.

| Token | Light | Dark |
|---|---|---|
| `--blue` | `#007aff` | `#0a84ff` |
| `--purple` | `#af52de` | `#bf5af2` |
| `--green` | `#34c759` | `#30d158` |
| `--orange` | `#ff9500` | `#ff9f0a` |
| `--teal` | `#30b0c7` | `#40c8e0` |
| `--red` | `#ff3b30` | `#ff453a` |

**Blue** is also the accent color: links, pressed toggles, active filters, the menu highlight and the focus ring.

### 2.3 Semantic tokens

| Token | Value | Meaning |
|---|---|---|
| `--milestone` | `--purple` | Milestone (type dot, bar) |
| `--epic` | `--blue` | Epic |
| `--issue` | `--teal` | Issue / user story (not green) |
| `--on-track` | `--green` | Progress ≥ expected progress |
| `--at-risk` | `--orange` | Up to 5 points behind |
| `--late` | `--red` | More than 5 points behind |
| `--health-on-track` | `--green` | Health: on track (tooltip text only) |
| `--health-needs-attention` | `--orange` | Health: needs attention (circle icon) |
| `--health-at-risk` | `--red` | Health: at risk (octagon icon) |
| `--warning` | `--orange` | Row warning (triangle icon) |
| `--overrun` | `--red` | Part of a bar past its parent's end, or before its blocker ends (hatched) |
| `--blocked` | `--red` | Blocked item (stroked no-entry sign) |
| `--dependency` | `#8e8e93` / dark `#98989d` | Dependency arrows |
| `--dependency-conflict` | `--red` | An arrow into an item that starts before its blocker ends |
| `--critical` | `--text` | Critical path arrows |
| `--undated` | `#aeaeb2` / dark `#636366` | Bars with made-up dates, items from elsewhere |
| `--undated-stroke` | `#8e8e93` / dark `#98989d` | Dashed outline of undated bars |
| `--closed-bg` | `rgba(142,142,147,0.18)` / dark `0.22` | Closed hatch, light stripe |
| `--closed-stroke` | `rgba(142,142,147,0.45)` / dark `0.5` | Closed hatch, dark stripe |
| `--milestone-band` | `rgba(175,82,222,0.1)` / dark `rgba(191,90,242,0.16)` | Tint of rows inside an expanded milestone |
| `--epic-band` | `rgba(0,122,255,0.1)` / dark `rgba(10,132,255,0.16)` | … inside an expanded epic |
| `--issue-band` | `rgba(48,176,199,0.1)` / dark `rgba(64,200,224,0.16)` | … inside an expanded issue |

### 2.4 Derived colors

These are always mixed from tokens with `color-mix(in srgb, …)` and never written out as literal values:

| Recipe | Where |
|---|---|
| `var(--bar) 65%, var(--card)` | Bars below the top level (toned down) |
| `var(--red) 10%, var(--card)` | Error banner background |
| `var(--blue) 50%, transparent` | Focus ring |
| `var(--blue) 45%, transparent` | Search field focus ring |
| `var(--blue) 14%, transparent` | Active pop-up button background |
| `var(--blue) 88%, #000` | Primary button hover |
| `var(--overrun) 30%, var(--card)` | Light stripe of the red hatch |
| `var(--undated) 35%, transparent` | Undated bar fill |

The literal colors allowed outside tokens are white (`#fff`), for text and glyphs on colored fills, and the modal backdrop (§5).

---

## 3. Typography

**Font stack**, system only:

```css
-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif
```

The base is **14 px / 1.4**, `-webkit-font-smoothing: antialiased`, in color `--text`.

| Role | Size | Weight | Notes |
|---|---|---|---|
| App title, empty-state heading | 17 px | 600 | Title tracking −0.01em |
| Dialog title | 15 px | 600 | Ellipsis on one line |
| Body: controls, list names, menu items | 13 px | 400 (buttons and segments 500) | |
| Expanded group name, critical name | 13 px | 600 | |
| Secondary: legend, subtitles, tooltip lines, "Updated at", bar labels | 12 px | 400 | Secondary color; tooltip title 13 / 600 |
| Calendar group (year / quarter) | 12 px | 600 | Secondary |
| Small: calendar cells, details, pills, menu headers | 11 px | 400 (pills and headers 600) | |
| Column header ("NAME") | 11 px | 600 | Uppercase, +0.06em, secondary |
| Today pill | 10 px | 600 | White on red |

Numbers that change or line up (counts, periods) use `font-variant-numeric: tabular-nums`. Labels inside colored bars are white 500; inside group bars they use `--text` at 600.

---

## 4. Layout, sizing, spacing

**Spacing scale**: 2, 4, 6, 8, 12, 16, 24 px.
- Page content: padding **16 × 24**, vertical gap 12.
- Toolbar: padding 12 × 24, gaps 12 (vertical) × 24 (horizontal); actions 8 apart.
- Filter bar and control groups: gap 8. Legend: gap 16, groups separated by a 0.5 px hairline with 16 px padding.

**Radius scale**:

| Radius | Element |
|---|---|
| 1–3 px | Legend lines and swatches, 4 px progress bar (2) |
| 5–6 px | Chevron button, segments, menu items, bars (6) |
| 7–8 px | Buttons (7), segmented control, search field, toggle group, app icon (8) |
| 9 px | Pills (dependency count: 18 px high) |
| 10 px | Menus, tooltips |
| 12 px | Cards, banner (`--radius`) |
| 14 px | Modal sheet |
| 50 % | Type dots, label dots, clear button |

**Control heights**: buttons, fields, menu items and pop-up buttons are **28 px**. Segments and toggles are **24 px** inside a 2 px inset. Icon buttons are 28 × 28.

**Chart grid**:

| Measure | Value |
|---|---|
| Row height | 40 px |
| Bar | 24 px high, 8 px from the row top, radius 6 |
| List column (sticky left) | 260 px, cell padding 0 12 0 10 |
| Calendar header | 52 px = group line 24 + cells 28 |
| Column width | Day 44 · Week 110 (weeks start Monday) · Month 180 |
| Type dot | 8 px circle, 8 px right margin |
| Chevron | 20 × 20 hit area, radius 5, 14 px glyph |
| Tree indent | 16 px per level |
| Dialog sheet | `min(1100px, 100vw − 32px)`, chart 70 vh |

---

## 5. Elevation and materials

| Token / rule | Light | Dark |
|---|---|---|
| `--shadow` (cards) | `0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)` | `0 0 0 0.5px rgba(255,255,255,0.08)`: a hairline ring instead of a shadow |
| `--popover-shadow` (menus, tooltips, sheets) | `0 8px 30px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.08)` | `0 8px 30px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.12)` |
| Raised segment / toggle | `0 1px 3px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.04)` | same |
| Modal backdrop | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.65)` |

- **Translucent material** (sticky toolbar, tooltip): `background: var(--material); backdrop-filter: saturate(180%) blur(20px)`, with a 0.5 px `--separator` bottom border on the toolbar.
- **Menus are near opaque** (`--menu-bg`, 97 %). A menu inside the blurred toolbar can't blur the page behind it: nested `backdrop-filter` only sees its parent.
- Layering, bottom to top: rows → arrows (z 1) → sticky list (z 2) → calendar header (z 3) → filter bar (z 5) → toolbar (z 10) → menus (z 20) → tooltip (z 30).

---

## 6. Motion

- **Easing**: `cubic-bezier(0.25, 0.1, 0.25, 1)` (`--ease`) everywhere.
- **Durations**:

| Duration | Use |
|---|---|
| 0.1 s | Press: buttons scale to 0.97 |
| 0.12 s | Menu appears: fade in and scale from 0.96, from its anchor corner |
| 0.15 s | Hover backgrounds, bar hover, dialog in, backdrop fade |
| 0.2 s | Chevron rotation (0 → 90°), dimming off the critical path |
| 0.22 s | Segmented control thumb slide |
| 0.9 s linear, infinite | Refresh spinner |
| 1.4 s, infinite | Skeleton shimmer |

- **Reduced motion**: under `prefers-reduced-motion: reduce`, every animation and transition is off, including the dialog backdrop.

---

## 7. Components

**States, everywhere**: hover darkens the fill (`--fill` → `--fill-pressed`). Active presses down (`scale(0.97)`). Disabled is `opacity 0.5`, with no press. Focus uses the focus ring (§12). "On" toggles use `aria-pressed='true'`.

| Component | Recipe |
|---|---|
| **Button** | 28 px high, padding 0 12, radius 7, no border, `--fill`, 13 px / 500, icon gap 6 |
| **Button, pressed toggle** (Closed, Blocked, Critical path only) | `--fill-pressed` background, **blue** text |
| **Icon button** | 28 × 28, centered 15 px icon |
| **Plain button** | No background, blue text, padding 0 8; hover shows `--fill` |
| **Primary button** | Blue background, white text; hover is blue mixed 88 % with black |
| **Segmented control** (Day / Week / Month) | 2 px padding, radius 8, `--fill`; equal-width segments (min 64 px, 24 px high, radius 6); a sliding white thumb (`--segment-thumb`) with the raised shadow; unselected text secondary |
| **Toggle group** (Milestones / Epics / Issues) | Same shell; each pressed button is raised like a thumb; text secondary, `--text` when pressed or hovered; an 8 px type dot before the label |
| **Pop-up button** (Labels, Health, Period) | A button with a 12 px chevron-down; when a filter is set, the selection replaces the title and the button is tinted (blue 14 % background, blue text) |
| **Search field** | 240 × 28, radius 8, `--fill`, 13–14 px magnifier; focus shows a 3 px blue ring at 45 %; a circular clear button (filled tertiary circle with a cross in `--card`) |
| **Menu / popover** | Radius 10, padding 5, `--menu-bg`, popover shadow, min width 190 (filters 290); 11 px / 600 secondary header; 28 px items with radius 6; hover is **solid blue with white text** (macOS); a check mark on selected items; sections and footer separated by a hairline; inner search field radius 6 |
| **Tooltip** | Material with blur, radius 10, padding 12 × 14, min 220 / max 320 px; 13 / 600 title, 12 px secondary lines; a 4 px progress track (`--fill`) with the value in the schedule color and the expected progress at 0.4 |
| **Card** | `--card`, radius 12, `--shadow`, content clipped |
| **Error banner** | Radius 12, padding 12 × 16, red 10 % mixed into the card; red icon; bold title with a 13 px secondary line |
| **Empty state** | Centered, padding 64 × 24; 40 px tertiary icon; 17 / 600 heading; secondary text; an action button 16 px below |
| **Skeleton** | 40 px rows; 10 px bars with radius 5 and a `--fill` → `--fill-pressed` shimmer |
| **Count pill** (dependencies) | 18 px high, padding 0 6, radius 9, `--fill`, 11 / 600 tabular secondary text, 12 px link icon; hover shows `--fill-pressed` and `--text` |
| **Legend** | 12 px secondary text; a 10 px dot with radius 3 (types, schedule); an 18 × 8 swatch with radius 3 (progress layers, hatches, gray); a 2 × 12 red line (today); a 22 px arrow (1.5 px, 2 px for the critical one, dashed for derived steps) |
| **Toolbar** | Sticky, translucent; left: app icon, title "Nornir · group" (the group in 400 secondary, blue on hover) and "Updated at" (12 px secondary) below; right: controls 8 px apart |

---

## 8. The Gantt chart

### Rows

- Background alternates `--card` and `--row-alt`. Hover adds `--row-hover`.
- A row **inside an expanded group** gets the parent's band (`--epic-band`…) across the whole row, plus a **3 px inset left edge** in the parent's color on the list side.
- Layers are stacked as backgrounds: hover tint, then group band, then row color. Calendar column lines (0.5 px `--separator`) are drawn on top of them.
- List side: chevron, then an 8 px type dot, then the name (13 px, ellipsis). An expanded group's name is 600.
- **Trailing accessories** line up at the right end of the cell like a macOS table cell, 6 px apart: warning, health, blocked, count pill.
- **Tree connectors**: 1 px `--text-tertiary` lines, 16 px per level, an elbow into each child, and the last child's line stops at mid-height.
- Closed rows: secondary-color name, tertiary dot. Items from elsewhere: secondary name, gray dot, an 11 px tertiary detail line.

### Calendar header and today

- Two lines: the group (year / quarter, 12 / 600, sticky while its months scroll) above the cells (11 px, centered). Every boundary is a 0.5 px separator.
- **Today**: a 2 px red vertical line through the body, and a red **"Today" pill** (40 × 16, radius 8, 10 / 600 white) in the header. In the dependencies dialog the line is 1 px at 50 % opacity: there, red belongs to conflicts.

### Bars

| Kind | Look |
|---|---|
| **Leaf** (issue) | Solid `--bar` (type color); progress is a `rgba(0,0,0,0.2)` overlay from the left |
| **Group** (epic, milestone, any item with children) | Three layers in `--bar`: the **track** (planned) at 0.3, the **expected** (linear) progress at 0.55, and the **real** progress solid. The color is the schedule status (green / orange / red) |
| **Nested** (below the top level) | The color is mixed 65 % with the card: toned down |
| **Label** | Inside when it fits (white 500, or `--text` 600 on group bars, centered, 8 px padding); otherwise to the right of the bar, 12 px secondary, 6 px gap |
| **Hover** | `brightness(1.08)` and `drop-shadow(0 2px 4px rgba(0,0,0,0.15))` |
| **Closed** | One full bar hatched at 45°, stripes `--closed-bg` 3 px / `--closed-stroke` 2 px; no progress, no schedule color; secondary label |
| **No dates** (made up) | `--undated` at 35 %, with a 1.5 px **dashed** inner outline in `--undated-stroke`; no schedule color |
| **Past its parent / before its blocker ends** | A red 45° hatch over that part of the bar (3 px red / 3 px red mixed 30 % with the card), rounded only on the outer side |
| **From elsewhere** (dependencies dialog) | Gray (`--undated`), `--text` label |

### Dependency arrows (dialog)

- **Normal**: 1.5 px `--dependency`. **Conflict**: `--dependency-conflict`. **Critical**: 1.75 px `--critical`, drawn last, black even when in conflict. **Through parent epics**: dashed `4 3`.
- Orthogonal routing: out of the blocker's end, then 10 px across, then down or up, then into the target's start. Corners are rounded with radius 4. Caps and joins are round.
- Arrowheads are **6 px** triangles, the same size whatever the stroke (`markerUnits="userSpaceOnUse"`).
- Verticals of different blockers turning at the same place sit **4 px apart**.
- With a critical path, everything else drops to **opacity 0.35** (back to 1 on hover), names off the path turn secondary, and names on it become 600.

---

## 9. Iconography

**Line icons**, in the spirit of SF Symbols:

| Property | Value |
|---|---|
| ViewBox | 24 × 24 |
| Default size | 16 px |
| Common sizes | 12, 13, 14, 15, 18, 20, 40 px |
| Stroke | 1.8 (2–2.4 for small or emphasized glyphs) |
| Caps / joins | Round |
| Fill | None |
| Color | `currentColor` |
| Accessibility | `aria-hidden` |

| Icon | Shape | Use |
|---|---|---|
| Chevron right / left / down | Open angle | Expand (rotates 90°), period ‹ ›, pop-up |
| Refresh | Arc with an arrowhead | Refresh |
| Today | Calendar with a dot | Today |
| Closed | Circle with a check | Closed toggle |
| Search | Circle with a handle | Search fields |
| Clear | Filled circle, cross in the card color | Clear a field |
| Check | Tick (stroke 2.2) | Menu selection |
| Sun / Moon / half-filled circle | | Appearance Light / Dark / Automatic |
| Warning (outline triangle) | | Error banner |
| Timeline | Three offset horizontal strokes (2.4) | App icon, empty state |
| Link | Two chain links (stroke 2) | Dependency count |

**Status glyphs**: a filled shape with a **white** mark (an exclamation bar 2.3–2.4 px plus a dot), 15 px in the list and 12 px in tooltips. **The shape carries the meaning**, so they can be told apart without color:

| Glyph | Color | Meaning |
|---|---|---|
| Rounded triangle (`exclamationmark.triangle.fill`) | `--warning` | Row warning: no dates, no child items |
| Octagon (`exclamationmark.octagon.fill`) | `--health-at-risk` | Health: at risk |
| Circle (`exclamationmark.circle.fill`) | `--health-needs-attention` | Health: needs attention |
| **Stroked** circle with a slash (`nosign`, stroke 2.2) | `--blocked` | Blocked: stroked, so it never reads as the filled red octagon |

**App icon**: a 32 px tile with radius 8, a 135° gradient from `--blue` to `--purple`, and an 18 px white timeline glyph.

---

## 10. Dark mode

- The user picks **Automatic** (follows the system), **Light** or **Dark**.
- The choice sets `data-theme="light|dark"` on `<html>`. A **single** `:root[data-theme='dark']` block overrides the tokens; there is no `prefers-color-scheme` query in the CSS.
- A tiny inline script applies the theme **before first paint**, so the page never flashes the wrong theme.
- `<meta name="color-scheme" content="light dark">` and `theme-color` meta tags: `#f5f5f7` light, `#000000` dark.
- Besides the palette:
  - card shadows become a 0.5 px light ring;
  - the segmented thumb is gray (`#636366`);
  - the hues switch to their brighter dark variants;
  - group bands go from 10 % to 16 %;
  - the backdrop goes from 50 % to 65 %.
- Every component must be checked in both appearances.

---

## 11. Do / don't

These choices were tried in Nornir and dropped:

| Don't | Do |
|---|---|
| Outline bars to show health or problems: too heavy | One icon in the row's trailing accessories |
| Put icons or text glyphs ("!!" in a capsule) on the bars | Keep marks in the list, which is always visible on the same row |
| Use two icon styles for "own status" vs "from below" | One icon; the help tag says which |
| Make issues green | Teal: green means on track only |
| Give the critical path its own hue, badge or outline | Use the strongest neutral and fade the rest |
| Show a warning sign for a blocker conflict | Hatch the conflicting part of the bar in red: it shows *where* |
| Hard-code colors in components | Expose `data-*` states and map them to tokens in CSS |
| Load a web font or a UI framework | Use the system font stack and plain CSS |

---

## 12. Accessibility

- **Focus ring**: `outline: 3px solid color-mix(in srgb, var(--blue) 50%, transparent); outline-offset: 2px; border-radius: 6px` on `:focus-visible`.
- **Shape before color**: status glyphs differ by shape; hatches and dashes carry states without relying on hue.
- Meaningful icons have `role="img"` with an `aria-label` and a native `title` (help tag). Decorative ones are `aria-hidden`.
- Toggles expose `aria-pressed`, segments `role="radio"` with `aria-checked`, and chevrons `aria-expanded`.
- Motion is off under reduced motion (§6).

---

## 13. Starter kit

Paste this into a new project to start with the same tokens and base controls:

```css
:root {
  color-scheme: light;
  --font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  --bg: #f5f5f7; --card: #ffffff; --row-alt: #fafafc; --row-hover: rgba(0, 0, 0, 0.035);
  --text: #1d1d1f; --text-secondary: rgba(60, 60, 67, 0.6); --text-tertiary: rgba(60, 60, 67, 0.3);
  --separator: rgba(60, 60, 67, 0.12);
  --fill: rgba(120, 120, 128, 0.12); --fill-pressed: rgba(120, 120, 128, 0.2);
  --material: rgba(255, 255, 255, 0.72); --menu-bg: rgba(246, 246, 248, 0.97); --segment-thumb: #ffffff;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 16px rgba(0, 0, 0, 0.06);
  --popover-shadow: 0 8px 30px rgba(0, 0, 0, 0.14), 0 0 0 0.5px rgba(0, 0, 0, 0.08);
  --blue: #007aff; --purple: #af52de; --green: #34c759; --orange: #ff9500; --teal: #30b0c7; --red: #ff3b30;
  --milestone: var(--purple); --epic: var(--blue); --issue: var(--teal);
  --on-track: var(--green); --at-risk: var(--orange); --late: var(--red);
  --health-needs-attention: var(--orange); --health-at-risk: var(--red); --health-on-track: var(--green);
  --warning: var(--orange); --overrun: var(--red); --blocked: var(--red);
  --dependency: #8e8e93; --dependency-conflict: var(--red); --critical: var(--text);
  --undated: #aeaeb2; --undated-stroke: #8e8e93;
  --closed-bg: rgba(142, 142, 147, 0.18); --closed-stroke: rgba(142, 142, 147, 0.45);
  --milestone-band: rgba(175, 82, 222, 0.1); --epic-band: rgba(0, 122, 255, 0.1); --issue-band: rgba(48, 176, 199, 0.1);
  --radius: 12px;
  --ease: cubic-bezier(0.25, 0.1, 0.25, 1);
}
:root[data-theme='dark'] {
  color-scheme: dark;
  --bg: #000000; --card: #1c1c1e; --row-alt: #202022; --row-hover: rgba(255, 255, 255, 0.05);
  --text: #f5f5f7; --text-secondary: rgba(235, 235, 245, 0.6); --text-tertiary: rgba(235, 235, 245, 0.3);
  --separator: rgba(84, 84, 88, 0.45);
  --fill: rgba(118, 118, 128, 0.24); --fill-pressed: rgba(118, 118, 128, 0.36);
  --material: rgba(28, 28, 30, 0.72); --menu-bg: rgba(44, 44, 46, 0.97); --segment-thumb: #636366;
  --shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.08);
  --popover-shadow: 0 8px 30px rgba(0, 0, 0, 0.5), 0 0 0 0.5px rgba(255, 255, 255, 0.12);
  --blue: #0a84ff; --purple: #bf5af2; --green: #30d158; --orange: #ff9f0a; --teal: #40c8e0; --red: #ff453a;
  --dependency: #98989d; --undated: #636366; --undated-stroke: #98989d;
  --closed-bg: rgba(142, 142, 147, 0.22); --closed-stroke: rgba(142, 142, 147, 0.5);
  --milestone-band: rgba(191, 90, 242, 0.16); --epic-band: rgba(10, 132, 255, 0.16); --issue-band: rgba(64, 200, 224, 0.16);
}

* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.4 var(--font); color: var(--text); background: var(--bg); -webkit-font-smoothing: antialiased; }
a { color: var(--blue); text-decoration: none; }
a:hover { text-decoration: underline; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 3px solid color-mix(in srgb, var(--blue) 50%, transparent); outline-offset: 2px; border-radius: 6px; }

.card { background: var(--card); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }

.toolbar {
  position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 12px 24px;
  padding: 12px 24px; background: var(--material);
  backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 0.5px solid var(--separator);
}

.button {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 0; border-radius: 7px;
  background: var(--fill); color: var(--text); font-size: 13px; font-weight: 500; cursor: pointer;
  transition: background 0.15s var(--ease), transform 0.1s var(--ease);
}
.button:hover { background: var(--fill-pressed); }
.button:active { transform: scale(0.97); }
.button:disabled { opacity: 0.5; cursor: default; transform: none; }
.button[aria-pressed='true'] { background: var(--fill-pressed); color: var(--blue); }
.button.primary { background: var(--blue); color: #fff; }
.button.primary:hover { background: color-mix(in srgb, var(--blue) 88%, #000); }

.segmented { position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr; padding: 2px; border-radius: 8px; background: var(--fill); }
.segmented-thumb {
  position: absolute; top: 2px; bottom: 2px; left: 2px; border-radius: 6px; background: var(--segment-thumb);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 0 0 0.5px rgba(0, 0, 0, 0.04); transition: transform 0.22s var(--ease);
}
.segmented button { position: relative; z-index: 1; min-width: 64px; height: 24px; padding: 0 12px; border: 0; background: none; font-size: 13px; font-weight: 500; border-radius: 6px; }
.segmented button[aria-checked='false'] { color: var(--text-secondary); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after, ::backdrop { animation: none !important; transition: none !important; }
}
```

The segmented thumb is sized `calc((100% - 4px) / <number of segments>)` and moved with `transform: translateX(<index> × 100%)`. For everything else (chart rows, bars, menus, tooltip), copy the matching rules from `frontend/src/styles/theme.css`.

**In a design tool** (Figma…), create:
- one color style per token in §2, in two modes (Light / Dark);
- the text styles of §3;
- effect styles for `--shadow`, `--popover-shadow` and the raised-thumb shadow;
- a 4 px-based spacing grid (§4: 2, 4, 6, 8, 12, 16, 24).
