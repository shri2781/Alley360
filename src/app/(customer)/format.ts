/** Shared display formatting for the customer site -- kept out of page.tsx so both
 *  the landing page and (if needed later) other customer pages format the same way.
 *  Re-exported from the domain layer rather than re-implemented here -- see
 *  src/domain/hours.ts, which is unit-tested. */
export { formatDayList, formatDayWindow, formatMinuteOfDay, formatWeekSummary } from "../../domain/hours";
export { formatSpecialWindow } from "../../domain/rates";
