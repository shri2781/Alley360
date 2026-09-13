import { asc, eq } from "drizzle-orm";
import { db } from "../../../../../db/client";
import { lane } from "../../../../../db/schema";
import { getVenue } from "../../../../../server/venue";
import { addLane, toggleLaneActive } from "../actions";
import { SettingsPageHeader } from "../SettingsPageHeader";
import styles from "../settings.module.css";

export default async function LanesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const venue = await getVenue();

  const lanes = await db.select().from(lane).where(eq(lane.tenantId, venue.id)).orderBy(asc(lane.number));

  return (
    <div>
      <SettingsPageHeader
        title="Lanes"
        description="Deactivate a lane instead of deleting it -- lane history is preserved and can't be removed once a booking has used it."
        error={error}
        success={success}
      />

      <section className={styles.section}>
        <div className={styles.laneGrid}>
          {lanes.map((l) => (
            <div key={l.id} className={`${styles.laneChip} ${l.isActive ? "" : styles.laneChipInactive}`}>
              {l.displayName}
              <form action={toggleLaneActive.bind(null, l.id, l.isActive)}>
                <button type="submit" className={styles.btn}>
                  {l.isActive ? "Deactivate" : "Activate"}
                </button>
              </form>
            </div>
          ))}

          <form action={addLane}>
            <button type="submit" className={`${styles.btn} ${styles.btnAdd}`}>
              + Add Lane
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
