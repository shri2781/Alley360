import { getVenue } from "../../../../../server/venue";
import { dayAt, formatWeekSummary } from "../../../../../domain/hours";
import { copyMondayToAllDays, updateVenueHours } from "../actions";
import { SettingsPageHeader } from "../SettingsPageHeader";
import { DISPLAY_DAYS, OPEN_OPTIONS, CLOSE_OPTIONS, formatOptionLabel } from "../shared";
import styles from "../settings.module.css";

export default async function TimingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const venue = await getVenue();

  return (
    <div>
      <SettingsPageHeader
        title="Alley Timings"
        description="Set different hours for different days, or mark a day closed. If a day's closing time is earlier on the clock than its opening time, it's read as running into the next morning -- e.g. opens 10:00 AM, closes 2:00 AM means that day runs through the night, and a booking at 1:00 AM still counts toward that business day."
        error={error}
        success={success}
      />

      <section className={styles.section}>
        <form action={updateVenueHours} className={styles.hoursTable}>
          {DISPLAY_DAYS.map(({ dow, label }) => {
            const day = dayAt(venue.weeklyHours, dow);
            return (
              <div key={dow} className={styles.hoursDayRow}>
                <span className={styles.hoursDayLabel}>{label}</span>

                {/* key forces a remount when the stored value changes -- a <select>'s
                 *  defaultValue is only applied at mount, so without this the option
                 *  visibly selected after Save could lag behind what was actually written. */}
                <select
                  key={`opens-${day.opensAtMin}`}
                  name={`day-${dow}-opens`}
                  defaultValue={day.opensAtMin}
                  className={styles.input}
                >
                  {OPEN_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {formatOptionLabel(m)}
                    </option>
                  ))}
                </select>

                <select
                  key={`closes-${day.closesAtMin}`}
                  name={`day-${dow}-closes`}
                  defaultValue={day.closesAtMin}
                  className={styles.input}
                >
                  {CLOSE_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {formatOptionLabel(m)}
                    </option>
                  ))}
                </select>

                <label className={styles.hoursClosedLabel}>
                  <input key={`closed-${day.isClosed}`} type="checkbox" name={`day-${dow}-closed`} defaultChecked={day.isClosed} />
                  Closed
                </label>
              </div>
            );
          })}

          <div className={styles.hoursActions}>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
              Save
            </button>
            <button type="submit" formAction={copyMondayToAllDays} className={styles.btn}>
              Copy Monday to all days
            </button>
          </div>
        </form>

        <p className={styles.hoursCaption}>{formatWeekSummary(venue.weeklyHours)}</p>
      </section>
    </div>
  );
}
