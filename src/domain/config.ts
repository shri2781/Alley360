/**
 * Estimator constants and the vocabulary the rest of the system uses for duration.
 *
 * THE THREE DURATION QUANTITIES
 * -----------------------------
 *
 *   baseMin    setup + games x (players x perPlayerPerGame + interGameReset)
 *              The CENTRAL estimate — roughly what a group actually takes. This is the
 *              only one comparable to the industry rule of thumb (~10 min per player
 *              per game), because that rule is itself a central estimate.
 *
 *   playMin    ceilToGrid(baseMin x bufferMultiplier)
 *              The ~P75 commitment: the window the lane is promised for. The buffer is
 *              a scheduling safety margin, deliberately NOT part of the central estimate.
 *
 *   occupyMin  ceilToGrid(playMin + turnoverMin)
 *              The real lane claim, including cleanup. This is what `lane_allocation.occupies`
 *              spans and therefore what the database exclusion constraint enforces.
 *
 * occupyMin is derived from playMin rather than from the unrounded value on purpose. Round
 * once from the raw number and grid quantisation can swallow the turnover entirely — a
 * 2-player single game gives ceil15(32) = 45 and ceil15(42) = 45, leaving a zero-minute gap
 * between groups.
 *
 * WHY P75 AND NOT THE MEAN
 * ------------------------
 * Newsvendor: q* = Cu / (Cu + Co), where Cu is the cost of underestimating (an overrun —
 * a visible, annoyed, delayed customer) and Co the cost of overestimating (an idle lane).
 * If a delayed customer is roughly 3x as costly as 15 idle minutes, q* = 0.75. Idle time
 * costs money quietly; an overrun costs money and someone's evening.
 *
 * CALIBRATION
 * -----------
 * Every constant below is a guess made without access to the venue. They are the first
 * thing to correct after watching one real evening. `npm run estimator:table` (M2) prints
 * the grid so the owner can correct the numbers on the spot.
 */

export type EstimatorConfig = {
  /** Shoes on, names into the scoring system, first ball. Paid once per session. */
  setupMin: number;
  /** 10 frames at roughly 55s. The dominant term. */
  perPlayerPerGameMin: number;
  /** Reset between consecutive games. */
  interGameResetMin: number;
  /** Shoe return, lane wipe, scoring reset, staff walk-over. Deterministic overhead,
   *  NOT uncertainty — kept separate so the two are never double-counted. */
  turnoverMin: number;
  /** Above this, a group is split across adjacent lanes. */
  maxPlayersPerLane: number;
  /** base -> ~P75. See the newsvendor note above. */
  bufferMultiplier: number;
  /** All starts and durations snap to this grid. */
  slotGridMin: number;
};

export const DEFAULT_ESTIMATOR_CONFIG: EstimatorConfig = {
  setupMin: 8,
  perPlayerPerGameMin: 9,
  interGameResetMin: 2,
  turnoverMin: 10,
  maxPlayersPerLane: 6,
  bufferMultiplier: 1.15,
  slotGridMin: 15,
};
