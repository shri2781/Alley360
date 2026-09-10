/**
 * Validation rules shared by the customer booking action and its tests. Browser
 * constraints are useful feedback, but callers can bypass them, so these rules run
 * at the server boundary too.
 */
import { addDays } from "./time";

export const MAX_BOOKING_PLAYERS = 24;
export const MAX_BOOKING_GAMES = 10;
export const MAX_CUSTOMER_NAME_LENGTH = 80;

// Customers can only book within a rolling week: today through six days out. E.g. on
// a Monday that's this coming Sunday; on a Tuesday it's next Monday.
export const BOOKING_WINDOW_DAYS = 7;

// Supports ordinary international names while keeping emoji, markup, digits, and
// control characters out of a value that is shown back to staff and customers.
const CUSTOMER_NAME_PATTERN = /^[\p{L}\p{M}]+(?:[ '\-’][\p{L}\p{M}]+)*$/u;
const PHONE_PATTERN = /^\d{10}$/;

export function validateBookingRequest(players: number, games: number): string | null {
  if (!Number.isInteger(players) || players < 1 || players > MAX_BOOKING_PLAYERS) {
    return `Enter a whole number of players between 1 and ${MAX_BOOKING_PLAYERS}.`;
  }
  if (!Number.isInteger(games) || games < 1 || games > MAX_BOOKING_GAMES) {
    return `Choose between 1 and ${MAX_BOOKING_GAMES} games.`;
  }
  return null;
}

export function validateCustomerName(name: string): string | null {
  if (!name) return "Name is required.";
  if (name.length > MAX_CUSTOMER_NAME_LENGTH || !CUSTOMER_NAME_PATTERN.test(name)) {
    return "Enter a valid name using letters, spaces, apostrophes, or hyphens.";
  }
  return null;
}

export function validateCustomerPhone(phone: string): string | null {
  return PHONE_PATTERN.test(phone) ? null : "Enter a valid 10-digit phone number.";
}

export function parseBookingStart(startIso: string): Date | null {
  const start = new Date(startIso);
  return Number.isNaN(start.getTime()) ? null : start;
}

export function parseCustomerSearchDate(dateStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [year, month, day] = dateStr.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
}

export function parseCustomerSearchTime(hourStr: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):?(\d{2})?$/.exec(hourStr);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : null;
}

/** Whether `dateStr` falls within the rolling booking window that starts on
 *  `todayStr` (both 'YYYY-MM-DD' business dates). Plain string comparison is valid
 *  here because ISO date strings sort lexicographically in calendar order. */
export function isWithinBookingWindow(dateStr: string, todayStr: string): boolean {
  return dateStr >= todayStr && dateStr <= addDays(todayStr, BOOKING_WINDOW_DAYS - 1);
}
