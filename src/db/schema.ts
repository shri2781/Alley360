/**
 * Typed mirror of `src/db/schema.sql`, which is the source of truth for DDL.
 * Keep the two in sync by hand — see the note at the top of schema.sql.
 */
import {
  boolean,
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/** Postgres tstzrange. Drizzle has no native range type; values move as strings
 *  in `[lower,upper)` form — build them with `tstzrangeLiteral()` in ./range.ts. */
const tstzrange = customType<{ data: string; driver: string }>({
  dataType() {
    return "tstzrange";
  },
});

export const bookingKind = pgEnum("booking_kind", ["open_play", "block"]);
export const bookingStatus = pgEnum("booking_status", [
  "confirmed",
  "active",
  "completed",
  "cancelled",
  "no_show",
]);
export const bookingSource = pgEnum("booking_source", ["walkin", "phone", "staff", "web"]);
export const allocationStatus = pgEnum("allocation_status", ["confirmed", "active", "released"]);
export const sessionEndReason = pgEnum("session_end_reason", [
  "normal",
  "staff_ended",
  "abandoned",
]);

export const tenant = pgTable("tenant", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per weekday (0=Sunday..6=Saturday). See the schema.sql banner comment
 *  above this table for the full convention -- times are minutes since venue-local
 *  midnight of the opening day. */
export const venueHours = pgTable(
  "venue_hours",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    /** 0 = Sunday .. 6 = Saturday -- JS getUTCDay() / PG EXTRACT(DOW). */
    dayOfWeek: smallint("day_of_week").notNull(),
    isClosed: boolean("is_closed").notNull().default(false),
    /** Minutes since venue-local midnight OF THE OPENING DAY: a 2am close is 1560. */
    opensAtMin: integer("opens_at_min").notNull().default(600),
    closesAtMin: integer("closes_at_min").notNull().default(1320),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.dayOfWeek] }),
  }),
);

export const lane = pgTable(
  "lane",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    displayName: text("display_name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => ({
    numberUnique: unique("lane_number_positive").on(t.tenantId, t.number),
  }),
);

/** See the schema.sql banner comment above this table for the full convention:
 *  base + ordered special overrides, half-open windows, business-day `days`. */
export const rate = pgTable(
  "rate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Per person PER GAME. Total = this x games x players. */
    pricePerPerson: integer("price_per_person").notNull(),
    isBase: boolean("is_base").notNull().default(false),
    /** 0=Sun..6=Sat, of the BUSINESS date. NULL on the base row. Filtered in JS,
     *  never with a Postgres array operator -- see src/server/rates.ts. */
    days: smallint("days").array(),
    startsAtMin: integer("starts_at_min"),
    endsAtMin: integer("ends_at_min"),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => ({
    tenantIdx: index("rate_tenant_idx").on(t.tenantId, t.isActive, t.priority),
    // rate_one_base_idx (a partial unique index) lives only in schema.sql --
    // Drizzle's index builder can't express a WHERE clause.
  }),
);

export const booking = pgTable(
  "booking",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    kind: bookingKind("kind").notNull().default("open_play"),
    status: bookingStatus("status").notNull().default("confirmed"),
    source: bookingSource("source").notNull().default("staff"),

    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),

    partySize: integer("party_size").notNull().default(0),
    games: integer("games").notNull().default(0),

    businessDate: date("business_date").notNull(),
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }).notNull(),

    // See src/domain/config.ts for why these are three separate numbers.
    estimatedBaseMin: integer("estimated_base_min").notNull().default(0),
    estimatedPlayMin: integer("estimated_play_min").notNull().default(0),
    estimatedOccupyMin: integer("estimated_occupy_min").notNull().default(0),

    // Price as agreed at booking time -- snapshotted, not joined. NULL on blocks.
    // See the schema.sql banner comment on this table for why.
    rateId: uuid("rate_id").references(() => rate.id, { onDelete: "set null" }),
    rateName: text("rate_name"),
    pricePerPerson: integer("price_per_person"),
    totalPrice: integer("total_price"),

    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dayIdx: index("booking_day_idx").on(t.tenantId, t.businessDate, t.status),
  }),
);

export const laneAllocation = pgTable(
  "lane_allocation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => booking.id, { onDelete: "cascade" }),
    laneId: uuid("lane_id")
      .notNull()
      .references(() => lane.id, { onDelete: "restrict" }),

    /** Play window + turnover. What the exclusion constraint guards. */
    occupies: tstzrange("occupies").notNull(),
    /** Customer-visible time, always contained in `occupies`. */
    playWindow: tstzrange("play_window").notNull(),
    status: allocationStatus("status").notNull().default("confirmed"),
  },
  (t) => ({
    bookingIdx: index("lane_allocation_booking_idx").on(t.bookingId),
    tenantIdx: index("lane_allocation_tenant_idx").on(t.tenantId),
    // The EXCLUDE constraint lives only in schema.sql — Drizzle cannot express it.
  }),
);

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => booking.id, { onDelete: "cascade" }),
    laneId: uuid("lane_id")
      .notNull()
      .references(() => lane.id, { onDelete: "restrict" }),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),

    actualPlayers: integer("actual_players").notNull(),
    gamesCompleted: integer("games_completed"),
    endReason: sessionEndReason("end_reason"),
    isClean: boolean("is_clean").notNull().default(true),
  },
  (t) => ({
    bookingIdx: index("session_booking_idx").on(t.bookingId),
    tenantIdx: index("session_tenant_idx").on(t.tenantId, t.startedAt),
  }),
);

/** Who may open /staff. See the banner comment in schema.sql -- one shared row is
 *  the expected case; the table shape just means a second login is an INSERT. */
export const staffUser = pgTable(
  "staff_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    usernameUnique: unique("staff_user_username_unique").on(t.tenantId, t.username),
  }),
);
