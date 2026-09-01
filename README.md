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
| M3 — Availability scheduler | Not started |
| M4 — Staff lane dashboard | Not started |
| M5 — Booking create/start/end/cancel | Not started |
| M6 — Multi-lane party bookings | Not started |
| M7 — Testing & polish | Not started |

## Stack

TypeScript, PostgreSQL 16 (via Docker), [Drizzle ORM](https://orm.drizzle.team/) for typed queries,
[Vitest](https://vitest.dev/) for tests. No framework yet — the domain logic and database layer are
built and verified before any UI.

## Setup

Requires Node.js, Docker Desktop (with WSL2 on Windows), and npm.

```bash
npm install
copy .env.example .env      # (or `cp` on macOS/Linux)

npm run db:up                # starts Postgres in Docker, port 5433
npm run db:reset             # builds the schema and seeds one venue + 4 lanes
```

## Scripts

| Command | What it does |
|---|---|
| `npm run db:up` / `db:down` | Start / stop the Postgres container |
| `npm run db:reset` | Rebuild the database from `src/db/schema.sql` and reseed it |
| `npm run db:seed` | Reseed only (assumes schema already exists) |
| `npm run prove:constraint` | Proves the overlap-prevention database constraint actually works, against a live Postgres |
| `npm run estimator:table` | Prints the duration-estimate grid for a range of players/games — useful for sanity-checking the numbers against a real venue |
| `npm test` | Runs the unit test suite (pure domain logic, no database) |
| `npm run typecheck` | TypeScript type-checking, no build output |

## Project structure

```
src/
  domain/     Pure logic — duration estimation, time/business-date handling. No I/O.
  db/         Database schema (SQL + typed Drizzle mirror), connection, seed data.
scripts/      One-off tools: reset the DB, seed it, verify the constraint, print the estimator grid.
```

The database schema (`src/db/schema.sql`) is the source of truth for the data model; `src/db/schema.ts`
mirrors it by hand for typed queries. See the comments in both files for why.
