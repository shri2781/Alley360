import { describe, expect, it } from "vitest";
import { addDays, daysBetween, zonedDateString, zonedInstant, zonedInstantAtMinute } from "./time";

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

describe("addDays", () => {
  it("adds whole days within a month", () => {
    expect(addDays("2026-09-10", 6)).toBe("2026-09-16");
  });

  it("rolls over a month boundary", () => {
    expect(addDays("2026-09-28", 6)).toBe("2026-10-04");
  });

  it("rolls over a year boundary", () => {
    expect(addDays("2026-12-29", 6)).toBe("2027-01-04");
  });

  it("supports subtracting days via a negative count", () => {
    expect(addDays("2026-09-10", -1)).toBe("2026-09-09");
  });
});

describe("daysBetween", () => {
  it("is the sibling of addDays -- addDays(a, daysBetween(a, b)) === b", () => {
    expect(daysBetween("2026-09-10", "2026-09-16")).toBe(6);
    expect(addDays("2026-09-10", daysBetween("2026-09-10", "2026-09-16"))).toBe("2026-09-16");
  });

  it("is negative when the second date comes first", () => {
    expect(daysBetween("2026-09-16", "2026-09-10")).toBe(-6);
  });

  it("is zero for the same date", () => {
    expect(daysBetween("2026-09-10", "2026-09-10")).toBe(0);
  });

  it("crosses a month boundary", () => {
    expect(daysBetween("2026-09-28", "2026-10-04")).toBe(6);
  });
});

describe("zonedDateString", () => {
  it("returns the venue-local calendar date, with no rollover applied", () => {
    // 04:30 UTC is 10:00 AM in Kolkata (UTC+5:30) the same day.
    expect(zonedDateString(new Date("2026-09-12T04:30:00.000Z"), "Asia/Kolkata")).toBe("2026-09-12");
  });

  it("crosses a calendar day even well before any business-hours rollover", () => {
    // 19:00 UTC on the 12th is 00:30 AM in Kolkata on the 13th -- a plain calendar
    // date, distinct from whatever business date that instant might roll onto.
    expect(zonedDateString(new Date("2026-09-12T19:00:00.000Z"), "Asia/Kolkata")).toBe("2026-09-13");
  });
});

describe("zonedInstantAtMinute", () => {
  it("agrees with zonedInstant(date, 0, tz, min)", () => {
    expect(zonedInstantAtMinute("2026-09-12", 630, "Asia/Kolkata")).toEqual(
      zonedInstant("2026-09-12", 0, "Asia/Kolkata", 630),
    );
  });

  it("normalizes minutes past 1439 into the next calendar day, like zonedInstant does for hours past 23", () => {
    // 1560 minutes = 2:00 AM the next day.
    const instant = zonedInstantAtMinute("2026-09-12", 1560, "Asia/Kolkata");
    expect(instant.toISOString()).toBe("2026-09-12T20:30:00.000Z");
  });
});
