import { getVenue } from "../../../server/venue";
import { businessDateFor } from "../../../domain/hours";
import { addDays } from "../../../domain/time";
import { BOOKING_WINDOW_DAYS } from "../../../domain/bookingInput";
import { BookingForm } from "./BookingForm";
import styles from "./book.module.css";

export default async function BookPage() {
  const venue = await getVenue();
  const minDate = businessDateFor(new Date(), venue.timezone, venue.weeklyHours);
  const maxDate = addDays(minDate, BOOKING_WINDOW_DAYS - 1);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Book Your Bowling Session</h1>
        <p className={styles.subtitle}>Pick your players, games, and a real available time, takes a minute.</p>
      </div>

      <BookingForm minDate={minDate} maxDate={maxDate} />
    </div>
  );
}
