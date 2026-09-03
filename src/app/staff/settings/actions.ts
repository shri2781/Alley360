"use server";

import { revalidatePath } from "next/cache";
import { and, eq, max } from "drizzle-orm";
import { db } from "../../../db/client";
import { lane, pkg } from "../../../db/schema";
import { getVenue } from "../../../server/venue";

function revalidateSettings() {
  revalidatePath("/staff/settings");
  revalidatePath("/"); // packages shown on the customer landing page
  revalidatePath("/book");
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
