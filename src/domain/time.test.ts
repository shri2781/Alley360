import { describe, expect, it } from "vitest";
import { businessDate, zonedInstant } from "./time";

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
});
