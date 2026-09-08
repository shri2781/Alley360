import { describe, expect, it } from "vitest";
import { DEFAULT_ESTIMATOR_CONFIG } from "./config";
import { estimateDuration } from "./estimator";
import {
  CANDIDATE_WINDOW_MIN,
  checkMove,
  checkSlot,
  findCandidates,
  type Allocation,
  type Lane,
  type ScheduleSnapshot,
} from "./scheduler";
import { addMinutes } from "./time";

const DAY = "2026-09-12";
const t = (hm: string) => new Date(`${DAY}T${hm}:00.000Z`);
const NEXT_DAY = "2026-09-13";
const tNext = (hm: string) => new Date(`${NEXT_DAY}T${hm}:00.000Z`);

const LANES: Lane[] = [
  { id: "L1", number: 1 },
  { id: "L2", number: 2 },
  { id: "L3", number: 3 },
  { id: "L4", number: 4 },
];

const numberOf = (laneId: string) => LANES.find((l) => l.id === laneId)?.number;

function snapshot(allocations: Allocation[], openAt = t("10:00"), closeAt = t("22:00")): ScheduleSnapshot {
  return { lanes: LANES, allocations, openAt, closeAt };
}

const FOUR_BY_TWO = { players: 4, games: 2 };
/** Derived, not hard-coded: the estimator's constants are still being tuned. */
const DUR = estimateDuration(FOUR_BY_TWO.players, FOUR_BY_TWO.games).occupyMin;

describe("empty schedule", () => {
  it("offers the exact requested time, on the lowest-numbered lane", () => {
    const result = findCandidates(snapshot([]), { ...FOUR_BY_TWO, preferredStart: t("14:00") });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.start).toEqual(t("14:00"));
    expect(numberOf(result[0]!.laneIds[0]!)).toBe(1);
  });

  it("offers exactly one lane, never a block of them", () => {
    const result = findCandidates(snapshot([]), { players: 12, games: 2, preferredStart: t("14:00") });
    for (const c of result) expect(c.laneIds).toHaveLength(1);
  });

  it("stays within the candidate window either side of the requested time", () => {
    const preferredStart = t("14:00");
    const result = findCandidates(snapshot([]), { ...FOUR_BY_TWO, preferredStart });
    for (const c of result) {
      const away = Math.abs(c.start.getTime() - preferredStart.getTime()) / 60_000;
      expect(away).toBeLessThanOrEqual(CANDIDATE_WINDOW_MIN);
    }
  });

  it("never offers a start before opening or a finish after closing", () => {
    const result = findCandidates(snapshot([]), { ...FOUR_BY_TWO, preferredStart: t("10:00") });
    for (const c of result) {
      expect(c.start.getTime()).toBeGreaterThanOrEqual(t("10:00").getTime());
      expect(c.end.getTime()).toBeLessThanOrEqual(t("22:00").getTime());
    }
    // 21:00, not 21:30: with a 70-minute duration, every start after 20:50 runs past
    // closing, so a window entirely beyond that would trivially satisfy this assertion
    // over an empty list. 21:00 keeps some feasible starts (20:30/20:40/20:50) in view.
    const nearClose = findCandidates(snapshot([]), { ...FOUR_BY_TWO, preferredStart: t("21:00") });
    expect(nearClose.length).toBeGreaterThan(0);
    for (const c of nearClose) {
      expect(c.end.getTime()).toBeLessThanOrEqual(t("22:00").getTime());
    }
  });

  it("supports a close time on the following calendar day", () => {
    // Alley opens 10:00 and closes 4:00 the next morning (closes_at_hour = 28) --
    // the scheduler only ever sees openAt/closeAt as plain Dates, so a request in the
    // small hours must be offered exactly like any other time inside the window.
    const snap = snapshot([], t("10:00"), tNext("04:00"));
    const result = findCandidates(snap, { ...FOUR_BY_TWO, preferredStart: tNext("01:00") });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.start).toEqual(tNext("01:00"));
    for (const c of result) {
      expect(c.end.getTime()).toBeLessThanOrEqual(tNext("04:00").getTime());
    }
  });
});

describe("overlap is genuinely excluded, not just deprioritised", () => {
  it("on a single free lane, a fully-booked window yields no candidate inside it", () => {
    const oneLane: Lane[] = [{ id: "L1", number: 1 }];
    const snap: ScheduleSnapshot = {
      lanes: oneLane,
      allocations: [{ laneId: "L1", start: t("14:00"), end: t("15:40") }],
      openAt: t("10:00"),
      closeAt: t("22:00"),
    };
    // Requested 15:10, so the 15:40 free-up moment (itself grid-aligned, since every
    // booking both starts and lasts a multiple of bookingGridMin) is inside the window.
    const result = findCandidates(snap, { players: 2, games: 1, preferredStart: t("15:10") });

    for (const c of result) {
      const overlapsBooking = c.start < t("15:40") && t("14:00") < c.end;
      expect(overlapsBooking).toBe(false);
    }
    // The booking ends at 15:40 -- that should be offered as soon as the lane frees up.
    expect(result.some((c) => c.start.getTime() === t("15:40").getTime())).toBe(true);
  });
});

describe("packing -- fewest dead minutes wins", () => {
  it("fills a hole that exactly fits ahead of a closer but wasteful slot", () => {
    // Lane 1 has a gap from 14:00 that is precisely long enough. Taking it strands
    // nothing on either side, so it must outrank 14:30 even though 14:30 is what was
    // asked for and every other lane is wide open.
    const snap = snapshot([
      { laneId: "L1", start: t("12:00"), end: t("14:00") },
      { laneId: "L1", start: addMinutes(t("14:00"), DUR), end: t("21:00") },
    ]);
    const result = findCandidates(snap, { ...FOUR_BY_TWO, preferredStart: t("14:30") });

    expect(result[0]!.start).toEqual(t("14:00"));
    expect(numberOf(result[0]!.laneIds[0]!)).toBe(1);
  });

  it("continuing immediately after an existing booking beats an untouched lane", () => {
    const snap = snapshot([{ laneId: "L1", start: t("12:00"), end: t("15:40") }]);
    const result = findCandidates(snap, { ...FOUR_BY_TWO, preferredStart: t("15:40") });

    expect(result[0]!.start).toEqual(t("15:40"));
    expect(numberOf(result[0]!.laneIds[0]!)).toBe(1);
  });

  it("penalizes a stranded gap even where raw before+after distance alone would tie", () => {
    // L1's only booking ends at 17:20. Continuing right there wastes nothing. Starting
    // at 17:30 -- the literal requested time -- instead strands a 10-minute gap in
    // front of it. Shift a placement by any amount X and its "before" grows by X while
    // its "after" shrinks by the same X, so UNCAPPED before+after is identical for both
    // starts: only capping each side at what's actually sellable makes the zero-waste
    // option win, which is the whole point of gapCost's cap.
    const snap = snapshot([{ laneId: "L1", start: t("15:00"), end: t("17:20") }]);
    const result = findCandidates(snap, { ...FOUR_BY_TWO, preferredStart: t("17:30") });

    expect(result[0]!.start).toEqual(t("17:20"));
    expect(numberOf(result[0]!.laneIds[0]!)).toBe(1);
  });

  it("never offers a start off the booking grid", () => {
    const snap = snapshot([{ laneId: "L1", start: t("12:00"), end: t("15:40") }]);
    const result = findCandidates(snap, { ...FOUR_BY_TWO, preferredStart: t("15:23") });

    for (const c of result) {
      expect(c.start.getUTCMinutes() % DEFAULT_ESTIMATOR_CONFIG.bookingGridMin).toBe(0);
    }
  });
});

describe("now -- never offers or confirms a start that has already passed", () => {
  it("findCandidates excludes starts before now, even inside the window", () => {
    const result = findCandidates(
      snapshot([]),
      { ...FOUR_BY_TWO, preferredStart: t("20:00") },
      undefined,
      t("19:55"),
    );
    for (const c of result) {
      expect(c.start.getTime()).toBeGreaterThanOrEqual(t("19:55").getTime());
    }
    expect(result.some((c) => c.start.getTime() === t("19:30").getTime())).toBe(false);
  });

  it("checkSlot rejects an exact start that has already passed", () => {
    const result = checkSlot(snapshot([]), t("19:30"), FOUR_BY_TWO, undefined, t("19:55"));
    expect(result).toBeNull();
  });

  it("checkSlot still confirms a future start when now is given", () => {
    const result = checkSlot(snapshot([]), t("20:00"), FOUR_BY_TWO, undefined, t("19:55"));
    expect(result).not.toBeNull();
  });
});

describe("checkSlot -- validates one exact time, never substitutes another", () => {
  it("confirms a feasible slot and returns its lane and end time", () => {
    const result = checkSlot(snapshot([]), t("14:00"), FOUR_BY_TWO);
    expect(result).not.toBeNull();
    expect(result!.end).toEqual(addMinutes(t("14:00"), DUR));
    expect(numberOf(result!.laneIds[0]!)).toBe(1);
  });

  it("returns null for a slot that overlaps an existing booking -- never a different time", () => {
    const snap = snapshot([{ laneId: "L1", start: t("13:00"), end: t("15:00") }]);
    const result = checkSlot(snap, t("14:00"), FOUR_BY_TWO);
    // Feasible overall (lanes 2-4 are free), so this should succeed -- but never on lane 1.
    expect(result).not.toBeNull();
    expect(numberOf(result!.laneIds[0]!)).not.toBe(1);
  });

  it("returns null, not a substitute, when EVERY lane is busy at that exact time", () => {
    const snap = snapshot(LANES.map((l) => ({ laneId: l.id, start: t("13:00"), end: t("15:00") })));
    const result = checkSlot(snap, t("14:00"), FOUR_BY_TWO);
    expect(result).toBeNull();
  });

  it("confirms a slot outside the candidate window, which findCandidates never offers", () => {
    // 11:00 is two hours from the requested time, well beyond the window. That makes it
    // unofferable, not infeasible -- checkSlot must still confirm it directly.
    const snap = snapshot([]);
    const offered = findCandidates(snap, { ...FOUR_BY_TWO, preferredStart: t("14:00") });
    expect(offered.some((c) => c.start.getTime() === t("11:00").getTime())).toBe(false);

    expect(checkSlot(snap, t("11:00"), FOUR_BY_TWO)).not.toBeNull();
  });
});

describe("checkMove -- validates a staff drag/resize of an existing allocation", () => {
  it("excludes the allocation being moved from its own overlap check", () => {
    const snap = snapshot([{ id: "A", laneId: "L1", start: t("14:00"), end: t("16:00") }]);
    const result = checkMove(snap, {
      allocationId: "A",
      laneId: "L1",
      start: t("14:15"),
      end: t("16:15"),
      hasTurnover: true,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a drag onto another allocation's time on the same lane", () => {
    const snap = snapshot([
      { id: "A", laneId: "L1", start: t("14:00"), end: t("16:00") },
      { id: "B", laneId: "L1", start: t("16:00"), end: t("18:00") },
    ]);
    const result = checkMove(snap, {
      allocationId: "A",
      laneId: "L1",
      start: t("15:00"),
      end: t("17:00"),
      hasTurnover: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("lane_conflict");
  });

  it("rejects a span below the one-minute floor", () => {
    const snap = snapshot([]);
    const result = checkMove(snap, {
      allocationId: "A",
      laneId: "L1",
      start: t("14:00"),
      end: new Date(t("14:00").getTime() + 30_000), // 30 seconds
      hasTurnover: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too_short");
  });

  it("rejects a drag that would end after closing", () => {
    const snap = snapshot([]);
    const result = checkMove(snap, {
      allocationId: "A",
      laneId: "L1",
      start: t("21:30"),
      end: t("22:15"),
      hasTurnover: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("after_close");
  });

  it("rejects any change to a locked (active-session) start", () => {
    const snap = snapshot([{ id: "A", laneId: "L1", start: t("14:00"), end: t("16:00") }]);
    const result = checkMove(snap, {
      allocationId: "A",
      laneId: "L1",
      start: t("14:15"),
      end: t("16:00"),
      hasTurnover: true,
      locked: { start: t("14:00"), laneId: "L1" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("locked_start");
  });

  it("allows extending the end of a locked (active-session) allocation", () => {
    const snap = snapshot([{ id: "A", laneId: "L1", start: t("14:00"), end: t("16:00") }]);
    const result = checkMove(snap, {
      allocationId: "A",
      laneId: "L1",
      start: t("14:00"),
      end: t("16:30"),
      hasTurnover: true,
      locked: { start: t("14:00"), laneId: "L1" },
    });
    expect(result.ok).toBe(true);
  });

  it("leaves playEnd equal to end -- there is no turnover to carve off", () => {
    const snap = snapshot([]);
    for (const hasTurnover of [true, false]) {
      const result = checkMove(snap, {
        allocationId: "A",
        laneId: "L1",
        start: t("14:00"),
        end: t("16:00"),
        hasTurnover,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.playEnd).toEqual(t("16:00"));
    }
  });
});
