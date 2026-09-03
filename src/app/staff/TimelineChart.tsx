import type { TimelineData } from "../../server/timeline";
import styles from "./timeline.module.css";

function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
}

function formatHour(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric" }).format(date);
}

function pct(from: Date, at: Date, totalMs: number): number {
  return Math.max(0, Math.min(100, ((at.getTime() - from.getTime()) / totalMs) * 100));
}

const BLOCK_CLASS = {
  booked: styles.blockBooked,
  walkin: styles.blockWalkin,
  maintenance: styles.blockMaintenance,
};

export function TimelineChart({ data }: { data: TimelineData }) {
  const { windowStart, windowEnd, now, timezone, lanes, blocks } = data;
  const totalMs = windowEnd.getTime() - windowStart.getTime();
  const showNowLine = now >= windowStart && now <= windowEnd;

  const hourMarks: Date[] = [];
  for (let t = windowStart.getTime(); t < windowEnd.getTime(); t += 60 * 60_000) {
    hourMarks.push(new Date(t));
  }

  return (
    <div>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: "#7c5cff" }} />
          Booked
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: "#22b573" }} />
          Walk-in
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: "#e08a2b" }} />
          Maintenance
        </span>
      </div>

      <div className={styles.timelineWrap}>
        <div className={styles.timelineInner}>
          <div className={styles.ruler}>
            {hourMarks.map((h) => (
              <div key={h.toISOString()} className={styles.rulerMark}>
                {formatHour(h, timezone)}
              </div>
            ))}
          </div>

          <div className={styles.tracksArea}>
            {showNowLine && (
              <div
                className={styles.nowLine}
                style={{ left: `calc(88px + (100% - 88px) * ${pct(windowStart, now, totalMs) / 100})` }}
              >
                <span className={styles.nowLabel}>Now</span>
              </div>
            )}

            {lanes.map((l) => {
              const laneBlocks = blocks.filter((b) => b.laneId === l.id);
              return (
                <div key={l.id} className={styles.laneRow}>
                  <div className={styles.laneLabel}>{l.displayName}</div>
                  <div className={styles.track}>
                    {laneBlocks.map((b) => {
                      const left = pct(windowStart, b.start, totalMs);
                      const playRight = pct(windowStart, b.playEnd, totalMs);
                      const occupyRight = pct(windowStart, b.occupyEnd, totalMs);

                      return (
                        <div key={b.bookingId}>
                          {occupyRight > playRight && (
                            <div
                              className={styles.tail}
                              style={{
                                left: `${left}%`,
                                width: `${occupyRight - left}%`,
                                background: b.kind === "maintenance" ? "#e08a2b" : "#7c5cff",
                              }}
                            />
                          )}
                          <div
                            className={`${styles.block} ${BLOCK_CLASS[b.kind]}`}
                            style={{ left: `${left}%`, width: `${Math.max(playRight - left, 1)}%` }}
                            title={`${b.label} - ${b.partySize} players, ${b.games} games`}
                          >
                            <span className={styles.blockLabel}>{b.label}</span>
                            <span className={styles.blockMeta}>
                              {formatTime(b.start, timezone)}
                              {b.kind !== "maintenance" ? ` · ${b.partySize}p` : ""}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {blocks.length === 0 && <p className={styles.emptyNote}>Nothing on the schedule for this window.</p>}
    </div>
  );
}
