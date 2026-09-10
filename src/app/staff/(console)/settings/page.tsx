import { asc, eq } from "drizzle-orm";
import { db } from "../../../../db/client";
import { lane, rate } from "../../../../db/schema";
import { getVenue } from "../../../../server/venue";
import { getRateSchedule } from "../../../../server/rates";
import { dayAt, formatMinuteOfDay, formatWeekSummary, HOURS_GRID_MIN, MINUTES_PER_DAY } from "../../../../domain/hours";
import { rateSegments } from "../../../../domain/rates";
import {
  addLane,
  addSpecialRate,
  changePassword,
  copyMondayToAllDays,
  moveSpecialRate,
  toggleLaneActive,
  toggleSpecialRateActive,
  updateBaseRate,
  updateSpecialRate,
  updateVenueHours,
} from "./actions";
import styles from "./settings.module.css";

/** Monday-first for display; storage (and every domain function) is 0=Sunday. */
const DISPLAY_DAYS = [
  { dow: 1, label: "Mon" },
  { dow: 2, label: "Tue" },
  { dow: 3, label: "Wed" },
  { dow: 4, label: "Thu" },
  { dow: 5, label: "Fri" },
  { dow: 6, label: "Sat" },
  { dow: 0, label: "Sun" },
] as const;

const OPEN_OPTIONS = Array.from({ length: MINUTES_PER_DAY / HOURS_GRID_MIN }, (_, i) => i * HOURS_GRID_MIN); // 0..1410
const CLOSE_OPTIONS = Array.from({ length: (MINUTES_PER_DAY * 2) / HOURS_GRID_MIN }, (_, i) => (i + 1) * HOURS_GRID_MIN); // 30..2880

/** 630 -> "10:30 AM"; 1560 -> "2:00 AM (next day)" -- the option list spans two
 *  calendar days (a close can run past midnight), so values past 1440 need the same
 *  "(next day)" framing the old single opens/closes pair used. */
function formatOptionLabel(min: number): string {
  return min >= MINUTES_PER_DAY ? `${formatMinuteOfDay(min)} (next day)` : formatMinuteOfDay(min);
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const venue = await getVenue();

  const [lanes, rateRows, schedule] = await Promise.all([
    db.select().from(lane).where(eq(lane.tenantId, venue.id)).orderBy(asc(lane.number)),
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
      <h1 className={styles.title}>Settings</h1>

      {error && <p className={styles.errorBanner}>{error}</p>}
      {success && <p className={styles.successBanner}>{success}</p>}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Alley Timings</h2>
        <p className={styles.sectionSubtitle}>
          Set different hours for different days, or mark a day closed. If a day&apos;s closing time is earlier on
          the clock than its opening time, it&apos;s read as running into the next morning -- e.g. opens 10:00 AM,
          closes 2:00 AM means that day runs through the night, and a booking at 1:00 AM still counts toward that
          business day.
        </p>

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
            <button type="submit" className={styles.btn}>
              Save
            </button>
            <button type="submit" formAction={copyMondayToAllDays} className={styles.btn}>
              Copy Monday to all days
            </button>
          </div>
        </form>

        <p className={styles.hoursCaption}>{formatWeekSummary(venue.weeklyHours)}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Pricing</h2>
        <p className={styles.sectionSubtitle}>
          Shown on the customer booking page. Prices are per person, per game -- payment is collected at the venue.
        </p>

        <p className={styles.sectionSubtitle}>
          <strong>Base rate</strong> &mdash; applies whenever no special rate below matches.
        </p>
        <form action={updateBaseRate} className={styles.rateBaseRow}>
          <input type="text" name="name" defaultValue={baseRow.name} className={styles.input} />
          <input type="number" name="pricePerPerson" defaultValue={baseRow.pricePerPerson} min={0} className={styles.input} />
          <button type="submit" className={styles.btn}>
            Save
          </button>
        </form>

        <p className={styles.sectionSubtitle}>
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
                  <input type="text" name="name" defaultValue={r.name} className={styles.input} />
                  <input type="number" name="pricePerPerson" defaultValue={r.pricePerPerson} min={0} className={styles.input} />
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
                  <select key={`s-${r.startsAtMin}`} name="startsAtMin" defaultValue={r.startsAtMin ?? ""} className={styles.input}>
                    <option value="">Opening</option>
                    {OPEN_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {formatOptionLabel(m)}
                      </option>
                    ))}
                  </select>
                  to
                  <select key={`e-${r.endsAtMin}`} name="endsAtMin" defaultValue={r.endsAtMin ?? ""} className={styles.input}>
                    <option value="">Closing</option>
                    {CLOSE_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {formatOptionLabel(m)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.rateRowActions}>
                  <button type="submit" className={styles.btn}>
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
            <input type="text" name="name" placeholder="New rate name" required className={styles.input} />
            <input type="number" name="pricePerPerson" placeholder="Price / person / game" min={0} required className={styles.input} />
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
            <select name="startsAtMin" defaultValue="" className={styles.input}>
              <option value="">Opening</option>
              {OPEN_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {formatOptionLabel(m)}
                </option>
              ))}
            </select>
            to
            <select name="endsAtMin" defaultValue="" className={styles.input}>
              <option value="">Closing</option>
              {CLOSE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {formatOptionLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={styles.btn}>
            + Add special rate
          </button>
        </form>

        <p className={styles.sectionSubtitle}>
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

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Account</h2>
        <p className={styles.sectionSubtitle}>
          The shared login everyone on shift uses to open this console. Changing it only affects future sign-ins.
        </p>

        <form action={changePassword} className={styles.passwordForm}>
          <label className={styles.hoursField}>
            Current password
            <input type="password" name="currentPassword" autoComplete="current-password" required className={styles.input} />
          </label>
          <label className={styles.hoursField}>
            New password
            <input
              type="password"
              name="newPassword"
              autoComplete="new-password"
              minLength={8}
              required
              className={styles.input}
            />
          </label>
          <label className={styles.hoursField}>
            Confirm new password
            <input
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              minLength={8}
              required
              className={styles.input}
            />
          </label>
          <button type="submit" className={styles.btn}>
            Update Password
          </button>
        </form>
      </section>
    </div>
  );
}
