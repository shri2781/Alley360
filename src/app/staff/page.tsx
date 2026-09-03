import { db } from "../../db/client";
import { tenant } from "../../db/schema";
import { AutoRefresh } from "../../components/AutoRefresh";
import { getTimeline } from "../../server/timeline";
import { TimelineChart } from "./TimelineChart";
import styles from "./timeline.module.css";

export default async function LaneAllotmentPage() {
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
        <h1 className={styles.title}>Lane Allotment</h1>
        <p className={styles.subtitle}>{data.venueName} &middot; live from now through closing</p>
      </div>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Lanes</div>
          <div className={styles.statValue}>{data.stats.totalLanes}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Active Now</div>
          <div className={styles.statValue}>{data.stats.activeSessions}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Upcoming Blocks</div>
          <div className={styles.statValue}>{data.stats.upcomingBlocks}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Walk-ins Today</div>
          <div className={styles.statValue}>{data.stats.walkinsToday}</div>
        </div>
      </div>

      <TimelineChart data={data} />
    </>
  );
}
