import { describe, expect, it } from "vitest";
import {
  businessDateFor,
  dayAt,
  dayOfWeek,
  formatDayList,
  formatMinuteOfDay,
  formatWeekSummary,
  offsetMinutes,
  summarizeWeek,
  validateWeeklyHours,
  venueWindow,
  type DayHours,
  type WeeklyHours,
} from "./hours";
import { zonedInstant } from "./time";

/** Builds a full WeeklyHours from partial per-day overrides (indexed 0=Sun..6=Sat),
 *  defaulting every day to open 10:00 (600) - 22:00 (1320). */
function weekly(overrides: Partial<Record<number, Partial<DayHours>>> = {}): WeeklyHours {
  const days = Array.from({ length: 7 }, (_, dow) => ({
    dayOfWeek: dow,
    isClosed: false,
    opensAtMin: 600,
    closesAtMin: 1320,
    ...overrides[dow],
  }));
  return days as unknown as WeeklyHours;
}

describe("dayOfWeek", () => {
  it("matches JS getUTCDay for known dates", () => {
    expect(dayOfWeek("2026-09-12")).toBe(6); // Saturday
    expect(dayOfWeek("2026-09-13")).toBe(0); // Sunday
    expect(dayOfWeek("2026-09-14")).toBe(1); // Monday
  });
});

describe("businessDateFor", () => {
  it("counts a post-midnight session toward the previous day when it closes past midnight", () => {
    const w = weekly({ 6: { closesAtMin: 1560 } }); // Saturday closes 2am Sunday
    const instant = zonedInstant("2026-09-13", 1, "Asia/Kolkata"); // 1am Sunday
    expect(businessDateFor(instant, "Asia/Kolkata", w)).toBe("2026-09-12");
  });

  it("does not roll over when the previous day is closed", () => {
    const w = weekly({ 6: { isClosed: true } }); // Saturday closed
    const instant = zonedInstant("2026-09-13", 1, "Asia/Kolkata"); // 1am Sunday
    expect(businessDateFor(instant, "Asia/Kolkata", w)).toBe("2026-09-13");
  });

  it("rolls over up to, but not including, the close minute (half-open)", () => {
    const w = weekly({ 6: { closesAtMin: 1560 } }); // Saturday closes 2am Sunday
    const justBefore = zonedInstant("2026-09-13", 1, "Asia/Kolkata", 59);
    const atClose = zonedInstant("2026-09-13", 2, "Asia/Kolkata", 0);
    expect(businessDateFor(justBefore, "Asia/Kolkata", w)).toBe("2026-09-12");
    expect(businessDateFor(atClose, "Asia/Kolkata", w)).toBe("2026-09-13");
  });

  it("never rolls over late in the evening, regardless of hours", () => {
    const w = weekly();
    const lateEvening = zonedInstant("2026-09-12", 23, "Asia/Kolkata", 59);
    expect(businessDateFor(lateEvening, "Asia/Kolkata", w)).toBe("2026-09-12");
  });

  it("depends on the PREVIOUS day's own close, not a shared global value", () => {
    // Friday closes 2am Saturday (1560); Saturday closes by 11pm same day (1380, i.e. no rollover).
    const w = weekly({ 5: { closesAtMin: 1560 }, 6: { closesAtMin: 1380 } });
    const oneAmSaturday = zonedInstant("2026-09-12", 1, "Asia/Kolkata"); // rolls back to Friday
    const oneAmSunday = zonedInstant("2026-09-13", 1, "Asia/Kolkata"); // Saturday didn't run past midnight -> stays Sunday
    expect(businessDateFor(oneAmSaturday, "Asia/Kolkata", w)).toBe("2026-09-11"); // Friday
    expect(businessDateFor(oneAmSunday, "Asia/Kolkata", w)).toBe("2026-09-13"); // Sunday
  });
});

describe("offsetMinutes", () => {
  it("returns the wall-clock minute-of-day when the instant is on the business date itself", () => {
    const instant = zonedInstant("2026-09-12", 10, "Asia/Kolkata", 30);
    expect(offsetMinutes(instant, "Asia/Kolkata", "2026-09-12")).toBe(630);
  });

  it("adds 1440 for an instant on the calendar day after the business date", () => {
    const instant = zonedInstant("2026-09-13", 1, "Asia/Kolkata"); // 1am, belongs to Saturday's board
    expect(offsetMinutes(instant, "Asia/Kolkata", "2026-09-12")).toBe(1500);
  });

  it("is DST-safe: 10:00 AM local is 600 on both US transition days, not the naive elapsed-time answer", () => {
    const tz = "America/New_York";
    const springForward = zonedInstant("2026-03-08", 10, tz);
    const fallBack = zonedInstant("2026-11-01", 10, tz);
    // A naive `minutesBetween(midnight, 10am)` gives 540 on the spring-forward day and
    // 660 on the fall-back day -- an hour off both ways. offsetMinutes must not do that.
    expect(offsetMinutes(springForward, tz, "2026-03-08")).toBe(600);
    expect(offsetMinutes(fallBack, tz, "2026-11-01")).toBe(600);
  });
});

describe("venueWindow", () => {
  it("returns the open/close instants for an open day", () => {
    const w = weekly({ 6: { opensAtMin: 600, closesAtMin: 1560 } });
    const window = venueWindow("2026-09-12", "Asia/Kolkata", w);
    expect(window?.openAt.toISOString()).toBe("2026-09-12T04:30:00.000Z");
    expect(window?.closeAt.toISOString()).toBe("2026-09-12T20:30:00.000Z");
  });

  it("returns null for a closed day", () => {
    const w = weekly({ 0: { isClosed: true } });
    expect(venueWindow("2026-09-13", "Asia/Kolkata", w)).toBeNull();
  });
});

describe("formatMinuteOfDay", () => {
  it("formats key minute-of-day values", () => {
    expect(formatMinuteOfDay(0)).toBe("12:00 AM");
    expect(formatMinuteOfDay(630)).toBe("10:30 AM");
    expect(formatMinuteOfDay(720)).toBe("12:00 PM");
    expect(formatMinuteOfDay(1440)).toBe("12:00 AM");
    expect(formatMinuteOfDay(1560)).toBe("2:00 AM");
  });
});

describe("summarizeWeek / formatWeekSummary", () => {
  it("collapses an identical week into one Mon-Sun run", () => {
    const runs = summarizeWeek(weekly());
    expect(runs.map((r) => r.label)).toEqual(["Mon–Sun 10:00 AM – 10:00 PM"]);
  });

  it("produces three runs in Monday-first order for Mon-Thu / Fri-Sat / Sun-closed", () => {
    const w = weekly({
      5: { closesAtMin: 1560 }, // Fri
      6: { closesAtMin: 1560 }, // Sat
      0: { isClosed: true }, // Sun
    });
    const runs = summarizeWeek(w);
    expect(runs.map((r) => r.label)).toEqual([
      "Mon–Thu 10:00 AM – 10:00 PM",
      "Fri–Sat 10:00 AM – 2:00 AM",
      "Sun Closed",
    ]);
  });

  it("does not wrap Saturday+Sunday into a Sat-Mon run even when they match each other", () => {
    const w = weekly({ 6: { opensAtMin: 660 }, 0: { opensAtMin: 660 } }); // Sat & Sun both 11am open
    const runs = summarizeWeek(w);
    // Mon-Fri run first, then Sat-Sun -- never merging across the wrap.
    expect(runs.map((r) => r.label)).toEqual(["Mon–Fri 10:00 AM – 10:00 PM", "Sat–Sun 11:00 AM – 10:00 PM"]);
  });

  it("renders a single odd day without a dash", () => {
    const w = weekly({ 3: { closesAtMin: 1380 } }); // Wednesday alone differs
    const runs = summarizeWeek(w);
    expect(runs.map((r) => r.label)).toEqual([
      "Mon–Tue 10:00 AM – 10:00 PM",
      "Wed 10:00 AM – 11:00 PM",
      "Thu–Sun 10:00 AM – 10:00 PM",
    ]);
  });

  it("joins runs with a middle dot for the caption", () => {
    const w = weekly({ 0: { isClosed: true } });
    expect(formatWeekSummary(w)).toBe("Mon–Sat 10:00 AM – 10:00 PM · Sun Closed");
  });
});

describe("dayAt", () => {
  it("returns the day at the given index", () => {
    const w = weekly({ 3: { isClosed: true } });
    expect(dayAt(w, 3).isClosed).toBe(true);
    expect(dayAt(w, 0).dayOfWeek).toBe(0);
  });
});

describe("formatDayList", () => {
  it("collapses a consecutive weekday run", () => {
    expect(formatDayList([1, 2, 3, 4, 5])).toBe("Mon–Fri");
  });

  it("collapses Saturday+Sunday, which are adjacent in display order despite wrapping", () => {
    expect(formatDayList([0, 6])).toBe("Sat–Sun");
  });

  it("lists non-consecutive days individually", () => {
    expect(formatDayList([1, 3])).toBe("Mon, Wed");
  });

  it("renders a single day without a dash", () => {
    expect(formatDayList([6])).toBe("Sat");
  });
});

describe("validateWeeklyHours", () => {
  it("flags a day opening before the previous day finishes closing", () => {
    const w = weekly({ 6: { closesAtMin: 1560 }, 0: { opensAtMin: 60 } }); // Sat closes 2am, Sun opens 1am
    const issues = validateWeeklyHours(w);
    expect(issues.map((i) => i.dayOfWeek)).toEqual([0]);
  });

  it("allows a day to open exactly when the previous day finishes closing", () => {
    const w = weekly({ 6: { closesAtMin: 1560 }, 0: { opensAtMin: 120 } }); // Sat closes 2am, Sun opens 2am
    expect(validateWeeklyHours(w)).toEqual([]);
  });

  it("raises no issue when the previous day is closed", () => {
    const w = weekly({ 6: { isClosed: true }, 0: { opensAtMin: 0 } });
    expect(validateWeeklyHours(w)).toEqual([]);
  });
});
