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
 *   - `booking.scheduled_start` IS rewritten, because a staff move normally reflects a
 *     real change to the agreement ("customer rang and asked for 8pm"). For a booking
 *     holding several lanes it is the MINIMUM start across its surviving allocations --
 *     one column cannot track several lanes independently.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import { parseTstzrange, tstzrangeLiteral } from "../../db/range";
import { booking, laneAllocation } from "../../db/schema";
import { DEFAULT_ESTIMATOR_CONFIG } from "../../domain/config";
import { checkMove, type MoveRejection } from "../../domain/scheduler";
import { businessDate, rolloverHour } from "../../domain/time";
import { isExclusionViolation } from "./booking";
import { loadSnapshot, type Venue } from "./availability";

export type MoveFailure = MoveRejection | "not_found" | "released" | "conflict";

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

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new MoveRejectedError("end_before_start");
  }

  const bDate = businessDate(start, venue.timezone, rolloverHour(venue.closesAtHour));
  const snapshot = await loadSnapshot(venue, bDate);

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

      // A maintenance block has no turnover component -- blockLane() writes
      // play_window = occupies for it, and subtracting turnover here would silently
      // change what the block means.
      const hasTurnover = row.booking.kind !== "block";

      // No lock: an in-progress session can be moved just like anything else. This
      // will diverge from session.started_at, same as a moved booking's
      // scheduled_start diverges from its allocation -- staff authority beats the
      // original record. Only a genuine double-booking (checked below, and backstopped
      // by the exclusion constraint) can reject a move.
      const check = checkMove(snapshot, {
        allocationId: input.allocationId,
        laneId: input.laneId,
        start,
        end,
        hasTurnover,
      });

      if (!check.ok) throw new MoveRejectedError(check.reason);

      await tx
        .update(laneAllocation)
        .set({
          laneId: input.laneId,
          occupies: tstzrangeLiteral(start, end),
          playWindow: tstzrangeLiteral(start, check.playEnd),
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
          businessDate: businessDate(earliest, venue.timezone, rolloverHour(venue.closesAtHour)),
        })
        .where(eq(booking.id, row.booking.id));

      return {
        bookingId: row.booking.id,
        laneId: input.laneId,
        start,
        end,
        playEnd: check.playEnd,
      };
    });
  } catch (err) {
    // checkMove should have caught every overlap already, but the constraint is the
    // real authority -- a concurrent drag can win the race between snapshot and UPDATE.
    if (isExclusionViolation(err)) throw new MoveRejectedError("conflict");
    throw err;
  }
}

const MESSAGES: Record<MoveFailure, string> = {
  end_before_start: "That would end before it starts.",
  too_short: `Too short — a booking needs at least ${DEFAULT_ESTIMATOR_CONFIG.minPlayBlockMin} minutes.`,
  before_open: "That starts before the alley opens.",
  after_close: "That would run past closing time.",
  unknown_lane: "That lane isn't available.",
  lane_conflict: "Another booking is already on that lane at that time.",
  locked_start: "This session has already started — you can only change when it ends.",
  locked_lane: "This session has already started — it can't be moved to another lane.",
  not_found: "That booking no longer exists.",
  released: "That booking has already been cancelled or completed.",
  conflict: "Someone else took that slot first.",
};

export function moveFailureMessage(reason: MoveFailure): string {
  return MESSAGES[reason];
}
