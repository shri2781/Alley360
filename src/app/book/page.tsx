import { submitBooking } from "./actions";
import styles from "./book.module.css";

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Book a Lane</h1>
      <p className={styles.subtitle}>
        Tell us how many players and games, and roughly when -- we&apos;ll find you a lane.
      </p>

      {error && <div className={styles.error}>{error}</div>}

      <form action={submitBooking} className={styles.form}>
        <label className={styles.label}>
          Players
          <input type="number" name="players" min={1} max={24} defaultValue={4} required className={styles.input} />
        </label>

        <label className={styles.label}>
          Games
          <input type="number" name="games" min={1} max={5} defaultValue={2} required className={styles.input} />
        </label>

        <label className={styles.label}>
          Preferred date &amp; time
          <input type="datetime-local" name="preferredStart" required className={styles.input} />
        </label>

        <label className={styles.label}>
          Name (optional)
          <input type="text" name="customerName" className={styles.input} />
        </label>

        <label className={styles.label}>
          Phone (optional)
          <input type="tel" name="customerPhone" className={styles.input} />
        </label>

        <button type="submit" className={styles.submit}>
          Book Now
        </button>
      </form>
    </div>
  );
}
