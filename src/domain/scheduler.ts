/**
 * Availability scheduler. Pure — no I/O, no clock, no database. Takes a snapshot of
 * today's schedule and a request, returns a ranked list of good candidate start times.
 *
 * At 4 lanes there is a real (if small) combinatorial question — which of a handful of
 * feasible times and lane assignments is actually the best one to offer — but not one
 * that needs a solver. ~14 open hours on a 15-minute grid is at most ~56 candidate starts,
 * and there are only 4 lanes to check each against. Enumerate everything, reject what
 * doesn't fit, score what's left. See DEFAULT_SCHEDULER_CONFIG in config.ts for what
 * "good" means here.
 *
 * This module never picks a lane for the customer to see or choose — it just decides,
 * internally, which lane(s) a given time slot would actually use, so scoring can account
 * for the schedule that placement would leave behind.
 */
import {
  DEFAULT_ESTIMATOR_CONFIG,
  DEFAULT_SCHEDULER_CONFIG,
  type EstimatorConfig,
  type SchedulerConfig,
} from "./config";
import { estimateDuration } from "./estimator";
import { addMinutes, minutesBetween } from "./time";

export type Lane = {
  id: string;
  /** Physical position on the floor. Adjacency for multi-lane parties is defined by
   *  this number, not by array order or id. */
  number: number;
};

/** One existing claim on a lane, from `lane_allocation.occupies` — already includes
 *  turnover, so two allocations that just touch (one starts when another ends) are
 *  not overlapping. Half-open, same convention as the database: [start, end). */
export type Allocation = {
  laneId: string;
  start: Date;
  end: Date;
};

export type ScheduleSnapshot = {
  lanes: Lane[];
  allocations: Allocation[];
  openAt: Date;
  closeAt: Date;
};

export type BookingRequest = {
  players: number;
  games: number;
  preferredStart: Date;
};

export type Candidate = {
  start: Date;
  /** End of the full lane claim (play + turnover) — what would become `occupies`. */
  end: Date;
  /** The lane(s) this candidate would actually use, chosen automatically. Never shown
   *  to a customer — staff/UI concern, not this module's. */
  laneIds: string[];
  /** Lower is better. */
  score: number;
};

/** Rounds an instant to the nearest grid boundary (e.g. nearest :00/:15/:30/:45).
 *  Works in raw epoch time, which stays grid-aligned in any real timezone because every
 *  standard UTC offset (including the 30/45-minute ones) is itself a multiple of 15. */
function roundToGrid(date: Date, gridMin: number): Date {
  const ms = gridMin * 60_000;
  return new Date(Math.round(date.getTime() / ms) * ms);
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Lane numbers with no allocation overlapping [start, end), sorted ascending. */
function freeLaneNumbers(snapshot: ScheduleSnapshot, start: Date, end: Date): number[] {
  const busyLaneIds = new Set(
    snapshot.allocations
      .filter((a) => overlaps(a.start, a.end, start, end))
      .map((a) => a.laneId),
  );
  return snapshot.lanes
    .filter((l) => !busyLaneIds.has(l.id))
    .map((l) => l.number)
    .sort((a, b) => a - b);
}

/**
 * The lowest-numbered run of `count` consecutive free lane numbers, or null if none
 * exists. For a single lane (the common case) this is just "the lowest free lane."
 * Lowest-first is a deliberate, simple tie-break — with identical lanes and no other
 * signal to prefer one over another, consistently picking the same one keeps the
 * schedule easy for staff to reason about, and is optimal for pure feasibility at
 * this scale (interval graphs are perfect: max overlap < lane count is sufficient).
 */
function findContiguousBlock(freeNumbers: number[], count: number): number[] | null {
  const free = new Set(freeNumbers);
  const sorted = [...freeNumbers].sort((a, b) => a - b);
  for (const start of sorted) {
    const block = Array.from({ length: count }, (_, i) => start + i);
    if (block.every((n) => free.has(n))) return block;
  }
  return null;
}

function laneIdsForNumbers(lanes: Lane[], numbers: number[]): string[] {
  const byNumber = new Map(lanes.map((l) => [l.number, l.id]));
  return numbers.map((n) => {
    const id = byNumber.get(n);
    if (!id) throw new Error(`no lane with number ${n}`);
    return id;
  });
}

/** Minutes between `instant` and the nearest neighbouring allocation edge on `laneId`
 *  on the given side, or the venue's open/close boundary if there's no allocation there.
 *  Always >= 0 for a feasible candidate — feasibility is checked before this runs. */
function gapMinutes(
  snapshot: ScheduleSnapshot,
  laneId: string,
  instant: Date,
  side: "before" | "after",
): number {
  const onLane = snapshot.allocations.filter((a) => a.laneId === laneId);

  if (side === "before") {
    const priorEnds = onLane.filter((a) => a.end <= instant).map((a) => a.end);
    const boundary = priorEnds.length > 0 ? new Date(Math.max(...priorEnds.map((d) => d.getTime()))) : snapshot.openAt;
    return Math.max(0, minutesBetween(boundary, instant));
  }

  const laterStarts = onLane.filter((a) => a.start >= instant).map((a) => a.start);
  const boundary = laterStarts.length > 0 ? new Date(Math.min(...laterStarts.map((d) => d.getTime()))) : snapshot.closeAt;
  return Math.max(0, minutesBetween(instant, boundary));
}

/**
 * Score a feasible placement. Lower is better.
 *
 *   + preferenceWeight  x  minutes away from what was actually requested
 *   + orphanGapWeight   x  number of sides (before/after) left stranded — too small
 *                          to be useful to the next booking, too big to call clean
 *   - perfectFitWeight  x  number of sides that land as a clean fit (near-zero gap)
 *
 * Checked per lane in the placement — a multi-lane party is scored on the worst gap
 * situation across its lanes, since a stranded gap on any one of them still fragments
 * the schedule.
 */
function scoreCandidate(
  snapshot: ScheduleSnapshot,
  laneIds: string[],
  start: Date,
  end: Date,
  preferredStart: Date,
  cfg: SchedulerConfig,
): number {
  const preferenceCost = cfg.preferenceWeight * Math.abs(minutesBetween(preferredStart, start));

  let orphanCount = 0;
  let perfectFitCount = 0;

  for (const laneId of laneIds) {
    for (const side of ["before", "after"] as const) {
      const gap = side === "before" ? gapMinutes(snapshot, laneId, start, "before") : gapMinutes(snapshot, laneId, end, "after");
      if (gap <= cfg.perfectFitThresholdMin) perfectFitCount += 1;
      else if (gap < cfg.orphanGapThresholdMin) orphanCount += 1;
    }
  }

  return preferenceCost + cfg.orphanGapWeight * orphanCount - cfg.perfectFitWeight * perfectFitCount;
}

export type SlotCheck = { end: Date; laneIds: string[] } | null;

/**
 * Checks feasibility of exactly ONE start time — no enumeration, no ranking, no
 * substitution. Used to re-confirm a slot a customer already picked from a candidate
 * list: findCandidates() might legitimately return a DIFFERENT "best" time if state has
 * shifted since the list was shown, and silently booking that instead of what the
 * customer actually clicked would be a real bug, not a helpful fallback. This returns
 * null rather than ever picking something else.
 */
export function checkSlot(
  snapshot: ScheduleSnapshot,
  start: Date,
  request: Pick<BookingRequest, "players" | "games">,
  estimatorCfg: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG,
  now?: Date,
): SlotCheck {
  const estimate = estimateDuration(request.players, request.games, estimatorCfg);
  const end = addMinutes(start, estimate.occupyMin);

  if (now && start < now) return null;
  if (start < snapshot.openAt || end > snapshot.closeAt) return null;

  const free = freeLaneNumbers(snapshot, start, end);
  const block = findContiguousBlock(free, estimate.lanesNeeded);
  if (!block) return null;

  return { end, laneIds: laneIdsForNumbers(snapshot.lanes, block) };
}

/**
 * The public entry point. Given today's schedule and a request, returns up to
 * `cfg.maxCandidates` feasible start times, best (lowest score) first.
 */
export function findCandidates(
  snapshot: ScheduleSnapshot,
  request: BookingRequest,
  schedulerCfg: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
  estimatorCfg: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG,
  now?: Date,
): Candidate[] {
  const estimate = estimateDuration(request.players, request.games, estimatorCfg);
  const grid = estimatorCfg.slotGridMin;

  const center = roundToGrid(request.preferredStart, grid);
  const steps = Math.round(schedulerCfg.candidateWindowMin / grid);

  const candidates: Candidate[] = [];

  for (let i = -steps; i <= steps; i++) {
    const start = addMinutes(center, i * grid);
    const end = addMinutes(start, estimate.occupyMin);

    if (now && start < now) continue;
    if (start < snapshot.openAt || end > snapshot.closeAt) continue;

    const free = freeLaneNumbers(snapshot, start, end);
    const block = findContiguousBlock(free, estimate.lanesNeeded);
    if (!block) continue;

    const laneIds = laneIdsForNumbers(snapshot.lanes, block);
    const score = scoreCandidate(snapshot, laneIds, start, end, request.preferredStart, schedulerCfg);

    candidates.push({ start, end, laneIds, score });
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates.slice(0, schedulerCfg.maxCandidates);
}
