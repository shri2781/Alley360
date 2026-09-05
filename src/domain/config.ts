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
  /** Smallest allowed occupies span for a staff-dragged open_play allocation. Below
   *  this, play_window (occupies minus turnoverMin) would be too thin to mean anything,
   *  or empty outright -- occupies must exceed turnoverMin, and two grid cells is the
   *  smallest span that leaves a sane play window. */
  minPlayBlockMin: number;
  /** Smallest allowed span for a maintenance allocation (kind: 'block'), which has no
   *  turnover component, so it only needs one grid cell. */
  minMaintenanceBlockMin: number;
};

export const DEFAULT_ESTIMATOR_CONFIG: EstimatorConfig = {
  setupMin: 8,
  perPlayerPerGameMin: 9,
  interGameResetMin: 2,
  turnoverMin: 10,
  maxPlayersPerLane: 6,
  bufferMultiplier: 1.15,
  slotGridMin: 15,
  minPlayBlockMin: 30,
  minMaintenanceBlockMin: 15,
};

/**
 * Scheduler tuning. At 4 lanes there's no real optimisation problem to solve — just
 * enumerate every grid-aligned candidate start near what was asked for, reject the
 * infeasible ones, and score what's left. These constants are what "good" means:
 * how far from the request is acceptable, and what counts as a wasted gap vs. a
 * clean fit. Guesses, same as the estimator's constants — correct after real use.
 */
export type SchedulerConfig = {
  /** How far from the requested time to look for candidates, each direction. */
  candidateWindowMin: number;
  /** A gap this small or smaller next to a placement counts as a clean fit — bonus. */
  perfectFitThresholdMin: number;
  /** A gap bigger than the perfect-fit threshold but smaller than this is "stranded"
   *  — too small to be useful to the next booking, too big to call a clean fit. Penalty. */
  orphanGapThresholdMin: number;
  /** Cost per minute of distance between a candidate and the requested start. */
  preferenceWeight: number;
  /** Cost per stranded gap (before and/or after) a candidate would create. */
  orphanGapWeight: number;
  /** Reward per clean-fit gap (before and/or after) a candidate would create. */
  perfectFitWeight: number;
  /** How many ranked candidates to return at most. */
  maxCandidates: number;
};

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  candidateWindowMin: 90,
  perfectFitThresholdMin: 10,
  orphanGapThresholdMin: 45,
  preferenceWeight: 1.0,
  orphanGapWeight: 0.5,
  perfectFitWeight: 15,
  maxCandidates: 5,
};
