/**
 * Bridges the database to the pure scheduler (M3). Everything here does real I/O --
 * unlike src/domain, this is not unit-testable in isolation; it's verified against a
 * real Postgres, the same way prove-constraint.ts verifies the schema.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import { parseTstzrange } from "../../db/range";
import { lane, laneAllocation } from "../../db/schema";
import { DEFAULT_ESTIMATOR_CONFIG, type EstimatorConfig } from "../../domain/config";
import { businessDateFor, hoursForDate, venueWindow } from "../../domain/hours";
import {
  findCandidates,
  type Allocation,
  type Candidate,
  type Lane as SchedulerLane,
  type ScheduleSnapshot,
} from "../../domain/scheduler";
import type { Venue } from "../venue";

export type { Venue } from "../venue";

export type AvailabilityRequest = {
  players: number;
  games: number;
  preferredStart: Date;
};

/**
 * Pulls this business date's lanes and live allocations out of Postgres and assembles
 * them into the plain-object shape the pure scheduler expects. Returns null on a day
 * the venue is closed -- callers must handle that rather than being handed an empty
 * or nonsensical window.
 *
 * Deliberately fetches every confirmed/active allocation for the tenant, not just ones
 * on `businessDateStr` -- at this scale (a handful of bookings a day) that's simpler
 * than a date-range query, and correct regardless: an allocation from a different day
 * will never overlap a candidate window on this one, so it's harmless, just unfiltered.
 */
export async function loadSnapshot(venue: Venue, businessDateStr: string): Promise<ScheduleSnapshot | null> {
  const window = venueWindow(businessDateStr, venue.timezone, venue.weeklyHours);
  if (!window) return null;

  const lanes = await db
    .select()
    .from(lane)
    .where(and(eq(lane.tenantId, venue.id), eq(lane.isActive, true)));

  const rawAllocations = await db
    .select()
    .from(laneAllocation)
    .where(and(eq(laneAllocation.tenantId, venue.id), inArray(laneAllocation.status, ["confirmed", "active"])));

  const schedulerLanes: SchedulerLane[] = lanes.map((l) => ({ id: l.id, number: l.number }));
  const allocations: Allocation[] = rawAllocations.map((a) => {
    const { start, end } = parseTstzrange(a.occupies);
    return { laneId: a.laneId, start, end };
  });

  return { lanes: schedulerLanes, allocations, openAt: window.openAt, closeAt: window.closeAt };
}

export type AvailabilityResult =
  | { status: "closed"; businessDate: string }
  | { status: "open"; businessDate: string; candidates: Candidate[] };

/** The read-only half of booking: what times could this request actually have? */
export async function getAvailability(
  venue: Venue,
  request: AvailabilityRequest,
  estimatorCfg: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG,
): Promise<AvailabilityResult> {
  const bDate = businessDateFor(request.preferredStart, venue.timezone, venue.weeklyHours);
  const snapshot = await loadSnapshot(venue, bDate);
  if (!snapshot) return { status: "closed", businessDate: bDate };

  // Never offer a start that's already passed -- the scheduler itself is blind to the clock.
  const candidates = findCandidates(snapshot, request, estimatorCfg, new Date());
  return { status: "open", businessDate: bDate, candidates };
}

/** hoursForDate re-exported for callers that already have a business date and just
 *  need that day's own open/close minutes (e.g. to price a rate whose window is
 *  null-bounded). */
export { hoursForDate };
