# Bowling Lane Scheduler

A lane scheduling and operations tool for a 4-lane bowling alley. Session duration varies with
players and games played, so lanes can't be booked as fixed time slots — the system estimates
occupancy, prevents overlapping bookings at the database level, and (eventually) gives staff a
live view of all lanes.

Built as a lean MVP: staff operations first, customer-facing booking later.

## Status

| Milestone | Status |
|---|---|
| M1 — Database schema + overlap-prevention constraint | ✅ Done, verified |
| M2 — Duration estimator | ✅ Done, verified |
| M3 — Availability scheduler | ✅ Done, verified |
| M4 — Staff lane dashboard | ✅ Done, verified (read-only) |
| M5 — Booking create/start/end/cancel | ✅ Service layer done, verified (no UI yet) |
| M6 — Multi-lane party bookings | Not started |
| M7 — Testing & polish | Not started |

## Stack

TypeScript, PostgreSQL 16 (via Docker), [Drizzle ORM](https://orm.drizzle.team/) for typed queries,
[Next.js](https://nextjs.org/) (App Router) for the staff UI, [Vitest](https://vitest.dev/) for
tests. Plain CSS Modules for styling — no CSS framework, no component library.

## Setup

Requires Node.js, Docker Desktop (with WSL2 on Windows), and npm.

```bash
npm install
copy .env.example .env      # (or `cp` on macOS/Linux)

npm run db:up                # starts Postgres in Docker, port 5433
npm run db:reset             # builds the schema and seeds one venue + 4 lanes
npm run demo:seed            # (optional) populates a believable board via real bookings
npm run dev                  # starts the dashboard at http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `npm run db:up` / `db:down` | Start / stop the Postgres container |
| `npm run db:reset` | Rebuild the database from `src/db/schema.sql` and reseed it |
| `npm run db:seed` | Reseed only (assumes schema already exists) |
| `npm run prove:constraint` | Proves the overlap-prevention database constraint actually works, against a live Postgres |
| `npm run estimator:table` | Prints the duration-estimate grid for a range of players/games — useful for sanity-checking the numbers against a real venue |
| `npm run scheduler:demo` | Loads a fixture day and prints ranked available times for a sample booking request |
| `npm run booking:demo` | Exercises the real booking service (availability, create, start, end, cancel, block) against a live Postgres |
| `npm run demo:seed` | Populates a believable board (playing / booked-soon / maintenance / available) using the real M5 service functions, anchored to the current time |
| `npm run dev` | Starts the Next.js dev server (the staff dashboard) |
| `npm test` | Runs the unit test suite (pure domain logic, no database) |
| `npm run typecheck` | TypeScript type-checking, no build output |

## Project structure

```
src/
  domain/       Pure logic — duration estimation, availability scheduling,
                time/business-date handling. No I/O.
  db/           Database schema (SQL + typed Drizzle mirror), connection, seed data.
  server/
    services/   Booking lifecycle (create/cancel/block, start/end session) — real I/O,
                composes the domain logic with the database.
    queries.ts  Read-only view assembly for the dashboard (derives each lane's
                current state from the raw booking/allocation rows).
  app/          Next.js App Router pages.
  components/   React components (plain CSS Modules, no UI library).
scripts/        One-off tools: reset the DB, seed it, verify the constraint, print the
                estimator grid, demo the scheduler/booking service, seed a demo board.
```

The database schema (`src/db/schema.sql`) is the source of truth for the data model; `src/db/schema.ts`
mirrors it by hand for typed queries. See the comments in both files for why.

**Import convention:** relative imports never use a `.js`/`.ts` extension (`from "../db/client"`,
not `"../db/client.js"`). The same source files run under two different resolvers — `tsx` for the
scripts, Next.js's Turbopack for the app — and only extensionless imports work under both.
