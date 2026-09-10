import { describe, expect, it } from "vitest";
import { confirmBooking, findTimes } from "./actions";

describe("[unit][customer] booking server actions", () => {
  it("rejects an emoji-only or emoji-containing customer name before attempting a booking", async () => {
    await expect(
      confirmBooking({
        players: 4,
        games: 2,
        startIso: "2026-09-12T14:00:00.000Z",
        customerName: "Riya 🎳",
        customerPhone: "9876543210",
      }),
    ).resolves.toEqual({ ok: false, message: "Enter a valid name using letters, spaces, apostrophes, or hyphens." });
  });

  it("does not query availability for malformed or impossible search input", async () => {
    // Each of these fails validation before findTimes() ever calls getVenue(), which is
    // what lets this test run without a database -- see the ordering comment in actions.ts.
    await expect(findTimes({ players: 25, games: 2, dateStr: "2026-09-12", hourStr: "19:00" })).resolves.toEqual({
      status: "invalid",
    });
    await expect(findTimes({ players: 4, games: 2, dateStr: "2026-02-29", hourStr: "19:00" })).resolves.toEqual({
      status: "invalid",
    });
    await expect(findTimes({ players: 4, games: 2, dateStr: "2026-09-12", hourStr: "24:00" })).resolves.toEqual({
      status: "invalid",
    });
  });
});
