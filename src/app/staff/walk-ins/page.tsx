import { getBookingsToday } from "../../../server/bookingsList";
import { getVenue } from "../../../server/venue";
import { addWalkIn } from "./actions";
import styles from "./walkins.module.css";

export default async function WalkInsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const venue = await getVenue();
  const bookings = await getBookingsToday(venue.id);
  const walkIns = bookings.filter((b) => b.source === "walkin");

  const formatTime = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: venue.timezone, hour: "numeric", minute: "2-digit" }).format(d);

  return (
    <div>
      <h1 className={styles.title}>Walk-ins</h1>

      <div className={styles.layout}>
        <form action={addWalkIn} className={styles.form}>
          {error && <div className={styles.errorNote}>{error}</div>}

          <label className={styles.field}>
            Players
            <input type="number" name="players" min={1} max={24} defaultValue={4} required className={styles.input} />
          </label>
          <label className={styles.field}>
            Games
            <input type="number" name="games" min={1} max={5} defaultValue={2} required className={styles.input} />
          </label>
          <label className={styles.field}>
            Name (optional)
            <input type="text" name="customerName" className={styles.input} />
          </label>

          <button type="submit" className={styles.submit}>
            Add &amp; Start Walk-in
          </button>
        </form>

        <div className={styles.list}>
          {walkIns.length === 0 ? (
            <p className={styles.emptyNote}>No walk-ins yet today.</p>
          ) : (
            walkIns.map((w) => (
              <div key={w.id} className={styles.row}>
                <span>{w.label}</span>
                <span className={styles.rowMeta}>
                  {formatTime(w.scheduledStart)} &middot; Lane {w.laneNumbers.join(", ")} &middot; {w.partySize}p,{" "}
                  {w.games}g &middot; {w.status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
