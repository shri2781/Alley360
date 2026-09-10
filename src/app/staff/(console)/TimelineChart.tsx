"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { acquireRefreshPause } from "../../../components/refreshGate";
import { DEFAULT_ESTIMATOR_CONFIG } from "../../../domain/config";
import { roundToGrid } from "../../../domain/scheduler";
import { addMinutes } from "../../../domain/time";
import type { TimelineBlock, TimelineData } from "../../../server/timeline";
import {
  cancelBookingAction,
  endBookingAction,
  moveAllocationAction,
  startBookingAction,
} from "./actions";
import styles from "./timeline.module.css";

const GRID_MIN = DEFAULT_ESTIMATOR_CONFIG.slotGridMin;
/** Pointer travel before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;
/** If the server never confirms a move, stop trusting the optimistic position. */
const OVERRIDE_TIMEOUT_MS = 8_000;
/** Width of the lane-label gutter -- must match .laneLabel in timeline.module.css. */
const GUTTER_PX = 88;
/** Popover box, needed here to keep it on screen -- must match .popover in the CSS. */
const POPOVER_W = 260;
const POPOVER_MAX_H = 300;
const VIEWPORT_MARGIN = 8;

type Placement = { laneId: string; start: Date; end: Date };

/** The only client-side check left: a staff override may go anywhere -- overlapping,
 *  off-hours, any length -- but an inverted range is unstorable. A genuine double-booking
 *  is caught by the exclusion constraint in Postgres and reported by the server. */
const isValidPlacement = (p: Placement) => p.end.getTime() > p.start.getTime();

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
  /** The block itself even when the press landed on a resize handle -- a press that
   *  never became a drag opens the details popover, anchored to this. */
  blockEl: HTMLElement;
  releasePause: (() => void) | null;
};

/** Which block's details are open, and where to draw the card. Coordinates are
 *  VIEWPORT coordinates: the card is position:fixed so it escapes .timelineWrap's
 *  horizontal scroll clipping, which would otherwise cut it off. */
type PopoverState = { allocationId: string; x: number; y: number };

type ActionKind = "start" | "end" | "cancel";

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

const STATUS_CLASS: Record<TimelineBlock["status"], string | undefined> = {
  confirmed: styles.popBadgeConfirmed,
  active: styles.popBadgeActive,
  completed: styles.popBadgeCompleted,
  cancelled: styles.popBadgeCancelled,
  no_show: styles.popBadgeCancelled,
};

const KIND_LABEL: Record<TimelineBlock["kind"], string> = {
  booked: "Booking",
  walkin: "Walk-in",
  maintenance: "Lane block",
};

export function TimelineChart({ data }: { data: TimelineData }) {
  const { windowStart, windowEnd, now, timezone, lanes } = data;
  const totalMs = windowEnd.getTime() - windowStart.getTime();
  const showNowLine = now >= windowStart && now <= windowEnd;

  const [overrides, setOverrides] = useState<Map<string, Placement>>(new Map());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionKind | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  /** Separate from `error`: a rejected Start/Cancel belongs in the card the operator is
   *  looking at, not in a banner above a timeline the backdrop is covering. */
  const [actionError, setActionError] = useState<string | null>(null);
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

  /** The open block, re-read from the CURRENT blocks every render rather than captured
   *  when the popover opened -- so Start flips the card's own status badge and buttons. */
  const selected = popover ? (blocks.find((b) => b.allocationId === popover.allocationId) ?? null) : null;

  /** Cancel releases the allocation, so the block leaves the board -- close with it. */
  useEffect(() => {
    if (popover && !selected) setPopover(null);
  }, [popover, selected]);

  useEffect(() => {
    setConfirmingCancel(false);
    setActionError(null);
  }, [popover]);

  /** Hold the 10-second poll while the card is open: a re-render underneath it would
   *  swap the block out mid-read, and the operator is about to act on what they see. */
  useEffect(() => {
    if (!popover) return;
    return acquireRefreshPause();
  }, [popover]);

  /** Fixed coordinates go stale the moment anything scrolls or the layout reflows;
   *  closing beats leaving a card pointing at empty space. */
  useEffect(() => {
    if (!popover) return;
    const close = () => setPopover(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [popover]);

  const openPopover = useCallback((allocationId: string, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect();

    // Prefer directly under the block; flip above when the bottom of the window is
    // close. POPOVER_MAX_H is an upper bound, not the measured height, so the flip can
    // trigger a little early -- it never leaves the card off-screen, which is the point.
    const below = r.bottom + 6;
    const fitsBelow = below + POPOVER_MAX_H <= window.innerHeight - VIEWPORT_MARGIN;
    const y = fitsBelow ? below : Math.max(VIEWPORT_MARGIN, r.top - 6 - POPOVER_MAX_H);

    const x = Math.min(
      Math.max(r.left, VIEWPORT_MARGIN),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - POPOVER_W - VIEWPORT_MARGIN),
    );

    setError(null);
    setPopover({ allocationId, x, y });
  }, []);

  const runBookingAction = useCallback(
    (kind: ActionKind, bookingId: string) => {
      const action =
        kind === "start" ? startBookingAction : kind === "end" ? endBookingAction : cancelBookingAction;

      setPendingAction(kind);
      setActionError(null);

      startTransition(async () => {
        try {
          const res = await action(bookingId);
          if (res.ok) setPopover(null);
          else setActionError(res.message);
        } finally {
          setPendingAction(null);
          setConfirmingCancel(false);
        }
      });
    },
    [],
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
      // whole window, unlike "move" below -- the grab point is wherever the pointer
      // visibly is, not an offset from the block's (possibly off-screen) true start.
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

      const trackEl = (e.currentTarget.closest(`.${styles.track}`) ?? null) as HTMLElement | null;
      const tracksEl = tracksRef.current;
      // closest() matches the element itself, so this is the block for a "move" press
      // and the block behind the handle for a resize press.
      const blockEl = (e.currentTarget.closest(`.${styles.block}`) ?? null) as HTMLElement | null;
      if (!trackEl || !tracksEl || !blockEl) return;

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
        blockEl,
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
        setPopover(null);
      }

      const placement = placementFor(session, e.clientX, e.clientY);

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
        valid: isValidPlacement(placement),
        top: rowRect ? rowRect.top - tracksRect.top + 8 : 8,
        height: rowRect ? rowRect.height - 16 : 40,
      });
    },
    [placementFor],
  );

  const finishPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const session = pointerRef.current;
      if (!session || session.pointerId !== e.pointerId) return;
      pointerRef.current = null;

      const wasDragging = session.dragging;
      setDrag(null);

      // A press that never travelled far enough to be a drag is a click: show the
      // booking's details and its Start/End/Cancel actions.
      if (!wasDragging) {
        session.releasePause?.();
        if (popover?.allocationId === session.block.allocationId) setPopover(null);
        else openPopover(session.block.allocationId, session.blockEl);
        return;
      }

      const placement = placementFor(session, e.clientX, e.clientY);
      const block = session.block;

      const unchanged =
        placement.laneId === block.laneId &&
        placement.start.getTime() === block.trueStart.getTime() &&
        placement.end.getTime() === block.trueEnd.getTime();

      const valid = isValidPlacement(placement);

      if (unchanged || !valid) {
        if (!valid && !unchanged) setError("That would end before it starts.");
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
    [placementFor, popover, openPopover],
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
        <span className={styles.legendHint}>
          Click a block for details &middot; drag to move it &middot; drag either edge to resize
        </span>
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

                      return (
                        <div
                          key={b.allocationId}
                          className={`${styles.block} ${BLOCK_CLASS[b.kind]} ${
                            isDragging ? styles.blockDragging : ""
                          }`}
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

      {popover && selected && (
        <>
          <div className={styles.popBackdrop} onPointerDown={() => setPopover(null)} />
          <div
            className={styles.popover}
            style={{ left: `${popover.x}px`, top: `${popover.y}px` }}
            role="dialog"
            aria-label={`${selected.label} details`}
          >
            <div className={styles.popHead}>
              <div>
                <div className={styles.popName}>{selected.label}</div>
                <div className={styles.popKind}>
                  {KIND_LABEL[selected.kind]} &middot;{" "}
                  {/* Every lane the same booking holds, in lane order -- a party split
                      across two lanes is one booking, and Start/End move both. */}
                  {lanes
                    .filter((l) => blocks.some((b) => b.bookingId === selected.bookingId && b.laneId === l.id))
                    .map((l) => l.displayName)
                    .join(", ")}
                </div>
              </div>
              <span className={`${styles.popBadge} ${STATUS_CLASS[selected.status] ?? ""}`}>
                {selected.status.replace("_", " ")}
              </span>
            </div>

            <dl className={styles.popRows}>
              <div className={styles.popRow}>
                <dt>Time</dt>
                <dd>
                  {formatTime(selected.trueStart, timezone)} &ndash; {formatTime(selected.trueEnd, timezone)}
                </dd>
              </div>
              {selected.kind !== "maintenance" && (
                <>
                  <div className={styles.popRow}>
                    <dt>People</dt>
                    <dd>
                      {selected.partySize} &middot; {selected.games} {selected.games === 1 ? "game" : "games"}
                    </dd>
                  </div>
                  <div className={styles.popRow}>
                    <dt>Phone</dt>
                    <dd>
                      {selected.phone ? (
                        <a className={styles.popPhone} href={`tel:${selected.phone}`}>
                          {selected.phone}
                        </a>
                      ) : (
                        <span className={styles.popMuted}>Not given</span>
                      )}
                    </dd>
                  </div>
                </>
              )}
            </dl>

            {actionError && (
              <p className={styles.popError} role="alert">
                {actionError}
              </p>
            )}

            <div className={styles.popActions}>
              {selected.status === "confirmed" && selected.kind !== "maintenance" && (
                <button
                  type="button"
                  className={`${styles.popBtn} ${styles.popBtnStart}`}
                  disabled={pendingAction !== null}
                  onClick={() => runBookingAction("start", selected.bookingId)}
                >
                  {pendingAction === "start" ? "Starting..." : "Start"}
                </button>
              )}

              {selected.status === "active" && (
                <button
                  type="button"
                  className={`${styles.popBtn} ${styles.popBtnEnd}`}
                  disabled={pendingAction !== null}
                  onClick={() => runBookingAction("end", selected.bookingId)}
                >
                  {pendingAction === "end" ? "Ending..." : "End"}
                </button>
              )}

              {/* Cancel frees the lane and cannot be undone from this screen, and the
                  card opens on a single click -- so it asks once before it fires. */}
              {selected.status === "confirmed" &&
                (confirmingCancel ? (
                  <>
                    <button
                      type="button"
                      className={`${styles.popBtn} ${styles.popBtnCancel}`}
                      disabled={pendingAction !== null}
                      onClick={() => runBookingAction("cancel", selected.bookingId)}
                    >
                      {pendingAction === "cancel" ? "Cancelling..." : "Confirm cancel"}
                    </button>
                    <button
                      type="button"
                      className={styles.popBtn}
                      disabled={pendingAction !== null}
                      onClick={() => setConfirmingCancel(false)}
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={`${styles.popBtn} ${styles.popBtnCancel}`}
                    disabled={pendingAction !== null}
                    onClick={() => setConfirmingCancel(true)}
                  >
                    {selected.kind === "maintenance" ? "Remove block" : "Cancel"}
                  </button>
                ))}

              <button
                type="button"
                className={`${styles.popBtn} ${styles.popBtnClose}`}
                onClick={() => setPopover(null)}
              >
                Close
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
