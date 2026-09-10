/**
 * Per-day-of-week opening hours. Pure -- no I/O, no implicit `now`.
 *
 * Replaces the single global opens_at_hour/closes_at_hour pair (and time.ts's
 * businessDate/rolloverHour, which were built for that single-pair world) with a
 * weekly table: whether 1am Tuesday belongs to Monday's business day depends on
 * MONDAY's close, not one scalar shared by every day.
 *
 * Times throughout are MINUTES SINCE VENUE-LOCAL MIDNIGHT OF THE OPENING DAY, so a
 * 2am close is 1560, not 120 -- same convention the old closes_at_hour used (a 4am
 * close was 28), just at 30-minute resolution.
 */
import { addDays, daysBetween, zonedDateString, zonedInstantAtMinute, zonedParts } from "./time";

export const MINUTES_PER_DAY = 1440;
export const HOURS_GRID_MIN = 30;

export type DayHours = {
  /** 0 = Sunday .. 6 = Saturday -- matches JS Date#getUTCDay() and PG EXTRACT(DOW). */
  dayOfWeek: number;
  isClosed: boolean;
  opensAtMin: number;
  /** Minutes since midnight of the OPENING day; > 1440 means the close is past midnight. */
  closesAtMin: number;
};

/** Exactly seven entries, indexed by day_of_week (index 0 = Sunday). */
export type WeeklyHours = readonly [DayHours, DayHours, DayHours, DayHours, DayHours, DayHours, DayHours];

/** Indexes a fixed-length array by a runtime-computed position that's guaranteed in
 *  range by construction (a day-of-week or a walk over DISPLAY_ORDER), so the
 *  noUncheckedIndexedAccess "possibly undefined" is a real invariant check, not
 *  defensive noise -- it would only ever fire on a bug in this module. */
function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`index ${i} out of range for length ${arr.length}`);
  return v;
}

/** 0 = Sunday .. 6 = Saturday, for a 'YYYY-MM-DD' business date. Pure calendar
 *  arithmetic, so it needs no timezone -- the input is already a local date, not an
 *  instant. */
export function dayOfWeek(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function hoursForDate(weekly: WeeklyHours, dateStr: string): DayHours {
  return at(weekly, dayOfWeek(dateStr));
}

/** Direct lookup by day_of_week (0=Sun..6=Sat) for callers that already know which
 *  weekday they mean with no calendar date in hand -- the Settings UI, mainly, which
 *  edits and previews the week as an abstract Mon..Sun cycle rather than real dates. */
export function dayAt(weekly: WeeklyHours, dow: number): DayHours {
  return at(weekly, dow);
}

/**
 * Minutes since venue-local midnight of `businessDateStr`, for `instant`. May exceed
 * 1439 when `instant` falls on the calendar day after the business date (e.g. a 1am
 * session belonging to the previous night's business day is minute 1500).
 *
 * Computed from wall-clock PARTS, not elapsed real time -- elapsed time is wrong by an
 * hour on a DST transition day (e.g. America/New_York, where "10:00 AM minus local
 * midnight" is 540 minutes on the spring-forward day and 660 on the fall-back day,
 * instead of 600 either way). This mirrors the trick businessDate() already used.
 */
export function offsetMinutes(instant: Date, timeZone: string, businessDateStr: string): number {
  const p = zonedParts(instant, timeZone);
  const calendarDate = zonedDateString(instant, timeZone);
  return daysBetween(businessDateStr, calendarDate) * MINUTES_PER_DAY + p.hour * 60 + p.minute;
}

/**
 * The venue trading day `instant` belongs to. Replaces businessDate()+rolloverHour():
 * whether the small hours count toward yesterday depends on YESTERDAY's close, which
 * can differ from today's, so the rollover has to be looked up per day rather than
 * passed in as one scalar.
 *
 * A closed previous day never claims the small hours -- there's no session to roll
 * over from.
 */
export function businessDateFor(instant: Date, timeZone: string, weekly: WeeklyHours): string {
  const p = zonedParts(instant, timeZone);
  const calendarDate = zonedDateString(instant, timeZone);
  const prevDate = addDays(calendarDate, -1);
  const prev = hoursForDate(weekly, prevDate);
  const clockMin = p.hour * 60 + p.minute;

  // prev.closesAtMin - 1440 <= 0 for a venue closing by midnight, so this is false and
  // no separate case is needed for "yesterday didn't run past midnight at all".
  if (!prev.isClosed && clockMin < prev.closesAtMin - MINUTES_PER_DAY) return prevDate;
  return calendarDate;
}

export type VenueWindow = { openAt: Date; closeAt: Date };

/** null on a closed day -- callers must handle it rather than being handed an empty
 *  or nonsensical window. */
export function venueWindow(dateStr: string, timeZone: string, weekly: WeeklyHours): VenueWindow | null {
  const d = hoursForDate(weekly, dateStr);
  if (d.isClosed) return null;
  return {
    openAt: zonedInstantAtMinute(dateStr, d.opensAtMin, timeZone),
    closeAt: zonedInstantAtMinute(dateStr, d.closesAtMin, timeZone),
  };
}

// --- display -----------------------------------------------------------------------
// Pure, so it's unit-testable and shared by the staff Settings page and the customer
// landing/footer, instead of the three hand-copies formatHour() used to have.

/** 630 -> "10:30 AM"; 1560 -> "2:00 AM" (a close past midnight, normalized back into
 *  clock time -- the caller is expected to add its own "next day" framing where that
 *  matters, the way formatDayWindow() does). */
export function formatMinuteOfDay(min: number): string {
  const m = ((min % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(m / 60);
  const minute = m % 60;
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:${String(minute).padStart(2, "0")} ${period}`;
}

/** "10:00 AM – 2:00 AM" | "Closed". */
export function formatDayWindow(d: DayHours): string {
  if (d.isClosed) return "Closed";
  return `${formatMinuteOfDay(d.opensAtMin)} – ${formatMinuteOfDay(d.closesAtMin)}`;
}

const DAY_ABBREV = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Monday-first order for display -- storage is 0=Sunday, but a week reads naturally
 *  starting Monday. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export type WeekRun = { fromDay: number; toDay: number; label: string };

/** Consecutive identical days (by isClosed/opensAtMin/closesAtMin) collapsed into
 *  runs, walked in Monday-first display order and never wrapping past Sunday --
 *  Saturday and Sunday being identical must not merge with a different Monday. */
export function summarizeWeek(weekly: WeeklyHours): WeekRun[] {
  const runs: WeekRun[] = [];
  let i = 0;
  while (i < DISPLAY_ORDER.length) {
    const start = i;
    const first = at(weekly, at(DISPLAY_ORDER, i));
    let j = i;
    while (j + 1 < DISPLAY_ORDER.length && sameHours(at(weekly, at(DISPLAY_ORDER, j + 1)), first)) j++;
    const fromDay = at(DISPLAY_ORDER, start);
    const toDay = at(DISPLAY_ORDER, j);
    const label =
      start === j
        ? `${at(DAY_ABBREV, fromDay)} ${formatDayWindow(first)}`
        : `${at(DAY_ABBREV, fromDay)}–${at(DAY_ABBREV, toDay)} ${formatDayWindow(first)}`;
    runs.push({ fromDay, toDay, label });
    i = j + 1;
  }
  return runs;
}

function sameHours(a: DayHours, b: DayHours): boolean {
  return a.isClosed === b.isClosed && a.opensAtMin === b.opensAtMin && a.closesAtMin === b.closesAtMin;
}

/** "Mon–Thu 10:00 AM – 11:00 PM · Fri–Sat 10:00 AM – 2:00 AM · Sun Closed" */
export function formatWeekSummary(weekly: WeeklyHours): string {
  return summarizeWeek(weekly)
    .map((r) => r.label)
    .join(" · ");
}

/** Collapses a set of day-of-week numbers (0=Sun..6=Sat, any order, e.g. a special
 *  rate's `days`) into a compact Monday-first label: [1,2,3,4,5] -> "Mon–Fri",
 *  [0,6] -> "Sat–Sun" (note this crosses the storage wrap at Saturday/Sunday but not
 *  the DISPLAY_ORDER wrap, so it's still one run), [1,3] -> "Mon, Wed". */
export function formatDayList(days: readonly number[]): string {
  const set = new Set(days);
  const runs: string[] = [];
  let i = 0;
  while (i < DISPLAY_ORDER.length) {
    if (!set.has(at(DISPLAY_ORDER, i))) {
      i++;
      continue;
    }
    const start = i;
    let j = i;
    while (j + 1 < DISPLAY_ORDER.length && set.has(at(DISPLAY_ORDER, j + 1))) j++;
    const fromDay = at(DISPLAY_ORDER, start);
    const toDay = at(DISPLAY_ORDER, j);
    runs.push(start === j ? at(DAY_ABBREV, fromDay) : `${at(DAY_ABBREV, fromDay)}–${at(DAY_ABBREV, toDay)}`);
    i = j + 1;
  }
  return runs.join(", ");
}

// --- validation ----------------------------------------------------------------------

export type HoursIssue = { dayOfWeek: number; message: string };

/**
 * The one cross-row rule Postgres can't express as a CHECK: a day may not open before
 * the previous day has finished closing, or the two venue windows overlap in real
 * time (a day's board would start being searched while yesterday's is still live).
 */
export function validateWeeklyHours(weekly: WeeklyHours): HoursIssue[] {
  const issues: HoursIssue[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const day = at(weekly, dow);
    if (day.isClosed) continue;
    const prevDow = (dow + 6) % 7;
    const prev = at(weekly, prevDow);
    if (prev.isClosed) continue;
    const earliestOpen = Math.max(0, prev.closesAtMin - MINUTES_PER_DAY);
    if (day.opensAtMin < earliestOpen) {
      issues.push({
        dayOfWeek: dow,
        message: `${at(DAY_ABBREV, dow)} can't open before ${at(DAY_ABBREV, prevDow)} finishes closing.`,
      });
    }
  }
  return issues;
}
