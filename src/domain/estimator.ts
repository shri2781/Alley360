/**
 * Duration estimation. Pure — no I/O, no clock, no database.
 *
 * players x games x perPlayerPerGameMin, rounded to the nearest bookingGridMin (ties round
 * down). Rounding the DURATION, not just the start, is what lets consecutive bookings
 * touch with zero gap: both land on the same grid, so one can end exactly where the next
 * begins. See scheduler.ts for how that gets exploited when ranking candidate starts.
 */
import { DEFAULT_ESTIMATOR_CONFIG, type EstimatorConfig } from "./config";

export type DurationEstimate = {
  baseMin: number;
  playMin: number;
  occupyMin: number;
};

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

  const raw = players * games * cfg.perPlayerPerGameMin;
  const remainder = raw % cfg.bookingGridMin;
  const rounded = remainder <= cfg.bookingGridMin / 2 ? raw - remainder : raw - remainder + cfg.bookingGridMin;
  // A range can never be empty (schema.sql: allocation_ranges_nonempty), so rounding can
  // never be allowed to reach zero -- only possible if perPlayerPerGameMin were tiny.
  const minutes = Math.max(rounded, cfg.bookingGridMin);

  return { baseMin: minutes, playMin: minutes, occupyMin: minutes };
}
