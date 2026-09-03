"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { confirmBooking, findTimes, type TimeOption } from "./actions";
import styles from "./book.module.css";

export type PackageOption = {
  id: string;
  name: string;
  games: number;
  pricePerPerson: number;
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function BookingForm({ packages }: { packages: PackageOption[] }) {
  const router = useRouter();

  const [players, setPlayers] = useState(4);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(packages[0]?.id ?? null);
  const games = packages.find((p) => p.id === selectedPackageId)?.games ?? 1;

  const [dateStr, setDateStr] = useState(todayStr());
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
      const found = await findTimes({ players, games, dateStr, hourStr });
      setTimes(found);
      setSelectedTimeIso(null);
      setSearched(true);
      if (found.length === 0) {
        setErrorMsg("No lanes available near that time. Try a different time or date.");
      }
    } finally {
      setSearching(false);
    }
  }

  async function handleConfirm() {
    if (!selectedTimeIso) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const result = await confirmBooking({
        players,
        games,
        startIso: selectedTimeIso,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
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

  const selectedPackage = packages.find((p) => p.id === selectedPackageId);
  const selectedTimeLabel = times.find((t) => t.startIso === selectedTimeIso)?.label;
  const total = selectedPackage ? selectedPackage.pricePerPerson * players : 0;

  return (
    <div className={styles.layout}>
      <div className={styles.form}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>1. Players &amp; Package</h2>
          <label className={styles.field}>
            Number of players
            <div className={styles.stepper}>
              <button
                type="button"
                className={styles.stepperBtn}
                disabled={players <= 1}
                onClick={() => {
                  setPlayers((p) => Math.max(1, p - 1));
                  resetSearch();
                }}
              >
                −
              </button>
              <span className={styles.stepperValue}>{players}</span>
              <button
                type="button"
                className={styles.stepperBtn}
                disabled={players >= 24}
                onClick={() => {
                  setPlayers((p) => Math.min(24, p + 1));
                  resetSearch();
                }}
              >
                +
              </button>
            </div>
          </label>

          <div className={styles.field}>
            Package
            <div className={styles.packageGrid}>
              {packages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`${styles.packageCard} ${p.id === selectedPackageId ? styles.packageCardSelected : ""}`}
                  onClick={() => {
                    setSelectedPackageId(p.id);
                    resetSearch();
                  }}
                >
                  <span className={styles.packageName}>{p.name}</span>
                  <span className={styles.packageMeta}>
                    {p.games} game{p.games === 1 ? "" : "s"}
                  </span>
                  <span className={styles.packagePrice}>&#8377;{p.pricePerPerson}/person</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>2. Date &amp; Preferred Time</h2>
          <div className={styles.row}>
            <label className={styles.field}>
              Date
              <input
                type="date"
                className={styles.input}
                value={dateStr}
                min={todayStr()}
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

          <button type="button" className={styles.findBtn} onClick={handleFindTimes} disabled={searching}>
            {searching ? "Finding times..." : "Find Available Times"}
          </button>

          {searched && times.length > 0 && (
            <div className={styles.timeGrid}>
              {times.map((t) => (
                <button
                  key={t.startIso}
                  type="button"
                  className={`${styles.timeBtn} ${t.startIso === selectedTimeIso ? styles.timeBtnSelected : ""}`}
                  onClick={() => setSelectedTimeIso(t.startIso)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedTimeIso && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>3. Your Details</h2>
            <label className={styles.field}>
              Name (optional)
              <input
                type="text"
                className={styles.input}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              Phone (optional)
              <input
                type="tel"
                className={styles.input}
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </label>

            {errorMsg && <div className={styles.errorNote}>{errorMsg}</div>}

            <button type="button" className={styles.submitBtn} onClick={handleConfirm} disabled={submitting}>
              {submitting ? "Booking..." : "Confirm Booking"}
            </button>
          </div>
        )}

        {!selectedTimeIso && errorMsg && <div className={styles.errorNote}>{errorMsg}</div>}
      </div>

      <aside className={styles.summary}>
        <h3 className={styles.summaryTitle}>Booking Summary</h3>
        <div className={styles.summaryRow}>
          <span>Players</span>
          <strong>{players}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>Package</span>
          <strong>{selectedPackage ? `${selectedPackage.name} (${selectedPackage.games}g)` : "—"}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>Date</span>
          <strong>{dateStr || "—"}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>Time</span>
          <strong>{selectedTimeLabel ?? "Not selected yet"}</strong>
        </div>
        <div className={styles.summaryTotal}>
          <span className={styles.summaryTotalLabel}>Total</span>
          <span className={styles.summaryTotalValue}>&#8377;{total}</span>
        </div>
        <p className={styles.summaryNote}>Pay at the venue. Lane assigned automatically.</p>
      </aside>
    </div>
  );
}
