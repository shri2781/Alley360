"use server";

import { revalidatePath } from "next/cache";
import { cancelBooking } from "../../../../server/services/booking";
import { endBooking, startSession } from "../../../../server/services/session";
import { requireStaff } from "../../../../server/auth/dal";

export async function startBookingAction(bookingId: string) {
  await requireStaff();
  await startSession(bookingId);
  revalidatePath("/staff/bookings");
  revalidatePath("/staff");
}

export async function endBookingAction(bookingId: string) {
  await requireStaff();
  await endBooking(bookingId);
  revalidatePath("/staff/bookings");
  revalidatePath("/staff");
}

export async function cancelBookingAction(bookingId: string) {
  await requireStaff();
  await cancelBooking(bookingId);
  revalidatePath("/staff/bookings");
  revalidatePath("/staff");
}
