/**
 * A tiny module-level pause switch for <AutoRefresh />.
 *
 * The staff board polls itself every 10 seconds. That is fine until someone is dragging
 * a block, at which point a full server re-render swaps the data out from under the
 * pointer. AutoRefresh and the timeline are SIBLINGS inside a server component, so they
 * cannot share React state without restructuring the page -- a module-level store is the
 * smaller change, and refs count rather than toggle so overlapping holds behave.
 */
let holds = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Pauses refreshing until the returned function is called. Safe to call twice. */
export function acquireRefreshPause(): () => void {
  holds += 1;
  emit();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    emit();
  };
}

export function subscribeRefreshGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isRefreshPaused(): boolean {
  return holds > 0;
}

/** Server snapshot for useSyncExternalStore -- never paused during SSR. */
export function isRefreshPausedServer(): boolean {
  return false;
}
