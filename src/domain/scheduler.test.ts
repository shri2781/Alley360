import { describe, expect, it } from "vitest";
import { DEFAULT_ESTIMATOR_CONFIG, DEFAULT_SCHEDULER_CONFIG } from "./config";
import { findCandidates, type Allocation, type Lane, type ScheduleSnapshot } from "./scheduler";

const DAY = "2026-09-12";
const t = (hm: string) => new Date(`${DAY}T${hm}:00.000Z`);

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

// 4 players / 2 games -> occupyMin 120 (per the estimator grid). Used throughout as
// a representative single-lane request.
const FOUR_BY_TWO = { players: 4, games: 2 };

describe("empty schedule", () => {
  it("offers the exact requested time, on the lowest-numbered lane", () => {
    const result = findCandidates(snapshot([]), { ...FOUR_BY_TWO, preferredStart: t("14:00") });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.start).toEqual(t("14:00"));
    expect(numberOf(result[0]!.laneIds[0]!)).toBe(1);
  });

  it("returns at most maxCandidates, closest-to-preferred first", () => {
    const result = findCandidates(snapshot([]), { ...FOUR_BY_TWO, preferredStart: t("14:00") });
    expect(result.length).toBe(DEFAULT_SCHEDULER_CONFIG.maxCandidates);
    for (let i = 1; i < result.length; i++) {
      const prevDist = Math.abs(result[i - 1]!.start.getTime() - t("14:00").getTime());
      const currDist = Math.abs(result[i]!.start.getTime() - t("14:00").getTime());
      expect(currDist).toBeGreaterThanOrEqual(prevDist);
    }
  });

  it("never returns a start off the 15-minute grid", () => {
    const result = findCandidates(snapshot([]), { ...FOUR_BY_TWO, preferredStart: t("14:07") });
    for (const c of result) {
      expect(c.start.getUTCMinutes() % DEFAULT_ESTIMATOR_CONFIG.slotGridMin).toBe(0);
      expect(c.start.getUTCSeconds()).toBe(0);
    }
  });

  it("never offers a start before opening or a finish after closing", () => {
    const result = findCandidates(snapshot([]), { ...FOUR_BY_TWO, preferredStart: t("10:00") });
    for (const c of result) {
      expect(c.start.getTime()).toBeGreaterThanOrEqual(t("10:00").getTime());
      expect(c.end.getTime()).toBeLessThanOrEqual(t("22:00").getTime());
    }
    // near closing, too — a candidate that would run past 22:00 must never appear
    const nearClose = findCandidates(snapshot([]), { ...FOUR_BY_TWO, preferredStart: t("21:30") });
    for (const c of nearClose) {
      expect(c.end.getTime()).toBeLessThanOrEqual(t("22:00").getTime());
    }
  });
});

describe("overlap is genuinely excluded, not just deprioritised", () => {
  it("on a single free lane, a fully-booked window yields no candidate inside it", () => {
    // Only one lane exists in this fixture, so there is nowhere else for an
    // overlapping request to go -- it must be rejected outright, not just scored low.
    const oneLane: Lane[] = [{ id: "L1", number: 1 }];
    const snap: ScheduleSnapshot = {
      lanes: oneLane,
      allocations: [{ laneId: "L1", start: t("14:00"), end: t("15:45") }],
      openAt: t("10:00"),
      closeAt: t("22:00"),
    };
    // 2 players / 1 game -> occupyMin 60.
    const result = findCandidates(snap, { players: 2, games: 1, preferredStart: t("14:30") });

    for (const c of result) {
      const overlapsBooking = c.start < t("15:45") && t("14:00") < c.end;
      expect(overlapsBooking).toBe(false);
    }
    // The booking ends at 15:45 -- that should be offered as soon as the lane frees up.
    expect(result.some((c) => c.start.getTime() === t("15:45").getTime())).toBe(true);
  });
});

describe("scoring prefers a clean fit over an equally-distant open slot", () => {
  it("continuing immediately after an existing booking outranks other options", () => {
    const snap = snapshot([{ laneId: "L1", start: t("12:00"), end: t("15:45") }]);
    // Request exactly the moment Lane 1 frees up -- zero preference cost AND a
    // perfect-fit bonus (the gap right before this placement is zero).
    const result = findCandidates(snap, { ...FOUR_BY_TWO, preferredStart: t("15:45") });

    expect(result[0]!.start).toEqual(t("15:45"));
    expect(numberOf(result[0]!.laneIds[0]!)).toBe(1);
  });
});

describe("multi-lane requests need a contiguous block", () => {
  it("skips a lone free lane and finds the only valid contiguous pair", () => {
    // Lane 2 busy all day -> free lanes are {1, 3, 4}. 1 has no contiguous partner
    // (its neighbour, 2, is busy). Only {3, 4} is a valid pair.
    const snap = snapshot([{ laneId: "L2", start: t("10:00"), end: t("22:00") }]);
    // 8 players / 2 games -> lanesNeeded 2, same duration as 4/2 (parallel lanes).
    const result = findCandidates(snap, { players: 8, games: 2, preferredStart: t("14:00") });

    expect(result.length).toBeGreaterThan(0);
    const numbers = result[0]!.laneIds.map(numberOf).sort();
    expect(numbers).toEqual([3, 4]);
  });

  it("returns nothing, ever, when no contiguous block of the right size exists", () => {
    // Lanes 2 and 3 busy all day -> free is {1, 4}, never adjacent.
    const snap = snapshot([
      { laneId: "L2", start: t("10:00"), end: t("22:00") },
      { laneId: "L3", start: t("10:00"), end: t("22:00") },
    ]);
    const result = findCandidates(snap, { players: 8, games: 2, preferredStart: t("14:00") });
    expect(result).toEqual([]);
  });
});
