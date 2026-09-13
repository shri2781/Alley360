# Alley360

A booking and lane-management platform for a bowling alley — a public booking site for
customers and an operations console for staff, backed by a scheduler that actually
understands how bowling works.

## Why this isn't just a calendar app

A bowling session doesn't fit a fixed time slot. How long a lane is occupied depends on
how many people are playing and how many games they're playing — a 2-player game and a
10-player party take very different amounts of time, and a party large enough gets split
across adjacent lanes automatically. So instead of booking "7:00–8:00 PM," the system:

1. **Estimates duration** from players and games (a calibratable formula, not a guess per
   booking) — split into a central estimate, a safety-buffered commitment, and the full
   lane claim including cleanup time.
2. **Finds real available times** by checking the live schedule, not a fixed grid of
   slots — customers see actual open times near what they asked for.
3. **Guarantees no double-booking at the database level.** A PostgreSQL exclusion
   constraint makes it structurally impossible for two bookings to claim the same lane
   at overlapping times — not "the app checks for this," but the database itself refuses
   the write, regardless of race conditions or bugs elsewhere in the code.

## Algorithms — then and now

The scheduling logic went through one big rewrite (`fa10bac`, "made the math algo
simpler"), plus a smaller follow-up for walk-ins (this section describes both, since
old code still shows up in git history and in muscle memory even after it's gone).

### Duration estimation (`src/domain/estimator.ts`, `config.ts`)

**Before `fa10bac`:** a three-quantity model —

- `lanesNeeded = ceil(players / maxPlayersPerLane)`, splitting a large party across
  adjacent lanes so they play in **parallel** (a 12-person party on 2 lanes took as long
  as a 6-person group on one, not twice as long).
- `baseMin = setupMin + games × (playersPerLane × perPlayerPerGameMin + interGameResetMin)`
  — the central estimate, comparable to the industry "~10 min/player/game" rule.
- `playMin = ceilToGrid(baseMin × bufferMultiplier, slotGridMin)` — a ~P75 commitment,
  not the mean. Justified via the newsvendor model (`q* = Cu/(Cu+Co)`): underestimating
  (an overrun, a visibly delayed customer) was judged ~3x costlier than overestimating
  (idle lane minutes), giving a 1.15 buffer multiplier.
- `occupyMin = ceilToGrid(playMin + turnoverMin, slotGridMin)` — the real lane claim
  (`lane_allocation.occupies`), including shoe return/wipe-down/scoring-reset overhead.
  Derived from the *rounded* `playMin`, not the raw value — rounding once from the raw
  number could swallow the turnover into the same grid cell and leave a zero-minute gap
  between groups.
- Defaults: `setupMin: 8, perPlayerPerGameMin: 9, interGameResetMin: 2, turnoverMin: 10,
  maxPlayersPerLane: 6, bufferMultiplier: 1.15, slotGridMin: 15`.

**Now:** collapsed to one line — `minutes = round(players × games × perPlayerPerGameMin,
bookingGridMin)` (ties round down, floored at one grid cell). `baseMin === playMin ===
occupyMin`, all the same number. No buffer, no turnover, no lane splitting — a 20-person
party takes 20x as long on one lane, it doesn't spread across lanes anymore.
Default: `perPlayerPerGameMin: 9, bookingGridMin: 10`. The upside of the simpler model:
because every booking both **starts and lasts** a multiple of `bookingGridMin`, it always
*ends* on the grid too, so the next booking can start there with a provable zero-minute
gap — the old model could only get close to that by construction, not guarantee it.

### Picking a lane/time (`src/domain/scheduler.ts`)

**Before `fa10bac`:** `findCandidates` enumerated grid-aligned starts within
`candidateWindowMin` (90 min) of the requested time and scored each feasible one as a
weighted sum (lower is better), via `DEFAULT_SCHEDULER_CONFIG`:

```
score = preferenceWeight(1.0) × |minutes from requested time|
      + orphanGapWeight(0.5)  × (sides left with a 10–45 min "stranded" gap)
      − perfectFitWeight(15)  × (sides landing within 10 min of a neighbour)
```

Closeness and packing both pulled on the same score continuously — a big enough
perfect-fit bonus *could* out-vote a moderate distance, but the weights weren't chosen to
guarantee it either way. Returned the top 5 (`maxCandidates`).

**Now:** `bestLane` picks whichever free lane leaves the fewest dead minutes
(`gapCost` — the gap to the nearest neighbour on each side, each **capped** at
`shortestSellableMin` so two equally-unsellable slivers score the same instead of one
arbitrarily beating the other). `findCandidates` enumerates every grid-aligned start
within `CANDIDATE_WINDOW_MIN` (30 min, a plain constant, not tunable via config anymore)
and sorts by `gapCost` **first**, closeness to the requested time only as a tie-break.
That's a deliberate, lexicographic version of "packing wins" rather than a blend — see
the `packing -- fewest dead minutes wins` tests in `scheduler.test.ts`. No cap on how
many candidates come back.

**Today's fix (walk-ins only), two parts:**

1. *Ranking.* The packing-first sort is right for a scheduled booking (a customer asking
   for 2:30 may reasonably get offered an exact-fit 2:00 instead), but wrong for a
   walk-in, whose "requested time" is always *now* — someone standing at the counter.
   Because `gapCost` caps each side at ~10 minutes, a lane that frees up later but butts
   up perfectly against an existing booking (gap 0) could out-rank a lane that's free
   immediately but leaves a large, capped-down gap — the walk-in got queued behind an
   occupied lane instead of seated on the free one. `findCandidates` now takes a
   `prioritizeSoonest` option (set by `createBooking` whenever `source === "walkin"`)
   that flips the sort to closeness-first, packing-second — so "next best available
   slot" means what a walk-in actually needs it to mean: the soonest lane, full stop,
   with packing only breaking a tie between two equally-soon options.
2. *Window.* `CANDIDATE_WINDOW_MIN` (30 min) is the right horizon for a scheduled
   booking, but "nothing free in the next 30 minutes" isn't the same as "nothing free
   today" — a walk-in should be offered a 4pm opening, not turned away because the board
   happens to be packed solid for the next half hour. A `searchUntilClose` option
   extends the forward edge of the search to the venue's actual closing time instead of
   `preferredStart + CANDIDATE_WINDOW_MIN`. `NoAvailabilityError` ("no lane free right
   now") now only fires for a walk-in when nothing opens up before close, not just
   within the next 30 minutes; scheduled bookings are untouched.

### Staff dragging a booking on the timeline (`src/domain/scheduler.ts` → `src/server/services/allocation.ts`)

**Before `removed constraints on block` (`d83dbd6`):** a dedicated `checkMove` validated
every drag/resize against: minimum span (`minPlayBlockMin`/`minMaintenanceBlockMin`),
venue open/close hours, lane conflicts (excluding the allocation being moved from its
own overlap check), and a "locked" start/lane for allocations belonging to an
already-started session (the end could still move, not the start or lane).

**Now:** staff overrides are trusted outright. `moveAllocation` only rejects an inverted
range (`end <= start`, which Postgres' `tstzrange` would hard-error on anyway), a
not-found allocation, or one already released. No length floor, no hours check, no
pre-flight overlap check — the only thing stopping two allocations from landing on the
same lane/time is the database's exclusion constraint itself, caught after the fact and
surfaced as a `conflict` rejection. This is intentional: staff can freely move a block
anywhere on the board now, which is the behavior this README's booking-logic section
above assumes.

### The one guarantee that never moved

Whatever the application-level scheduling logic decides, the PostgreSQL exclusion
constraint on `lane_allocation` is the actual backstop — see "Why this isn't just a
calendar app" above. Both eras of this code have relied on it the same way: pick a
placement application-side, then let the database reject the write (and retry/report)
if something else claimed it first.

## What's here

**Customer-facing** (`/`, `/book`) — a landing page with live pricing packages, and a
booking flow that shows real available times pulled from the current schedule, picks the
best lane automatically, and never asks the customer to choose one.

**Staff console** (`/staff/*`) — a live timeline of all lanes from now through closing,
a bookings list with Start/End/Cancel, a walk-in flow (create and start a session in one
step), and settings for pricing and lane count. Gated behind a login (`/staff/login`) —
see [Staff login](#staff-login) below.

## Staff login

`/staff/*` is not public. One shared username/password protects the whole console —
no per-person accounts, no audit trail of who did what, by design: for a single small
alley where everyone on shift is trusted, that complexity isn't worth it, and the table
shape (`staff_user`) means adding a second login later is an `INSERT`, not a rewrite.

The password is hashed (`node:crypto` scrypt — no new dependency) and the session is a
signed cookie (`node:crypto` HMAC-SHA256), not a plaintext passcode sitting in `.env`.
Enforcement is three layers deep, because none of them alone is sufficient:

1. **`src/proxy.ts`** — optimistic, cookie-only, redirects a logged-out visitor before
   a page even renders. (Next.js 16 renamed `middleware.ts` to `proxy.ts` — same
   mechanism, new name.)
2. **`src/app/staff/(console)/layout.tsx`** — re-checks the session against the database
   (`staff_user.is_active`), so deactivating the account takes effect immediately even
   though the cookie itself is stateless and would otherwise keep verifying until it
   expires.
3. **Every mutating Server Action** — the actual boundary. A proxy matcher that skips a
   path also skips Server Actions called from it, so hiding a page is never enough on
   its own; each of the 11 mutating staff actions checks the session itself.

A session lasts 12 hours and slides forward on activity (refreshed by `proxy.ts`), so a
normal shift never needs a re-login but a terminal left overnight is logged out by
morning. Change the password from `/staff/settings` → Account.

## Stack

TypeScript throughout. [Next.js](https://nextjs.org/) (App Router) for both the customer
site and the staff console, plain CSS Modules (no UI framework). PostgreSQL 16 via
Docker, [Drizzle ORM](https://orm.drizzle.team/) for typed queries. Vitest for the
domain-logic test suite. Staff auth uses Node's built-in `crypto` (scrypt + HMAC) rather
than an external auth library — see [Staff login](#staff-login).

## Getting started

Requires Node.js, Docker Desktop (with WSL2 on Windows), and npm.

```bash
npm install
copy .env.example .env      # (or `cp` on macOS/Linux)
                              # then edit .env -- set a real SESSION_SECRET and a
                              # STAFF_USERNAME/STAFF_PASSWORD for the seeded login

npm run db:up                # starts Postgres in Docker, port 5433
npm run db:reset             # builds the schema, seeds one venue + 4 lanes + 3
                              # packages + the one staff login from .env
npm run dev                  # http://localhost:3000  (customer site)
                              # http://localhost:3000/staff  (staff console -- login required)
```

## Project structure

```
src/
  domain/          Pure scheduling logic — no I/O, no database, no clock.
    estimator.ts     Session duration from players + games.
    scheduler.ts      Finds and scores available lane/time combinations.
    time.ts           Timezone-correct instant/business-date conversions.

  db/
    schema.sql        Source of truth for the database (tables, the exclusion
                       constraint). Hand-written — see the comment at its top for why.
    schema.ts          Typed mirror of schema.sql for Drizzle queries.

  server/
    services/          Booking lifecycle: create/cancel/block a booking, start/end
                        a session. Each function is one transaction.
    auth/                Staff login: password hashing, signed-cookie sessions, the
                          DAL (getStaffUser/requireStaff), an in-memory rate limiter.
    timeline.ts         Staff timeline data (lane state across a time window).
    bookingsList.ts      Today's bookings for the staff Bookings page.
    packages.ts, venue.ts, lanes.ts  Small shared lookups.

  app/
    (customer)/         Public site: landing page ("/") and booking flow ("/book").
    staff/
      login/             Public login page -- outside the (console) group, so it
                          isn't itself gated by the layout below.
      (console)/         Everything that requires login: Lane Allotment, Bookings,
                          Walk-ins, Settings. A route group, so it adds no URL
                          segment -- "/staff/bookings" is unchanged.

  components/          Shared UI pieces used across routes.

  proxy.ts             Optimistic auth check on /staff/* -- see "Staff login" above.

scripts/                Dev tools: reset/seed the database, verify the exclusion
                        constraint against a live Postgres, print the duration-estimate
                        table, demo the scheduler and booking service standalone.
```

**A convention worth knowing:** relative imports never use a file extension
(`from "../db/client"`, not `"../db/client.js"`). The same source files run under two
different module resolvers — `tsx` for the scripts, Next.js's Turbopack for the app —
and only extensionless imports resolve correctly under both.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app (customer site + staff console) |
| `npm run db:up` / `db:down` | Start / stop the Postgres container |
| `npm run db:reset` | Rebuild the database from `src/db/schema.sql` and reseed it |
| `npm run db:seed` | Reseed only (assumes the schema already exists) |
| `npm run prove:constraint` | Proves the overlap-prevention database constraint works, against a live Postgres |
| `npm run estimator:table` | Prints the duration-estimate grid for a range of players/games |
| `npm run scheduler:demo` | Loads a fixture day and prints ranked available times for a sample request |
| `npm run booking:demo` | Exercises the booking service (availability → create → start → end → cancel → block) against a live Postgres |
| `npm run demo:seed` | Populates a believable board (playing / booked-soon / maintenance / available) via real bookings |
| `npm test` | Runs the domain-logic test suite (pure logic, no database) |
| `npm run typecheck` | TypeScript type-checking, no build output |
