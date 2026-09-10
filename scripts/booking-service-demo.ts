/**
 * M5 exit criterion: exercise the real service layer (availability, booking, session)
 * against a live Postgres. Not a unit test -- these functions do real I/O, so this is
 * a proof script, same style as prove-constraint.ts: real inserts, real checks, cleans
 * up after itself.
 *
 * Run: npm run booking:demo
 */
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/client.js";
import { booking, lane } from "../src/db/schema.js";
import { zonedInstant } from "../src/domain/time.js";
import {
  blockLane,
  cancelBooking,
  createBooking,
  NoAvailabilityError,
} from "../src/server/services/booking.js";
import { getAvailability } from "../src/server/services/availability.js";
import { endSession, startSession } from "../src/server/services/session.js";
import { getVenue } from "../src/server/venue.js";

let failures = 0;
function check(ok: boolean, label: string) {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}`);
  if (!ok) failures += 1;
}

async function main() {
  const venue = await getVenue();

  const lanes = await db.select().from(lane).where(eq(lane.tenantId, venue.id));
  if (lanes.length < 4) throw new Error("expected at least 4 seeded lanes");

  const createdBookingIds: string[] = [];
  const day = "2026-09-14";
  const preferredStart = zonedInstant(day, 14, venue.timezone); // 2 PM venue-local

  console.log(`\nBooking service demo -- ${venue.name} (${venue.timezone})\n`);

  // 1. Availability, before anything exists.
  const availability = await getAvailability(venue, { players: 4, games: 2, preferredStart });
  check(availability.status === "open", `getAvailability reports the venue open on ${day} (status=${availability.status})`);
  const candidateCount = availability.status === "open" ? availability.candidates.length : 0;
  check(candidateCount > 0, `getAvailability returns candidates (${candidateCount} found)`);

  // 2. Create a real booking on the top candidate.
  const booking1 = await createBooking(venue, {
    players: 4,
    games: 2,
    preferredStart,
    source: "walkin",
    customerName: "Demo Walk-in",
  });
  createdBookingIds.push(booking1.id);
  check(booking1.status === "confirmed", `createBooking inserts a confirmed booking (status=${booking1.status})`);

  // 3. Start it -- status flips to active, a session row is created.
  const sessions1 = await startSession(booking1.id);
  check(sessions1.length === 1, `startSession creates one session row (got ${sessions1.length})`);

  // 4. End it -- booking completes, lane releases immediately.
  const endedSession = await endSession(sessions1[0]!.id, { gamesCompleted: 2 });
  check(endedSession.endedAt !== null, "endSession stamps an end time");

  // 5. A second booking, then cancel it instead of running it.
  const booking2 = await createBooking(venue, {
    players: 2,
    games: 1,
    preferredStart: zonedInstant(day, 18, venue.timezone),
    source: "phone",
    customerName: "Demo Phone Booking",
  });
  createdBookingIds.push(booking2.id);
  await cancelBooking(booking2.id, "customer called to cancel");
  check(true, "cancelBooking completes without error");

  // 6. Block a lane for maintenance -- should succeed on an empty window.
  const maintenanceLane = lanes[3]!;
  const blockStart = zonedInstant(day, 20, venue.timezone);
  const blockEnd = zonedInstant(day, 21, venue.timezone);
  const blockBooking = await blockLane(venue, maintenanceLane.id, blockStart, blockEnd, "oiling machine service");
  createdBookingIds.push(blockBooking.id);
  check(blockBooking.kind === "block", "blockLane creates a kind='block' booking");

  // 7. A conflicting block attempt on the SAME lane/time must fail loudly, not silently
  //    displace the booking that's already there.
  try {
    await blockLane(venue, maintenanceLane.id, blockStart, blockEnd, "should conflict");
    check(false, "conflicting blockLane was accepted -- should have been rejected");
  } catch {
    check(true, "conflicting blockLane is rejected, not silently resolved");
  }

  // 8. Asking for more lanes than exist should surface a clear NoAvailabilityError.
  try {
    await createBooking(venue, {
      players: 999,
      games: 1,
      preferredStart: zonedInstant(day, 11, venue.timezone),
      source: "staff",
    });
    check(false, "an impossible request was accepted -- should have been rejected");
  } catch (err) {
    check(err instanceof NoAvailabilityError, "an impossible request throws NoAvailabilityError");
  }

  // Cleanup -- back to the clean seeded state. Deleting `booking` cascades to its
  // lane_allocation and session rows (see schema.sql's ON DELETE CASCADE).
  for (const id of createdBookingIds) {
    await db.delete(booking).where(eq(booking.id, id));
  }

  console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) failed\n`);
  await sql.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
