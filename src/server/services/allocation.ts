/**
 * Moving and resizing an existing lane claim -- the staff override path.
 *
 * Everywhere else in this codebase a `lane_allocation` range is written once at insert
 * and never touched again (endSession only flips `status` to 'released'). This module is
 * the only place that UPDATEs `occupies`/`play_window`, so it is also the only place
 * where the exclusion constraint can reject an UPDATE rather than an INSERT.
 *
 * Two invariants worth stating, because they are easy to break by "tidying up":
 *
 *   - `booking.estimated_*_min` is NEVER rewritten here. Those are the estimator's
 *     original prediction. Overwriting a prediction with its outcome destroys the only
 *     signal that could ever calibrate the guessed constants in src/domain/config.ts.
 *
 *   - `booking.scheduled_start` IS rewritten for a confirmed booking, because a staff
 *     move normally reflects a real change to the agreement ("customer rang and asked
 *     for 8pm"). For a booking holding several lanes it is the MINIMUM start across its
 *     surviving allocations -- one column cannot track several lanes independently.
 *
 *   - `booking.rate_id`/`rate_name`/`price_per_person`/`total_price` are likewise NEVER
 *     rewritten here. The snapshotted price is what the customer agreed to when they
 *     booked; silently repricing them (up OR down) as a side effect of a staff drag for
 *     scheduling convenience would be worse than the price going stale. If repricing a
 *     moved booking is ever wanted, it should be its own explicit staff action, not a
 *     side effect of this one.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import { parseTstzrange, tstzrangeLiteral } from "../../db/range";
import { booking, laneAllocation } from "../../db/schema";
import { businessDateFor } from "../../domain/hours";
import { type Venue } from "../venue";
import { isExclusionViolation } from "./booking";

export type MoveFailure = "end_before_start" | "not_found" | "released" | "conflict";

export class MoveRejectedError extends Error {
  constructor(readonly reason: MoveFailure) {
    super(`move rejected: ${reason}`);
  }
}

export type MoveAllocationInput = {
  allocationId: string;
  laneId: string;
  /** ISO strings -- the client sends these across the server-action boundary. */
  startISO: string;
  endISO: string;
};

export async function moveAllocation(venue: Venue, input: MoveAllocationInput) {
  const start = new Date(input.startISO);
  const end = new Date(input.endISO);

  // Staff overrides are otherwise trusted -- no minimum length, venue-hours or overlap
  // check here. An inverted range is the exception only because Postgres' tstzrange
  // constructor hard-errors on lower > upper, so it could never be stored anyway.
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new MoveRejectedError("end_before_start");
  }

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ allocation: laneAllocation, booking })
        .from(laneAllocation)
        .innerJoin(booking, eq(laneAllocation.bookingId, booking.id))
        .where(and(eq(laneAllocation.id, input.allocationId), eq(laneAllocation.tenantId, venue.id)))
        .for("update");

      if (!row) throw new MoveRejectedError("not_found");
      if (row.allocation.status === "released") throw new MoveRejectedError("released");

      await tx
        .update(laneAllocation)
        .set({
          laneId: input.laneId,
          // No turnover component anywhere any more, so play_window is the full span.
          occupies: tstzrangeLiteral(start, end),
          playWindow: tstzrangeLiteral(start, end),
        })
        .where(eq(laneAllocation.id, input.allocationId));

      // Re-read the booking's live allocations (this one now updated) and pull
      // scheduled_start back to the earliest of them.
      const siblings = await tx
        .select({ occupies: laneAllocation.occupies })
        .from(laneAllocation)
        .where(
          and(
            eq(laneAllocation.bookingId, row.booking.id),
            inArray(laneAllocation.status, ["confirmed", "active"]),
          ),
        );

      const earliest = siblings
        .map((s) => parseTstzrange(s.occupies).start)
        .reduce((min, d) => (d < min ? d : min), start);

      await tx
        .update(booking)
        .set({
          scheduledStart: earliest,
          // A dragged block can cross the venue's rollover hour into a different
          // business day.
          businessDate: businessDateFor(earliest, venue.timezone, venue.weeklyHours),
        })
        .where(eq(booking.id, row.booking.id));

      return {
        bookingId: row.booking.id,
        laneId: input.laneId,
        start,
        end,
      };
    });
  } catch (err) {
    // The EXCLUDE constraint is the only thing stopping two allocations from claiming
    // the same lane at the same time -- nothing checks for that before the UPDATE.
    if (isExclusionViolation(err)) throw new MoveRejectedError("conflict");
    throw err;
  }
}

const MESSAGES: Record<MoveFailure, string> = {
  end_before_start: "That would end before it starts.",
  not_found: "That booking no longer exists.",
  released: "That booking has already been cancelled or completed.",
  conflict: "Another booking is already on that lane at that time.",
};

export function moveFailureMessage(reason: MoveFailure): string {
  return MESSAGES[reason];
}
