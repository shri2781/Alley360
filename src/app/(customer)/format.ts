/** Shared display formatting for the customer site -- kept out of page.tsx so both
 *  the landing page and (if needed later) other customer pages format the same way. */

export function formatHour(hour: number): string {
  const h = hour % 24;
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}
