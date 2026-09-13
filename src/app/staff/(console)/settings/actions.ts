"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, eq, max } from "drizzle-orm";
import { db } from "../../../../db/client";
import { lane, rate, staffUser, venueHours } from "../../../../db/schema";
import { getVenue } from "../../../../server/venue";
import { requireStaff } from "../../../../server/auth/dal";
import { hashPassword, verifyPassword } from "../../../../server/auth/password";
import { validateWeeklyHours, type DayHours, type WeeklyHours } from "../../../../domain/hours";
import { validateSpecialRate } from "../../../../domain/rates";

const TIMINGS_PATH = "/staff/settings/timings";
const PRICING_PATH = "/staff/settings/pricing";
const LANES_PATH = "/staff/settings/lanes";
const PASSWORD_PATH = "/staff/settings/password";

function revalidateSettings() {
  revalidatePath("/staff/settings");
  revalidatePath(TIMINGS_PATH);
  revalidatePath(PRICING_PATH);
  revalidatePath(LANES_PATH);
  revalidatePath(PASSWORD_PATH);
  revalidatePath("/"); // rates and hours shown on the customer landing page
  revalidatePath("/book");
  revalidatePath("/staff"); // timeline window depends on venue hours
}

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function succeed(path: string, message: string): never {
  redirect(`${path}?success=${encodeURIComponent(message)}`);
}

/**
 * Saves all seven days at once from a single form (see the page for the field naming
 * convention: `day-<dayOfWeek>-opens` etc, keyed by day_of_week regardless of the
 * Monday-first display order). Unlike the old single opens/closes pair, this is
 * enough of an input space that a silent no-op on bad input would be indistinguishable
 * from a save that worked -- so, unlike toggleLaneActive/addLane below, failures here
 * redirect with ?error=.
 */
export async function updateVenueHours(formData: FormData) {
  await requireStaff();
  const venue = await getVenue();

  const days: DayHours[] = [];
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    days.push({
      dayOfWeek,
      isClosed: formData.get(`day-${dayOfWeek}-closed`) === "on",
      opensAtMin: Number(formData.get(`day-${dayOfWeek}-opens`)),
      closesAtMin: Number(formData.get(`day-${dayOfWeek}-closes`)),
    });
  }
  const weekly = days as unknown as WeeklyHours;

  const wellFormed = weekly.every(
    (d) =>
      Number.isInteger(d.opensAtMin) &&
      d.opensAtMin >= 0 &&
      d.opensAtMin <= 1439 &&
      d.opensAtMin % 30 === 0 &&
      Number.isInteger(d.closesAtMin) &&
      d.closesAtMin > d.opensAtMin &&
      d.closesAtMin <= d.opensAtMin + 1440 &&
      d.closesAtMin % 30 === 0,
  );
  if (!wellFormed) fail(TIMINGS_PATH, "Enter a valid opening and closing time for every day.");

  const issues = validateWeeklyHours(weekly);
  if (issues.length > 0) fail(TIMINGS_PATH, issues[0]!.message);

  await db.transaction(async (tx) => {
    for (const d of weekly) {
      await tx
        .insert(venueHours)
        .values({
          tenantId: venue.id,
          dayOfWeek: d.dayOfWeek,
          isClosed: d.isClosed,
          opensAtMin: d.opensAtMin,
          closesAtMin: d.closesAtMin,
        })
        .onConflictDoUpdate({
          target: [venueHours.tenantId, venueHours.dayOfWeek],
          set: { isClosed: d.isClosed, opensAtMin: d.opensAtMin, closesAtMin: d.closesAtMin },
        });
    }
  });

  revalidateSettings();
  succeed(TIMINGS_PATH, "Alley timings updated.");
}

/** Copies Monday's (day_of_week=1) hours onto every other day -- a fast path for the
 *  common case of one schedule all week, still posted through the same form so it
 *  works without JS: this formAction skips straight to writing Monday's values into
 *  every row rather than reading the other six days' selects. */
export async function copyMondayToAllDays(formData: FormData) {
  await requireStaff();
  const venue = await getVenue();

  const opensAtMin = Number(formData.get("day-1-opens"));
  const closesAtMin = Number(formData.get("day-1-closes"));
  const isClosed = formData.get("day-1-closed") === "on";

  const wellFormed =
    Number.isInteger(opensAtMin) &&
    opensAtMin >= 0 &&
    opensAtMin <= 1439 &&
    opensAtMin % 30 === 0 &&
    Number.isInteger(closesAtMin) &&
    closesAtMin > opensAtMin &&
    closesAtMin <= opensAtMin + 1440 &&
    closesAtMin % 30 === 0;
  if (!wellFormed) fail(TIMINGS_PATH, "Monday's hours must be valid before they can be copied to the rest of the week.");

  await db.transaction(async (tx) => {
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      await tx
        .insert(venueHours)
        .values({ tenantId: venue.id, dayOfWeek, isClosed, opensAtMin, closesAtMin })
        .onConflictDoUpdate({
          target: [venueHours.tenantId, venueHours.dayOfWeek],
          set: { isClosed, opensAtMin, closesAtMin },
        });
    }
  });

  revalidateSettings();
  succeed(TIMINGS_PATH, "Monday's hours copied to every day.");
}

function parseSpecialRateForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const pricePerPerson = Number(formData.get("pricePerPerson"));
  const days = Array.from({ length: 7 }, (_, d) => d).filter((d) => formData.get(`day-${d}`) === "on");
  const startsRaw = String(formData.get("startsAtMin") ?? "");
  const endsRaw = String(formData.get("endsAtMin") ?? "");
  return {
    name,
    pricePerPerson,
    days,
    startsAtMin: startsRaw === "" ? null : Number(startsRaw),
    endsAtMin: endsRaw === "" ? null : Number(endsRaw),
  };
}

export async function updateBaseRate(formData: FormData) {
  await requireStaff();
  const venue = await getVenue();

  const name = String(formData.get("name") ?? "").trim();
  const pricePerPerson = Number(formData.get("pricePerPerson"));
  if (!name || !Number.isInteger(pricePerPerson) || pricePerPerson < 0) {
    fail(PRICING_PATH, "Enter a valid name and price for the base rate.");
  }

  await db
    .update(rate)
    .set({ name, pricePerPerson })
    .where(and(eq(rate.tenantId, venue.id), eq(rate.isBase, true)));

  revalidateSettings();
  succeed(PRICING_PATH, "Base rate updated.");
}

export async function addSpecialRate(formData: FormData) {
  await requireStaff();
  const venue = await getVenue();
  const input = parseSpecialRateForm(formData);

  const issues = validateSpecialRate(input);
  if (issues.length > 0) fail(PRICING_PATH, issues[0]!.message);

  const [row] = await db
    .select({ maxPriority: max(rate.priority) })
    .from(rate)
    .where(eq(rate.tenantId, venue.id));

  await db.insert(rate).values({
    tenantId: venue.id,
    name: input.name,
    pricePerPerson: input.pricePerPerson,
    isBase: false,
    days: input.days,
    startsAtMin: input.startsAtMin,
    endsAtMin: input.endsAtMin,
    priority: (row?.maxPriority ?? 0) + 1,
  });

  revalidateSettings();
  succeed(PRICING_PATH, "Rate added.");
}

export async function updateSpecialRate(rateId: string, formData: FormData) {
  await requireStaff();
  const venue = await getVenue();
  const input = parseSpecialRateForm(formData);

  const issues = validateSpecialRate(input);
  if (issues.length > 0) fail(PRICING_PATH, issues[0]!.message);

  await db
    .update(rate)
    .set({
      name: input.name,
      pricePerPerson: input.pricePerPerson,
      days: input.days,
      startsAtMin: input.startsAtMin,
      endsAtMin: input.endsAtMin,
    })
    .where(and(eq(rate.id, rateId), eq(rate.tenantId, venue.id), eq(rate.isBase, false)));

  revalidateSettings();
  succeed(PRICING_PATH, "Rate updated.");
}

/** The base rate can never be deactivated (rate_base_shape enforces this at the DB
 *  layer too) -- this action is only ever bound to a special rate row. */
export async function toggleSpecialRateActive(rateId: string, currentlyActive: boolean) {
  await requireStaff();
  const venue = await getVenue();
  await db
    .update(rate)
    .set({ isActive: !currentlyActive })
    .where(and(eq(rate.id, rateId), eq(rate.tenantId, venue.id), eq(rate.isBase, false)));
  revalidateSettings();
}

/** Swaps this special's `priority` with its neighbour in the current ordering, so
 *  moving a rate up or down changes which one wins a tie at the same time. No unique
 *  constraint on priority, so a plain swap (rather than a temp value) is enough. */
export async function moveSpecialRate(rateId: string, direction: "up" | "down") {
  await requireStaff();
  const venue = await getVenue();

  await db.transaction(async (tx) => {
    const specials = await tx
      .select({ id: rate.id, priority: rate.priority })
      .from(rate)
      .where(and(eq(rate.tenantId, venue.id), eq(rate.isBase, false)))
      .orderBy(asc(rate.priority), asc(rate.name), asc(rate.id));

    const index = specials.findIndex((r) => r.id === rateId);
    if (index === -1) return;
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= specials.length) return;

    const a = specials[index]!;
    const b = specials[swapWith]!;
    await tx.update(rate).set({ priority: b.priority }).where(eq(rate.id, a.id));
    await tx.update(rate).set({ priority: a.priority }).where(eq(rate.id, b.id));
  });

  revalidateSettings();
}

export async function toggleLaneActive(laneId: string, currentlyActive: boolean) {
  await requireStaff();
  await db.update(lane).set({ isActive: !currentlyActive }).where(eq(lane.id, laneId));
  revalidateSettings();
}

export async function addLane() {
  await requireStaff();

  const venue = await getVenue();
  const [row] = await db
    .select({ maxNumber: max(lane.number) })
    .from(lane)
    .where(and(eq(lane.tenantId, venue.id)));

  await db.insert(lane).values({
    tenantId: venue.id,
    number: (row?.maxNumber ?? 0) + 1,
    displayName: `Lane ${(row?.maxNumber ?? 0) + 1}`,
  });
  revalidateSettings();
}

/** Errors redirect back with ?error=... (matching the hours/rate actions above)
 *  rather than silently no-opping like toggleLaneActive/addLane -- a failed password
 *  change needs to be visible, since it's the one action here with real security
 *  stakes. */
export async function changePassword(formData: FormData) {
  const user = await requireStaff();

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword.length < 8) {
    fail(PASSWORD_PATH, "New password must be at least 8 characters.");
  }
  if (newPassword !== confirmPassword) {
    fail(PASSWORD_PATH, "New password and confirmation don't match.");
  }

  const [row] = await db.select().from(staffUser).where(eq(staffUser.id, user.id));
  if (!row || !(await verifyPassword(currentPassword, row.passwordHash))) {
    fail(PASSWORD_PATH, "Current password is incorrect.");
  }

  await db.update(staffUser).set({ passwordHash: await hashPassword(newPassword) }).where(eq(staffUser.id, user.id));
  succeed(PASSWORD_PATH, "Password updated.");
}
