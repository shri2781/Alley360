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

/** How far either side of the requested time to look for a slot, by default. */
export const CANDIDATE_WINDOW_MIN = 30;

export type FindCandidatesOptions = {
  /** Flips the sort to closeness-first, packing-second. For a walk-in, preferredStart
   *  IS now -- someone is standing at the counter, and gapCost's cap (shortestSellableMin
   *  per side) means a lane that frees up later but butts up perfectly against the
   *  existing booking can otherwise outscore a lane that's free immediately. That's the
   *  right call for a scheduled booking (see "packing -- fewest dead minutes wins"
   *  below), but not for someone who can't be told to come back in 20 minutes. */
  prioritizeSoonest?: boolean;
  /** Extends the forward edge of the search to closing time instead of stopping at
   *  CANDIDATE_WINDOW_MIN. Also for walk-ins: "no lane free in the next 30 minutes"
   *  isn't the same as "no lane free today," and a walk-in should be offered the 4pm
   *  opening rather than turned away when nothing frees up sooner. The backward edge
   *  (relevant only to a preferredStart in the past, which `now` already excludes)
   *  is untouched. */
  searchUntilClose?: boolean;
};

/**
 * The public entry point. Returns the feasible starts within CANDIDATE_WINDOW_MIN of the
 * requested time (or up to closing -- see `searchUntilClose`), tightest-packing first.
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
  { prioritizeSoonest = false, searchUntilClose = false }: FindCandidatesOptions = {},
): Candidate[] {
  const estimate = estimateDuration(request.players, request.games, estimatorCfg);
  const shortestSellableMin = estimateDuration(1, 1, estimatorCfg).occupyMin;
  const grid = estimatorCfg.bookingGridMin;

  const windowStart = addMinutes(request.preferredStart, -CANDIDATE_WINDOW_MIN);
  const windowEnd = searchUntilClose
    ? snapshot.closeAt
    : addMinutes(request.preferredStart, CANDIDATE_WINDOW_MIN);

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

  const byGap = (a: (typeof scored)[number], b: (typeof scored)[number]) => a.gap - b.gap;
  const byDistance = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    Math.abs(minutesBetween(request.preferredStart, a.candidate.start)) -
    Math.abs(minutesBetween(request.preferredStart, b.candidate.start));

  // Walk-ins: closest to now wins, tightest packing only breaks a tie between two
  // equally-soon options. Everyone else: tightest packing wins, closeness breaks ties --
  // see "packing -- fewest dead minutes wins" in scheduler.test.ts for why that's right
  // when the requester picked a specific time rather than just showing up.
  scored.sort(prioritizeSoonest ? (a, b) => byDistance(a, b) || byGap(a, b) : (a, b) => byGap(a, b) || byDistance(a, b));

  return scored.map((s) => s.candidate);
}
