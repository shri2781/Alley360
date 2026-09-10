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
import { businessDateFor, venueWindow } from "../domain/hours";
import { zonedInstantAtMinute, zonedParts } from "../domain/time";
import { displayName } from "./labels";
import { loadWeeklyHours } from "./venue";

export type TimelineBlock = {
  /** The lane_allocation row -- the drag identity. Not bookingId: one booking can hold
   *  several lanes, so bookingId does not uniquely identify a block. */
  allocationId: string;
  bookingId: string;
  laneId: string;
  kind: "booked" | "walkin" | "maintenance";
  /** The booking's own status, not the allocation's -- Start/End/Cancel act on the whole
   *  booking, so the details popover must show and gate on the booking-level state. */
  status: "confirmed" | "active" | "completed" | "cancelled" | "no_show";
  label: string;
  phone: string | null;
  partySize: number;
  games: number;
  /** Clamped to the visible window -- a session that started before the window
   *  begins renders from the left edge rather than overflowing off-screen. */
  start: Date;
  occupyEnd: Date;
  /** The REAL allocation bounds, unclamped. Layout uses the clamped pair above; any
   *  arithmetic that ends up written back to the database must use these, or a block
   *  that merely runs off the edge of the view would be silently truncated on save. */
  trueStart: Date;
  trueEnd: Date;
};

export type TimelineData = {
  venueName: string;
  timezone: string;
  now: Date;
  windowStart: Date;
  windowEnd: Date;
  /** True when today's business day is marked closed in Alley Timings. The window
   *  still falls back to the full local calendar day (not an empty board) so any
   *  live allocation -- a booking made before the day was closed, or a staff block --
   *  stays visible rather than silently disappearing. */
  isClosedToday: boolean;
  lanes: { id: string; number: number; displayName: string }[];
  blocks: TimelineBlock[];
  stats: {
    totalLanes: number;
    activeSessions: number;
  };
};

const pad = (n: number) => String(n).padStart(2, "0");

export async function getTimeline(venueId: string): Promise<TimelineData> {
  const [venueRow] = await db.select().from(tenant).where(eq(tenant.id, venueId));
  if (!venueRow) throw new Error(`venue ${venueId} not found`);

  const weeklyHours = await loadWeeklyHours(venueId);

  const now = new Date();
  const nowParts = zonedParts(now, venueRow.timezone);
  const dateStr = `${nowParts.year}-${pad(nowParts.month)}-${pad(nowParts.day)}`;
  // Distinct from dateStr: after midnight but before rollover, the business day that's
  // still open is yesterday's -- that's the one the window needs to span.
  const bDateStr = businessDateFor(now, venueRow.timezone, weeklyHours);

  const window = venueWindow(bDateStr, venueRow.timezone, weeklyHours);
  const isClosedToday = window === null;

  let windowStart: Date;
  let windowEnd: Date;
  if (window) {
    // Before opening or after closing: fall back to the full day rather than showing
    // an empty or nonsensical window.
    windowStart =
      now < window.openAt || now >= window.closeAt
        ? window.openAt
        : zonedInstantAtMinute(dateStr, nowParts.hour * 60, venueRow.timezone);
    windowEnd = window.closeAt;
  } else {
    windowStart = zonedInstantAtMinute(dateStr, 0, venueRow.timezone);
    windowEnd = zonedInstantAtMinute(dateStr, 1440, venueRow.timezone);
  }

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

  for (const r of rows) {
    const occ = parseTstzrange(r.allocation.occupies);

    if (occ.start <= now && now < occ.end) activeSessions += 1;

    // Skip anything entirely outside the visible window.
    if (occ.end <= windowStart || occ.start >= windowEnd) continue;

    const kind: TimelineBlock["kind"] =
      r.booking.kind === "block" ? "maintenance" : r.booking.source === "walkin" ? "walkin" : "booked";

    blocks.push({
      allocationId: r.allocation.id,
      bookingId: r.booking.id,
      laneId: r.allocation.laneId,
      kind,
      status: r.booking.status,
      label: kind === "maintenance" ? (r.booking.notes ?? "Maintenance") : displayName(r.booking.customerName, r.booking.source),
      phone: r.booking.customerPhone,
      partySize: r.booking.partySize,
      games: r.booking.games,
      start: occ.start < windowStart ? windowStart : occ.start,
      occupyEnd: occ.end > windowEnd ? windowEnd : occ.end,
      trueStart: occ.start,
      trueEnd: occ.end,
    });
  }

  return {
    venueName: venueRow.name,
    timezone: venueRow.timezone,
    now,
    windowStart,
    windowEnd,
    isClosedToday,
    lanes: lanes.map((l) => ({ id: l.id, number: l.number, displayName: l.displayName })),
    blocks,
    stats: {
      totalLanes: lanes.length,
      activeSessions,
    },
  };
}
