-- Bowling lane scheduler — full schema.
--
-- This file is the SOURCE OF TRUTH for the database. `src/db/schema.ts` mirrors it
-- for typed queries and must be kept in sync by hand. That is a deliberate choice
-- for a small prototype: exclusion constraints and tstzrange are painful to express
-- through a migration generator, and one hand-written file is less machinery than
-- drizzle-kit plus a separate raw migration for the constraint.
--
-- `npm run db:reset` drops and recreates everything from this file.

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- Required for the exclusion constraint: lets a GiST index mix an equality column
-- (lane_id) with a range column (occupies).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- custom datatypes
CREATE TYPE booking_kind       AS ENUM ('open_play', 'block');
CREATE TYPE booking_status     AS ENUM ('confirmed', 'active', 'completed', 'cancelled', 'no_show');
CREATE TYPE booking_source     AS ENUM ('walkin', 'phone', 'staff', 'web');
CREATE TYPE allocation_status  AS ENUM ('confirmed', 'active', 'released');
CREATE TYPE session_end_reason AS ENUM ('normal', 'staff_ended', 'abandoned');

-- ---------------------------------------------------------------------------
-- tenant — one row for now. Present so nothing hardcodes "the venue" or "4 lanes";
-- real multi-tenancy (provisioning, RLS, auth scoping) is explicitly out of scope.
-- ---------------------------------------------------------------------------
CREATE TABLE tenant (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text        NOT NULL,
  timezone           text        NOT NULL,              -- IANA, e.g. 'Asia/Kolkata'
  created_at         timestamptz NOT NULL DEFAULT now()

  -- Opening hours used to live here as a single opens_at_hour/closes_at_hour pair
  -- for every day of the week. Replaced by the per-weekday `venue_hours` table below.
);

-- ---------------------------------------------------------------------------
-- venue_hours — opening hours, one row per weekday. Exactly seven rows per
-- tenant, enforced by the composite primary key plus the seed.
--
-- Times are MINUTES SINCE VENUE-LOCAL MIDNIGHT OF THE OPENING DAY, so a 2am
-- close is 1560, not 120 -- the same "hours past midnight of the opening day"
-- convention this schema used before per-weekday hours existed (a single
-- closes_at_hour column, where a 4am close was 28), just at 30-minute
-- resolution now. See src/domain/hours.ts for every function that reads this
-- table.
--
-- A closed day KEEPS its opens/closes values so that un-checking "Closed" in
-- Settings restores the previous times rather than losing them; is_closed is
-- the only thing that makes a day closed.
--
-- NOT enforced here (cross-row, so it can't be a CHECK): a day's opens_at_min
-- must not be earlier than the previous day finishes closing -- see
-- validateWeeklyHours() in src/domain/hours.ts, applied by the settings
-- action before this table is written.
--
-- Extension point for later: a one-off closure or holiday hours would need a
-- venue_hours_override(tenant_id, date, ...) table checked ahead of this one.
-- Not built -- out of scope for now.
-- ---------------------------------------------------------------------------
CREATE TABLE venue_hours (
  tenant_id      uuid     NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  day_of_week    smallint NOT NULL,                    -- 0=Sunday .. 6=Saturday, matching JS getUTCDay() and PG EXTRACT(DOW)
  is_closed      boolean  NOT NULL DEFAULT false,
  opens_at_min   int      NOT NULL DEFAULT 600,        -- 10:00
  closes_at_min  int      NOT NULL DEFAULT 1320,       -- 22:00

  PRIMARY KEY (tenant_id, day_of_week),

  CONSTRAINT venue_hours_dow_valid CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT venue_hours_window_valid CHECK (
    opens_at_min BETWEEN 0 AND 1439
    AND closes_at_min > opens_at_min
    AND closes_at_min <= opens_at_min + 1440
  ),
  -- 30-minute granularity everywhere: the Settings selects, rate windows, and
  -- this table all agree, so a rate boundary always lands on a real minute.
  CONSTRAINT venue_hours_aligned CHECK (opens_at_min % 30 = 0 AND closes_at_min % 30 = 0)
);

-- ---------------------------------------------------------------------------
-- lane — `number` drives adjacency for multi-lane parties (M6).
-- ---------------------------------------------------------------------------
CREATE TABLE lane (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  number          int  NOT NULL,
  display_name    text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,

  CONSTRAINT lane_number_positive UNIQUE (tenant_id, number)
);

-- ---------------------------------------------------------------------------
-- rate — what a person pays per game, resolved from the time they start.
--
-- Replaces a `package` table that bundled a games count with a flat
-- price-per-person and had no time dimension at all. A rate carries no games
-- count: the customer picks their own games, and the price is per person PER
-- GAME, so total = price_per_person x games x players.
--
-- Overlap resolution is base + ordered overrides:
--   * exactly one is_base row per tenant (rate_one_base_idx). Always applies,
--     has no days and no window, and cannot be deactivated (rate_base_shape).
--   * every other row is a special: a set of weekdays plus an optional window.
--     Checked in `priority` order, first match wins. Ties are impossible to
--     resolve meaningfully, so the loader orders by (priority, name, id) and
--     the pure resolver takes the first -- see resolveRate() in
--     src/domain/rates.ts, which trusts that ordering rather than sorting.
--
-- Windows are half-open [starts_at_min, ends_at_min) in the SAME minutes-since-
-- business-midnight space as venue_hours, so a "Late Night" rate may legally
-- run 1320..1500 (10pm to 1am). NULL means "the venue's own boundary": NULL
-- start = from opening, NULL end = until closing.
--
-- `days` is the day-of-week of the BUSINESS date, not the calendar date: a
-- Friday rate covers 00:30 Saturday if Friday's window runs past midnight.
--
-- A booking is priced from its START instant only, not its span: a session
-- starting inside Happy Hours is Happy-Hours-priced end to end.
--
-- `days` is filtered in application code (src/server/rates.ts), never with a
-- Postgres array operator in a WHERE clause -- the rate list is a handful of
-- rows per tenant, so there is no reason to push that logic into SQL.
-- ---------------------------------------------------------------------------
CREATE TABLE rate (
  id                uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid     NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name              text     NOT NULL,
  price_per_person  int      NOT NULL,   -- per person PER GAME, whole rupees
  is_base           boolean  NOT NULL DEFAULT false,
  days              smallint[],          -- 0=Sun..6=Sat; NULL on the base row
  starts_at_min     int,                 -- NULL = from opening
  ends_at_min       int,                 -- NULL = until closing; may exceed 1440
  priority          int      NOT NULL DEFAULT 0,
  is_active         boolean  NOT NULL DEFAULT true,

  CONSTRAINT rate_price_nonnegative CHECK (price_per_person >= 0),

  CONSTRAINT rate_base_shape CHECK (
    NOT is_base
    OR (days IS NULL AND starts_at_min IS NULL AND ends_at_min IS NULL AND is_active)
  ),
  CONSTRAINT rate_special_shape CHECK (
    is_base
    OR (days IS NOT NULL
        AND days <@ '{0,1,2,3,4,5,6}'::smallint[]
        AND array_length(days, 1) BETWEEN 1 AND 7)
  ),
  CONSTRAINT rate_window_valid CHECK (
    (starts_at_min IS NULL OR starts_at_min BETWEEN 0 AND 1439)
    AND (ends_at_min IS NULL OR ends_at_min BETWEEN 30 AND 2880)
    AND (starts_at_min IS NULL OR ends_at_min IS NULL OR ends_at_min > starts_at_min)
  ),
  CONSTRAINT rate_window_aligned CHECK (
    (starts_at_min IS NULL OR starts_at_min % 30 = 0)
    AND (ends_at_min IS NULL OR ends_at_min % 30 = 0)
  )
);

-- At most one base per tenant. "At least one" is a seed + loader invariant:
-- getRateSchedule() throws rather than silently pricing at zero.
CREATE UNIQUE INDEX rate_one_base_idx ON rate (tenant_id) WHERE is_base;
CREATE INDEX rate_tenant_idx ON rate (tenant_id, is_active, priority);

-- ---------------------------------------------------------------------------
-- booking — the commercial agreement. Deliberately also models maintenance:
-- a lane block is a booking with kind='block', so it flows through the same
-- exclusion constraint and conflicts with real bookings for free. That removes
-- a whole table and a parallel code path.
-- ---------------------------------------------------------------------------
CREATE TABLE booking (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  kind                  booking_kind   NOT NULL DEFAULT 'open_play',
  status                booking_status NOT NULL DEFAULT 'confirmed',
  source                booking_source NOT NULL DEFAULT 'staff',

  customer_name         text,
  customer_phone        text,

  party_size            int NOT NULL DEFAULT 0,
  games                 int NOT NULL DEFAULT 0,

  business_date         date        NOT NULL,   -- venue day, derived per-weekday (see businessDateFor in src/domain/hours.ts)
  scheduled_start       timestamptz NOT NULL,

  -- The three duration quantities are distinct on purpose (see src/domain/config.ts):
  --   base   = central estimate, comparable to the ~10 min/player/game rule of thumb
  --   play   = base x buffer, grid-rounded — what the lane is promised for
  --   occupy = play + turnover — the actual lane claim, and what `occupies` spans
  estimated_base_min    int NOT NULL DEFAULT 0,
  estimated_play_min    int NOT NULL DEFAULT 0,
  estimated_occupy_min  int NOT NULL DEFAULT 0,

  -- Price as agreed at booking time. Snapshotted, not joined: editing a rate in
  -- Settings must never silently reprice bookings that already exist, and
  -- rate_name survives even if the rate row is later removed. A staff drag to a
  -- different time deliberately does NOT reprice (see allocation.ts) -- the
  -- quoted price is the quoted price. NULL on kind='block', which has no party.
  rate_id               uuid REFERENCES rate(id) ON DELETE SET NULL,
  rate_name             text,
  price_per_person      int,   -- per person per game, copied from the rate
  total_price           int,   -- price_per_person x games x party_size

  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),

  -- Blocks carry no party; open play always does.
  CONSTRAINT booking_party_valid
    CHECK (kind = 'block' OR (party_size > 0 AND games > 0)),

  CONSTRAINT booking_price_nonnegative
    CHECK ((price_per_person IS NULL OR price_per_person >= 0)
       AND (total_price IS NULL OR total_price >= 0))
);

CREATE INDEX booking_day_idx ON booking (tenant_id, business_date, status);

-- ---------------------------------------------------------------------------
-- lane_allocation — the claim on a lane over an interval.
--
-- Separate from `booking` because one booking can claim several lanes (a party),
-- and because a claim can be moved to a different lane without touching the
-- commercial record. This split is what makes multi-lane parties and future lane
-- reassignment possible without a schema change.
--
-- `occupies` INCLUDES the turnover buffer; `play_window` is the customer-visible
-- time. Storing both means the exclusion constraint enforces the cleanup gap too,
-- rather than trusting application code to remember it.
-- ---------------------------------------------------------------------------
CREATE TABLE lane_allocation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  booking_id    uuid NOT NULL REFERENCES booking(id) ON DELETE CASCADE,
  lane_id       uuid NOT NULL REFERENCES lane(id)    ON DELETE RESTRICT,

  occupies      tstzrange NOT NULL,   -- play + turnover, '[)' bounds
  play_window   tstzrange NOT NULL,   -- customer-visible, '[)' bounds
  status        allocation_status NOT NULL DEFAULT 'confirmed',

  CONSTRAINT allocation_ranges_nonempty
    CHECK (NOT isempty(occupies) AND NOT isempty(play_window)),

  -- Play time can never exceed the lane claim.
  CONSTRAINT allocation_play_within_occupies
    CHECK (occupies @> play_window),

  -- '[)' bounds throughout, so back-to-back allocations touch without overlapping.
  CONSTRAINT allocation_bounds_half_open
    CHECK (lower_inc(occupies) AND NOT upper_inc(occupies)
           AND lower_inc(play_window) AND NOT upper_inc(play_window))
);

CREATE INDEX lane_allocation_booking_idx ON lane_allocation (booking_id);
CREATE INDEX lane_allocation_tenant_idx  ON lane_allocation (tenant_id);

-- ===========================================================================
-- THE constraint. Two bookings cannot occupy the same lane at overlapping times
-- — not "should not", *cannot*, regardless of application bugs, races, retries,
-- or a second process. Everything in the booking service leans on this being true.
--
-- Released allocations (cancelled, moved) are excluded from the check so the freed
-- time is immediately reusable while the row is kept for history.
-- ===========================================================================
ALTER TABLE lane_allocation
  ADD CONSTRAINT lane_allocation_no_overlap
  EXCLUDE USING gist (lane_id WITH =, occupies WITH &&)
  WHERE (status IN ('confirmed', 'active'));

-- ---------------------------------------------------------------------------
-- session — what actually happened, as opposed to what was scheduled.
--
-- This table is the entire point of the operations tool. It is the dataset that
-- eventually replaces the guessed constants in src/domain/config.ts. It is not
-- read by anything in the MVP, and that is fine: collect now, model later.
-- ---------------------------------------------------------------------------
CREATE TABLE session (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id)  ON DELETE CASCADE,
  booking_id       uuid NOT NULL REFERENCES booking(id) ON DELETE CASCADE,
  lane_id          uuid NOT NULL REFERENCES lane(id)    ON DELETE RESTRICT,

  started_at       timestamptz NOT NULL,
  ended_at         timestamptz,

  actual_players   int NOT NULL,
  games_completed  int,
  end_reason       session_end_reason,

  -- Cleared when the session looks untrustworthy (a forgotten "End" button, a
  -- mid-session lane change). Only clean sessions may ever calibrate the estimator;
  -- one 5-hour phantom session would wreck a bucket's quantile.
  is_clean         boolean NOT NULL DEFAULT true,

  CONSTRAINT session_ends_after_start CHECK (ended_at IS NULL OR ended_at > started_at)
);

CREATE INDEX session_booking_idx ON session (booking_id);
CREATE INDEX session_tenant_idx  ON session (tenant_id, started_at);

-- ---------------------------------------------------------------------------
-- staff_user — who may open the console at /staff.
--
-- One row is the expected case for a single alley: everyone on shift shares it.
-- It is a table rather than a passcode in .env so the password is stored hashed
-- rather than readable in a file, and can be changed from Settings without a
-- redeploy. A second login later is an INSERT, not an auth rewrite.
--
-- Deliberately no actor tracking: booking rows do not record who created them.
-- ---------------------------------------------------------------------------
CREATE TABLE staff_user (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  username       text NOT NULL,
  password_hash  text NOT NULL,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_user_username_unique UNIQUE (tenant_id, username)
);
