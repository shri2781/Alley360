/**
 * Baseline seed: one venue and its lanes. Nothing else — a believable busy Saturday
 * for demos is a separate `demo:seed` script in M7.
 */
import { db, sql } from "./client";
import { lane, rate, staffUser, tenant, venueHours } from "./schema";
import { hashPassword } from "../server/auth/password";

/** Placeholder venue settings. Set VENUE_TIMEZONE, or change these for the real alley. */
const VENUE_NAME = process.env.VENUE_NAME ?? "Alley360";
const VENUE_TIMEZONE = process.env.VENUE_TIMEZONE ?? "Asia/Kolkata";
const LANE_COUNT = Number(process.env.VENUE_LANE_COUNT ?? 4);
const OPENS_AT_HOUR = Number(process.env.VENUE_OPENS_AT_HOUR ?? 10);
const CLOSES_AT_HOUR = Number(process.env.VENUE_CLOSES_AT_HOUR ?? 22);

/** The one shared staff login. Change the password from /staff/settings after
 *  the first login against anything but your own machine. */
const STAFF_USERNAME = process.env.STAFF_USERNAME ?? "staff";
const STAFF_PASSWORD = process.env.STAFF_PASSWORD ?? "change-me";

export async function seed() {
  const [venue] = await db
    .insert(tenant)
    .values({
      name: VENUE_NAME,
      timezone: VENUE_TIMEZONE,
    })
    .returning();

  if (!venue) throw new Error("failed to insert tenant");

  // Same hours every day of the week, expressed at the new minutes-since-midnight
  // resolution -- the per-day model exists so an owner CAN differ Friday from
  // Monday in Settings, not so the seed has to guess a realistic default for them.
  await db.insert(venueHours).values(
    Array.from({ length: 7 }, (_, dayOfWeek) => ({
      tenantId: venue.id,
      dayOfWeek,
      opensAtMin: OPENS_AT_HOUR * 60,
      closesAtMin: CLOSES_AT_HOUR * 60,
    })),
  );

  await db.insert(lane).values(
    Array.from({ length: LANE_COUNT }, (_, i) => ({
      tenantId: venue.id,
      number: i + 1,
      displayName: `Lane ${i + 1}`,
    })),
  );

  // Base + ordered overrides: Regular always applies unless a special matches first.
  // Days are 0=Sun..6=Sat. These two specials happen not to overlap in days, so the
  // seed alone won't demonstrate first-match-wins -- that becomes visible as soon as
  // an overlapping rate is added by hand (e.g. a Friday-evening special).
  await db.insert(rate).values([
    { tenantId: venue.id, name: "Regular", pricePerPerson: 299, isBase: true },
    {
      tenantId: venue.id,
      name: "Happy Hours",
      pricePerPerson: 199,
      days: [1, 2, 3, 4, 5], // Mon-Fri
      startsAtMin: 720, // 12:00 PM
      endsAtMin: 960, // 4:00 PM
      priority: 1,
    },
    {
      tenantId: venue.id,
      name: "Weekend",
      pricePerPerson: 349,
      days: [0, 6], // Sun, Sat
      startsAtMin: null, // all day
      endsAtMin: null,
      priority: 2,
    },
  ]);

  await db.insert(staffUser).values({
    tenantId: venue.id,
    username: STAFF_USERNAME,
    passwordHash: await hashPassword(STAFF_PASSWORD),
  });
  if (STAFF_PASSWORD === "change-me") {
    console.warn(
      `WARNING: staff login "${STAFF_USERNAME}" was seeded with the default password. ` +
        "Change it from /staff/settings before using this anywhere but your own machine.",
    );
  }

  console.log(
    `seeded "${venue.name}" (${VENUE_TIMEZONE}) with ${LANE_COUNT} lanes, 7 days of hours, ` +
      "3 rates, and 1 staff login",
  );
  return venue;
}

// Allow running standalone: `npm run db:seed`
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  seed()
    .then(() => sql.end())
    .catch(async (err) => {
      console.error(err);
      await sql.end();
      process.exit(1);
    });
}
