/**
 * M3 exit criterion: load a fixture day and print ranked candidates for a sample
 * request. No database -- the scheduler is pure, so this is just calling it with
 * made-up data, the same way scheduler.test.ts does.
 *
 * Run: npm run scheduler:demo
 */
import { findCandidates, type Allocation, type Lane, type ScheduleSnapshot } from "../src/domain/scheduler.js";

const DAY = "2026-09-12";
const t = (hm: string) => new Date(`${DAY}T${hm}:00.000Z`);
const fmt = (d: Date) => d.toISOString().slice(11, 16);

const lanes: Lane[] = [
  { id: "lane-1", number: 1 },
  { id: "lane-2", number: 2 },
  { id: "lane-3", number: 3 },
  { id: "lane-4", number: 4 },
];

// A moderately busy Saturday afternoon: two lanes already booked, two open.
const allocations: Allocation[] = [
  { laneId: "lane-1", start: t("13:00"), end: t("15:00") },
  { laneId: "lane-2", start: t("14:30"), end: t("16:15") },
];

const snapshot: ScheduleSnapshot = { lanes, allocations, openAt: t("10:00"), closeAt: t("22:00") };

console.log("Today's existing schedule:");
for (const a of allocations) {
  const laneNumber = lanes.find((l) => l.id === a.laneId)?.number;
  console.log(`  Lane ${laneNumber}: ${fmt(a.start)}-${fmt(a.end)}`);
}

const request = { players: 4, games: 2, preferredStart: t("14:30") };
console.log(
  `\nRequest: ${request.players} players, ${request.games} games, preferred start ${fmt(request.preferredStart)}\n`,
);

const candidates = findCandidates(snapshot, request);

if (candidates.length === 0) {
  console.log("No feasible times found.");
} else {
  console.log("Ranked candidates (best first):");
  candidates.forEach((c, i) => {
    const laneNumbers = c.laneIds.map((id) => lanes.find((l) => l.id === id)?.number).join(", ");
    console.log(
      `  ${i + 1}. ${fmt(c.start)}-${fmt(c.end)}  lane(s) ${laneNumbers}  score ${c.score.toFixed(2)}`,
    );
  });
}
