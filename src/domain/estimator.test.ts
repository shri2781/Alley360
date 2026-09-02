import { describe, expect, it } from "vitest";
import { DEFAULT_ESTIMATOR_CONFIG } from "./config";
import { ceilToGrid, estimateDuration } from "./estimator";

const cfg = DEFAULT_ESTIMATOR_CONFIG;

describe("ceilToGrid", () => {
  it("rounds up to the grid", () => {
    expect(ceilToGrid(1, 15)).toBe(15);
    expect(ceilToGrid(16, 15)).toBe(30);
  });

  it("leaves exact multiples alone", () => {
    expect(ceilToGrid(30, 15)).toBe(30);
  });

  it("absorbs float noise rather than jumping a slot", () => {
    // 120 * 1.15 evaluates to 137.99999999999997
    expect(ceilToGrid(120 * 1.15, 15)).toBe(150);
    expect(ceilToGrid(150.0000000001, 15)).toBe(150);
    // ...but a genuine overshoot still rounds up
    expect(ceilToGrid(150.5, 15)).toBe(165);
  });
});

describe("estimateDuration — the grid shown to the owner", () => {
  // These are the numbers to check against reality after watching one real evening.
  const table = [
    { players: 2, games: 1, baseMin: 28, playMin: 45, occupyMin: 60 },
    { players: 2, games: 2, baseMin: 48, playMin: 60, occupyMin: 75 },
    { players: 2, games: 3, baseMin: 68, playMin: 90, occupyMin: 105 },
    { players: 4, games: 1, baseMin: 46, playMin: 60, occupyMin: 75 },
    { players: 4, games: 2, baseMin: 84, playMin: 105, occupyMin: 120 },
    { players: 4, games: 3, baseMin: 122, playMin: 150, occupyMin: 165 },
    { players: 6, games: 1, baseMin: 64, playMin: 75, occupyMin: 90 },
    { players: 6, games: 2, baseMin: 120, playMin: 150, occupyMin: 165 },
    { players: 6, games: 3, baseMin: 176, playMin: 210, occupyMin: 225 },
  ];

  for (const row of table) {
    it(`${row.players} players x ${row.games} games`, () => {
      const got = estimateDuration(row.players, row.games, cfg);
      expect(got.baseMin).toBe(row.baseMin);
      expect(got.playMin).toBe(row.playMin);
      expect(got.occupyMin).toBe(row.occupyMin);
      expect(got.lanesNeeded).toBe(1);
    });
  }

  it("tracks the ~10 min/player/game rule of thumb, -20%/+40%", () => {
    // The rule is a CENTRAL estimate, so it is baseMin that must match it —
    // not playMin, which carries the scheduling buffer on top.
    //
    // The tolerance is deliberately asymmetric. Across the grid, ratio ranges from
    // ~0.98 (6p x 3g) up to exactly 1.4 (2p x 1g): the fixed 8-min setup cost is a much
    // bigger fraction of a short session, so the model diverges most from the naive
    // per-player rule at the smallest party size. That is expected, not a bug — the
    // bound is inclusive at 1.4 for exactly that reason.
    for (const row of table) {
      const ruleOfThumb = 10 * row.players * row.games;
      const ratio = row.baseMin / ruleOfThumb;
      expect(ratio).toBeGreaterThanOrEqual(0.8);
      expect(ratio).toBeLessThanOrEqual(1.4);
    }
  });
});

describe("multi-lane parties bowl in parallel", () => {
  it("a 12-person party takes the same time as a 6-person group, not double", () => {
    const party = estimateDuration(12, 2, cfg);
    const group = estimateDuration(6, 2, cfg);

    expect(party.lanesNeeded).toBe(2);
    expect(party.playersPerLane).toBe(6);
    expect(party.baseMin).toBe(group.baseMin);
    expect(party.playMin).toBe(group.playMin);
  });

  it("splits players evenly and sizes on the busiest lane", () => {
    const seven = estimateDuration(7, 2, cfg);
    expect(seven.lanesNeeded).toBe(2);
    expect(seven.playersPerLane).toBe(4); // 4 + 3, and the lane of 4 gates the finish
    expect(seven.baseMin).toBe(estimateDuration(4, 2, cfg).baseMin);
  });

  it("adds a lane at each capacity boundary", () => {
    expect(estimateDuration(6, 1, cfg).lanesNeeded).toBe(1);
    expect(estimateDuration(7, 1, cfg).lanesNeeded).toBe(2);
    expect(estimateDuration(12, 1, cfg).lanesNeeded).toBe(2);
    expect(estimateDuration(13, 1, cfg).lanesNeeded).toBe(3);
  });
});

describe("invariants that the scheduler and database depend on", () => {
  const players = [1, 2, 3, 4, 5, 6, 7, 8, 12, 18, 24];
  const games = [1, 2, 3, 4];

  it("always leaves at least the configured turnover between groups", () => {
    for (const p of players) {
      for (const g of games) {
        const e = estimateDuration(p, g, cfg);
        expect(e.occupyMin - e.playMin).toBeGreaterThanOrEqual(cfg.turnoverMin);
      }
    }
  });

  it("never commits less time than the central estimate", () => {
    for (const p of players) {
      for (const g of games) {
        const e = estimateDuration(p, g, cfg);
        expect(e.playMin).toBeGreaterThanOrEqual(e.baseMin);
      }
    }
  });

  it("returns grid-aligned durations so every start stays on the grid", () => {
    for (const p of players) {
      for (const g of games) {
        const e = estimateDuration(p, g, cfg);
        expect(e.playMin % cfg.slotGridMin).toBe(0);
        expect(e.occupyMin % cfg.slotGridMin).toBe(0);
      }
    }
  });

  it("is monotonic in games", () => {
    for (const p of players) {
      for (let g = 1; g < 4; g++) {
        expect(estimateDuration(p, g + 1, cfg).baseMin).toBeGreaterThan(
          estimateDuration(p, g, cfg).baseMin,
        );
      }
    }
  });
});

describe("input validation", () => {
  it("rejects nonsense", () => {
    expect(() => estimateDuration(0, 1, cfg)).toThrow();
    expect(() => estimateDuration(4, 0, cfg)).toThrow();
    expect(() => estimateDuration(2.5, 1, cfg)).toThrow();
    expect(() => estimateDuration(-1, 1, cfg)).toThrow();
  });
});
