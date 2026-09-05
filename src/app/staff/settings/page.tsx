import { asc, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { lane, pkg } from "../../../db/schema";
import { getVenue } from "../../../server/venue";
import {
  addLane,
  addPackage,
  toggleLaneActive,
  togglePackageActive,
  updatePackage,
  updateVenueHours,
} from "./actions";
import styles from "./settings.module.css";

/** `hour` may exceed 23 -- a 4am close past midnight is stored/passed as 28. */
function formatHour(hour: number): string {
  const h = hour % 24;
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  const suffix = hour >= 24 ? " (next day)" : "";
  return `${display}:00 ${period}${suffix}`;
}

const OPEN_HOURS = Array.from({ length: 24 }, (_, h) => h); // 0-23
const CLOSE_HOURS = Array.from({ length: 24 }, (_, h) => h); // 0-23; a value <= Opens At means next day

export default async function SettingsPage() {
  const venue = await getVenue();

  const packages = await db.select().from(pkg).where(eq(pkg.tenantId, venue.id)).orderBy(asc(pkg.sortOrder));
  const lanes = await db.select().from(lane).where(eq(lane.tenantId, venue.id)).orderBy(asc(lane.number));

  return (
    <div>
      <h1 className={styles.title}>Settings</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Alley Timings</h2>
        <p className={styles.sectionSubtitle}>
          When the alley opens and closes. If Closes At is earlier on the clock than Opens At, it&apos;s read as
          the next day -- e.g. opens 10:00 AM, closes 4:00 AM means the alley runs through the night, and a
          booking at 1:00 AM still counts toward the previous night&apos;s business day.
        </p>

        <form action={updateVenueHours} className={styles.hoursRow}>
          <label className={styles.hoursField}>
            Opens At
            {/* key forces a remount when the stored hour changes -- a <select>'s
             *  defaultValue is only applied at mount, so without this the option
             *  visibly selected after Save could lag behind what was actually written. */}
            <select key={venue.opensAtHour} name="opensAtHour" defaultValue={venue.opensAtHour} className={styles.input}>
              {OPEN_HOURS.map((h) => (
                <option key={h} value={h}>
                  {formatHour(h)}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.hoursField}>
            Closes At
            <select
              key={venue.closesAtHour}
              name="closesAtHour"
              defaultValue={venue.closesAtHour % 24}
              className={styles.input}
            >
              {CLOSE_HOURS.map((h) => (
                <option key={h} value={h}>
                  {formatHour(h)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={styles.btn}>
            Save
          </button>
        </form>

        <p className={styles.hoursCaption}>
          Open {formatHour(venue.opensAtHour)} &ndash; {formatHour(venue.closesAtHour)} &middot;{" "}
          {venue.closesAtHour - venue.opensAtHour} hours
        </p>
      </section>

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
