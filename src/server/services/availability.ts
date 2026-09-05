/**
 * Bridges the database to the pure scheduler (M3). Everything here does real I/O --
 * unlike src/domain, this is not unit-testable in isolation; it's verified against a
 * real Postgres, the same way prove-constraint.ts verifies the schema.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import { parseTstzrange } from "../../db/range";
import { lane, laneAllocation } from "../../db/schema";
import {
  DEFAULT_ESTIMATOR_CONFIG,
  DEFAULT_SCHEDULER_CONFIG,
  type EstimatorConfig,
  type SchedulerConfig,
} from "../../domain/config";
import {
  findCandidates,
  type Allocation,
  type Candidate,
  type Lane as SchedulerLane,
  type ScheduleSnapshot,
} from "../../domain/scheduler";
import { businessDate, rolloverHour, zonedInstant } from "../../domain/time";

/** The subset of a `tenant` row the scheduling code actually needs. */
export type Venue = {
  id: string;
  timezone: string;
  opensAtHour: number;
  closesAtHour: number;
};

export type AvailabilityRequest = {
  players: number;
  games: number;
  preferredStart: Date;
};

/**
 * Pulls this business date's lanes and live allocations out of Postgres and assembles
 * them into the plain-object shape the pure scheduler expects.
 *
 * Deliberately fetches every confirmed/active allocation for the tenant, not just ones
 * on `businessDateStr` -- at this scale (a handful of bookings a day) that's simpler
 * than a date-range query, and correct regardless: an allocation from a different day
 * will never overlap a candidate window on this one, so it's harmless, just unfiltered.
 */
export async function loadSnapshot(venue: Venue, businessDateStr: string): Promise<ScheduleSnapshot> {
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
    return { id: a.id, laneId: a.laneId, start, end };
  });

  return {
    lanes: schedulerLanes,
    allocations,
    openAt: zonedInstant(businessDateStr, venue.opensAtHour, venue.timezone),
    closeAt: zonedInstant(businessDateStr, venue.closesAtHour, venue.timezone),
  };
}

/** The read-only half of booking: what times could this request actually have? */
export async function getAvailability(
  venue: Venue,
  request: AvailabilityRequest,
  schedulerCfg: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
  estimatorCfg: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG,
): Promise<Candidate[]> {
  const bDate = businessDate(request.preferredStart, venue.timezone, rolloverHour(venue.closesAtHour));
  const snapshot = await loadSnapshot(venue, bDate);
  // Never offer a start that's already passed -- a preferred time near "now" would
  // otherwise pull in candidates from earlier in the candidate window (see M3's
  // scheduler.ts: it centers purely on preferredStart, blind to the clock).
  return findCandidates(snapshot, request, schedulerCfg, estimatorCfg, new Date());
}
