import { useEffect, useState } from "react";

// The time now, ticking once a second while `active`: one clock per page, handed to whatever shows an
// elapsed time, so a long feed never runs a timer per row. Inactive, it stops where it was.
export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [active, everyMs]);
  return now;
}
