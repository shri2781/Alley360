"use server";

import { getAvailability } from "../../../server/services/availability";
import { bookSpecificSlot, NoAvailabilityError } from "../../../server/services/booking";
import { getVenue } from "../../../server/venue";
import { zonedInstant } from "../../../domain/time";

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
  if (!Number.isInteger(input.players) || input.players < 1) return [];
  if (!Number.isInteger(input.games) || input.games < 1) return [];

  const match = /^(\d{4}-\d{2}-\d{2})$/.exec(input.dateStr);
  const timeMatch = /^(\d{1,2}):?(\d{2})?$/.exec(input.hourStr);
  if (!match || !timeMatch) return [];

  const venue = await getVenue();
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] ?? 0);
  const preferredStart = zonedInstant(input.dateStr, hour, venue.timezone, minute);

  const candidates = await getAvailability(venue, {
    players: input.players,
    games: input.games,
    preferredStart,
  });

  return candidates.map((c) => ({
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
  customerName?: string;
  customerPhone?: string;
};

export type ConfirmResult = { ok: true; bookingId: string } | { ok: false; message: string };

/** Books the EXACT slot the customer picked from findTimes()'s results -- see
 *  bookSpecificSlot()'s own comment for why this never substitutes a different time. */
export async function confirmBooking(input: ConfirmBookingInput): Promise<ConfirmResult> {
  const venue = await getVenue();

  try {
    const booking = await bookSpecificSlot(
      venue,
      {
        players: input.players,
        games: input.games,
        preferredStart: new Date(input.startIso),
        source: "web",
        customerName: input.customerName,
        customerPhone: input.customerPhone,
      },
      new Date(input.startIso),
    );
    return { ok: true, bookingId: booking.id };
  } catch (err) {
    if (err instanceof NoAvailabilityError) {
      return { ok: false, message: "That time was just taken. Please pick another." };
    }
    throw err;
  }
}
