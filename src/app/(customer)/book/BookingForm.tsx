"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import btn from "../_components/Button.module.css";
import { confirmBooking, findTimes, type TimeOption } from "./actions";
import { MAX_BOOKING_GAMES, validateCustomerName } from "../../../domain/bookingInput";
import styles from "./book.module.css";

/** "2026-09-14" -> "Sunday, Sep 14". Formatted in UTC -- the string is already a
 *  venue-local business date, not an instant, so no timezone conversion applies. */
function formatBusinessDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function BookingForm({ minDate, maxDate }: { minDate: string; maxDate: string }) {
  const router = useRouter();

  const [players, setPlayers] = useState(4);
  const [games, setGames] = useState(2);

  const [dateStr, setDateStr] = useState(minDate);
  const [hourStr, setHourStr] = useState("19:00");

  const [times, setTimes] = useState<TimeOption[]>([]);
  const [selectedTimeIso, setSelectedTimeIso] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Any change to what's being requested invalidates a prior search -- re-searching
  // is required rather than silently booking a slot found under different terms.
  function resetSearch() {
    setTimes([]);
    setSelectedTimeIso(null);
    setSearched(false);
    setErrorMsg(null);
  }

  async function handleFindTimes() {
    setSearching(true);
    setErrorMsg(null);
    try {
      const result = await findTimes({ players, games, dateStr, hourStr });
      setSelectedTimeIso(null);
      setSearched(true);

      if (result.status === "invalid") {
        setTimes([]);
        setErrorMsg("Enter a valid date, time, and player/game count.");
        return;
      }
      if (result.status === "closed") {
        setTimes([]);
        setErrorMsg(`The alley is closed on ${formatBusinessDate(result.businessDate)}. Try a different date.`);
        return;
      }

      setTimes(result.times);
      if (result.times.length === 0) {
        setErrorMsg("No lanes available near that time. Try a different time or date.");
      }
    } finally {
      setSearching(false);
    }
  }

  const trimmedName = customerName.trim();
  const trimmedPhone = customerPhone.trim();
  const nameValid = validateCustomerName(trimmedName) === null;
  const phoneValid = /^\d{10}$/.test(trimmedPhone);

  async function handleConfirm() {
    if (!selectedTimeIso) return;
    if (!nameValid) {
      setErrorMsg(validateCustomerName(trimmedName) ?? "Name is required.");
      return;
    }
    if (!phoneValid) {
      setErrorMsg("Enter a valid 10-digit phone number.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const result = await confirmBooking({
        players,
        games,
        startIso: selectedTimeIso,
        customerName: trimmedName,
        customerPhone: trimmedPhone,
      });
      if (result.ok) {
        router.push(`/book/confirmed?id=${result.bookingId}`);
      } else {
        setErrorMsg(result.message);
        resetSearch();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const selectedTime = times.find((t) => t.startIso === selectedTimeIso);
  const step3Unlocked = Boolean(selectedTimeIso);

  return (
    <div className={styles.layout}>
      <div className={styles.form}>
        <ol className={styles.stepRail} aria-hidden="true">
          <li className={`${styles.stepRailItem} ${styles.stepRailDone}`}>
            <span className={styles.stepRailDot}>&#10003;</span> Players &amp; Games
          </li>
          <li className={`${styles.stepRailItem} ${step3Unlocked ? styles.stepRailDone : styles.stepRailActive}`}>
            <span className={styles.stepRailDot}>{step3Unlocked ? "✓" : "2"}</span> Date &amp; Time
          </li>
          <li className={`${styles.stepRailItem} ${step3Unlocked ? styles.stepRailActive : ""}`}>
            <span className={styles.stepRailDot}>3</span> Your Details
          </li>
        </ol>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>1. Players &amp; Games</h2>
          <label className={styles.field}>
            Number of players
            <div className={styles.stepper}>
              <button
                type="button"
                className={styles.stepperBtn}
                disabled={players <= 1}
                aria-label="Fewer players"
                onClick={() => {
                  setPlayers((p) => Math.max(1, p - 1));
                  resetSearch();
                }}
              >
                &minus;
              </button>
              <span className={styles.stepperValue}>{players}</span>
              <button
                type="button"
                className={styles.stepperBtn}
                disabled={players >= 24}
                aria-label="More players"
                onClick={() => {
                  setPlayers((p) => Math.min(24, p + 1));
                  resetSearch();
                }}
              >
                +
              </button>
            </div>
          </label>

          <label className={styles.field}>
            Number of games
            <div className={styles.stepper}>
              <button
                type="button"
                className={styles.stepperBtn}
                disabled={games <= 1}
                aria-label="Fewer games"
                onClick={() => {
                  setGames((g) => Math.max(1, g - 1));
                  resetSearch();
                }}
              >
                &minus;
              </button>
              <span className={styles.stepperValue}>{games}</span>
              <button
                type="button"
                className={styles.stepperBtn}
                disabled={games >= MAX_BOOKING_GAMES}
                aria-label="More games"
                onClick={() => {
                  setGames((g) => Math.min(MAX_BOOKING_GAMES, g + 1));
                  resetSearch();
                }}
              >
                +
              </button>
            </div>
          </label>
        </div>

        <form
          className={styles.section}
          onSubmit={(e) => {
            e.preventDefault();
            handleFindTimes();
          }}
        >
          <h2 className={styles.sectionTitle}>2. Date &amp; Preferred Time</h2>
          <div className={styles.row}>
            <label className={styles.field}>
              Date
              <input
                type="date"
                className={styles.input}
                value={dateStr}
                min={minDate}
                max={maxDate}
                onChange={(e) => {
                  setDateStr(e.target.value);
                  resetSearch();
                }}
              />
            </label>
            <label className={styles.field}>
              Around what time?
              <input
                type="time"
                className={styles.input}
                value={hourStr}
                onChange={(e) => {
                  setHourStr(e.target.value);
                  resetSearch();
                }}
              />
            </label>
          </div>

          <button type="submit" className={`${btn.btnPrimary} ${btn.btnBlock}`} disabled={searching}>
            {searching ? "Finding times…" : "Find Available Times"}
          </button>

          {searching && (
            <div className={styles.timeGrid} aria-hidden="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <span key={i} className={styles.timeSkeleton} />
              ))}
            </div>
          )}

          {!searching && searched && times.length > 0 && (
            <div className={styles.timeGrid} role="group" aria-label="Available times">
              {times.map((t) => (
                <button
                  key={t.startIso}
                  type="button"
                  aria-pressed={t.startIso === selectedTimeIso}
                  className={`${styles.timeBtn} ${t.startIso === selectedTimeIso ? styles.timeBtnSelected : ""}`}
                  onClick={() => setSelectedTimeIso(t.startIso)}
                >
                  <span className={styles.timeBtnLabel}>{t.label}</span>
                  <span className={styles.timeBtnMeta}>
                    {t.rateName} &middot; &#8377;{t.totalPrice}
                  </span>
                </button>
              ))}
            </div>
          )}
        </form>

        {step3Unlocked && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>3. Your Details</h2>
            <label className={styles.field}>
              Name
              <input
                type="text"
                className={styles.input}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
              />
            </label>
            <label className={styles.field}>
              Phone
              <input
                type="tel"
                inputMode="numeric"
                pattern="\d{10}"
                maxLength={10}
                className={styles.input}
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                required
              />
            </label>

            {errorMsg && (
              <div className={styles.errorNote} role="status" aria-live="polite">
                {errorMsg}
              </div>
            )}

            <button
              type="button"
              className={`${btn.btnPrimary} ${btn.btnBlock}`}
              onClick={handleConfirm}
              disabled={submitting || !nameValid || !phoneValid}
            >
              {submitting ? "Booking…" : "Confirm Booking"}
            </button>
          </div>
        )}

        {!step3Unlocked && errorMsg && (
          <div className={styles.errorNote} role="status" aria-live="polite">
            {errorMsg}
          </div>
        )}
      </div>

      <aside className={styles.summary}>
        <h3 className={styles.summaryTitle}>Booking Summary</h3>
        <div className={styles.summaryRow}>
          <span>Players</span>
          <strong>{players}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>Games</span>
          <strong>{games}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>Date</span>
          <strong>{dateStr || "—"}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>Time</span>
          <strong>{selectedTime?.label ?? "Not selected yet"}</strong>
        </div>
        {selectedTime && (
          <div className={styles.summaryRow}>
            <span>Rate</span>
            <strong>{selectedTime.rateName}</strong>
          </div>
        )}
        <div className={styles.summaryTotal}>
          <span className={styles.summaryTotalLabel}>Total</span>
          <span className={styles.summaryTotalValue}>{selectedTime ? `₹${selectedTime.totalPrice}` : "—"}</span>
        </div>
        <p className={styles.summaryNote}>
          {selectedTime ? "Pay at the venue. Lane assigned automatically." : "Select a time to see your price."}
        </p>
      </aside>

      <div className={styles.mobileBar} aria-hidden="true">
        <div className={styles.mobileBarInfo}>
          <span className={styles.mobileBarTime}>{selectedTime?.label ?? `${players} players, ${games} games`}</span>
          <span className={styles.mobileBarSub}>{selectedTime?.rateName ?? "Pick a time"}</span>
        </div>
        <span className={styles.mobileBarTotal}>{selectedTime ? `₹${selectedTime.totalPrice}` : "—"}</span>
      </div>
    </div>
  );
}
