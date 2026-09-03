/**
 * Baseline seed: one venue and its lanes. Nothing else — a believable busy Saturday
 * for demos is a separate `demo:seed` script in M7.
 */
import { db, sql } from "./client";
import { lane, pkg, tenant } from "./schema";

/** Placeholder venue settings. Set VENUE_TIMEZONE, or change these for the real alley. */
const VENUE_NAME = process.env.VENUE_NAME ?? "Demo Bowling Alley";
const VENUE_TIMEZONE = process.env.VENUE_TIMEZONE ?? "Asia/Kolkata";
const LANE_COUNT = Number(process.env.VENUE_LANE_COUNT ?? 4);
const OPENS_AT_HOUR = Number(process.env.VENUE_OPENS_AT_HOUR ?? 10);
const CLOSES_AT_HOUR = Number(process.env.VENUE_CLOSES_AT_HOUR ?? 22);

export async function seed() {
  const [venue] = await db
    .insert(tenant)
    .values({
      name: VENUE_NAME,
      timezone: VENUE_TIMEZONE,
      dayRolloverHour: 4,
      opensAtHour: OPENS_AT_HOUR,
      closesAtHour: CLOSES_AT_HOUR,
    })
    .returning();

  if (!venue) throw new Error("failed to insert tenant");

  await db.insert(lane).values(
    Array.from({ length: LANE_COUNT }, (_, i) => ({
      tenantId: venue.id,
      number: i + 1,
      displayName: `Lane ${i + 1}`,
    })),
  );

  // Display-only pricing tiers -- "pay at venue," not wired to any payment logic.
  // Games count feeds the booking form; price is shown as an estimate only.
  await db.insert(pkg).values([
    { tenantId: venue.id, name: "Basic Bowl", games: 1, pricePerPerson: 299, sortOrder: 1 },
    { tenantId: venue.id, name: "Strike Special", games: 2, pricePerPerson: 499, sortOrder: 2 },
    { tenantId: venue.id, name: "Ultimate Fun", games: 3, pricePerPerson: 699, sortOrder: 3 },
  ]);

  console.log(`seeded "${venue.name}" (${VENUE_TIMEZONE}) with ${LANE_COUNT} lanes and 3 packages`);
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
