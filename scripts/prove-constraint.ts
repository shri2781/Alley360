/**
 * M1 exit criterion: demonstrate that the database — not application code — is what
 * prevents double-booking a lane.
 *
 * Four cases, run against real Postgres:
 *   1. a first allocation is accepted
 *   2. an OVERLAPPING allocation on the same lane is rejected with 23P01
 *   3. the same overlapping window on a DIFFERENT lane is accepted (the guard is per-lane)
 *   4. a BACK-TO-BACK allocation on the same lane is accepted (proves the '[)' bounds —
 *      touching ranges are not overlapping ranges)
 *
 * Run: npm run prove:constraint
 */
import { asc, eq } from "drizzle-orm";
import { db, sql } from "../src/db/client.js";
import { tstzrangeLiteral } from "../src/db/range.js";
import { booking, lane, laneAllocation } from "../src/db/schema.js";
import { businessDateFor, type WeeklyHours } from "../src/domain/hours.js";
import { addMinutes } from "../src/domain/time.js";
import { getVenue } from "../src/server/venue.js";

const PG_EXCLUSION_VIOLATION = "23P01";

/** Inserts a booking plus one allocation. Throws on constraint violation. */
async function allocate(opts: {
  tenantId: string;
  laneId: string;
  start: Date;
  playMin: number;
  label: string;
  timezone: string;
  weeklyHours: WeeklyHours;
}) {
  // occupies == play_window: there is no turnover component any more.
  const playEnd = addMinutes(opts.start, opts.playMin);
  const occupyEnd = playEnd;

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(booking)
      .values({
        tenantId: opts.tenantId,
        partySize: 4,
        games: 2,
        businessDate: businessDateFor(opts.start, opts.timezone, opts.weeklyHours),
        scheduledStart: opts.start,
        estimatedPlayMin: opts.playMin,
        estimatedOccupyMin: opts.playMin,
        notes: opts.label,
      })
      .returning();

    if (!created) throw new Error("booking insert returned nothing");

    await tx.insert(laneAllocation).values({
      tenantId: opts.tenantId,
      bookingId: created.id,
      laneId: opts.laneId,
      occupies: tstzrangeLiteral(opts.start, occupyEnd),
      playWindow: tstzrangeLiteral(opts.start, playEnd),
    });

    return created.id;
  });
}

/**
 * Drizzle wraps the driver error in a DrizzleQueryError; the real PostgresError
 * (carrying `.code`) lives at `err.cause`, not on the wrapper itself. Check both so
 * this also works if a raw `postgres` error is ever thrown directly (e.g. via sql.unsafe).
 */
function isExclusionViolation(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  const causeCode = (err as { cause?: { code?: string } } | undefined)?.cause?.code;
  return code === PG_EXCLUSION_VIOLATION || causeCode === PG_EXCLUSION_VIOLATION;
}

async function main() {
  const venue = await getVenue();

  const lanes = await db
    .select()
    .from(lane)
    .where(eq(lane.tenantId, venue.id))
    .orderBy(asc(lane.number));

  const laneOne = lanes[0];
  const laneTwo = lanes[1];
  if (!laneOne || !laneTwo) throw new Error("expected at least 2 lanes");

  const ctx = { tenantId: venue.id, timezone: venue.timezone, weeklyHours: venue.weeklyHours };

  // 18:00 UTC on a fixed future date, so the run is deterministic.
  const start = new Date("2026-09-12T18:00:00.000Z");
  const playMin = 72; // 4 players x 2 games x 9 min
  const occupyEnd = addMinutes(start, playMin);

  const created: string[] = [];
  let failures = 0;

  const check = (ok: boolean, label: string) => {
    console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}`);
    if (!ok) failures += 1;
  };

  console.log(`\nlane_allocation_no_overlap — proving the guarantee on ${laneOne.displayName}\n`);

  // 1. baseline
  try {
    created.push(await allocate({ ...ctx, laneId: laneOne.id, start, playMin, label: "baseline" }));
    check(true, "first allocation 18:00–19:45 accepted");
  } catch (err) {
    check(false, `first allocation should have been accepted: ${String(err)}`);
  }

  // 2. overlap on the same lane must be refused
  try {
    created.push(
      await allocate({
        ...ctx,
        laneId: laneOne.id,
        start: addMinutes(start, 60),
        playMin,
        label: "overlap",
      }),
    );
    check(false, "overlapping allocation was accepted — the constraint is NOT working");
  } catch (err) {
    check(isExclusionViolation(err), `overlapping allocation rejected with ${PG_EXCLUSION_VIOLATION}`);
  }

  // 3. the same window on another lane is fine — the guard is per-lane, not global
  try {
    created.push(
      await allocate({
        ...ctx,
        laneId: laneTwo.id,
        start: addMinutes(start, 60),
        playMin,
        label: "other lane",
      }),
    );
    check(true, `same window accepted on ${laneTwo.displayName}`);
  } catch (err) {
    check(false, `other lane should have been accepted: ${String(err)}`);
  }

  // 4. back-to-back on the same lane, starting exactly when the previous claim ends.
  //    This is the '[)' bounds paying off: touching ranges do not overlap.
  try {
    created.push(
      await allocate({ ...ctx, laneId: laneOne.id, start: occupyEnd, playMin, label: "back to back" }),
    );
    check(true, "back-to-back allocation accepted (half-open bounds)");
  } catch (err) {
    check(false, `back-to-back should have been accepted: ${String(err)}`);
  }

  // Leave the database as we found it.
  for (const id of created) {
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
