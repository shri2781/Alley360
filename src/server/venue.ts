import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { tenant, venueHours } from "../db/schema";
import type { DayHours, WeeklyHours } from "../domain/hours";

/** The subset of a `tenant` row plus its full weekly hours -- everything the
 *  scheduling and pricing code needs about "the venue". */
export type Venue = {
  id: string;
  name: string;
  timezone: string;
  weeklyHours: WeeklyHours;
};

/** Loads the seven venue_hours rows for a tenant into a WeeklyHours tuple, indexed
 *  by day_of_week. Throws if any of the seven is missing -- a missing row silently
 *  meaning "closed" would take down a whole day of bookings without anyone noticing,
 *  so a broken seed should fail loudly instead. Exported separately from getVenue()
 *  because some callers (the staff timeline) already have the tenant row and only
 *  need this half. */
export async function loadWeeklyHours(tenantId: string): Promise<WeeklyHours> {
  const rows = await db.select().from(venueHours).where(eq(venueHours.tenantId, tenantId));
  const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));

  const days: DayHours[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const row = byDay.get(dow);
    if (!row) {
      throw new Error(`venue ${tenantId} is missing venue_hours for day_of_week ${dow} -- run \`npm run db:reset\``);
    }
    days.push({ dayOfWeek: dow, isClosed: row.isClosed, opensAtMin: row.opensAtMin, closesAtMin: row.closesAtMin });
  }

  return days as unknown as WeeklyHours;
}

/** The one seeded venue. Real multi-tenancy (picking a venue by domain/subdomain) is
 *  out of scope -- see the note on the `tenant` table in schema.sql.
 *
 *  Wrapped in React `cache()` so a request that needs the venue from a layout AND a
 *  page AND a server action on the same render only hits the database once -- same
 *  pattern as requireStaff() in src/server/auth/dal.ts. */
export const getVenue = cache(async (): Promise<Venue> => {
  const [row] = await db.select().from(tenant).limit(1);
  if (!row) throw new Error("no venue configured -- run `npm run db:reset` first");

  const weeklyHours = await loadWeeklyHours(row.id);
  return { id: row.id, name: row.name, timezone: row.timezone, weeklyHours };
});
