/**
 * tstzrange literals. Always half-open `[lower,upper)` so that back-to-back
 * allocations touch without the exclusion constraint treating them as an overlap.
 */

export function tstzrangeLiteral(start: Date, end: Date): string {
  if (!(end.getTime() > start.getTime())) {
    throw new Error(`empty range: ${start.toISOString()} -> ${end.toISOString()}`);
  }
  return `[${start.toISOString()},${end.toISOString()})`;
}

/** Parses `["2026-09-12 18:00:00+00","2026-09-12 20:00:00+00")` as returned by Postgres. */
export function parseTstzrange(literal: string): { start: Date; end: Date } {
  const match = /^[[(]"?([^",]+)"?,"?([^",]+)"?[\])]$/.exec(literal.trim());
  if (!match || !match[1] || !match[2]) {
    throw new Error(`unparseable tstzrange: ${literal}`);
  }
  return { start: new Date(match[1]), end: new Date(match[2]) };
}
