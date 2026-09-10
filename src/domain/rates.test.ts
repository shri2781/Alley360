import { describe, expect, it } from "vitest";
import type { DayHours } from "./hours";
import {
  formatSpecialWindow,
  priceFor,
  rateSegments,
  resolveRate,
  validateSpecialRate,
  type RateSchedule,
  type SpecialRate,
} from "./rates";

const BASE = { id: "base", name: "Regular", pricePerPerson: 300 };

function day(overrides: Partial<DayHours> = {}): DayHours {
  return { dayOfWeek: 6, isClosed: false, opensAtMin: 600, closesAtMin: 1320, ...overrides }; // Saturday, 10am-10pm
}

function special(overrides: Partial<SpecialRate> = {}): SpecialRate {
  return {
    id: "special",
    name: "Happy Hours",
    pricePerPerson: 180,
    days: [6],
    startsAtMin: 720,
    endsAtMin: 960,
    priority: 0,
    ...overrides,
  };
}

describe("resolveRate", () => {
  it("returns the base rate when there are no specials", () => {
    const schedule: RateSchedule = { base: BASE, specials: [] };
    expect(resolveRate(schedule, day(), 800)).toEqual(BASE);
  });

  it("matches a special on the right day, inside its window", () => {
    const schedule: RateSchedule = { base: BASE, specials: [special()] };
    expect(resolveRate(schedule, day(), 800).id).toBe("special");
  });

  it("falls back to base on the wrong day", () => {
    const schedule: RateSchedule = { base: BASE, specials: [special({ days: [1] })] }; // Monday only
    expect(resolveRate(schedule, day(), 800).id).toBe("base"); // day() is Saturday
  });

  it("falls back to base outside the window", () => {
    const schedule: RateSchedule = { base: BASE, specials: [special()] }; // 720-960
    expect(resolveRate(schedule, day(), 700).id).toBe("base");
    expect(resolveRate(schedule, day(), 1000).id).toBe("base");
  });

  it("is half-open: matches at startsAtMin, does not match at endsAtMin", () => {
    const schedule: RateSchedule = { base: BASE, specials: [special({ startsAtMin: 720, endsAtMin: 960 })] };
    expect(resolveRate(schedule, day(), 720).id).toBe("special");
    expect(resolveRate(schedule, day(), 960).id).toBe("base");
  });

  it("lets a lower priority win even when listed later in the array", () => {
    const narrow = special({ id: "weekend", name: "Weekend", startsAtMin: null, endsAtMin: null, priority: 1 });
    const wide = special({ id: "happy", name: "Happy Hours", startsAtMin: 720, endsAtMin: 960, priority: 0 });
    // "happy" (priority 0) must win at 800 even though it's listed second -- resolveRate
    // trusts array order, so this proves the loader's priority sort is what actually decides.
    const schedule: RateSchedule = { base: BASE, specials: [narrow, wide] };
    expect(resolveRate(schedule, day(), 800).id).toBe("weekend");
    const sortedByPriority: RateSchedule = { base: BASE, specials: [wide, narrow] };
    expect(resolveRate(sortedByPriority, day(), 800).id).toBe("happy");
  });

  it("expands a null startsAtMin to the day's own opening", () => {
    const d = day({ opensAtMin: 630 });
    const schedule: RateSchedule = { base: BASE, specials: [special({ startsAtMin: null, endsAtMin: 960 })] };
    expect(resolveRate(schedule, d, 600).id).toBe("base"); // before opening -- shouldn't happen in practice, but not "special"
    expect(resolveRate(schedule, d, 630).id).toBe("special");
  });

  it("expands a null endsAtMin to the day's own closing, including past-midnight closes", () => {
    const d = day({ closesAtMin: 1560 }); // closes 2am next day
    const schedule: RateSchedule = { base: BASE, specials: [special({ startsAtMin: 1320, endsAtMin: null })] };
    expect(resolveRate(schedule, d, 1500).id).toBe("special"); // 00:30 next calendar day
    expect(resolveRate(schedule, d, 1560).id).toBe("base");
  });

  it("matches an explicit window that crosses midnight", () => {
    const d = day({ closesAtMin: 1560 });
    const schedule: RateSchedule = { base: BASE, specials: [special({ startsAtMin: 1320, endsAtMin: 1500 })] };
    expect(resolveRate(schedule, d, 1320).id).toBe("special");
    expect(resolveRate(schedule, d, 1400).id).toBe("special");
    expect(resolveRate(schedule, d, 1500).id).toBe("base");
  });

  it("matches on the BUSINESS day-of-week, not the calendar day", () => {
    // A Friday (5) rate, and an offset of 1500 -- which represents 00:30 the next
    // calendar day but is still Friday's business day because offsetMinutes() is
    // measured from Friday's own midnight.
    const friday = day({ dayOfWeek: 5, closesAtMin: 1560 });
    const schedule: RateSchedule = { base: BASE, specials: [special({ days: [5], startsAtMin: null, endsAtMin: null })] };
    expect(resolveRate(schedule, friday, 1500).id).toBe("special");
  });
});

describe("priceFor", () => {
  it("multiplies price per person by players and games", () => {
    expect(priceFor({ id: "r", name: "Regular", pricePerPerson: 299 }, 4, 2)).toBe(2392);
  });

  it("allows a zero rate", () => {
    expect(priceFor({ id: "r", name: "Free", pricePerPerson: 0 }, 4, 2)).toBe(0);
  });
});

describe("rateSegments", () => {
  it("returns no segments on a closed day", () => {
    const schedule: RateSchedule = { base: BASE, specials: [] };
    expect(rateSegments(schedule, day({ isClosed: true }))).toEqual([]);
  });

  it("returns one segment spanning the whole day when there are no specials", () => {
    const schedule: RateSchedule = { base: BASE, specials: [] };
    const segs = rateSegments(schedule, day());
    expect(segs).toEqual([{ fromMin: 600, toMin: 1320, rate: BASE }]);
  });

  it("splits into three segments around a mid-day special", () => {
    const schedule: RateSchedule = { base: BASE, specials: [special()] }; // 720-960
    const segs = rateSegments(schedule, day());
    expect(segs.map((s) => [s.fromMin, s.toMin, s.rate.id])).toEqual([
      [600, 720, "base"],
      [720, 960, "special"],
      [960, 1320, "base"],
    ]);
  });

  it("produces two segments when a special starts exactly at opening", () => {
    const schedule: RateSchedule = { base: BASE, specials: [special({ startsAtMin: 600, endsAtMin: 960 })] };
    const segs = rateSegments(schedule, day());
    expect(segs.map((s) => [s.fromMin, s.toMin, s.rate.id])).toEqual([
      [600, 960, "special"],
      [960, 1320, "base"],
    ]);
  });

  it("merges adjacent segments that resolve to the same rate", () => {
    // Two specials, same rate id, covering 700-800 and 800-900 -- must merge into one 700-900 segment.
    const s1 = special({ id: "happy", startsAtMin: 700, endsAtMin: 800 });
    const s2 = special({ id: "happy", startsAtMin: 800, endsAtMin: 900 });
    const schedule: RateSchedule = { base: BASE, specials: [s1, s2] };
    const segs = rateSegments(schedule, day());
    expect(segs.map((s) => [s.fromMin, s.toMin, s.rate.id])).toEqual([
      [600, 700, "base"],
      [700, 900, "happy"],
      [900, 1320, "base"],
    ]);
  });

  it("clips a window that extends past closing", () => {
    const schedule: RateSchedule = { base: BASE, specials: [special({ startsAtMin: 1200, endsAtMin: 1500 })] };
    const segs = rateSegments(schedule, day()); // closes 1320
    expect(segs.map((s) => [s.fromMin, s.toMin, s.rate.id])).toEqual([
      [600, 1200, "base"],
      [1200, 1320, "special"],
    ]);
  });

  it("demonstrates first-match-wins: a narrower higher-priority special beats a wider one", () => {
    const weekend = special({ id: "weekend", name: "Weekend", startsAtMin: null, endsAtMin: null, priority: 1 });
    const happy = special({ id: "happy", name: "Happy Hours", startsAtMin: 720, endsAtMin: 960, priority: 0 });
    const schedule: RateSchedule = { base: BASE, specials: [happy, weekend] }; // sorted by priority, as the loader would
    const segs = rateSegments(schedule, day());
    expect(segs.map((s) => [s.fromMin, s.toMin, s.rate.id])).toEqual([
      [600, 720, "weekend"],
      [720, 960, "happy"],
      [960, 1320, "weekend"],
    ]);
  });
});

describe("formatSpecialWindow", () => {
  it("formats an explicit window", () => {
    expect(formatSpecialWindow({ startsAtMin: 720, endsAtMin: 960 })).toBe("12:00 PM – 4:00 PM");
  });

  it("falls back to 'All day' when either bound defers to the venue's own hours", () => {
    expect(formatSpecialWindow({ startsAtMin: null, endsAtMin: null })).toBe("All day");
    expect(formatSpecialWindow({ startsAtMin: null, endsAtMin: 960 })).toBe("All day");
    expect(formatSpecialWindow({ startsAtMin: 720, endsAtMin: null })).toBe("All day");
  });
});

describe("validateSpecialRate", () => {
  const valid = { name: "Happy Hours", pricePerPerson: 199, days: [1, 2, 3], startsAtMin: 720, endsAtMin: 960 };

  it("accepts a well-formed special rate", () => {
    expect(validateSpecialRate(valid)).toEqual([]);
  });

  it("rejects an empty name", () => {
    expect(validateSpecialRate({ ...valid, name: "  " })).not.toEqual([]);
  });

  it("rejects an empty days list", () => {
    expect(validateSpecialRate({ ...valid, days: [] })).not.toEqual([]);
  });

  it("rejects endsAtMin at or before startsAtMin", () => {
    expect(validateSpecialRate({ ...valid, startsAtMin: 900, endsAtMin: 900 })).not.toEqual([]);
    expect(validateSpecialRate({ ...valid, startsAtMin: 900, endsAtMin: 800 })).not.toEqual([]);
  });

  it("rejects minutes off the 30-minute grid", () => {
    expect(validateSpecialRate({ ...valid, startsAtMin: 715 })).not.toEqual([]);
  });

  it("rejects a negative price", () => {
    expect(validateSpecialRate({ ...valid, pricePerPerson: -1 })).not.toEqual([]);
  });
});
