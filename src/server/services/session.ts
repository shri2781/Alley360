/**
 * Starting and ending sessions -- turning a scheduled booking into a record of what
 * actually happened. A multi-lane booking (a party) gets one `session` row per lane,
 * since schema.sql ties each session to exactly one lane_id; they share a booking_id.
 *
 * Ending them all together as one action is explicitly M6 scope (see the plan) -- here,
 * `endSession` operates on a single session/lane at a time. The booking as a whole only
 * flips to 'completed' once every one of its sessions has ended.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { booking, laneAllocation, session } from "../../db/schema.js";

/** Starts every lane a booking covers at once. If `actualPlayers` isn't given, falls
 *  back to what was booked -- lets check-in record a different headcount than planned. */
export async function startSession(bookingId: string, actualPlayers?: number) {
  return db.transaction(async (tx) => {
    const [bookingRow] = await tx.select().from(booking).where(eq(booking.id, bookingId));
    if (!bookingRow) throw new Error(`booking ${bookingId} not found`);

    const allocations = await tx.select().from(laneAllocation).where(eq(laneAllocation.bookingId, bookingId));
    if (allocations.length === 0) throw new Error(`booking ${bookingId} has no lane allocations`);

    const startedAt = new Date();
    const players = actualPlayers ?? bookingRow.partySize;

    const sessions = await tx
      .insert(session)
      .values(
        allocations.map((a) => ({
          tenantId: a.tenantId,
          bookingId,
          laneId: a.laneId,
          startedAt,
          actualPlayers: players,
        })),
      )
      .returning();

    await tx.update(booking).set({ status: "active" }).where(eq(booking.id, bookingId));
    await tx.update(laneAllocation).set({ status: "active" }).where(eq(laneAllocation.bookingId, bookingId));

    return sessions;
  });
}

/**
 * Ends one lane's session. Releases that lane immediately -- an early finish on one
 * lane of a multi-lane party frees it up for a walk-in even while the other lane is
 * still running. The booking itself only becomes 'completed' once every session tied
 * to it has ended.
 */
export async function endSession(
  sessionId: string,
  opts: { gamesCompleted?: number; endReason?: "normal" | "staff_ended" | "abandoned" } = {},
) {
  return db.transaction(async (tx) => {
    const [ended] = await tx
      .update(session)
      .set({
        endedAt: new Date(),
        gamesCompleted: opts.gamesCompleted,
        endReason: opts.endReason ?? "normal",
      })
      .where(eq(session.id, sessionId))
      .returning();

    if (!ended) throw new Error(`session ${sessionId} not found`);

    await tx
      .update(laneAllocation)
      .set({ status: "released" })
      .where(and(eq(laneAllocation.bookingId, ended.bookingId), eq(laneAllocation.laneId, ended.laneId)));

    const siblings = await tx.select().from(session).where(eq(session.bookingId, ended.bookingId));
    const anyStillRunning = siblings.some((s) => s.endedAt === null);

    if (!anyStillRunning) {
      await tx.update(booking).set({ status: "completed" }).where(eq(booking.id, ended.bookingId));
    }

    return ended;
  });
}
