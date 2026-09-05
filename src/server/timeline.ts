/**
 * Data for the staff Lane Allotment timeline: a window from "now" (floored to the
 * hour) through closing, with every lane's bookings positioned within it.
 *
 * The exclusion constraint (schema.sql) guarantees no two allocations on the same
 * lane ever overlap -- so this never has to resolve collisions or stack blocks.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { parseTstzrange } from "../db/range";
import { booking, lane, laneAllocation, tenant } from "../db/schema";
import { businessDate, rolloverHour, zonedInstant, zonedParts } from "../domain/time";
import { displayName } from "./labels";

export type TimelineBlock = {
  /** The lane_allocation row -- the drag identity. Not bookingId: one booking can hold
   *  several lanes, so bookingId does not uniquely identify a block. */
  allocationId: string;
  bookingId: string;
  laneId: string;
  kind: "booked" | "walkin" | "maintenance";
  /** 'active' means a session is running: its start is fixed, only its end can move. */
  status: "confirmed" | "active";
  label: string;
  partySize: number;
  games: number;
  /** Clamped to the visible window -- a session that started before the window
   *  begins renders from the left edge rather than overflowing off-screen. */
  start: Date;
  playEnd: Date;
  occupyEnd: Date;
  /** The REAL allocation bounds, unclamped. Layout uses the clamped pair above; any
   *  arithmetic that ends up written back to the database must use these, or a block
   *  that merely runs off the edge of the view would be silently truncated on save. */
  trueStart: Date;
  trueEnd: Date;
  /** True when the block actually begins before the visible window. Such a block can
   *  still be resized, but dragging its body would be misleading -- the grab point
   *  doesn't correspond to its real start. */
  clippedStart: boolean;
};

export type TimelineData = {
  venueName: string;
  timezone: string;
  now: Date;
  windowStart: Date;
  windowEnd: Date;
  /** The venue's real opening/closing instants for this business day. Distinct from
   *  windowStart, which is only "now, floored to the hour" -- the client needs the real
   *  bounds to validate a drag the same way the server does. */
  openAt: Date;
  closeAt: Date;
  lanes: { id: string; number: number; displayName: string }[];
  blocks: TimelineBlock[];
  stats: {
    totalLanes: number;
    activeSessions: number;
    upcomingBlocks: number;
    walkinsToday: number;
  };
};

const pad = (n: number) => String(n).padStart(2, "0");

export async function getTimeline(venueId: string): Promise<TimelineData> {
  const [venueRow] = await db.select().from(tenant).where(eq(tenant.id, venueId));
  if (!venueRow) throw new Error(`venue ${venueId} not found`);

  const now = new Date();
  const nowParts = zonedParts(now, venueRow.timezone);
  const dateStr = `${nowParts.year}-${pad(nowParts.month)}-${pad(nowParts.day)}`;
  // Distinct from dateStr: after midnight but before rollover, the business day that's
  // still open is yesterday's -- that's the one openAt/closeAt need to span.
  const bDateStr = businessDate(now, venueRow.timezone, rolloverHour(venueRow.closesAtHour));

  const openAt = zonedInstant(bDateStr, venueRow.opensAtHour, venueRow.timezone);
  const closeAt = zonedInstant(bDateStr, venueRow.closesAtHour, venueRow.timezone);

  // Before opening or after closing: fall back to the full day rather than showing
  // an empty or nonsensical window.
  const windowStart = now < openAt || now >= closeAt ? openAt : zonedInstant(dateStr, nowParts.hour, venueRow.timezone);
  const windowEnd = closeAt;

  const lanes = await db
    .select()
    .from(lane)
    .where(and(eq(lane.tenantId, venueId), eq(lane.isActive, true)));
  lanes.sort((a, b) => a.number - b.number);

  const rows = await db
    .select({ allocation: laneAllocation, booking })
    .from(laneAllocation)
    .innerJoin(booking, eq(laneAllocation.bookingId, booking.id))
    .where(and(eq(laneAllocation.tenantId, venueId), inArray(laneAllocation.status, ["confirmed", "active"])));

  const blocks: TimelineBlock[] = [];
  let activeSessions = 0;
  let upcomingBlocks = 0;
  const walkinBookingIds = new Set<string>();

  for (const r of rows) {
    const occ = parseTstzrange(r.allocation.occupies);
    const play = parseTstzrange(r.allocation.playWindow);

    if (occ.start <= now && now < occ.end) activeSessions += 1;
    if (r.booking.kind === "block" && occ.start > now) upcomingBlocks += 1;
    if (r.booking.source === "walkin" && r.booking.businessDate === bDateStr) {
      walkinBookingIds.add(r.booking.id);
    }

    // Skip anything entirely outside the visible window.
    if (occ.end <= windowStart || occ.start >= windowEnd) continue;

    const kind: TimelineBlock["kind"] =
      r.booking.kind === "block" ? "maintenance" : r.booking.source === "walkin" ? "walkin" : "booked";

    blocks.push({
      allocationId: r.allocation.id,
      bookingId: r.booking.id,
      laneId: r.allocation.laneId,
      kind,
      status: r.allocation.status === "active" ? "active" : "confirmed",
      label: kind === "maintenance" ? (r.booking.notes ?? "Maintenance") : displayName(r.booking.customerName, r.booking.source),
      partySize: r.booking.partySize,
      games: r.booking.games,
      start: occ.start < windowStart ? windowStart : occ.start,
      playEnd: play.end < windowStart ? windowStart : play.end > windowEnd ? windowEnd : play.end,
      occupyEnd: occ.end > windowEnd ? windowEnd : occ.end,
      trueStart: occ.start,
      trueEnd: occ.end,
      clippedStart: occ.start < windowStart,
    });
  }

  return {
    venueName: venueRow.name,
    timezone: venueRow.timezone,
    now,
    windowStart,
    windowEnd,
    openAt,
    closeAt,
    lanes: lanes.map((l) => ({ id: l.id, number: l.number, displayName: l.displayName })),
    blocks,
    stats: {
      totalLanes: lanes.length,
      activeSessions,
      upcomingBlocks,
      walkinsToday: walkinBookingIds.size,
    },
  };
}
