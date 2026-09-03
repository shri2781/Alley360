/**
 * Read-only view assembly for the staff dashboard (M4). Turns raw `booking` /
 * `lane_allocation` rows into "what is each lane doing right now" -- the one thing
 * the UI actually needs to render. Real I/O, same category as src/server/services.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { parseTstzrange } from "../db/range";
import { booking, lane, laneAllocation, tenant } from "../db/schema";
import { businessDate, minutesBetween } from "../domain/time";

/** A lane counts as "booked-soon" once its next confirmed booking is this close. */
const BOOKED_SOON_WINDOW_MIN = 60;

export type LaneState = "available" | "playing" | "booked-soon" | "maintenance";

export type LaneBoardEntry = {
  laneId: string;
  laneNumber: number;
  laneName: string;
  state: LaneState;
  /** Only meaningful when state === "playing": true once past the expected finish. */
  isOverrun: boolean;
  current?: {
    bookingId: string;
    customerName: string | null;
    /** Where this booking came from -- used to pick an honest fallback label when
     *  customerName is empty. A blank-name online booking is not a walk-in. */
    source: "walkin" | "phone" | "staff" | "web";
    partySize: number;
    /** The scheduled start, not necessarily the literal actual clock-in moment --
     *  close enough for a display, and avoids a second join to `session` for M4. */
    startedAt: Date;
    expectedFinish: Date;
  };
  nextBooking?: {
    bookingId: string;
    customerName: string | null;
    source: "walkin" | "phone" | "staff" | "web";
    partySize: number;
    start: Date;
  };
  maintenanceUntil?: Date;
};

export type UpcomingBooking = {
  bookingId: string;
  kind: "open_play" | "block";
  laneNumbers: number[];
  customerName: string | null;
  source: "walkin" | "phone" | "staff" | "web";
  partySize: number;
  games: number;
  start: Date;
};

export type LaneBoardData = {
  venueName: string;
  timezone: string;
  now: Date;
  lanes: LaneBoardEntry[];
  upcoming: UpcomingBooking[];
};

export async function getLaneBoard(venueId: string): Promise<LaneBoardData> {
  const [venueRow] = await db.select().from(tenant).where(eq(tenant.id, venueId));
  if (!venueRow) throw new Error(`venue ${venueId} not found`);

  const now = new Date();
  const bDate = businessDate(now, venueRow.timezone, venueRow.dayRolloverHour);

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

  const lanes_ = lanes.map((l) => {
    const onThisLane = rows.filter((r) => r.allocation.laneId === l.id);

    const current = onThisLane.find((r) => {
      const occ = parseTstzrange(r.allocation.occupies);
      return occ.start <= now && now < occ.end;
    });

    if (current) {
      const playWindow = parseTstzrange(current.allocation.playWindow);

      if (current.booking.kind === "block") {
        const occ = parseTstzrange(current.allocation.occupies);
        return {
          laneId: l.id,
          laneNumber: l.number,
          laneName: l.displayName,
          state: "maintenance" as const,
          isOverrun: false,
          maintenanceUntil: occ.end,
        };
      }

      return {
        laneId: l.id,
        laneNumber: l.number,
        laneName: l.displayName,
        state: "playing" as const,
        isOverrun: now > playWindow.end,
        current: {
          bookingId: current.booking.id,
          customerName: current.booking.customerName,
          source: current.booking.source,
          partySize: current.booking.partySize,
          startedAt: playWindow.start,
          expectedFinish: playWindow.end,
        },
      };
    }

    const next = onThisLane
      .filter((r) => r.allocation.status === "confirmed")
      .map((r) => ({ ...r, occ: parseTstzrange(r.allocation.occupies) }))
      .filter((r) => r.occ.start > now)
      .sort((a, b) => a.occ.start.getTime() - b.occ.start.getTime())[0];

    if (next && minutesBetween(now, next.occ.start) <= BOOKED_SOON_WINDOW_MIN) {
      return {
        laneId: l.id,
        laneNumber: l.number,
        laneName: l.displayName,
        state: "booked-soon" as const,
        isOverrun: false,
        nextBooking: {
          bookingId: next.booking.id,
          customerName: next.booking.customerName,
          source: next.booking.source,
          partySize: next.booking.partySize,
          start: next.occ.start,
        },
      };
    }

    return {
      laneId: l.id,
      laneNumber: l.number,
      laneName: l.displayName,
      state: "available" as const,
      isOverrun: false,
    };
  });

  // Today's not-yet-started bookings, chronological. A multi-lane party has one
  // allocation row PER lane sharing one booking_id -- group back into one entry per
  // booking, not one per lane, or a party would show up duplicated.
  const upcomingByBooking = new Map<
    string,
    { booking: (typeof rows)[number]["booking"]; laneNumbers: number[]; start: Date }
  >();

  for (const r of rows) {
    if (r.allocation.status !== "confirmed") continue;
    if (r.booking.businessDate !== bDate) continue;
    const occ = parseTstzrange(r.allocation.occupies);
    if (occ.start <= now) continue;

    const laneNumber = lanes.find((l) => l.id === r.allocation.laneId)?.number;
    const existing = upcomingByBooking.get(r.booking.id);
    if (existing) {
      if (laneNumber) existing.laneNumbers.push(laneNumber);
    } else {
      upcomingByBooking.set(r.booking.id, {
        booking: r.booking,
        laneNumbers: laneNumber ? [laneNumber] : [],
        start: occ.start,
      });
    }
  }

  const upcoming: UpcomingBooking[] = [...upcomingByBooking.values()]
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((u) => ({
      bookingId: u.booking.id,
      kind: u.booking.kind,
      laneNumbers: u.laneNumbers.sort((a, b) => a - b),
      customerName: u.booking.customerName,
      source: u.booking.source,
      partySize: u.booking.partySize,
      games: u.booking.games,
      start: u.start,
    }));

  return { venueName: venueRow.name, timezone: venueRow.timezone, now, lanes: lanes_, upcoming };
}
