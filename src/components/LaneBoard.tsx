import type { LaneBoardData, LaneBoardEntry } from "../server/queries";
import styles from "./LaneBoard.module.css";

function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
}

/** A nameless booking isn't necessarily a walk-in -- an online booking with no name
 *  entered is still an online booking. Only the literal 'walkin' source gets that label. */
function displayName(customerName: string | null, source: "walkin" | "phone" | "staff" | "web"): string {
  if (customerName) return customerName;
  return source === "walkin" ? "Walk-in" : "Guest";
}

const STATE_LABEL: Record<LaneBoardEntry["state"], string> = {
  available: "Available",
  playing: "Playing",
  "booked-soon": "Booked soon",
  maintenance: "Maintenance",
};

function badgeClass(entry: LaneBoardEntry): string {
  if (entry.state === "playing" && entry.isOverrun) return styles.badgeOverrun!;
  if (entry.state === "playing") return styles.badgePlaying!;
  if (entry.state === "booked-soon") return styles.badgeBookedSoon!;
  if (entry.state === "maintenance") return styles.badgeMaintenance!;
  return styles.badgeAvailable!;
}

function LaneCard({ entry, timezone }: { entry: LaneBoardEntry; timezone: string }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.laneName}>{entry.laneName}</span>
        <span className={`${styles.badge} ${badgeClass(entry)}`}>
          {entry.state === "playing" && entry.isOverrun ? "Overrun" : STATE_LABEL[entry.state]}
        </span>
      </div>

      <div className={styles.cardBody}>
        {entry.state === "playing" && entry.current && (
          <>
            <div className={styles.customerName}>
              {displayName(entry.current.customerName, entry.current.source)} · {entry.current.partySize} players
            </div>
            <div>Started {formatTime(entry.current.startedAt, timezone)}</div>
            <div>Expected finish {formatTime(entry.current.expectedFinish, timezone)}</div>
          </>
        )}

        {entry.state === "booked-soon" && entry.nextBooking && (
          <>
            <div className={styles.customerName}>
              {displayName(entry.nextBooking.customerName, entry.nextBooking.source)} · {entry.nextBooking.partySize}{" "}
              players
            </div>
            <div>Starts {formatTime(entry.nextBooking.start, timezone)}</div>
          </>
        )}

        {entry.state === "maintenance" && entry.maintenanceUntil && (
          <div>Until {formatTime(entry.maintenanceUntil, timezone)}</div>
        )}

        {entry.state === "available" && <div className={styles.emptyState}>No bookings right now</div>}
      </div>
    </div>
  );
}

export function LaneBoard({ data }: { data: LaneBoardData }) {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{data.venueName}</h1>
        <span className={styles.clock}>{formatTime(data.now, data.timezone)}</span>
      </div>

      <div className={styles.grid}>
        {data.lanes.map((entry) => (
          <LaneCard key={entry.laneId} entry={entry} timezone={data.timezone} />
        ))}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Today&apos;s upcoming bookings</h2>

        {data.upcoming.length === 0 ? (
          <p className={styles.emptyState}>Nothing else booked today.</p>
        ) : (
          <ul className={styles.upcomingList}>
            {data.upcoming.map((u) => (
              <li
                key={u.bookingId}
                className={`${styles.upcomingRow} ${u.kind === "block" ? styles.blockRow : ""}`}
              >
                <span className={styles.upcomingTime}>{formatTime(u.start, data.timezone)}</span>
                <span className={styles.upcomingLanes}>Lane {u.laneNumbers.join(", ")}</span>
                <span className={styles.upcomingCustomer}>
                  {u.kind === "block" ? "Blocked" : displayName(u.customerName, u.source)} · {u.partySize} players,{" "}
                  {u.games} game{u.games === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
