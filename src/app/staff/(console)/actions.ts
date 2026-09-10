"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { booking } from "../../../db/schema";
import {
  moveAllocation,
  moveFailureMessage,
  MoveRejectedError,
  type MoveAllocationInput,
} from "../../../server/services/allocation";
import { cancelBooking, createBooking, NoAvailabilityError } from "../../../server/services/booking";
import { endBooking, startSession } from "../../../server/services/session";
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
    // `created`, not `booking`: that name is the schema table in this module now.
    const created = await createBooking(venue, {
      players,
      games,
      preferredStart: new Date(),
      source: "walkin",
      customerName,
    });
    await startSession(created.id);
  } catch (err) {
    if (err instanceof NoAvailabilityError) {
      redirect("/staff?error=" + encodeURIComponent("No lane is free right now for that group."));
    }
    throw err;
  }

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
  return { ok: true };
}

export type BlockActionResult = { ok: true } | { ok: false; message: string };

type BookingStatus = "confirmed" | "active" | "completed" | "cancelled" | "no_show";

/**
 * Start / End / Cancel driven from the timeline's block popover.
 *
 * Returns a result for the same reason moveAllocationAction does: the caller is a button
 * inside a client component with its own error slot, not a <form> with an error boundary
 * above it, so a redirect's throw would have nowhere to land.
 *
 * The status re-read is what makes that possible. The board polls every 10 seconds, so a
 * popover can be clicked against a booking that has since moved on -- without the check,
 * startSession/endBooking would throw a bare Error and blow up the page for what is a
 * routine stale-view click. Checking here (rather than catching) keeps a real bug loud:
 * anything the services throw after the precondition held still propagates.
 */
async function runBlockAction(
  bookingId: string,
  allowed: BookingStatus[],
  work: () => Promise<unknown>,
): Promise<BlockActionResult> {
  if (!(await getStaffUser())) {
    return { ok: false, message: "Session expired. Please sign in again." };
  }

  const [row] = await db.select({ status: booking.status }).from(booking).where(eq(booking.id, bookingId));
  if (!row) return { ok: false, message: "That booking no longer exists." };
  if (!allowed.includes(row.status)) {
    return { ok: false, message: `That booking is ${row.status.replace("_", " ")} now -- the board is out of date.` };
  }

  await work();

  revalidatePath("/staff");
  return { ok: true };
}

// `async`, not a plain function returning the promise: every export of a "use server"
// file is compiled into a server action, and Next only accepts async functions there.
export async function startBookingAction(bookingId: string): Promise<BlockActionResult> {
  return runBlockAction(bookingId, ["confirmed"], () => startSession(bookingId));
}

export async function endBookingAction(bookingId: string): Promise<BlockActionResult> {
  return runBlockAction(bookingId, ["active"], () => endBooking(bookingId));
}

export async function cancelBookingAction(bookingId: string): Promise<BlockActionResult> {
  return runBlockAction(bookingId, ["confirmed"], () => cancelBooking(bookingId));
}
