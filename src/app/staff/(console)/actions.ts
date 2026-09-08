"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  moveAllocation,
  moveFailureMessage,
  MoveRejectedError,
  type MoveAllocationInput,
} from "../../../server/services/allocation";
import { createBooking, NoAvailabilityError } from "../../../server/services/booking";
import { startSession } from "../../../server/services/session";
import { getVenue } from "../../../server/venue";
import { getStaffUser, requireStaff } from "../../../server/auth/dal";
import { validateCustomerName } from "../../../domain/bookingInput";

/** A walk-in is bowling now -- create the booking and start its session in one step,
 *  matching the counter flow: party arrives, staff enter size, they start playing. */
export async function addWalkIn(formData: FormData) {
  // The real boundary -- see the comment on StaffLayout for why the page gate
  // alone isn't enough. redirect()'s throw is fine here; it's outside any try.
  await requireStaff();

  const players = Number(formData.get("players"));
  const games = Number(formData.get("games"));
  const customerName = String(formData.get("customerName") ?? "").trim();

  if (!Number.isInteger(players) || players < 1) {
    redirect("/staff?error=" + encodeURIComponent("Enter a valid number of players."));
  }
  if (!Number.isInteger(games) || games < 1) {
    redirect("/staff?error=" + encodeURIComponent("Enter a valid number of games."));
  }
  const customerNameError = validateCustomerName(customerName);
  if (customerNameError) {
    redirect("/staff?error=" + encodeURIComponent(customerNameError));
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
      redirect("/staff?error=" + encodeURIComponent("No lane is free right now for that group."));
    }
    throw err;
  }

  revalidatePath("/staff/bookings");
  revalidatePath("/staff");
  redirect("/staff");
}

/**
 * Staff dragged a block on the timeline. Returns a result rather than throwing: the
 * caller is a pointer handler, not a <form>, so there is no error boundary to catch a
 * throw and nothing sensible to redirect to mid-drag. Anything that isn't a rejection
 * we understand still throws, so real bugs stay loud.
 */
export async function moveAllocationAction(
  input: MoveAllocationInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // getStaffUser(), not requireStaff(): this is an RPC from a pointer handler
  // mid-drag, not a <form> -- there's no error boundary to catch a redirect's
  // throw, so an expired session must come back as a typed failure instead.
  if (!(await getStaffUser())) {
    return { ok: false, message: "Session expired. Please sign in again." };
  }

  const venue = await getVenue();

  try {
    await moveAllocation(venue, input);
  } catch (err) {
    if (err instanceof MoveRejectedError) {
      return { ok: false, message: moveFailureMessage(err.reason) };
    }
    throw err;
  }

  revalidatePath("/staff");
  revalidatePath("/staff/bookings");
  return { ok: true };
}
