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
Duration estimates — ${cfg.perPlayerPerGameMin} min per player per game, rounded to the
nearest ${cfg.bookingGridMin} minutes (ties round down). No setup cost, no safety buffer,
no turnover.

  base    the estimate, grid-rounded — is this roughly how long a group really takes?
  play    what we promise the lane for. Same number.
  occupy  how long the lane is unavailable. Same number — NO cleanup gap.
  rate    min per player per game this works out to AFTER rounding — should hover
          near ${cfg.perPlayerPerGameMin}, drifting slightly for small players x games products
`);

console.log(
  `${pad("players", 8)}${pad("games", 7)}${pad("lanes", 7)}${pad("base", 8)}${pad("play", 8)}${pad("occupy", 8)}${pad("rate", 8)}   rule of thumb`,
);
console.log("-".repeat(80));

for (const players of PLAYERS) {
  for (const games of GAMES) {
    const e = estimateDuration(players, games, cfg);
    const rule = 10 * players * games;
    // Back-derived from the ROUNDED baseMin, so this is expected to drift a little from
    // perPlayerPerGameMin, not match it exactly -- that drift is the rounding cost.
    const rate = e.baseMin / (players * games);
    console.log(
      pad(players, 8) +
        pad(games, 7) +
        pad(1, 7) +
        pad(`${e.baseMin}m`, 8) +
        pad(`${e.playMin}m`, 8) +
        pad(`${e.occupyMin}m`, 8) +
        pad(rate.toFixed(1), 8) +
        `   ${rule}m`,
    );
  }
}

console.log(`
Note: occupy equals play, so consecutive groups on a lane touch exactly — there is no
time budgeted for shoe return, lane wipe or scoring reset between them. Every estimate
above is a multiple of ${cfg.bookingGridMin}, so a booking that starts on the grid always ends on
it too — that's what lets the next booking start with zero gap.
`);
