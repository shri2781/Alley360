"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createBooking, NoAvailabilityError } from "../../../server/services/booking";
import { startSession } from "../../../server/services/session";
import { getVenue } from "../../../server/venue";

/** A walk-in is bowling now -- create the booking and start its session in one step,
 *  matching the counter flow: party arrives, staff enter size, they start playing. */
export async function addWalkIn(formData: FormData) {
  const players = Number(formData.get("players"));
  const games = Number(formData.get("games"));
  const customerName = String(formData.get("customerName") ?? "").trim() || undefined;

  if (!Number.isInteger(players) || players < 1) {
    redirect("/staff/walk-ins?error=" + encodeURIComponent("Enter a valid number of players."));
  }
  if (!Number.isInteger(games) || games < 1) {
    redirect("/staff/walk-ins?error=" + encodeURIComponent("Enter a valid number of games."));
  }

  const venue = await getVenue();

  try {
    const booking = await createBooking(venue, {
      players,
      games,
      preferredStart: new Date(),
      source: "walkin",
      customerName,
    });
    await startSession(booking.id);
  } catch (err) {
    if (err instanceof NoAvailabilityError) {
      redirect("/staff/walk-ins?error=" + encodeURIComponent("No lane is free right now for that group."));
    }
    throw err;
  }

  revalidatePath("/staff/walk-ins");
  revalidatePath("/staff/bookings");
  revalidatePath("/staff");
  redirect("/staff/walk-ins");
}
