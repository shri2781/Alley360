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
step), and settings for pricing and lane count.

## Stack

TypeScript throughout. [Next.js](https://nextjs.org/) (App Router) for both the customer
site and the staff console, plain CSS Modules (no UI framework). PostgreSQL 16 via
Docker, [Drizzle ORM](https://orm.drizzle.team/) for typed queries. Vitest for the
domain-logic test suite.

## Getting started

Requires Node.js, Docker Desktop (with WSL2 on Windows), and npm.

```bash
npm install
copy .env.example .env      # (or `cp` on macOS/Linux)

npm run db:up                # starts Postgres in Docker, port 5433
npm run db:reset             # builds the schema, seeds one venue + 4 lanes + 3 packages
npm run dev                  # http://localhost:3000  (customer site)
                              # http://localhost:3000/staff  (staff console)
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
    timeline.ts         Staff timeline data (lane state across a time window).
    bookingsList.ts      Today's bookings for the staff Bookings page.
    packages.ts, venue.ts  Small shared lookups.

  app/
    (customer)/         Public site: landing page ("/") and booking flow ("/book").
    staff/               Console: Lane Allotment, Bookings, Walk-ins, Settings.

  components/          Shared UI pieces used across routes.

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
