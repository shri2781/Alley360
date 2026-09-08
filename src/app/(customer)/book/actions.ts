"use server";

import { getAvailability } from "../../../server/services/availability";
import { bookSpecificSlot, NoAvailabilityError } from "../../../server/services/booking";
import { getVenue } from "../../../server/venue";
import { zonedInstant } from "../../../domain/time";
import {
  parseBookingStart,
  parseCustomerSearchDate,
  parseCustomerSearchTime,
  validateBookingRequest,
  validateCustomerName,
  validateCustomerPhone,
} from "../../../domain/bookingInput";

export type FindTimesInput = {
  players: number;
  games: number;
  dateStr: string; // "YYYY-MM-DD"
  hourStr: string; // "HH" or "HH:MM", the customer's rough preferred time
};

export type TimeOption = { startIso: string; label: string };

/** Finds real available times near what was asked for, pulled from the live schedule
 *  via M3's scheduler (getAvailability) -- never a fixed, decorative time grid. */
export async function findTimes(input: FindTimesInput): Promise<TimeOption[]> {
  if (validateBookingRequest(input.players, input.games)) return [];
  if (!parseCustomerSearchDate(input.dateStr)) return [];
  const preferredTime = parseCustomerSearchTime(input.hourStr);
  if (!preferredTime) return [];

  const venue = await getVenue();
  const preferredStart = zonedInstant(input.dateStr, preferredTime.hour, venue.timezone, preferredTime.minute);

  const candidates = await getAvailability(venue, {
    players: input.players,
    games: input.games,
    preferredStart,
  });

  // getAvailability ranks by tightest lane-packing first, not by time -- reorder
  // chronologically for display, so the customer reads a normal, sorted list of times.
  const sorted = [...candidates].sort((a, b) => a.start.getTime() - b.start.getTime());

  return sorted.map((c) => ({
    startIso: c.start.toISOString(),
    label: new Intl.DateTimeFormat("en-US", {
      timeZone: venue.timezone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(c.start),
  }));
}

export type ConfirmBookingInput = {
  players: number;
  games: number;
  startIso: string;
  customerName: string;
  customerPhone: string;
};

export type ConfirmResult = { ok: true; bookingId: string } | { ok: false; message: string };

/** Books the EXACT slot the customer picked from findTimes()'s results -- see
 *  bookSpecificSlot()'s own comment for why this never substitutes a different time. */
export async function confirmBooking(input: ConfirmBookingInput): Promise<ConfirmResult> {
  const customerName = input.customerName.trim();
  const customerPhone = input.customerPhone.trim();
  const requestError = validateBookingRequest(input.players, input.games);
  const nameError = validateCustomerName(customerName);
  const phoneError = validateCustomerPhone(customerPhone);
  const start = parseBookingStart(input.startIso);

  if (requestError) return { ok: false, message: requestError };
  if (nameError) return { ok: false, message: nameError };
  if (phoneError) return { ok: false, message: phoneError };
  if (!start) return { ok: false, message: "Choose a valid booking time." };

  const venue = await getVenue();

  try {
    const booking = await bookSpecificSlot(
      venue,
      {
        players: input.players,
        games: input.games,
        preferredStart: start,
        source: "web",
        customerName,
        customerPhone,
      },
      start,
    );
    return { ok: true, bookingId: booking.id };
  } catch (err) {
    if (err instanceof NoAvailabilityError) {
      return { ok: false, message: "That time was just taken. Please pick another." };
    }
    throw err;
  }
}
