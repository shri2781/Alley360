import { describe, expect, it } from "vitest";
import { DEFAULT_ESTIMATOR_CONFIG } from "./config";
import { estimateDuration } from "./estimator";

describe("[unit][domain] estimateDuration", () => {
  it("rounds a duration down when it is exactly halfway between booking-grid boundaries", () => {
    // 5 players × 1 game × 9 minutes = 45, exactly halfway between 40 and 50.
    expect(estimateDuration(5, 1)).toEqual({ baseMin: 40, playMin: 40, occupyMin: 40 });
  });

  it("rounds a duration up when it is closer to the next booking-grid boundary", () => {
    // 4 players × 1 game × 9 minutes = 36, so it occupies a 40-minute slot.
    expect(estimateDuration(4, 1)).toEqual({ baseMin: 40, playMin: 40, occupyMin: 40 });
  });

  it("never produces an empty allocation when a custom estimate rounds to zero", () => {
    const estimate = estimateDuration(1, 1, {
      ...DEFAULT_ESTIMATOR_CONFIG,
      perPlayerPerGameMin: 1,
    });

    expect(estimate.occupyMin).toBe(DEFAULT_ESTIMATOR_CONFIG.bookingGridMin);
  });

  it("rejects zero, negative, and fractional player or game counts", () => {
    for (const [players, games] of [
      [0, 1],
      [-1, 1],
      [1.5, 1],
      [1, 0],
      [1, -1],
      [1, 1.5],
    ] as const) {
      expect(() => estimateDuration(players, games)).toThrow();
    }
  });
});
