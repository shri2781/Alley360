import { eq } from "drizzle-orm";
import { db } from "../../../../db/client";
import { booking as bookingTable, tenant } from "../../../../db/schema";
import styles from "../book.module.css";

export default async function ConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;

  if (!id) {
    return <div className={styles.page}>No booking id given.</div>;
  }

  const [row] = await db.select().from(bookingTable).where(eq(bookingTable.id, id));
  if (!row) {
    return <div className={styles.page}>Booking not found.</div>;
  }

  const [venue] = await db.select().from(tenant).where(eq(tenant.id, row.tenantId));

  const formattedTime = venue
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: venue.timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(row.scheduledStart)
    : row.scheduledStart.toISOString();

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>You&apos;re booked!</h1>
      <div className={styles.confirmation}>
        <p>
          <strong>{formattedTime}</strong>
        </p>
        <p>
          {row.partySize} players &middot; {row.games} game{row.games === 1 ? "" : "s"}
        </p>
        {row.customerName && <p>Under the name {row.customerName}</p>}
        <p className={styles.note}>We&apos;ll see you then. Arrive a few minutes early for shoes.</p>
      </div>
    </div>
  );
}
