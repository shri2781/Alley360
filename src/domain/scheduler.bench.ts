import { bench, describe } from "vitest";
import { findCandidates, type Allocation, type Lane, type ScheduleSnapshot } from "./scheduler";

const day = "2026-09-12";
const at = (hour: number, minute = 0) =>
  new Date(day + "T" + String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0") + ":00.000Z");

const lanes: Lane[] = Array.from({ length: 12 }, (_, index) => ({ id: "lane-" + (index + 1), number: index + 1 }));
const allocations: Allocation[] = lanes.flatMap((lane) =>
  Array.from({ length: 12 }, (_, index) => {
    const startMinute = index * 50;
    return {
      id: lane.id + "-" + index,
      laneId: lane.id,
      start: new Date(at(10).getTime() + startMinute * 60_000),
      end: new Date(at(10).getTime() + (startMinute + 40) * 60_000),
    };
  }),
);

const snapshot: ScheduleSnapshot = { lanes, allocations, openAt: at(10), closeAt: at(22) };

describe("[benchmark][performance] scheduler", () => {
  bench("finds candidates in a dense 12-lane day", () => {
    findCandidates(snapshot, { players: 4, games: 2, preferredStart: at(16) });
  });
});
