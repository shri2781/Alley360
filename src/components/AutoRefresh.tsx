"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { isRefreshPaused, isRefreshPausedServer, subscribeRefreshGate } from "./refreshGate";

/** Re-fetches the page's server data every `intervalMs`. Polling, not SSE/WebSockets --
 *  the lane board's data changes slowly enough that a live push channel isn't worth
 *  the extra moving parts at this scale. Renders nothing itself.
 *
 *  Pauses while anything holds the refresh gate (see ./refreshGate) -- refreshing
 *  mid-drag would replace the block being dragged. */
export function AutoRefresh({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const paused = useSyncExternalStore(subscribeRefreshGate, isRefreshPaused, isRefreshPausedServer);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs, paused]);

  return null;
}
