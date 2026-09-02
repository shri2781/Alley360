/**
 * M4 exit criterion: populate a believable board using the REAL M5 service functions --
 * not fake inserts. Anchored to the actual current time, so whatever you see in the
 * browser right after running this looks like a real moment on a real Saturday.
 *
 * Run this against a freshly-reset database (`npm run db:reset` first) -- it doesn't
 * clean up after itself the way the proof scripts do, since its whole point is to
 * leave data behind to look at.
 *
 * Run: npm run demo:seed
 */
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/client.js";
import { lane, laneAllocation, tenant } from "../src/db/schema.js";
import { addMinutes } from "../src/domain/time.js";
import { blockLane, createBooking } from "../src/server/services/booking.js";
import { startSession } from "../src/server/services/session.js";
import type { Venue } from "../src/server/services/availability.js";

async function main() {
  const [venueRow] = await db.select().from(tenant).limit(1);
  if (!venueRow) throw new Error("no tenant -- run `npm run db:reset` first");
  const venue: Venue = venueRow;

  const lanes = await db.select().from(lane).where(eq(lane.tenantId, venue.id));
  if (lanes.length < 4) throw new Error("expected at least 4 seeded lanes");

  const now = new Date();

  console.log(`Seeding a realistic board for "${venueRow.name}" around ${now.toISOString()}\n`);

  // Currently playing: started 20 min ago, on whichever lane the scheduler picks first.
  const playing = await createBooking(venue, {
    players: 4,
    games: 2,
    preferredStart: addMinutes(now, -20),
    source: "walkin",
    customerName: "Priya's group",
  });
  await startSession(playing.id);
  console.log(`  playing:      booking ${playing.id} (started ~20 min ago)`);

  // Booked soon: starts in 30 minutes.
  const bookedSoon = await createBooking(venue, {
    players: 2,
    games: 1,
    preferredStart: addMinutes(now, 30),
    source: "phone",
    customerName: "Rahul",
  });
  console.log(`  booked-soon:  booking ${bookedSoon.id} (starts in ~30 min)`);

  // Maintenance and "genuinely available" both need a lane the two bookings above
  // didn't land on. Query rather than guess which lanes the scheduler actually picked.
  const usedLaneIds = new Set(
    (await db.select().from(laneAllocation).where(eq(laneAllocation.tenantId, venue.id))).map((a) => a.laneId),
  );
  const freeLanes = lanes.filter((l) => !usedLaneIds.has(l.id)).sort((a, b) => a.number - b.number);
  if (freeLanes.length < 2) {
    throw new Error("expected at least 2 lanes left free for the maintenance/available scenarios");
  }

  const maintenanceLane = freeLanes[0]!;
  await blockLane(venue, maintenanceLane.id, addMinutes(now, -10), addMinutes(now, 50), "oiling machine service");
  console.log(`  maintenance:  Lane ${maintenanceLane.number} (blocked, covers now)`);

  console.log(`  available:    Lane ${freeLanes[1]!.number} (left untouched)\n`);
  console.log("Run `npm run dev` and open http://localhost:3000 to see it.\n");

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
