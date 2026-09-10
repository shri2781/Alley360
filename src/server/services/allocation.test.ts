import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock("../../db/client", () => ({
  db: { transaction: mocks.transaction },
}));

import { moveAllocation } from "./allocation";
import type { DayHours, WeeklyHours } from "../../domain/hours";
import type { Venue } from "../venue";

const DAY: DayHours = { dayOfWeek: 0, isClosed: false, opensAtMin: 600, closesAtMin: 1320 };
const WEEKLY_HOURS = Array.from({ length: 7 }, (_, dayOfWeek) => ({ ...DAY, dayOfWeek })) as unknown as WeeklyHours;
const VENUE: Venue = { id: "V1", name: "Test Venue", timezone: "UTC", weeklyHours: WEEKLY_HOURS };
const OCCUPIES = "[2026-09-12T14:00:00.000Z,2026-09-12T16:00:00.000Z)";

function txFor(status: "confirmed" | "active") {
  const lockRow = vi.fn().mockResolvedValue([
    {
      allocation: { id: "A1", status, occupies: OCCUPIES, laneId: "L1" },
      booking: { id: "B1", status, kind: "open_play" },
    },
  ]);
  const siblingRows = vi.fn().mockResolvedValue([{ occupies: OCCUPIES }]);
  const tx = {
    select: vi.fn((cols) => {
      // First call reads the allocation+booking row; the second reads siblings.
      if ("allocation" in cols) {
        return { from: vi.fn(() => ({ innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ for: lockRow })) })) })) };
      }
      return { from: vi.fn(() => ({ where: siblingRows })) };
    }),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
  };
  mocks.transaction.mockImplementation(async (fn) => fn(tx));
  return tx;
}

describe("[unit][lifecycle] booking moves", () => {
  it("moves an in-progress session's start and lane, same as a confirmed one", async () => {
    const tx = txFor("active");

    const result = await moveAllocation(VENUE, {
      allocationId: "A1",
      laneId: "L2",
      startISO: "2026-09-12T14:15:00.000Z",
      endISO: "2026-09-12T16:15:00.000Z",
    });

    expect(result.laneId).toBe("L2");
    expect(result.start).toEqual(new Date("2026-09-12T14:15:00.000Z"));
    expect(tx.update).toHaveBeenCalled();
  });

  it("accepts a placement outside venue hours and below any length floor", async () => {
    txFor("confirmed");

    const result = await moveAllocation(VENUE, {
      allocationId: "A1",
      laneId: "L1",
      // 03:00 is hours before the 10:00 open, and the span is 30 seconds.
      startISO: "2026-09-12T03:00:00.000Z",
      endISO: "2026-09-12T03:00:30.000Z",
    });

    expect(result.end).toEqual(new Date("2026-09-12T03:00:30.000Z"));
  });

  it("rejects an inverted range -- Postgres cannot store one", async () => {
    txFor("confirmed");

    await expect(
      moveAllocation(VENUE, {
        allocationId: "A1",
        laneId: "L1",
        startISO: "2026-09-12T16:00:00.000Z",
        endISO: "2026-09-12T14:00:00.000Z",
      }),
    ).rejects.toMatchObject({ reason: "end_before_start" });
  });
});
