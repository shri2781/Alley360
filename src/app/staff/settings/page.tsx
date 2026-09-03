import { asc, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { lane, pkg } from "../../../db/schema";
import { getVenue } from "../../../server/venue";
import { addLane, addPackage, toggleLaneActive, togglePackageActive, updatePackage } from "./actions";
import styles from "./settings.module.css";

export default async function SettingsPage() {
  const venue = await getVenue();

  const packages = await db.select().from(pkg).where(eq(pkg.tenantId, venue.id)).orderBy(asc(pkg.sortOrder));
  const lanes = await db.select().from(lane).where(eq(lane.tenantId, venue.id)).orderBy(asc(lane.number));

  return (
    <div>
      <h1 className={styles.title}>Settings</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Pricing Packages</h2>
        <p className={styles.sectionSubtitle}>
          Shown on the customer booking page. Prices are estimates -- payment is collected at the venue.
        </p>

        {packages.map((p) => (
          <form
            key={p.id}
            action={updatePackage.bind(null, p.id)}
            className={`${styles.packageRow} ${p.isActive ? "" : styles.inactiveRow}`}
          >
            <input type="text" name="name" defaultValue={p.name} className={styles.input} />
            <input type="number" name="games" defaultValue={p.games} min={1} className={styles.input} />
            <input type="number" name="pricePerPerson" defaultValue={p.pricePerPerson} min={0} className={styles.input} />
            <button type="submit" className={styles.btn}>
              Save
            </button>
            <button type="submit" formAction={togglePackageActive.bind(null, p.id, p.isActive)} className={styles.btn}>
              {p.isActive ? "Deactivate" : "Activate"}
            </button>
          </form>
        ))}

        <form action={addPackage} className={styles.addRow}>
          <input type="text" name="name" placeholder="New package name" required className={styles.input} />
          <input type="number" name="games" placeholder="Games" min={1} required className={styles.input} />
          <input type="number" name="pricePerPerson" placeholder="Price/person" min={0} required className={styles.input} />
          <button type="submit" className={styles.btn}>
            Add
          </button>
        </form>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Lanes</h2>
        <p className={styles.sectionSubtitle}>
          Deactivate a lane instead of deleting it -- lane history is preserved and can&apos;t be removed once a
          booking has used it.
        </p>

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
            <button type="submit" className={styles.btn}>
              + Add Lane
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
