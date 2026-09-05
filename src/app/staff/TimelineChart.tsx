"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { acquireRefreshPause } from "../../components/refreshGate";
import { DEFAULT_ESTIMATOR_CONFIG } from "../../domain/config";
import { checkMove, roundToGrid, type ScheduleSnapshot } from "../../domain/scheduler";
import { addMinutes } from "../../domain/time";
import type { TimelineBlock, TimelineData } from "../../server/timeline";
import { moveAllocationAction } from "./actions";
import styles from "./timeline.module.css";

const GRID_MIN = DEFAULT_ESTIMATOR_CONFIG.slotGridMin;
/** Pointer travel before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;
/** If the server never confirms a move, stop trusting the optimistic position. */
const OVERRIDE_TIMEOUT_MS = 8_000;
/** Width of the lane-label gutter -- must match .laneLabel in timeline.module.css. */
const GUTTER_PX = 88;

type Placement = { laneId: string; start: Date; end: Date };

type DragState = {
  allocationId: string;
  laneId: string;
  start: Date;
  end: Date;
  valid: boolean;
  /** Offset and height of the ghost relative to .tracksArea. */
  top: number;
  height: number;
};

/** Holds ELEMENTS, not rects. Rects are read live on every move: .timelineWrap scrolls
 *  horizontally and the page scrolls vertically, either of which would silently desync
 *  a cached rect from the pointer for the rest of the drag. */
type DragMode = "move" | "resize-start" | "resize-end";

type PointerSession = {
  pointerId: number;
  mode: DragMode;
  block: TimelineBlock;
  originX: number;
  originY: number;
  dragging: boolean;
  trackEl: HTMLElement;
  tracksEl: HTMLElement;
  releasePause: (() => void) | null;
};

function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
}

function formatHour(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric" }).format(date);
}

function pct(from: Date, at: Date, totalMs: number): number {
  return Math.max(0, Math.min(100, ((at.getTime() - from.getTime()) / totalMs) * 100));
}

/** Positions an element across the track area, compensating for the label gutter --
 *  same trick .nowLine uses, since .tracksArea spans the gutter but tracks do not. */
function spanStyle(leftPct: number, rightPct: number) {
  return {
    left: `calc(${GUTTER_PX}px + (100% - ${GUTTER_PX}px) * ${leftPct / 100})`,
    width: `calc((100% - ${GUTTER_PX}px) * ${(rightPct - leftPct) / 100})`,
  };
}

const BLOCK_CLASS = {
  booked: styles.blockBooked,
  walkin: styles.blockWalkin,
  maintenance: styles.blockMaintenance,
};

export function TimelineChart({ data }: { data: TimelineData }) {
  const { windowStart, windowEnd, now, timezone, lanes } = data;
  const totalMs = windowEnd.getTime() - windowStart.getTime();
  const showNowLine = now >= windowStart && now <= windowEnd;

  const [overrides, setOverrides] = useState<Map<string, Placement>>(new Map());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const pointerRef = useRef<PointerSession | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const tracksRef = useRef<HTMLDivElement | null>(null);

  /** Server blocks with any unconfirmed local move applied on top. */
  const blocks = useMemo(() => {
    if (overrides.size === 0) return data.blocks;
    return data.blocks.map((b) => {
      const o = overrides.get(b.allocationId);
      if (!o) return b;
      return {
        ...b,
        laneId: o.laneId,
        trueStart: o.start,
        trueEnd: o.end,
        start: o.start < windowStart ? windowStart : o.start,
        occupyEnd: o.end > windowEnd ? windowEnd : o.end,
        clippedStart: o.start < windowStart,
      };
    });
  }, [data.blocks, overrides, windowStart, windowEnd]);

  /** Drop an override once the server's own data agrees with it. Deliberately NOT done
   *  when the transition ends -- the revalidated render lands a moment later, and
   *  clearing early makes the block jump back to its old spot for a frame. */
  useEffect(() => {
    setOverrides((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      let changed = false;
      for (const [id, o] of prev) {
        const b = data.blocks.find((x) => x.allocationId === id);
        if (!b) continue;
        if (
          b.laneId === o.laneId &&
          b.trueStart.getTime() === o.start.getTime() &&
          b.trueEnd.getTime() === o.end.getTime()
        ) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [data.blocks]);

  /** A response that never arrives must not strand a block in a position the server
   *  never accepted. */
  useEffect(() => {
    if (overrides.size === 0) return;
    const id = setTimeout(() => setOverrides(new Map()), OVERRIDE_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [overrides]);

  /** Client-side feasibility, for instant feedback only. The exclusion constraint in
   *  Postgres remains the authority -- this snapshot only covers blocks inside the
   *  visible window, so it can miss a conflict the server will still catch. */
  const validate = useCallback(
    (block: TimelineBlock, placement: Placement) => {
      const snapshot: ScheduleSnapshot = {
        lanes: lanes.map((l) => ({ id: l.id, number: l.number })),
        allocations: blocks.map((b) => ({
          id: b.allocationId,
          laneId: b.laneId,
          start: b.trueStart,
          end: b.trueEnd,
        })),
        openAt: data.openAt,
        closeAt: data.closeAt,
      };

      return checkMove(snapshot, {
        allocationId: block.allocationId,
        laneId: placement.laneId,
        start: placement.start,
        end: placement.end,
        hasTurnover: block.kind !== "maintenance",
        // No lock: an in-progress session can be moved just like anything else. Only a
        // genuine double-booking (the overlap check above) can reject a drop.
      });
    },
    [blocks, lanes, data.openAt, data.closeAt],
  );

  const laneAtY = useCallback(
    (clientY: number, fallback: string): string => {
      for (const l of lanes) {
        const el = rowRefs.current.get(l.id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (clientY >= r.top && clientY < r.bottom) return l.id;
      }
      return fallback;
    },
    [lanes],
  );

  const placementFor = useCallback(
    (session: PointerSession, clientX: number, clientY: number): Placement => {
      const { block, mode } = session;
      const trackRect = session.trackEl.getBoundingClientRect();

      // Both resize modes read an ABSOLUTE time off the pointer's position along the
      // whole window, unlike "move" below -- that's what makes resize-start correct even
      // on a clippedStart block: the grab point is wherever the pointer visibly is, not
      // an offset from the block's (possibly off-screen) true start.
      const ratioToTime = (x: number) => {
        const ratio = (x - trackRect.left) / trackRect.width;
        return roundToGrid(new Date(windowStart.getTime() + ratio * totalMs), GRID_MIN);
      };

      if (mode === "resize-end") {
        return { laneId: block.laneId, start: block.trueStart, end: ratioToTime(clientX) };
      }
      if (mode === "resize-start") {
        return { laneId: block.laneId, start: ratioToTime(clientX), end: block.trueEnd };
      }

      // move -- snap the DELTA, not the absolute time: an active session can legitimately
      // start off-grid (18:07), and snapping absolutely would teleport it on the first pixel.
      const duration = block.trueEnd.getTime() - block.trueStart.getTime();
      const deltaMs = ((clientX - session.originX) / trackRect.width) * totalMs;
      const deltaMin = Math.round(deltaMs / 60_000 / GRID_MIN) * GRID_MIN;
      const start = addMinutes(block.trueStart, deltaMin);

      return {
        laneId: laneAtY(clientY, block.laneId),
        start,
        end: new Date(start.getTime() + duration),
      };
    },
    [windowStart, totalMs, laneAtY],
  );

  const beginPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, block: TimelineBlock, mode: DragMode) => {
      if (e.button !== 0) return;
      // clippedStart blocks are still resizable (from either edge) but not draggable-by-
      // body -- the body-drag grab point wouldn't correspond to their real (off-screen)
      // start, whereas a resize reads an absolute time off the pointer regardless.
      if (mode === "move" && block.clippedStart) return;

      const trackEl = (e.currentTarget.closest(`.${styles.track}`) ?? null) as HTMLElement | null;
      const tracksEl = tracksRef.current;
      if (!trackEl || !tracksEl) return;

      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      pointerRef.current = {
        pointerId: e.pointerId,
        mode,
        block,
        originX: e.clientX,
        originY: e.clientY,
        dragging: false,
        trackEl,
        tracksEl,
        releasePause: null,
      };
    },
    [],
  );

  const handleMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const session = pointerRef.current;
      if (!session || session.pointerId !== e.pointerId) return;

      if (!session.dragging) {
        const moved =
          Math.abs(e.clientX - session.originX) + Math.abs(e.clientY - session.originY);
        if (moved < DRAG_THRESHOLD_PX) return;
        session.dragging = true;
        session.releasePause = acquireRefreshPause();
        setError(null);
      }

      const placement = placementFor(session, e.clientX, e.clientY);
      const result = validate(session.block, placement);

      // Ghost position is relative to .tracksArea; both rects are read now, so a page
      // scroll shifts them together and the offset stays right.
      const rowEl = rowRefs.current.get(placement.laneId);
      const rowRect = rowEl?.getBoundingClientRect();
      const tracksRect = session.tracksEl.getBoundingClientRect();

      setDrag({
        allocationId: session.block.allocationId,
        laneId: placement.laneId,
        start: placement.start,
        end: placement.end,
        valid: result.ok,
        top: rowRect ? rowRect.top - tracksRect.top + 8 : 8,
        height: rowRect ? rowRect.height - 16 : 40,
      });
    },
    [placementFor, validate],
  );

  const finishPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const session = pointerRef.current;
      if (!session || session.pointerId !== e.pointerId) return;
      pointerRef.current = null;

      const wasDragging = session.dragging;
      setDrag(null);

      if (!wasDragging) {
        session.releasePause?.();
        return;
      }

      const placement = placementFor(session, e.clientX, e.clientY);
      const block = session.block;

      const unchanged =
        placement.laneId === block.laneId &&
        placement.start.getTime() === block.trueStart.getTime() &&
        placement.end.getTime() === block.trueEnd.getTime();

      const result = validate(block, placement);

      if (unchanged || !result.ok) {
        if (!result.ok && !unchanged) setError(rejectionMessage(result.reason));
        session.releasePause?.();
        return;
      }

      setOverrides((prev) => new Map(prev).set(block.allocationId, placement));

      startTransition(async () => {
        try {
          const res = await moveAllocationAction({
            allocationId: block.allocationId,
            laneId: placement.laneId,
            startISO: placement.start.toISOString(),
            endISO: placement.end.toISOString(),
          });

          if (!res.ok) {
            setOverrides((prev) => {
              const next = new Map(prev);
              next.delete(block.allocationId);
              return next;
            });
            setError(res.message);
          }
        } finally {
          session.releasePause?.();
        }
      });
    },
    [placementFor, validate],
  );

  const cancelPointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const session = pointerRef.current;
    if (!session || session.pointerId !== e.pointerId) return;
    pointerRef.current = null;
    session.releasePause?.();
    setDrag(null);
  }, []);

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
        <span className={styles.legendHint}>Drag a block to move it &middot; drag either edge to resize</span>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <span>{error}</span>
          <button type="button" className={styles.errorDismiss} onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className={styles.timelineWrap}>
        <div className={styles.timelineInner}>
          <div className={styles.ruler}>
            {hourMarks.map((h) => (
              <div key={h.toISOString()} className={styles.rulerMark}>
                {formatHour(h, timezone)}
              </div>
            ))}
          </div>

          <div className={styles.tracksArea} ref={tracksRef}>
            {showNowLine && (
              <div
                className={styles.nowLine}
                style={{ left: `calc(${GUTTER_PX}px + (100% - ${GUTTER_PX}px) * ${pct(windowStart, now, totalMs) / 100})` }}
              >
                <span className={styles.nowLabel}>Now</span>
              </div>
            )}

            {drag && (
              <div
                className={`${styles.ghost} ${drag.valid ? "" : styles.ghostInvalid}`}
                style={{
                  ...spanStyle(
                    pct(windowStart, drag.start, totalMs),
                    pct(windowStart, drag.end, totalMs),
                  ),
                  top: `${drag.top}px`,
                  height: `${drag.height}px`,
                }}
              >
                <span className={styles.ghostLabel}>
                  {formatTime(drag.start, timezone)} &ndash; {formatTime(drag.end, timezone)}
                </span>
              </div>
            )}

            {lanes.map((l) => {
              const laneBlocks = blocks.filter((b) => b.laneId === l.id);
              return (
                <div
                  key={l.id}
                  className={styles.laneRow}
                  ref={(el) => {
                    if (el) rowRefs.current.set(l.id, el);
                    else rowRefs.current.delete(l.id);
                  }}
                >
                  <div className={styles.laneLabel}>{l.displayName}</div>
                  <div className={styles.track}>
                    {laneBlocks.map((b) => {
                      const left = pct(windowStart, b.start, totalMs);
                      const right = pct(windowStart, b.occupyEnd, totalMs);
                      const isDragging = drag?.allocationId === b.allocationId;
                      const movable = !b.clippedStart;

                      return (
                        <div
                          key={b.allocationId}
                          className={`${styles.block} ${BLOCK_CLASS[b.kind]} ${
                            isDragging ? styles.blockDragging : ""
                          } ${movable ? styles.blockMovable : ""}`}
                          style={{ left: `${left}%`, width: `${Math.max(right - left, 1)}%` }}
                          title={`${b.label} - ${b.partySize} players, ${b.games} games\n${formatTime(
                            b.trueStart,
                            timezone,
                          )} - ${formatTime(b.trueEnd, timezone)}`}
                          onPointerDown={(e) => beginPointer(e, b, "move")}
                          onPointerMove={handleMove}
                          onPointerUp={finishPointer}
                          onPointerCancel={cancelPointer}
                          onLostPointerCapture={cancelPointer}
                        >
                          <span className={styles.blockLabel}>{b.label}</span>
                          <span className={styles.blockMeta}>
                            {formatTime(b.trueStart, timezone)}
                            {b.kind !== "maintenance" ? ` · ${b.partySize}p` : ""}
                          </span>
                          <div
                            className={`${styles.resizeHandle} ${styles.resizeHandleLeft}`}
                            onPointerDown={(e) => beginPointer(e, b, "resize-start")}
                            onPointerMove={handleMove}
                            onPointerUp={finishPointer}
                            onPointerCancel={cancelPointer}
                            onLostPointerCapture={cancelPointer}
                          />
                          <div
                            className={`${styles.resizeHandle} ${styles.resizeHandleRight}`}
                            onPointerDown={(e) => beginPointer(e, b, "resize-end")}
                            onPointerMove={handleMove}
                            onPointerUp={finishPointer}
                            onPointerCancel={cancelPointer}
                            onLostPointerCapture={cancelPointer}
                          />
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

function rejectionMessage(reason: string): string {
  switch (reason) {
    case "too_short":
      return `Too short — a booking needs at least ${DEFAULT_ESTIMATOR_CONFIG.minPlayBlockMin} minutes.`;
    case "before_open":
      return "That starts before the alley opens.";
    case "after_close":
      return "That would run past closing time.";
    case "lane_conflict":
      return "Another booking is already on that lane at that time.";
    case "locked_start":
      return "This session has already started — you can only change when it ends.";
    case "locked_lane":
      return "This session has already started — it can't be moved to another lane.";
    default:
      return "That move isn't possible.";
  }
}
