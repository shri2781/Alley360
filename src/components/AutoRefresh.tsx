"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches the page's server data every `intervalMs`. Polling, not SSE/WebSockets --
 *  the lane board's data changes slowly enough that a live push channel isn't worth
 *  the extra moving parts at this scale. Renders nothing itself. */
export function AutoRefresh({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
