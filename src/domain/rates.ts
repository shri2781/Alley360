/**
 * Time-based pricing. Pure -- no I/O.
 *
 * Overlap resolution is base + ordered overrides: exactly one base rate always
 * applies (no days, no window), and any number of special rates are checked in
 * `priority` order, first match wins.
 *
 * Windows are half-open [startsAtMin, endsAtMin) -- otherwise a 12-4 and a 4-8 rate
 * would both match 4:00 and priority would silently decide. `days` is the day-of-week
 * of the BUSINESS date, not the calendar date: a Friday rate covers 00:30 Saturday
 * when Friday's window runs past midnight, because that instant's offsetMinutes() is
 * still measured from Friday's midnight.
 *
 * A booking is priced from its START instant only, not its span -- a session starting
 * inside Happy Hours is Happy-Hours-priced end to end. That's the normal commercial
 * rule, and it keeps rate resolution a point lookup rather than an interval-weighted
 * average.
 */
import { formatMinuteOfDay, MINUTES_PER_DAY, type DayHours } from "./hours";

/** Indexes a runtime-computed position that's guaranteed in range by the caller's loop
 *  bound, so the noUncheckedIndexedAccess "possibly undefined" is a real invariant
 *  check on this module's own logic, not defensive noise. */
function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`index ${i} out of range for length ${arr.length}`);
  return v;
}

export type Rate = { id: string; name: string; pricePerPerson: number };

export type SpecialRate = Rate & {
  /** 0=Sun..6=Sat, of the business date. */
  days: number[];
  /** null = from the day's opening. */
  startsAtMin: number | null;
  /** null = until the day's closing. May exceed 1440 (a window that runs past
   *  midnight, e.g. a Late Night rate 10pm-1am). */
  endsAtMin: number | null;
  priority: number;
};

/** The base is a FIELD, not a list entry, so resolveRate() is total by construction --
 *  no caller has to handle "no rate applied". A missing base is a loader-level error
 *  (a broken seed), not a case this type needs to represent. */
export type RateSchedule = { base: Rate; specials: SpecialRate[] };

/** First matching special (in `specials` order -- callers sort by priority when
 *  loading), else the base. `day` supplies the day's own open/close as the default
 *  bounds for a null startsAtMin/endsAtMin. */
export function resolveRate(schedule: RateSchedule, day: DayHours, offsetMin: number): Rate {
  for (const special of schedule.specials) {
    if (!special.days.includes(day.dayOfWeek)) continue;
    const from = special.startsAtMin ?? day.opensAtMin;
    const to = special.endsAtMin ?? day.closesAtMin;
    if (offsetMin >= from && offsetMin < to) return special;
  }
  return schedule.base;
}

export function priceFor(rate: Rate, players: number, games: number): number {
  return rate.pricePerPerson * players * games;
}

export type RateSegment = { fromMin: number; toMin: number; rate: Rate };

/** The day broken into maximal runs of one rate -- what the Settings "this week"
 *  preview renders, and how first-match-wins becomes concrete instead of abstract.
 *  [] on a closed day. A window extending past closing is clipped to closesAtMin;
 *  adjacent segments that resolve to the same rate are merged. */
export function rateSegments(schedule: RateSchedule, day: DayHours): RateSegment[] {
  if (day.isClosed) return [];

  const boundaries = new Set<number>([day.opensAtMin, day.closesAtMin]);
  for (const special of schedule.specials) {
    if (!special.days.includes(day.dayOfWeek)) continue;
    const from = clamp(special.startsAtMin ?? day.opensAtMin, day.opensAtMin, day.closesAtMin);
    const to = clamp(special.endsAtMin ?? day.closesAtMin, day.opensAtMin, day.closesAtMin);
    if (to > from) {
      boundaries.add(from);
      boundaries.add(to);
    }
  }

  const sorted = [...boundaries].sort((a, b) => a - b);
  const raw: RateSegment[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const fromMin = at(sorted, i);
    const toMin = at(sorted, i + 1);
    const rate = resolveRate(schedule, day, Math.floor((fromMin + toMin) / 2));
    raw.push({ fromMin, toMin, rate });
  }

  const merged: RateSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.rate.id === seg.rate.id) {
      last.toMin = seg.toMin;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** "12:00 PM – 4:00 PM" for an explicit window, "All day" when either bound falls
 *  back to the venue's own open/close (which varies day to day, so a fixed label
 *  can't name it precisely). Used on the customer-facing rates display. */
export function formatSpecialWindow(rate: Pick<SpecialRate, "startsAtMin" | "endsAtMin">): string {
  if (rate.startsAtMin === null || rate.endsAtMin === null) return "All day";
  return `${formatMinuteOfDay(rate.startsAtMin)} – ${formatMinuteOfDay(rate.endsAtMin)}`;
}

export type RateIssue = { message: string };

export function validateSpecialRate(input: {
  name: string;
  pricePerPerson: number;
  days: number[];
  startsAtMin: number | null;
  endsAtMin: number | null;
}): RateIssue[] {
  const issues: RateIssue[] = [];
  if (!input.name.trim()) issues.push({ message: "Name is required." });
  if (!Number.isInteger(input.pricePerPerson) || input.pricePerPerson < 0) {
    issues.push({ message: "Price must be a whole number, 0 or more." });
  }
  if (input.days.length === 0) issues.push({ message: "Choose at least one day." });
  if (input.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    issues.push({ message: "Days must be between Sunday (0) and Saturday (6)." });
  }
  for (const [label, min] of [
    ["Start time", input.startsAtMin],
    ["End time", input.endsAtMin],
  ] as const) {
    if (min !== null && min % 30 !== 0) issues.push({ message: `${label} must be on a 30-minute step.` });
  }
  if (input.startsAtMin !== null && input.endsAtMin !== null && input.endsAtMin <= input.startsAtMin) {
    issues.push({ message: "End time must be after start time." });
  }
  if (input.startsAtMin !== null && (input.startsAtMin < 0 || input.startsAtMin >= MINUTES_PER_DAY)) {
    issues.push({ message: "Start time must be within the day." });
  }
  if (input.endsAtMin !== null && (input.endsAtMin < 30 || input.endsAtMin > MINUTES_PER_DAY * 2)) {
    issues.push({ message: "End time is out of range." });
  }
  return issues;
}
