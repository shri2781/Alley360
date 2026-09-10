"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, max } from "drizzle-orm";
import { db } from "../../../../db/client";
import { lane, pkg, staffUser, tenant } from "../../../../db/schema";
import { getVenue } from "../../../../server/venue";
import { requireStaff } from "../../../../server/auth/dal";
import { hashPassword, verifyPassword } from "../../../../server/auth/password";

function revalidateSettings() {
  revalidatePath("/staff/settings");
  revalidatePath("/"); // packages shown on the customer landing page
  revalidatePath("/book");
  revalidatePath("/staff"); // timeline window depends on venue hours
}

export async function updateVenueHours(formData: FormData) {
  await requireStaff();

  const opensAtHour = Number(formData.get("opensAtHour"));
  const closesRaw = Number(formData.get("closesAtHour"));

  const inputValid =
    Number.isInteger(opensAtHour) &&
    opensAtHour >= 0 &&
    opensAtHour <= 23 &&
    Number.isInteger(closesRaw) &&
    closesRaw >= 0 &&
    closesRaw <= 23;

  if (!inputValid) return;

  // A closing hour earlier on the clock than opening means the alley runs past
  // midnight -- e.g. opens 10, closes 4 is a 10am-4am alley, stored as closes_at_hour
  // = 28. Equal hours means open the full 24.
  const closesAtHour = closesRaw <= opensAtHour ? closesRaw + 24 : closesRaw;

  const venue = await getVenue();
  await db.update(tenant).set({ opensAtHour, closesAtHour }).where(eq(tenant.id, venue.id));
  revalidateSettings();
}

export async function updatePackage(packageId: string, formData: FormData) {
  await requireStaff();

  const name = String(formData.get("name") ?? "").trim();
  const games = Number(formData.get("games"));
  const pricePerPerson = Number(formData.get("pricePerPerson"));

  if (!name || !Number.isInteger(games) || games < 1 || !Number.isInteger(pricePerPerson) || pricePerPerson < 0) {
    return;
  }

  await db.update(pkg).set({ name, games, pricePerPerson }).where(eq(pkg.id, packageId));
  revalidateSettings();
}

export async function togglePackageActive(packageId: string, currentlyActive: boolean) {
  await requireStaff();
  await db.update(pkg).set({ isActive: !currentlyActive }).where(eq(pkg.id, packageId));
  revalidateSettings();
}

export async function addPackage(formData: FormData) {
  await requireStaff();

  const name = String(formData.get("name") ?? "").trim();
  const games = Number(formData.get("games"));
  const pricePerPerson = Number(formData.get("pricePerPerson"));

  if (!name || !Number.isInteger(games) || games < 1 || !Number.isInteger(pricePerPerson) || pricePerPerson < 0) {
    return;
  }

  const venue = await getVenue();
  const [row] = await db
    .select({ maxSort: max(pkg.sortOrder) })
    .from(pkg)
    .where(eq(pkg.tenantId, venue.id));

  await db.insert(pkg).values({
    tenantId: venue.id,
    name,
    games,
    pricePerPerson,
    sortOrder: (row?.maxSort ?? 0) + 1,
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

/** Errors redirect back with ?error=... (matching addWalkIn's convention, the one
 *  other place in the console that surfaces a failure) rather than silently
 *  no-opping like the settings actions above -- a failed password change needs
 *  to be visible, since it's the one action here with real security stakes. */
export async function changePassword(formData: FormData) {
  const user = await requireStaff();

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const fail = (message: string) => redirect("/staff/settings?error=" + encodeURIComponent(message));

  if (newPassword.length < 8) {
    fail("New password must be at least 8 characters.");
  }
  if (newPassword !== confirmPassword) {
    fail("New password and confirmation don't match.");
  }

  const [row] = await db.select().from(staffUser).where(eq(staffUser.id, user.id));
  if (!row || !(await verifyPassword(currentPassword, row.passwordHash))) {
    fail("Current password is incorrect.");
  }

  await db.update(staffUser).set({ passwordHash: await hashPassword(newPassword) }).where(eq(staffUser.id, user.id));
  redirect("/staff/settings?success=" + encodeURIComponent("Password updated."));
}
