import { describe, expect, it } from "vitest";
import { businessDate, rolloverHour, zonedInstant } from "./time";

describe("zonedInstant", () => {
  it("handles a half-hour-offset zone (India, UTC+5:30)", () => {
    // 10:00 AM in Kolkata is 04:30 UTC the same day.
    const instant = zonedInstant("2026-09-12", 10, "Asia/Kolkata");
    expect(instant.toISOString()).toBe("2026-09-12T04:30:00.000Z");
  });

  it("handles a whole-hour-offset zone outside any DST transition (New York, winter)", () => {
    // EST is UTC-5 in January. 10:00 AM local -> 15:00 UTC.
    const instant = zonedInstant("2026-01-15", 10, "America/New_York");
    expect(instant.toISOString()).toBe("2026-01-15T15:00:00.000Z");
  });

  it("handles UTC itself", () => {
    const instant = zonedInstant("2026-09-12", 22, "UTC");
    expect(instant.toISOString()).toBe("2026-09-12T22:00:00.000Z");
  });

  it("round-trips through businessDate for a mid-day hour", () => {
    const instant = zonedInstant("2026-09-12", 14, "Asia/Kolkata");
    expect(businessDate(instant, "Asia/Kolkata", 4)).toBe("2026-09-12");
  });

  it("defaults minute to 0 when omitted", () => {
    expect(zonedInstant("2026-09-12", 10, "Asia/Kolkata")).toEqual(
      zonedInstant("2026-09-12", 10, "Asia/Kolkata", 0),
    );
  });

  it("preserves an arbitrary minute, not just whole hours", () => {
    // 7:45 PM in Kolkata (UTC+5:30) is 14:15 UTC the same day.
    const instant = zonedInstant("2026-09-12", 19, "Asia/Kolkata", 45);
    expect(instant.toISOString()).toBe("2026-09-12T14:15:00.000Z");
  });

  it("normalizes an hour past 23 into the next calendar day", () => {
    // A venue closing at 4am is stored as hour 28. 4:00 AM in Kolkata on the 13th
    // is 22:30 UTC on the 12th.
    const instant = zonedInstant("2026-09-12", 28, "Asia/Kolkata");
    expect(instant.toISOString()).toBe("2026-09-12T22:30:00.000Z");
  });
});

describe("rolloverHour", () => {
  it("is 0 for a venue that closes by midnight", () => {
    expect(rolloverHour(22)).toBe(0);
    expect(rolloverHour(24)).toBe(0);
  });

  it("is the wall-clock closing hour for a venue that closes past midnight", () => {
    expect(rolloverHour(28)).toBe(4);
  });
});

describe("businessDate", () => {
  it("counts a post-midnight, pre-rollover session toward the previous day", () => {
    // 00:30 and 03:59 Kolkata on the 13th both belong to the 12th when rollover is 4am.
    const halfPastMidnight = zonedInstant("2026-09-13", 0, "Asia/Kolkata", 30);
    const justBeforeRollover = zonedInstant("2026-09-13", 3, "Asia/Kolkata", 59);
    expect(businessDate(halfPastMidnight, "Asia/Kolkata", 4)).toBe("2026-09-12");
    expect(businessDate(justBeforeRollover, "Asia/Kolkata", 4)).toBe("2026-09-12");
  });

  it("counts a session at or after rollover toward the current day", () => {
    const atRollover = zonedInstant("2026-09-13", 4, "Asia/Kolkata", 30);
    expect(businessDate(atRollover, "Asia/Kolkata", 4)).toBe("2026-09-13");
  });
});
