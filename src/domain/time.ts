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

  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

export function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 60_000;
}
