// Calendar-date primitives (SPEC §7.2, §7.3, §8.3, ledger #9/#10).
// Every date in the domain layer is an ISO calendar date string `YYYY-MM-DD`. All arithmetic is done in
// UTC calendar days so results never depend on the viewer's time zone (see conformance doc, D-1).

/** ISO calendar date, `YYYY-MM-DD`. ISO dates sort chronologically as plain text (§7.3). */
export type IsoDate = string

const DAY_MS = 86_400_000

const toUtcMs = (date: IsoDate): number => Date.parse(`${date}T00:00:00Z`)
const fromUtcMs = (ms: number): IsoDate => new Date(ms).toISOString().slice(0, 10)

/**
 * "Today" = the current calendar day in **UTC** (§7.2, ledger #9), as `YYYY-MM-DD`.
 * `now` is injectable for tests; defaults to the current instant.
 */
export function todayUtc(now: Date = new Date()): IsoDate {
  return now.toISOString().slice(0, 10)
}

/** `date` shifted by `days` calendar days (may be negative). Weekends/holidays are ordinary days (§7.3). */
export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS)
}

/** Signed number of whole calendar days from `from` to `to` (`to − from`); e.g. 03-01 → 03-04 = 3. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS)
}
