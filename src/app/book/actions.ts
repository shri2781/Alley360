"use server";

import { redirect } from "next/navigation";
import { db } from "../../db/client";
import { tenant } from "../../db/schema";
import { zonedInstant } from "../../domain/time";
import {
  BookingConflictError,
  createBooking,
  NoAvailabilityError,
} from "../../server/services/booking";
import type { Venue } from "../../server/services/availability";

/**
 * Handles the booking form submission. No candidate picker -- this hands the request
 * straight to createBooking(), which already picks the best available slot on its own
 * (same one-shot path the walk-in flow uses). Showing a few ranked options to choose
 * from is a real improvement, deliberately left for later rather than built today.
 */
export async function submitBooking(formData: FormData) {
  const [venueRow] = await db.select().from(tenant).limit(1);
  if (!venueRow) {
    redirect("/book?error=" + encodeURIComponent("No venue configured."));
  }
  const venue: Venue = venueRow;

  const players = Number(formData.get("players"));
  const games = Number(formData.get("games"));
  const preferredLocal = String(formData.get("preferredStart") ?? "");
  const customerName = String(formData.get("customerName") ?? "").trim() || undefined;
  const customerPhone = String(formData.get("customerPhone") ?? "").trim() || undefined;

  if (!Number.isInteger(players) || players < 1) {
    redirect("/book?error=" + encodeURIComponent("Enter a valid number of players."));
  }
  if (!Number.isInteger(games) || games < 1) {
    redirect("/book?error=" + encodeURIComponent("Enter a valid number of games."));
  }

  // <input type="datetime-local"> gives "YYYY-MM-DDTHH:mm" with no timezone info.
  // Those numbers are interpreted as venue-local wall-clock time -- not the browser's
  // own timezone, which the server has no reliable way to know anyway.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(preferredLocal);
  if (!match) {
    redirect("/book?error=" + encodeURIComponent("Enter a valid date and time."));
  }
  const [, businessDateStr, hourStr, minuteStr] = match as unknown as [string, string, string, string];
  const preferredStart = zonedInstant(businessDateStr!, Number(hourStr), venue.timezone, Number(minuteStr));

  try {
    const booking = await createBooking(venue, {
      players,
      games,
      preferredStart,
      source: "phone",
      customerName,
      customerPhone,
    });
    redirect(`/book/confirmed?id=${booking.id}`);
  } catch (err) {
    if (err instanceof NoAvailabilityError) {
      redirect("/book?error=" + encodeURIComponent("No lanes available anywhere near that time -- try another."));
    }
    if (err instanceof BookingConflictError) {
      redirect("/book?error=" + encodeURIComponent("That slot was just taken. Please try again."));
    }
    throw err;
  }
}
