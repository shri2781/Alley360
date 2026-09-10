/**
 * Time helpers. Pure — no I/O, no implicit `now`.
 *
 * Everything is stored as UTC `timestamptz` and rendered in venue-local time. The one
 * subtlety worth its own function is the business date: an alley open past midnight has
 * sessions at 00:30 that belong to the *previous* trading day, so "today's bookings" is
 * never `date_trunc('day', ...)`.
 */

const MS_PER_DAY = 86_400_000;

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number };

/** Wall-clock parts of `instant` as seen in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23", // not hour12:false — that can yield "24" for midnight
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`missing ${type} for timezone ${timeZone}`);
    return Number(found.value);
  };

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/**
 * The venue trading day an instant belongs to, as 'YYYY-MM-DD'.
 *
 * Anything before `rolloverHour` in venue-local time is counted as the previous day, so a
 * session starting 00:30 Sunday lands on Saturday's business date.
 */
export function businessDate(instant: Date, timeZone: string, rolloverHour: number): string {
  const p = zonedParts(instant, timeZone);

  // Pure calendar arithmetic on the local Y-M-D triple; UTC is used only as a safe
  // vehicle for "subtract one day" and never reinterpreted as a real instant.
  let ms = Date.UTC(p.year, p.month - 1, p.day);
  if (p.hour < rolloverHour) ms -= MS_PER_DAY;

  return formatDateUTC(new Date(ms));
}

function formatDateUTC(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Adds (or, with a negative count, subtracts) whole days to a 'YYYY-MM-DD' business
 *  date. Pure calendar arithmetic -- no timezone involved, since the input is already
 *  a venue-local business date rather than an instant. */
export function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number) as [number, number, number];
  return formatDateUTC(new Date(Date.UTC(year, month - 1, day) + days * MS_PER_DAY));
}

/**
 * The UTC instant corresponding to a given hour:minute, on a given business date, in
 * venue-local wall-clock time. E.g. zonedInstant("2026-09-12", 10, "Asia/Kolkata") is the
 * UTC instant that displays as 10:00 AM in Kolkata that day (India is UTC+5:30 -- not a
 * whole hour, so this can't be done with a fixed offset). `minute` defaults to 0.
 *
 * `hour` may exceed 23: a venue closing at 4am is stored as closes_at_hour = 28 (hours
 * since midnight of the opening day), and Date.UTC normalizes hour 28 into the next
 * calendar day, so zonedInstant("2026-09-12", 28, tz) is simply 4:00 AM on the 13th.
 *
 * Standard double-conversion trick: guess the instant naively (as if the local time were
 * UTC), see what that guess actually displays as in the target zone, then correct by the
 * difference. Converges in one step for any timezone whose offset doesn't itself change
 * between the guess and the correction -- true for every case this app needs (bowling
 * alley opening hours are never scheduled across a DST transition instant).
 */
export function zonedInstant(businessDate: string, hour: number, timeZone: string, minute = 0): Date {
  const [year, month, day] = businessDate.split("-").map(Number) as [number, number, number];

  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const actual = zonedParts(guess, timeZone);

  const wantedMs = Date.UTC(year, month - 1, day, hour, minute);
  const gotMs = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);

  return new Date(guess.getTime() + (wantedMs - gotMs));
}

/** The business-day boundary implied by closing time: an alley closing at 4am (hour 28)
 *  rolls over at 4am, so a 00:30 session still belongs to last night. An alley that closes
 *  by midnight (hour <= 24) has no post-midnight hours at all, so the boundary is 0. */
export function rolloverHour(closesAtHour: number): number {
  return Math.max(0, closesAtHour - 24);
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

export function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 60_000;
}
