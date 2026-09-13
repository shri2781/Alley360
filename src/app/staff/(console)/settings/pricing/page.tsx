import { asc, eq } from "drizzle-orm";
import { db } from "../../../../../db/client";
import { rate } from "../../../../../db/schema";
import { getVenue } from "../../../../../server/venue";
import { getRateSchedule } from "../../../../../server/rates";
import { dayAt, formatMinuteOfDay } from "../../../../../domain/hours";
import { rateSegments } from "../../../../../domain/rates";
import {
  addSpecialRate,
  moveSpecialRate,
  toggleSpecialRateActive,
  updateBaseRate,
  updateSpecialRate,
} from "../actions";
import { SettingsPageHeader } from "../SettingsPageHeader";
import { DISPLAY_DAYS, OPEN_OPTIONS, CLOSE_OPTIONS, formatOptionLabel } from "../shared";
import styles from "../settings.module.css";

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const venue = await getVenue();

  const [rateRows, schedule] = await Promise.all([
    // Raw rows, unfiltered by is_active -- this list needs to show (and let staff
    // reactivate) inactive rates too, unlike getRateSchedule() below.
    db.select().from(rate).where(eq(rate.tenantId, venue.id)).orderBy(asc(rate.priority), asc(rate.name), asc(rate.id)),
    // Active-only schedule, for the "This week" preview -- it should show exactly
    // what a customer booking today would see, not rates staff have turned off.
    getRateSchedule(venue.id),
  ]);

  const baseRow = rateRows.find((r) => r.isBase);
  if (!baseRow) throw new Error(`tenant ${venue.id} has no base rate -- run \`npm run db:reset\``);
  const specialRows = rateRows.filter((r) => !r.isBase);

  return (
    <div>
      <SettingsPageHeader
        title="Pricing"
        description="Shown on the customer booking page. Prices are per person, per game -- payment is collected at the venue."
        error={error}
        success={success}
      />

      <section className={styles.section}>
        <p className={styles.groupLabel}>
          <strong>Base rate</strong> &mdash; applies whenever no special rate below matches.
        </p>
        <form action={updateBaseRate} className={styles.rateBaseRow}>
          <label className={styles.field}>
            Name
            <input type="text" name="name" defaultValue={baseRow.name} className={styles.input} />
          </label>
          <label className={`${styles.field} ${styles.fieldNarrow}`}>
            Price / person / game
            <input type="number" name="pricePerPerson" defaultValue={baseRow.pricePerPerson} min={0} className={styles.input} />
          </label>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
            Save
          </button>
        </form>

        <p className={styles.groupLabel}>
          <strong>Special rates</strong> &mdash; checked top to bottom, first match wins.
        </p>
        <div className={styles.rateList}>
          {specialRows.map((r, i) => {
            const days = r.days ?? [];
            return (
              <form
                key={r.id}
                action={updateSpecialRate.bind(null, r.id)}
                className={`${styles.rateRow} ${r.isActive ? "" : styles.inactiveRow}`}
              >
                <div className={styles.rateRowTop}>
                  <span className={styles.hoursDayLabel}>{i + 1}.</span>
                  <label className={styles.field}>
                    <span className={styles.srOnly}>Rate name</span>
                    <input type="text" name="name" defaultValue={r.name} className={styles.input} />
                  </label>
                  <label className={`${styles.field} ${styles.fieldNarrow}`}>
                    <span className={styles.srOnly}>Price per person per game</span>
                    <input type="number" name="pricePerPerson" defaultValue={r.pricePerPerson} min={0} className={styles.input} />
                  </label>
                </div>

                <div className={styles.rateDays}>
                  {DISPLAY_DAYS.map(({ dow, label }) => (
                    <label key={dow} className={styles.rateDayToggle}>
                      <input
                        key={`d-${dow}-${days.includes(dow)}`}
                        type="checkbox"
                        name={`day-${dow}`}
                        defaultChecked={days.includes(dow)}
                      />
                      {label}
                    </label>
                  ))}
                </div>

                <div className={styles.rateWindow}>
                  From
                  <select
                    key={`s-${r.startsAtMin}`}
                    name="startsAtMin"
                    defaultValue={r.startsAtMin ?? ""}
                    className={`${styles.input} ${styles.timeSelect}`}
                  >
                    <option value="">Opening</option>
                    {OPEN_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {formatOptionLabel(m)}
                      </option>
                    ))}
                  </select>
                  to
                  <select
                    key={`e-${r.endsAtMin}`}
                    name="endsAtMin"
                    defaultValue={r.endsAtMin ?? ""}
                    className={`${styles.input} ${styles.timeSelect}`}
                  >
                    <option value="">Closing</option>
                    {CLOSE_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {formatOptionLabel(m)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.rateRowActions}>
                  <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
                    Save
                  </button>
                  <button type="submit" formAction={moveSpecialRate.bind(null, r.id, "up")} className={styles.btn} disabled={i === 0}>
                    &uarr;
                  </button>
                  <button
                    type="submit"
                    formAction={moveSpecialRate.bind(null, r.id, "down")}
                    className={styles.btn}
                    disabled={i === specialRows.length - 1}
                  >
                    &darr;
                  </button>
                  <button type="submit" formAction={toggleSpecialRateActive.bind(null, r.id, r.isActive)} className={styles.btn}>
                    {r.isActive ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </form>
            );
          })}
        </div>

        <form action={addSpecialRate} className={styles.rateRow}>
          <div className={styles.rateRowTop}>
            <label className={styles.field}>
              <span className={styles.srOnly}>Rate name</span>
              <input type="text" name="name" placeholder="New rate name" required className={styles.input} />
            </label>
            <label className={`${styles.field} ${styles.fieldNarrow}`}>
              <span className={styles.srOnly}>Price per person per game</span>
              <input type="number" name="pricePerPerson" placeholder="Price / person / game" min={0} required className={styles.input} />
            </label>
          </div>
          <div className={styles.rateDays}>
            {DISPLAY_DAYS.map(({ dow, label }) => (
              <label key={dow} className={styles.rateDayToggle}>
                <input type="checkbox" name={`day-${dow}`} />
                {label}
              </label>
            ))}
          </div>
          <div className={styles.rateWindow}>
            From
            <select name="startsAtMin" defaultValue="" className={`${styles.input} ${styles.timeSelect}`}>
              <option value="">Opening</option>
              {OPEN_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {formatOptionLabel(m)}
                </option>
              ))}
            </select>
            to
            <select name="endsAtMin" defaultValue="" className={`${styles.input} ${styles.timeSelect}`}>
              <option value="">Closing</option>
              {CLOSE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {formatOptionLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={`${styles.btn} ${styles.btnAdd}`}>
            + Add special rate
          </button>
        </form>

        <p className={styles.groupLabel}>
          <strong>This week</strong> &mdash; what customers booking today would actually be charged.
        </p>
        <div className={styles.weekPreview}>
          {DISPLAY_DAYS.map(({ dow, label }) => {
            const day = dayAt(venue.weeklyHours, dow);
            const segments = rateSegments(schedule, day);
            return (
              <div key={dow} className={styles.weekPreviewDay}>
                <span className={styles.weekPreviewLabel}>{label}</span>
                {day.isClosed ? (
                  <span className={styles.weekPreviewClosed}>Closed</span>
                ) : (
                  <div className={styles.weekPreviewSegments}>
                    {segments.map((seg) => (
                      <span key={seg.fromMin} className={styles.weekPreviewSegment}>
                        {formatMinuteOfDay(seg.fromMin)} &ndash; {formatMinuteOfDay(seg.toMin)} &middot; {seg.rate.name} &#8377;
                        {seg.rate.pricePerPerson}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
