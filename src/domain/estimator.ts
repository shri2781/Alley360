/**
 * Duration estimation. Pure — no I/O, no clock, no database.
 *
 * See src/domain/config.ts for the three duration quantities (base / play / occupy)
 * and why the buffer is not part of the central estimate.
 */
import { DEFAULT_ESTIMATOR_CONFIG, type EstimatorConfig } from "./config";

export type DurationEstimate = {
  /** Central estimate — comparable to the ~10 min/player/game rule of thumb. */
  baseMin: number;
  /** ~P75 commitment, grid-aligned. The window the lane is promised for. */
  playMin: number;
  /** playMin + turnover, grid-aligned. The lane claim the exclusion constraint guards. */
  occupyMin: number;
  /** How many lanes the party needs. */
  lanesNeeded: number;
  /** Players on the busiest lane — the number the duration actually depends on. */
  playersPerLane: number;
};

/** Rounds up to the slot grid. The epsilon absorbs float noise so that a value
 *  landing exactly on a boundary (120 * 1.15 = 137.99999...) does not jump a slot. */
export function ceilToGrid(minutes: number, gridMin: number): number {
  return Math.ceil(minutes / gridMin - 1e-6) * gridMin;
}

/**
 * How long a group occupies a lane.
 *
 * The subtlety is `playersPerLane`. A party split across lanes bowls in PARALLEL, so a
 * 12-person party on two lanes takes as long as a 6-person group, not twice as long.
 * Feeding total players into the formula would nearly double every party estimate.
 * The split is balanced, and `ceil` picks the busiest lane, which is what gates the finish.
 */
export function estimateDuration(
  players: number,
  games: number,
  cfg: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG,
): DurationEstimate {
  if (!Number.isInteger(players) || players < 1) {
    throw new Error(`players must be a positive integer, got ${players}`);
  }
  if (!Number.isInteger(games) || games < 1) {
    throw new Error(`games must be a positive integer, got ${games}`);
  }

  const lanesNeeded = Math.ceil(players / cfg.maxPlayersPerLane);
  const playersPerLane = Math.ceil(players / lanesNeeded);

  const baseMin =
    cfg.setupMin + games * (playersPerLane * cfg.perPlayerPerGameMin + cfg.interGameResetMin);

  const playMin = ceilToGrid(baseMin * cfg.bufferMultiplier, cfg.slotGridMin);

  // Derived from playMin, not from the unrounded value: rounding once from the raw
  // number can swallow the turnover entirely and leave a zero-minute gap between groups.
  const occupyMin = ceilToGrid(playMin + cfg.turnoverMin, cfg.slotGridMin);

  return { baseMin, playMin, occupyMin, lanesNeeded, playersPerLane };
}
