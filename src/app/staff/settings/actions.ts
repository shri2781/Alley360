"use server";

import { revalidatePath } from "next/cache";
import { and, eq, max } from "drizzle-orm";
import { db } from "../../../db/client";
import { lane, pkg, tenant } from "../../../db/schema";
import { getVenue } from "../../../server/venue";

function revalidateSettings() {
  revalidatePath("/staff/settings");
  revalidatePath("/"); // packages shown on the customer landing page
  revalidatePath("/book");
  revalidatePath("/staff"); // timeline window depends on venue hours
  revalidatePath("/staff/bookings");
}

export async function updateVenueHours(formData: FormData) {
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
  await db.update(pkg).set({ isActive: !currentlyActive }).where(eq(pkg.id, packageId));
  revalidateSettings();
}

export async function addPackage(formData: FormData) {
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
  await db.update(lane).set({ isActive: !currentlyActive }).where(eq(lane.id, laneId));
  revalidateSettings();
}

export async function addLane() {
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
