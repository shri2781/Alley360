/**
 * Availability scheduler. Pure — no I/O, no clock, no database. Takes a snapshot of
 * today's schedule and a request, returns the feasible start times within
 * CANDIDATE_WINDOW_MIN of the requested one, tightest-packing first.
 *
 * "Tightest" means fewest dead minutes left on the lane — see gapCost(). Packing is the
 * primary sort so the board fills without stranding unusable slivers between bookings;
 * closeness to the requested time only breaks ties.
 */
import { DEFAULT_ESTIMATOR_CONFIG, type EstimatorConfig } from "./config";
import { estimateDuration } from "./estimator";
import { addMinutes, minutesBetween } from "./time";

export type Lane = {
  id: string;
  /** Physical position on the floor. Adjacency for multi-lane parties is defined by
   *  this number, not by array order or id. */
  number: number;
};

/** One existing claim on a lane, from `lane_allocation.occupies`. Half-open, same
 *  convention as the database: [start, end) — two allocations that just touch (one
 *  starts when another ends) are not overlapping. */
export type Allocation = {
  /** The lane_allocation row id. Optional so existing snapshot fixtures still compile;
   *  required in practice for checkMove(), which must exclude the allocation being
   *  moved from its own overlap check. */
  id?: string;
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
  /** End of the lane claim — what would become `occupies`. */
  end: Date;
  /** The lane this candidate would use, chosen automatically. Never shown to a customer
   *  — staff/UI concern, not this module's. Always exactly one. */
  laneIds: string[];
};

/** Rounds an instant to the nearest grid boundary (e.g. nearest :00/:15/:30/:45).
 *  Works in raw epoch time, which stays grid-aligned in any real timezone because every
 *  standard UTC offset (including the 30/45-minute ones) is itself a multiple of 15. */
export function roundToGrid(date: Date, gridMin: number): Date {
  const ms = gridMin * 60_000;
  return new Date(Math.round(date.getTime() / ms) * ms);
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Lanes with no allocation overlapping [start, end). */
function freeLanes(snapshot: ScheduleSnapshot, start: Date, end: Date): Lane[] {
  const busyLaneIds = new Set(
    snapshot.allocations.filter((a) => overlaps(a.start, a.end, start, end)).map((a) => a.laneId),
  );
  return snapshot.lanes.filter((l) => !busyLaneIds.has(l.id));
}

/**
 * Dead minutes this placement would leave behind on `laneId`: the gap to the nearest
 * booking ending before it, plus the gap to the nearest booking starting after it,
 * EACH CAPPED at the shortest booking anyone could actually sell. The venue's open/close
 * boundaries stand in when there is no neighbour on that side.
 *
 * The cap is what makes this a measure of WASTE rather than raw distance. Without it, a
 * slot butting straight onto the previous booking (gap 0) and one leaving a 2-hour-open
 * lane in front of it (gap 120) would differ by 120 -- correctly favouring the tight fit
 * -- but so would two slots that both leave unsellable slivers, say gaps of 3 and 8
 * minutes on an otherwise packed day: raw distance would rank the 3-minute sliver ahead
 * of the 8-minute one even though NEITHER can ever be booked, arbitrarily overriding the
 * closest-to-requested tie-break for a difference that changes nothing about how the lane
 * gets used. Capped at shortestSellableMin, both score the same (fully wasted) and the
 * request's actual preferred time decides between them, as it should.
 *
 * Zero means it slots in exactly back-to-back on both sides, wasting nothing.
 */
function gapCost(
  snapshot: ScheduleSnapshot,
  laneId: string,
  start: Date,
  end: Date,
  shortestSellableMin: number,
): number {
  let before = minutesBetween(snapshot.openAt, start);
  let after = minutesBetween(end, snapshot.closeAt);

  for (const a of snapshot.allocations) {
    if (a.laneId !== laneId) continue;
    if (a.end <= start) before = Math.min(before, minutesBetween(a.end, start));
    if (a.start >= end) after = Math.min(after, minutesBetween(end, a.start));
  }

  return Math.min(before, shortestSellableMin) + Math.min(after, shortestSellableMin);
}

/** The free lane this placement packs into tightest, or null if every lane is busy.
 *  Ties break to the lowest lane number, so the board stays predictable for staff. */
function bestLane(
  snapshot: ScheduleSnapshot,
  start: Date,
  end: Date,
  shortestSellableMin: number,
): Lane | null {
  const free = freeLanes(snapshot, start, end);
  if (free.length === 0) return null;

  return free.reduce((best, l) => {
    const diff =
      gapCost(snapshot, l.id, start, end, shortestSellableMin) -
      gapCost(snapshot, best.id, start, end, shortestSellableMin);
    return diff < 0 || (diff === 0 && l.number < best.number) ? l : best;
  });
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

  const shortestSellableMin = estimateDuration(1, 1, estimatorCfg).occupyMin;
  const lane = bestLane(snapshot, start, end, shortestSellableMin);
  if (!lane) return null;

  return { end, laneIds: [lane.id] };
}

export type MoveRejection =
  | "end_before_start"
  | "too_short"
  | "before_open"
  | "after_close"
  | "unknown_lane"
  | "lane_conflict"
  | "locked_start"
  | "locked_lane";

export type MoveCheck =
  | { ok: true; end: Date; playEnd: Date }
  | { ok: false; reason: MoveRejection; conflicts: Allocation[] };

/**
 * Validates a staff drag/resize of an EXISTING allocation to an arbitrary
 * [start, end) on a chosen lane. Deliberately separate from checkSlot(): that function
 * derives `end` from the estimator and picks its own lane, neither of which applies to
 * a manual override, and it has no notion of "the allocation being moved doesn't count
 * as a conflict with itself."
 *
 * No `now` parameter, unlike checkSlot/findCandidates -- those guard a customer-facing
 * booking flow against offering a start that's already passed. Staff correcting the
 * board after the fact (backdating a walk-in, fixing a mistake) is a legitimate use of
 * this function, so the past is not rejected here.
 */
export function checkMove(
  snapshot: ScheduleSnapshot,
  req: {
    allocationId: string;
    laneId: string;
    start: Date;
    end: Date;
    /** false for a maintenance allocation (kind: 'block'), which uses the smaller
     *  minMaintenanceBlockMin floor instead of minPlayBlockMin. */
    hasTurnover: boolean;
    /** Set when the allocation belongs to an active session: its start and lane are
     *  already real (session.started_at is recorded) and cannot be dragged, though the
     *  end may still move in either direction. */
    locked?: { start: Date; laneId: string };
  },
  estimatorCfg: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG,
): MoveCheck {
  if (!(req.end.getTime() > req.start.getTime())) {
    return { ok: false, reason: "end_before_start", conflicts: [] };
  }

  const minSpanMin = req.hasTurnover ? estimatorCfg.minPlayBlockMin : estimatorCfg.minMaintenanceBlockMin;
  if (minutesBetween(req.start, req.end) < minSpanMin) {
    return { ok: false, reason: "too_short", conflicts: [] };
  }

  if (req.start < snapshot.openAt) return { ok: false, reason: "before_open", conflicts: [] };
  if (req.end > snapshot.closeAt) return { ok: false, reason: "after_close", conflicts: [] };

  if (!snapshot.lanes.some((l) => l.id === req.laneId)) {
    return { ok: false, reason: "unknown_lane", conflicts: [] };
  }

  if (req.locked) {
    if (req.start.getTime() !== req.locked.start.getTime()) {
      return { ok: false, reason: "locked_start", conflicts: [] };
    }
    if (req.laneId !== req.locked.laneId) {
      return { ok: false, reason: "locked_lane", conflicts: [] };
    }
  }

  const conflicts = snapshot.allocations.filter(
    (a) => a.id !== req.allocationId && a.laneId === req.laneId && overlaps(a.start, a.end, req.start, req.end),
  );
  if (conflicts.length > 0) {
    return { ok: false, reason: "lane_conflict", conflicts };
  }

  // No turnover component anywhere any more, so play_window is always the full span.
  return { ok: true, end: req.end, playEnd: req.end };
}

/** How far either side of the requested time to look for a slot. */
export const CANDIDATE_WINDOW_MIN = 30;

/**
 * The public entry point. Returns the feasible starts within CANDIDATE_WINDOW_MIN of the
 * requested time, tightest-packing first.
 *
 * Candidate starts are exactly the bookingGridMin boundaries in that window -- nothing
 * off-grid. That's sufficient for zero-gap packing (not just a best effort): every
 * booking both starts AND lasts a multiple of bookingGridMin (estimator.ts), so it always
 * ends on the grid too, and the very next grid boundary is available to butt up against
 * it exactly.
 */
export function findCandidates(
  snapshot: ScheduleSnapshot,
  request: BookingRequest,
  estimatorCfg: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG,
  now?: Date,
): Candidate[] {
  const estimate = estimateDuration(request.players, request.games, estimatorCfg);
  const shortestSellableMin = estimateDuration(1, 1, estimatorCfg).occupyMin;
  const grid = estimatorCfg.bookingGridMin;

  const windowStart = addMinutes(request.preferredStart, -CANDIDATE_WINDOW_MIN);
  const windowEnd = addMinutes(request.preferredStart, CANDIDATE_WINDOW_MIN);

  const scored: { candidate: Candidate; gap: number }[] = [];

  for (let start = roundToGrid(windowStart, grid); start <= windowEnd; start = addMinutes(start, grid)) {
    if (start < windowStart) continue;
    const end = addMinutes(start, estimate.occupyMin);

    if (now && start < now) continue;
    if (start < snapshot.openAt || end > snapshot.closeAt) continue;

    const lane = bestLane(snapshot, start, end, shortestSellableMin);
    if (!lane) continue;

    scored.push({
      candidate: { start, end, laneIds: [lane.id] },
      gap: gapCost(snapshot, lane.id, start, end, shortestSellableMin),
    });
  }

  // Tightest packing wins; equally tight options go to whichever is closest to the
  // time actually asked for.
  scored.sort(
    (a, b) =>
      a.gap - b.gap ||
      Math.abs(minutesBetween(request.preferredStart, a.candidate.start)) -
        Math.abs(minutesBetween(request.preferredStart, b.candidate.start)),
  );

  return scored.map((s) => s.candidate);
}
