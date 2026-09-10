import { db } from "../../../db/client";
import { tenant } from "../../../db/schema";
import { AutoRefresh } from "../../../components/AutoRefresh";
import { getTimeline } from "../../../server/timeline";
import { TimelineChart } from "./TimelineChart";
import { AddWalkInButton } from "./AddWalkInButton";
import styles from "./timeline.module.css";

export default async function LaneAllotmentPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const [venue] = await db.select().from(tenant).limit(1);

  if (!venue) {
    return (
      <div>
        No venue found. Run <code>npm run db:reset</code> to seed one.
      </div>
    );
  }

  const data = await getTimeline(venue.id);

  return (
    <>
      <AutoRefresh />
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Lane Allotment</h1>
          <p className={styles.subtitle}>{data.venueName} &middot; live from now through closing</p>
        </div>
        <AddWalkInButton error={error} />
      </div>

      {data.isClosedToday && (
        <p className={styles.errorBanner}>
          The alley is marked closed today in Alley Timings. Showing the full day so any existing bookings stay
          visible -- walk-ins will be turned away until hours are updated in Settings.
        </p>
      )}

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Lanes</div>
          <div className={styles.statValue}>{data.stats.totalLanes}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Active Now</div>
          <div className={styles.statValue}>{data.stats.activeSessions}</div>
        </div>
      </div>

      <TimelineChart data={data} />
    </>
  );
}
