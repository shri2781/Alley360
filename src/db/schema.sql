-- Bowling lane scheduler — full schema.
--
-- This file is the SOURCE OF TRUTH for the database. `src/db/schema.ts` mirrors it
-- for typed queries and must be kept in sync by hand. That is a deliberate choice
-- for a 5-table prototype: exclusion constraints and tstzrange are painful to express
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
  opens_at_hour      int         NOT NULL DEFAULT 10,   -- venue-local hour bookings can start from
  closes_at_hour     int         NOT NULL DEFAULT 22,   -- hours since midnight of the opening day: a 4am close is 28
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenant_hours_valid CHECK (opens_at_hour BETWEEN 0 AND 23
    AND closes_at_hour > opens_at_hour AND closes_at_hour <= opens_at_hour + 24)
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
-- package — display-only pricing tiers for the customer-facing site. Prices are
-- shown as "pay at venue" estimates; nothing here touches payments or the
-- scheduler. `booking.games` (not this table) stays the source of truth once a
-- booking exists — a package just supplies a starting `games` value in the UI.
-- Deliberately minimal: no booking_id/package_id link, no price snapshotting.
-- Real pricing logic is future work; this exists so the admin side has
-- somewhere to edit tiers instead of them being hardcoded HTML.
-- ---------------------------------------------------------------------------
CREATE TABLE package (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name              text NOT NULL,
  games             int  NOT NULL,
  price_per_person  int  NOT NULL,   -- smallest currency unit's whole number, e.g. rupees
  sort_order        int  NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,

  CONSTRAINT package_games_positive CHECK (games > 0),
  CONSTRAINT package_price_nonnegative CHECK (price_per_person >= 0)
);

CREATE INDEX package_tenant_idx ON package (tenant_id, is_active, sort_order);

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

  business_date         date        NOT NULL,   -- venue day, derived from closing hour (see rolloverHour in src/domain/time.ts)
  scheduled_start       timestamptz NOT NULL,

  -- The three duration quantities are distinct on purpose (see src/domain/config.ts):
  --   base   = central estimate, comparable to the ~10 min/player/game rule of thumb
  --   play   = base x buffer, grid-rounded — what the lane is promised for
  --   occupy = play + turnover — the actual lane claim, and what `occupies` spans
  estimated_base_min    int NOT NULL DEFAULT 0,
  estimated_play_min    int NOT NULL DEFAULT 0,
  estimated_occupy_min  int NOT NULL DEFAULT 0,

  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),

  -- Blocks carry no party; open play always does.
  CONSTRAINT booking_party_valid
    CHECK (kind = 'block' OR (party_size > 0 AND games > 0))
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
