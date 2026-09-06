import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { lane } from "../db/schema";

/** How many lanes are actually bookable right now -- used on the landing page's stat
 *  strip so it never drifts from what staff have configured at /staff/settings. */
export async function getActiveLaneCount(tenantId: string): Promise<number> {
  const rows = await db
    .select({ id: lane.id })
    .from(lane)
    .where(and(eq(lane.tenantId, tenantId), eq(lane.isActive, true)));
  return rows.length;
}
