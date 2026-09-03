"use server";

import { revalidatePath } from "next/cache";
import { cancelBooking } from "../../../server/services/booking";
import { endBooking, startSession } from "../../../server/services/session";

export async function startBookingAction(bookingId: string) {
  await startSession(bookingId);
  revalidatePath("/staff/bookings");
  revalidatePath("/staff");
}

export async function endBookingAction(bookingId: string) {
  await endBooking(bookingId);
  revalidatePath("/staff/bookings");
  revalidatePath("/staff");
}

export async function cancelBookingAction(bookingId: string) {
  await cancelBooking(bookingId);
  revalidatePath("/staff/bookings");
  revalidatePath("/staff");
}
