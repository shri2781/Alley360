import { formatMinuteOfDay, HOURS_GRID_MIN, MINUTES_PER_DAY } from "../../../../domain/hours";

/** Monday-first for display; storage (and every domain function) is 0=Sunday. */
export const DISPLAY_DAYS = [
  { dow: 1, label: "Mon" },
  { dow: 2, label: "Tue" },
  { dow: 3, label: "Wed" },
  { dow: 4, label: "Thu" },
  { dow: 5, label: "Fri" },
  { dow: 6, label: "Sat" },
  { dow: 0, label: "Sun" },
] as const;

export const OPEN_OPTIONS = Array.from({ length: MINUTES_PER_DAY / HOURS_GRID_MIN }, (_, i) => i * HOURS_GRID_MIN); // 0..1410
export const CLOSE_OPTIONS = Array.from({ length: (MINUTES_PER_DAY * 2) / HOURS_GRID_MIN }, (_, i) => (i + 1) * HOURS_GRID_MIN); // 30..2880

/** 630 -> "10:30 AM"; 1560 -> "2:00 AM (next day)" -- the option list spans two
 *  calendar days (a close can run past midnight), so values past 1440 need the same
 *  "(next day)" framing the old single opens/closes pair used. */
export function formatOptionLabel(min: number): string {
  return min >= MINUTES_PER_DAY ? `${formatMinuteOfDay(min)} (next day)` : formatMinuteOfDay(min);
}
