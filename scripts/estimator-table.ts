/**
 * Prints the duration grid so it can be put in front of the alley owner and corrected
 * on the spot. Every constant behind these numbers is a guess until someone who has
 * actually run a Friday night looks at them.
 *
 * Run: npm run estimator:table
 */
import { DEFAULT_ESTIMATOR_CONFIG as cfg } from "../src/domain/config.js";
import { estimateDuration } from "../src/domain/estimator.js";

const PLAYERS = [2, 3, 4, 5, 6, 8, 12];
const GAMES = [1, 2, 3];

const pad = (s: string | number, w: number) => String(s).padStart(w);

console.log(`
Duration estimates — ${cfg.setupMin} min setup, ${cfg.perPlayerPerGameMin} min per player per game,
${cfg.interGameResetMin} min between games, ${cfg.turnoverMin} min turnover, x${cfg.bufferMultiplier} buffer, ${cfg.slotGridMin} min grid.

  base    central estimate — is this roughly how long a group really takes?
  play    what we promise the lane for (base + safety margin)
  occupy  play + cleanup — the lane is unavailable this long
`);

console.log(
  `${pad("players", 8)}${pad("games", 7)}${pad("lanes", 7)}${pad("base", 8)}${pad("play", 8)}${pad("occupy", 8)}   rule of thumb`,
);
console.log("-".repeat(72));

for (const players of PLAYERS) {
  for (const games of GAMES) {
    const e = estimateDuration(players, games, cfg);
    // ~10 min per player per game, on the busiest lane (parties bowl in parallel).
    const rule = 10 * e.playersPerLane * games;
    console.log(
      pad(players, 8) +
        pad(games, 7) +
        pad(e.lanesNeeded, 7) +
        pad(`${e.baseMin}m`, 8) +
        pad(`${e.playMin}m`, 8) +
        pad(`${e.occupyMin}m`, 8) +
        `   ${rule}m`,
    );
  }
}

console.log(`
Note: for very short sessions the ${cfg.slotGridMin}-minute grid, not the buffer, is what
inflates the estimate (2 players x 1 game: ${estimateDuration(2, 1, cfg).baseMin}m base becomes ${estimateDuration(2, 1, cfg).playMin}m). That is
why a single quick game looks expensive to the scheduler.
`);
