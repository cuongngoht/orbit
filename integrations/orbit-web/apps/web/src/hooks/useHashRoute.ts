// The page's place, kept in the URL hash (#/chat/<id>, #/settings, #/setup), so a reload or a bookmark comes back to it
// and the server needs to know no route but /.
import { useCallback, useEffect, useState } from "react";

export type Route = { page: "chat"; sessionId: string | null } | { page: "settings" } | { page: "setup" };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "settings") return { page: "settings" };
  if (parts[0] === "setup") return { page: "setup" };
  if (parts[0] === "chat" && parts[1]) return { page: "chat", sessionId: decodeURIComponent(parts[1]) };
  return { page: "chat", sessionId: null };
}

export const hrefOf = (r: Route): string => (r.page === "chat" ? (r.sessionId ? `#/chat/${encodeURIComponent(r.sessionId)}` : "#/chat") : `#/${r.page}`);

export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const go = useCallback((r: Route) => {
    window.location.hash = hrefOf(r);
    setRoute(r);
  }, []);
  return [route, go];
}
