// The page's place, kept in the URL hash so a reload or a bookmark comes back to it and the server needs no route but
// `/`: `#/` is a new session, `#/chat/<id>` an open chat, and `?settings=<section>` opens Settings over either.
import { useCallback, useEffect, useState } from "react";

export const SETTINGS_SECTIONS = ["account", "appearance", "code", "connectors", "skills", "plugins", "system"] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type View = { view: "new" } | { view: "chat"; sessionId: string };

export interface Route {
  view: View;
  settings: SettingsSection | null;
}

const isSection = (v: string | null): v is SettingsSection => v !== null && (SETTINGS_SECTIONS as readonly string[]).includes(v);

export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  const wanted = new URLSearchParams(query).get("settings");
  const settings = isSection(wanted) ? wanted : parts[0] === "settings" ? (isSection(parts[1] ?? null) ? (parts[1] as SettingsSection) : "account") : null;
  const view: View = parts[0] === "chat" && parts[1] ? { view: "chat", sessionId: decodeURIComponent(parts[1]) } : { view: "new" };
  return { view, settings };
}

export function hrefOf(r: Route): string {
  const path = r.view.view === "chat" ? `#/chat/${encodeURIComponent(r.view.sessionId)}` : "#/";
  return r.settings ? `${path}?settings=${r.settings}` : path;
}

export interface Navigation {
  route: Route;
  open: (view: View) => void;
  openSettings: (section: SettingsSection) => void;
  closeSettings: () => void;
}

export function useHashRoute(): Navigation {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const go = useCallback((next: Route) => {
    window.location.hash = hrefOf(next);
    setRoute(next);
  }, []);
  return {
    route,
    open: useCallback((view: View) => go({ view, settings: null }), [go]),
    openSettings: useCallback((section: SettingsSection) => go({ view: parseRoute(window.location.hash).view, settings: section }), [go]),
    closeSettings: useCallback(() => go({ view: parseRoute(window.location.hash).view, settings: null }), [go]),
  };
}
