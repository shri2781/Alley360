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
