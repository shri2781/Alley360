import { getActivePackages } from "../../../server/packages";
import { getVenue } from "../../../server/venue";
import { BookingForm } from "./BookingForm";
import styles from "./book.module.css";

export default async function BookPage() {
  const venue = await getVenue();
  const packages = await getActivePackages(venue.id);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Book Your Bowling Session</h1>
        <p className={styles.subtitle}>Pick your players, package, and a real available time -- takes a minute.</p>
      </div>

      <BookingForm
        packages={packages.map((p) => ({
          id: p.id,
          name: p.name,
          games: p.games,
          pricePerPerson: p.pricePerPerson,
        }))}
      />
    </div>
  );
}
