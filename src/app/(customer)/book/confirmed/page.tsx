import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "../../../../db/client";
import { booking as bookingTable, tenant } from "../../../../db/schema";
import btn from "../../_components/Button.module.css";
import { PhotoCard } from "../../_components/PhotoCard";
import { AddToCalendarButton } from "./AddToCalendarButton";
import styles from "./confirmed.module.css";
import friendsPosingPhoto from "../../../../assets/photos/friends-posing.jpg";

export default async function ConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;

  if (!id) {
    return <EmptyState heading="No booking found" body="No booking id was given." />;
  }

  const [row] = await db.select().from(bookingTable).where(eq(bookingTable.id, id));
  if (!row) {
    return <EmptyState heading="Booking not found" body="That booking doesn't exist -- it may have been cancelled." />;
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

  const playEnd = new Date(row.scheduledStart.getTime() + row.estimatedPlayMin * 60_000);
  const reference = row.id.slice(0, 8).toUpperCase();

  return (
    <div className={styles.page}>
      <PhotoCard
        src={friendsPosingPhoto}
        alt="A group of friends celebrating together"
        aspect="16 / 9"
        priority
        className={styles.photo}
      />

      <div className={styles.card}>
        <span className={styles.check} aria-hidden="true">
          &#10003;
        </span>
        <h1 className={styles.title}>You&apos;re booked!</h1>
        <p className={styles.reference}>Booking reference {reference}</p>

        <div className={styles.details}>
          <div className={styles.detailRow}>
            <span>When</span>
            <strong>{formattedTime}</strong>
          </div>
          <div className={styles.detailRow}>
            <span>Party</span>
            <strong>
              {row.partySize} player{row.partySize === 1 ? "" : "s"} &middot; {row.games} game
              {row.games === 1 ? "" : "s"}
            </strong>
          </div>
          {row.customerName && (
            <div className={styles.detailRow}>
              <span>Name</span>
              <strong>{row.customerName}</strong>
            </div>
          )}
        </div>

        <p className={styles.note}>We&apos;ll see you then. Arrive a few minutes early for shoes.</p>

        <div className={styles.actions}>
          <AddToCalendarButton
            venueName={venue?.name ?? "Bowling"}
            startIso={row.scheduledStart.toISOString()}
            endIso={playEnd.toISOString()}
            description={`${row.partySize} players, ${row.games} game(s). Lane assigned automatically.`}
          />
          <Link href="/" className={btn.btnPrimary}>
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ heading, body }: { heading: string; body: string }) {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{heading}</h1>
        <p className={styles.note}>{body}</p>
        <div className={styles.actions}>
          <Link href="/book" className={btn.btnPrimary}>
            Book a Lane
          </Link>
        </div>
      </div>
    </div>
  );
}
