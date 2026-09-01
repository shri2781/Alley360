/**
 * Creating, cancelling, and blocking bookings. Each exported function is one
 * transaction -- either the whole thing happens, or none of it does.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { tstzrangeLiteral } from "../../db/range.js";
import { booking, laneAllocation } from "../../db/schema.js";
import { DEFAULT_ESTIMATOR_CONFIG, DEFAULT_SCHEDULER_CONFIG } from "../../domain/config.js";
import { estimateDuration } from "../../domain/estimator.js";
import { addMinutes, businessDate } from "../../domain/time.js";
import { getAvailability, type AvailabilityRequest, type Venue } from "./availability.js";

const PG_EXCLUSION_VIOLATION = "23P01";

/**
 * Drizzle wraps the real Postgres error inside `err.cause` -- the code lives there,
 * not on the wrapper. Same detail that tripped up prove-constraint.ts's first draft.
 */
function isExclusionViolation(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  const causeCode = (err as { cause?: { code?: string } } | undefined)?.cause?.code;
  return code === PG_EXCLUSION_VIOLATION || causeCode === PG_EXCLUSION_VIOLATION;
}

export class NoAvailabilityError extends Error {
  constructor() {
    super("no feasible lane/time found for this request");
  }
}

export class BookingConflictError extends Error {
  constructor() {
    super("could not confirm a booking after several attempts -- lanes kept getting taken");
  }
}

export type CreateBookingInput = AvailabilityRequest & {
  source: "walkin" | "phone" | "staff";
  customerName?: string;
  customerPhone?: string;
};

/**
 * Picks the best available slot (M3's top-ranked candidate) and books it atomically.
 *
 * On the rare race where someone else claims that exact lane/time between scoring and
 * inserting, retries the WHOLE pipeline against fresh state -- retrying the identical
 * placement would just fail again, since something else took it -- up to 3 attempts.
 */
export async function createBooking(venue: Venue, input: CreateBookingInput) {
  const estimatorCfg = DEFAULT_ESTIMATOR_CONFIG;
  const schedulerCfg = DEFAULT_SCHEDULER_CONFIG;
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidates = await getAvailability(venue, input, schedulerCfg, estimatorCfg);
    const best = candidates[0];
    if (!best) throw new NoAvailabilityError();

    const estimate = estimateDuration(input.players, input.games, estimatorCfg);

    try {
      return await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(booking)
          .values({
            tenantId: venue.id,
            kind: "open_play",
            status: "confirmed",
            source: input.source,
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            partySize: input.players,
            games: input.games,
            businessDate: businessDate(best.start, venue.timezone, venue.dayRolloverHour),
            scheduledStart: best.start,
            estimatedBaseMin: estimate.baseMin,
            estimatedPlayMin: estimate.playMin,
            estimatedOccupyMin: estimate.occupyMin,
          })
          .returning();

        if (!created) throw new Error("booking insert returned nothing");

        await tx.insert(laneAllocation).values(
          best.laneIds.map((laneId) => ({
            tenantId: venue.id,
            bookingId: created.id,
            laneId,
            occupies: tstzrangeLiteral(best.start, best.end),
            playWindow: tstzrangeLiteral(best.start, addMinutes(best.start, estimate.playMin)),
          })),
        );

        return created;
      });
    } catch (err) {
      if (isExclusionViolation(err) && attempt < MAX_ATTEMPTS) continue;
      if (isExclusionViolation(err)) throw new BookingConflictError();
      throw err;
    }
  }

  throw new BookingConflictError();
}

/** Releases every lane this booking held. Freed time becomes bookable immediately --
 *  the exclusion constraint ignores 'released' rows. */
export async function cancelBooking(bookingId: string, reason?: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(booking)
      .set({ status: "cancelled", ...(reason ? { notes: reason } : {}) })
      .where(eq(booking.id, bookingId));

    await tx.update(laneAllocation).set({ status: "released" }).where(eq(laneAllocation.bookingId, bookingId));
  });
}

/**
 * Takes a lane out of service for maintenance/etc. Modelled as an ordinary booking
 * with kind='block' (see schema.sql), so it flows through the same exclusion
 * constraint as any real booking. If it conflicts with an existing booking, that
 * conflict is surfaced as a thrown error, not silently resolved -- staff decide
 * what to do about a real booking in the way, not this function.
 */
export async function blockLane(venue: Venue, laneId: string, from: Date, to: Date, reason: string) {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(booking)
      .values({
        tenantId: venue.id,
        kind: "block",
        status: "confirmed",
        source: "staff",
        businessDate: businessDate(from, venue.timezone, venue.dayRolloverHour),
        scheduledStart: from,
        notes: reason,
      })
      .returning();

    if (!created) throw new Error("block booking insert returned nothing");

    await tx.insert(laneAllocation).values({
      tenantId: venue.id,
      bookingId: created.id,
      laneId,
      occupies: tstzrangeLiteral(from, to),
      // A block has no separate "play" portion -- the whole window is the block, and a
      // range trivially contains itself, so this satisfies allocation_play_within_occupies.
      playWindow: tstzrangeLiteral(from, to),
    });

    return created;
  });
}
