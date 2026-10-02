// Contract-shaped fixtures for the screens wave (docs/conformance/screens.md).
// Test-only: never import from production code.
//
// Estate (ROOT_GROUP org/delivery, GROUP_TERM ART) — what GET /api/groups returns, 3 cards / 5 groups:
//   alpha  (card)  ── team-1 (tile)
//   beta   (card)  ── x      (tile)
//   delta  (card, no tiles)
//
// Iterations per group (GET /api/iterations, newest-first, UNFILTERED — upcoming included):
//   alpha  : 8 upcoming · 7 current (live, dates relative to `today`) · 6 5 4 3 2 closed
//            closed 6,5,4,3 reproduce the §15.3 vector (50,45) (40,40) (30,24) (20,21); 2 is a 200-pt outlier
//   beta   : 7 current (already finished: today's remaining 0) · 6 closed, committed 0 · 5 closed with
//            reportError · 4 closed, report with EMPTY series · 3 closed, report null and no reportError
//   team-1 : 4 upcoming · 3 2 1 closed            (no live iteration: auto-select = first NON-upcoming)
//   x      : 2 upcoming · 1 upcoming              (all upcoming: nothing selected, no closed ⇒ no score read)
//   delta  : none
// alpha and beta both have an iteration with iid 7 (and 6, 5, 4, 3): annotations must not leak (§10.2).

import type { AppConfig, GroupCard, Iteration, IterationReport, Report, SeriesPoint } from '../api/types'

/** The injected "today" (UTC). Tests pin the clock to `${TODAY}T10:00:00.000Z`. */
export const TODAY = '2026-03-12'
export const NOW_ISO = `${TODAY}T10:00:00.000Z`

export const CONFIG: AppConfig = { groupTerm: 'ART', rootGroup: 'org/delivery' }

export const ALPHA = 'org/delivery/alpha'
export const TEAM1 = 'org/delivery/alpha/team-1'
export const BETA = 'org/delivery/beta'
export const X = 'org/delivery/beta/x'
export const DELTA = 'org/delivery/delta'

export const GROUPS: GroupCard[] = [
  {
    fullPath: ALPHA,
    name: 'Alpha',
    segment: 'alpha',
    children: [{ fullPath: TEAM1, name: 'Team One', segment: 'team-1' }],
  },
  {
    fullPath: BETA,
    name: 'Beta',
    segment: 'beta',
    children: [{ fullPath: X, name: 'Xray', segment: 'x' }],
  },
  { fullPath: DELTA, name: 'Delta', segment: 'delta', children: [] },
]

/** Verbatim GitLab refusal carried by beta / iid 5 (shown as the chart region's error). */
export const REPORT_ERROR = 'You do not have permission to read the burnup chart of this timebox'

// ---------------------------------------------------------------------------------------------------------
// Builders

/** ISO date `offset` calendar days after `date` (UTC). */
export function addDaysIso(date: string, offset: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)
}

/** Points on consecutive days from `start`, constant `committed`, the given delivered values. */
export function seriesFrom(start: string, committed: number, delivered: number[]): SeriesPoint[] {
  return delivered.map((d, i) => ({ date: addDaysIso(start, i), committed, delivered: d, remaining: committed - d }))
}

/** `n` points from `start`, delivered growing linearly from 0 to `finalDelivered` (one decimal). */
export function linearSeries(start: string, n: number, committed: number, finalDelivered: number): SeriesPoint[] {
  const delivered = Array.from({ length: n }, (_, i) => Math.round(((finalDelivered * i) / (n - 1)) * 10) / 10)
  return seriesFrom(start, committed, delivered)
}

export function report(series: SeriesPoint[], committed: number, delivered: number, inProgress: number): Report {
  return {
    series,
    totals: {
      committed: { weight: committed, count: 10 },
      delivered: { weight: delivered, count: 6 },
      inProgress: { weight: inProgress, count: 4 },
    },
  }
}

function emptyReport(): Report {
  return report([], 0, 0, 0)
}

function iteration(
  groupIndex: number,
  p: {
    iid: number
    title: string
    state: string
    startDate: string
    dueDate: string
    report: Report | null
    reportError?: string | null
  },
): IterationReport {
  return {
    id: `gid://gitlab/Iteration/${groupIndex * 100 + p.iid}`,
    iid: String(p.iid),
    title: p.title,
    state: p.state,
    startDate: p.startDate,
    dueDate: p.dueDate,
    report: p.report,
    reportError: p.reportError ?? null,
  }
}

/** The /api/iterations shape of a report entry (drops `report` / `reportError`). */
export function toIteration(r: IterationReport): Iteration {
  return { id: r.id, iid: r.iid, title: r.title, startDate: r.startDate, dueDate: r.dueDate, state: r.state }
}

export interface Estate {
  today: string
  config: AppConfig
  groups: GroupCard[]
  /** GET /api/reports?group= — newest-first IterationReport[] per group. */
  reports: Record<string, IterationReport[]>
  /** GET /api/iterations?group= — newest-first Iteration[] per group (same order as `reports`). */
  iterations: Record<string, Iteration[]>
}

/** Builds the whole estate with the live iterations placed relative to `today`. */
export function buildEstate(today: string = TODAY): Estate {
  const liveStart = addDaysIso(today, -10) // 2026-03-02 for the default TODAY
  const liveDue = addDaysIso(today, 3) // 2026-03-15
  const nextStart = addDaysIso(today, 4) // 2026-03-16
  const nextDue = addDaysIso(today, 17) // 2026-03-29
  const sprint = (k: number) => ({ startDate: addDaysIso(liveStart, -14 * k), dueDate: addDaysIso(liveDue, -14 * k) })

  const alpha: IterationReport[] = [
    iteration(1, { iid: 8, title: 'Sprint 8', state: 'upcoming', startDate: nextStart, dueDate: nextDue, report: emptyReport() }),
    iteration(1, {
      iid: 7,
      title: 'Sprint 7',
      state: 'current',
      startDate: liveStart,
      dueDate: liveDue,
      // 10 points, liveStart … yesterday; the "today" point comes from the totals (§7.2).
      report: report(seriesFrom(liveStart, 50, [0, 0, 3, 5, 8, 10, 10, 14, 16, 18]), 50, 20, 30),
    }),
    iteration(1, { iid: 6, title: 'Sprint 6', state: 'closed', ...sprint(1), report: report(linearSeries(sprint(1).startDate, 14, 50, 45), 50, 45, 5) }),
    iteration(1, { iid: 5, title: 'Sprint 5', state: 'closed', ...sprint(2), report: report(linearSeries(sprint(2).startDate, 14, 40, 40), 40, 40, 0) }),
    iteration(1, { iid: 4, title: 'Sprint 4', state: 'closed', ...sprint(3), report: report(linearSeries(sprint(3).startDate, 14, 30, 24), 30, 24, 6) }),
    iteration(1, { iid: 3, title: 'Sprint 3', state: 'closed', ...sprint(4), report: report(linearSeries(sprint(4).startDate, 14, 20, 21), 20, 21, 0) }),
    // Fifth closed iteration: a 200-point outlier that must stay outside the 4-iteration score window.
    iteration(1, { iid: 2, title: 'Sprint 2', state: 'closed', ...sprint(5), report: report(linearSeries(sprint(5).startDate, 14, 200, 10), 200, 10, 190) }),
  ]

  const beta: IterationReport[] = [
    iteration(2, {
      iid: 7,
      title: 'Cycle 7',
      state: 'current',
      startDate: liveStart,
      dueDate: liveDue,
      // Finished early: today's remaining (inProgress total) is 0 ⇒ forecast 0 ⇒ no orange label.
      report: report(seriesFrom(liveStart, 20, [0, 2, 5, 8, 11, 14, 17, 20, 20, 20]), 20, 20, 0),
    }),
    iteration(2, { iid: 6, title: 'Cycle 6', state: 'closed', ...sprint(1), report: report(linearSeries(sprint(1).startDate, 14, 0, 0), 0, 0, 0) }),
    iteration(2, { iid: 5, title: 'Cycle 5', state: 'closed', ...sprint(2), report: null, reportError: REPORT_ERROR }),
    iteration(2, { iid: 4, title: 'Cycle 4', state: 'closed', ...sprint(3), report: report([], 10, 10, 0) }),
    iteration(2, { iid: 3, title: 'Cycle 3', state: 'closed', ...sprint(4), report: null }),
  ]

  const team1: IterationReport[] = [
    iteration(3, { iid: 4, title: 'T1 Sprint 4', state: 'upcoming', startDate: nextStart, dueDate: nextDue, report: emptyReport() }),
    iteration(3, { iid: 3, title: 'T1 Sprint 3', state: 'closed', ...sprint(1), report: report(linearSeries(sprint(1).startDate, 14, 30, 27), 30, 27, 3) }),
    iteration(3, { iid: 2, title: 'T1 Sprint 2', state: 'closed', ...sprint(2), report: report(linearSeries(sprint(2).startDate, 14, 30, 30), 30, 30, 0) }),
    iteration(3, { iid: 1, title: 'T1 Sprint 1', state: 'closed', ...sprint(3), report: report(linearSeries(sprint(3).startDate, 14, 30, 25), 30, 25, 5) }),
  ]

  const x: IterationReport[] = [
    iteration(4, { iid: 2, title: 'X Sprint 2', state: 'upcoming', startDate: addDaysIso(nextStart, 14), dueDate: addDaysIso(nextDue, 14), report: emptyReport() }),
    iteration(4, { iid: 1, title: 'X Sprint 1', state: 'upcoming', startDate: nextStart, dueDate: nextDue, report: emptyReport() }),
  ]

  const reports: Record<string, IterationReport[]> = {
    [ALPHA]: alpha,
    [BETA]: beta,
    [TEAM1]: team1,
    [X]: x,
    [DELTA]: [],
  }
  const iterations = Object.fromEntries(Object.entries(reports).map(([k, v]) => [k, v.map(toIteration)]))
  return { today, config: CONFIG, groups: GROUPS, reports, iterations }
}

export const estate: Estate = buildEstate(TODAY)

/** Finds one iteration report of the default estate. */
export function reportOf(group: string, iid: string, e: Estate = estate): IterationReport {
  const found = e.reports[group]?.find((r) => r.iid === iid)
  if (!found) throw new Error(`fixture: no iteration ${group} #${iid}`)
  return found
}

/**
 * §15.3 expectations for alpha's score panel (A.6 colours): closed 6,5,4,3 →
 * average deviation 0.0875 → `8.8 %` good · difference +2.5 → `+2.5 pts` caution ·
 * compliant 50 → `50 %` caution · median velocity 32 → `32.0 pts` (never coloured).
 */
export const ALPHA_SCORE = {
  averageDeviation: { text: '8.8 %', tone: 'good' },
  deliveryDiff: { text: '+2.5 pts', tone: 'caution' },
  compliant: { text: '50 %', tone: 'caution' },
  medianVelocity: { text: '32.0 pts' },
} as const
