import { getBookingsToday } from "../../../../server/bookingsList";
import { getVenue } from "../../../../server/venue";
import { cancelBookingAction, endBookingAction, startBookingAction } from "./actions";
import styles from "./bookings.module.css";

const STATUS_BADGE: Record<string, string> = {
  confirmed: styles.badgeConfirmed!,
  active: styles.badgeActive!,
  completed: styles.badgeCompleted!,
  cancelled: styles.badgeCancelled!,
  no_show: styles.badgeNoShow!,
};

export default async function BookingsPage() {
  const venue = await getVenue();
  const bookings = await getBookingsToday(venue.id);

  const formatTime = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: venue.timezone, hour: "numeric", minute: "2-digit" }).format(d);

  return (
    <div>
      <h1 className={styles.title}>Today&apos;s Bookings</h1>

      {bookings.length === 0 ? (
        <div className={styles.list}>
          <p className={styles.emptyNote}>No bookings today yet.</p>
        </div>
      ) : (
        <div className={styles.list}>
          <div className={`${styles.row} ${styles.headerRow}`}>
            <span>Time</span>
            <span>Lane</span>
            <span>Customer</span>
            <span>Status</span>
            <span></span>
            <span>Actions</span>
          </div>

          {bookings.map((b) => (
            <div key={b.id} className={styles.row}>
              <span>{formatTime(b.scheduledStart)}</span>
              <span className={styles.lanes}>{b.laneNumbers.join(", ")}</span>
              <span className={styles.customer}>
                {b.label}
                {b.kind === "open_play" && (
                  <span className={styles.customerMeta}>
                    {" "}
                    &middot; {b.partySize}p, {b.games}g
                  </span>
                )}
              </span>
              <span className={`${styles.badge} ${STATUS_BADGE[b.status] ?? ""}`}>{b.status}</span>
              <span></span>
              <span className={styles.actions}>
                {b.status === "confirmed" && b.kind === "open_play" && (
                  <form action={startBookingAction.bind(null, b.id)}>
                    <button type="submit" className={`${styles.btn} ${styles.btnStart}`}>
                      Start
                    </button>
                  </form>
                )}
                {b.status === "active" && (
                  <form action={endBookingAction.bind(null, b.id)}>
                    <button type="submit" className={`${styles.btn} ${styles.btnEnd}`}>
                      End
                    </button>
                  </form>
                )}
                {b.status === "confirmed" && (
                  <form action={cancelBookingAction.bind(null, b.id)}>
                    <button type="submit" className={`${styles.btn} ${styles.btnCancel}`}>
                      Cancel
                    </button>
                  </form>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
