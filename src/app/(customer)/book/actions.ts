"use server";

import { getAvailability } from "../../../server/services/availability";
import { bookSpecificSlot, NoAvailabilityError, VenueClosedError } from "../../../server/services/booking";
import { getRateSchedule } from "../../../server/rates";
import { getVenue } from "../../../server/venue";
import { businessDateFor, hoursForDate, offsetMinutes } from "../../../domain/hours";
import { priceFor, resolveRate } from "../../../domain/rates";
import { zonedInstant } from "../../../domain/time";
import {
  isWithinBookingWindow,
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

export type TimeOption = {
  startIso: string;
  label: string;
  rateName: string;
  pricePerPerson: number;
  totalPrice: number;
};

export type FindTimesResult =
  | { status: "invalid" }
  | { status: "closed"; businessDate: string }
  | { status: "ok"; times: TimeOption[] };

/** Finds real available times near what was asked for, pulled from the live schedule
 *  via M3's scheduler (getAvailability) -- never a fixed, decorative time grid. Each
 *  time comes back priced: the rate that applies depends on when the session starts,
 *  so a customer can see a Happy Hours slot is cheaper before they pick it. */
export async function findTimes(input: FindTimesInput): Promise<FindTimesResult> {
  // All validation runs before getVenue() -- this is what lets actions.test.ts cover
  // the invalid-input cases without a database.
  if (validateBookingRequest(input.players, input.games)) return { status: "invalid" };
  if (!parseCustomerSearchDate(input.dateStr)) return { status: "invalid" };
  const preferredTime = parseCustomerSearchTime(input.hourStr);
  if (!preferredTime) return { status: "invalid" };

  const venue = await getVenue();
  const today = businessDateFor(new Date(), venue.timezone, venue.weeklyHours);
  if (!isWithinBookingWindow(input.dateStr, today)) return { status: "invalid" };

  const preferredStart = zonedInstant(input.dateStr, preferredTime.hour, venue.timezone, preferredTime.minute);

  const availability = await getAvailability(venue, {
    players: input.players,
    games: input.games,
    preferredStart,
  });

  if (availability.status === "closed") {
    return { status: "closed", businessDate: availability.businessDate };
  }

  // getAvailability ranks by tightest lane-packing first, not by time -- reorder
  // chronologically for display, so the customer reads a normal, sorted list of times.
  const sorted = [...availability.candidates].sort((a, b) => a.start.getTime() - b.start.getTime());

  const schedule = await getRateSchedule(venue.id);
  const times: TimeOption[] = sorted.map((c) => {
    // Each candidate is priced independently: two times 20 minutes apart can straddle
    // a Happy Hours boundary and land on different rates.
    const bDate = businessDateFor(c.start, venue.timezone, venue.weeklyHours);
    const day = hoursForDate(venue.weeklyHours, bDate);
    const offset = offsetMinutes(c.start, venue.timezone, bDate);
    const rate = resolveRate(schedule, day, offset);

    return {
      startIso: c.start.toISOString(),
      label: new Intl.DateTimeFormat("en-US", {
        timeZone: venue.timezone,
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      }).format(c.start),
      rateName: rate.name,
      pricePerPerson: rate.pricePerPerson,
      totalPrice: priceFor(rate, input.players, input.games),
    };
  });

  return { status: "ok", times };
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
 *  bookSpecificSlot()'s own comment for why this never substitutes a different time.
 *  The price is recomputed here from the confirmed start, server-side -- the price
 *  findTimes() showed is never trusted as input. */
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
  const today = businessDateFor(new Date(), venue.timezone, venue.weeklyHours);
  const bookingDate = businessDateFor(start, venue.timezone, venue.weeklyHours);
  if (!isWithinBookingWindow(bookingDate, today)) {
    return { ok: false, message: "That date is outside the booking window. Please search again." };
  }

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
    if (err instanceof VenueClosedError) {
      return { ok: false, message: "The alley is closed at that time. Please pick another." };
    }
    throw err;
  }
}
