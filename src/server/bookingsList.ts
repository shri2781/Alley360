import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { booking, lane, laneAllocation, tenant } from "../db/schema";
import { businessDate, rolloverHour } from "../domain/time";
import { displayName } from "./labels";

export type BookingRow = {
  id: string;
  status: "confirmed" | "active" | "completed" | "cancelled" | "no_show";
  kind: "open_play" | "block";
  source: "walkin" | "phone" | "staff" | "web";
  label: string;
  partySize: number;
  games: number;
  laneNumbers: number[];
  scheduledStart: Date;
};

/** Today's bookings (all statuses), one row per booking -- a multi-lane party's
 *  several lane_allocation rows are collapsed into one row with several lane numbers. */
export async function getBookingsToday(venueId: string): Promise<BookingRow[]> {
  const [venueRow] = await db.select().from(tenant).where(eq(tenant.id, venueId));
  if (!venueRow) throw new Error(`venue ${venueId} not found`);

  const today = businessDate(new Date(), venueRow.timezone, rolloverHour(venueRow.closesAtHour));

  const rows = await db
    .select({ booking, laneNumber: lane.number })
    .from(booking)
    .innerJoin(laneAllocation, eq(laneAllocation.bookingId, booking.id))
    .innerJoin(lane, eq(lane.id, laneAllocation.laneId))
    .where(and(eq(booking.tenantId, venueId), eq(booking.businessDate, today)));

  const byBooking = new Map<string, BookingRow>();
  for (const r of rows) {
    const existing = byBooking.get(r.booking.id);
    if (existing) {
      existing.laneNumbers.push(r.laneNumber);
      continue;
    }
    byBooking.set(r.booking.id, {
      id: r.booking.id,
      status: r.booking.status,
      kind: r.booking.kind,
      source: r.booking.source,
      label: r.booking.kind === "block" ? (r.booking.notes ?? "Maintenance") : displayName(r.booking.customerName, r.booking.source),
      partySize: r.booking.partySize,
      games: r.booking.games,
      laneNumbers: [r.laneNumber],
      scheduledStart: r.booking.scheduledStart,
    });
  }

  return [...byBooking.values()]
    .map((b) => ({ ...b, laneNumbers: b.laneNumbers.sort((a, c) => a - c) }))
    .sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime());
}
