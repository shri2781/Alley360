import { describe, expect, it } from "vitest";
import {
  MAX_CUSTOMER_NAME_LENGTH,
  parseBookingStart,
  parseCustomerSearchDate,
  parseCustomerSearchTime,
  validateBookingRequest,
  validateCustomerName,
  validateCustomerPhone,
} from "./bookingInput";

describe("[unit][validation] customer booking input", () => {
  it("accepts ordinary international customer names", () => {
    expect(validateCustomerName("Aarav Singh")).toBeNull();
    expect(validateCustomerName("Élodie D'Souza")).toBeNull();
    expect(validateCustomerName("O’Connor")).toBeNull();
    expect(validateCustomerName("Anne-Marie")).toBeNull();
  });

  it("rejects emoji, markup, numbers, blank names, and oversized names", () => {
    for (const name of ["", "   ", "Riya 🎳", "<script>alert(1)</script>", "Lane 7", "A".repeat(MAX_CUSTOMER_NAME_LENGTH + 1)]) {
      expect(validateCustomerName(name.trim())).not.toBeNull();
    }
  });

  it("rejects direct requests with impossible party sizes or game counts", () => {
    for (const [players, games] of [
      [0, 1],
      [1.5, 1],
      [25, 1],
      [4, 0],
      [4, 1.5],
    ] as const) {
      expect(validateBookingRequest(players, games)).not.toBeNull();
    }
    expect(validateBookingRequest(24, 1)).toBeNull();
  });

  it("requires an exact ten-digit phone number", () => {
    for (const phone of ["987654321", "98765432101", "+919876543210", "98765 43210", "abcdefghij"]) {
      expect(validateCustomerPhone(phone)).not.toBeNull();
    }
    expect(validateCustomerPhone("9876543210")).toBeNull();
  });

  it("rejects malformed calendar dates, times, and booking timestamps", () => {
    for (const date of ["2026-02-29", "2026-13-01", "2026-09-32", "09/12/2026"]) {
      expect(parseCustomerSearchDate(date)).toBeNull();
    }
    for (const time of ["24:00", "19:60", "hello"]) {
      expect(parseCustomerSearchTime(time)).toBeNull();
    }
    expect(parseBookingStart("not-a-date")).toBeNull();
    expect(parseBookingStart("2026-09-12T14:00:00.000Z")).not.toBeNull();
  });
});
