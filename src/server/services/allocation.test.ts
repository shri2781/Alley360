import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  loadSnapshot: vi.fn(),
}));

vi.mock("../../db/client", () => ({
  db: { transaction: mocks.transaction },
}));

vi.mock("./availability", () => ({
  loadSnapshot: mocks.loadSnapshot,
}));

import { moveAllocation, MoveRejectedError } from "./allocation";

describe("[unit][lifecycle] booking moves", () => {
  beforeEach(() => {
    mocks.loadSnapshot.mockResolvedValue({
      lanes: [{ id: "L1", number: 1 }],
      allocations: [],
      openAt: new Date("2026-09-12T10:00:00.000Z"),
      closeAt: new Date("2026-09-12T22:00:00.000Z"),
    });
  });

  it("rejects every attempted change once a booking has started", async () => {
    const lockRow = vi.fn().mockResolvedValue([
      {
        allocation: { id: "A1", status: "active" },
        booking: { id: "B1", status: "active" },
      },
    ]);
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({ for: lockRow })),
          })),
        })),
      })),
      update: vi.fn(),
    };
    mocks.transaction.mockImplementation(async (fn) => fn(tx));

    await expect(
      moveAllocation(
        { id: "V1", timezone: "UTC", opensAtHour: 10, closesAtHour: 22 },
        {
          allocationId: "A1",
          laneId: "L1",
          startISO: "2026-09-12T14:00:00.000Z",
          endISO: "2026-09-12T16:00:00.000Z",
        },
      ),
    ).rejects.toMatchObject({ reason: "active" } satisfies Partial<MoveRejectedError>);

    expect(tx.update).not.toHaveBeenCalled();
  });
});
