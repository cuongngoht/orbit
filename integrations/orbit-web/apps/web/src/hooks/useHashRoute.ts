// The page's place, kept in the URL hash so a reload or a bookmark comes back to it and the server needs no route but
// `/`: `#/` is a new session, `#/chat/<id>` an open chat, `#/research/<id>` an open research session,
// `#/governance/<page>[/<item>]` the Governance console, and `?settings=<section>` opens Settings over any of them.
import { useCallback, useEffect, useState } from "react";

export const SETTINGS_SECTIONS = ["account", "appearance", "code", "connectors", "skills", "plugins", "system"] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const GOVERNANCE_PAGES = ["overview", "constitution", "operators", "agents", "decisions", "approvals", "audit", "findings", "reports"] as const;

export type GovernancePage = (typeof GOVERNANCE_PAGES)[number];

export type View = { view: "new" } | { view: "chat"; sessionId: string } | { view: "research"; sessionId: string } | { view: "governance"; page: GovernancePage; item: string | null };

const isGovernancePage = (v: string | undefined): v is GovernancePage => v !== undefined && (GOVERNANCE_PAGES as readonly string[]).includes(v);

function viewOf(parts: string[]): View {
  if (parts[0] === "chat" && parts[1]) return { view: "chat", sessionId: decodeURIComponent(parts[1]) };
  if (parts[0] === "research" && parts[1]) return { view: "research", sessionId: decodeURIComponent(parts[1]) };
  if (parts[0] === "governance") return { view: "governance", page: isGovernancePage(parts[1]) ? parts[1] : "overview", item: parts[2] ? decodeURIComponent(parts[2]) : null };
  return { view: "new" };
}

function pathOf(v: View): string {
  if (v.view === "chat") return `#/chat/${encodeURIComponent(v.sessionId)}`;
  if (v.view === "research") return `#/research/${encodeURIComponent(v.sessionId)}`;
  if (v.view === "governance") return `#/governance/${v.page}${v.item ? `/${encodeURIComponent(v.item)}` : ""}`;
  return "#/";
}

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
  return { view: viewOf(parts), settings };
}

export function hrefOf(r: Route): string {
  const path = pathOf(r.view);
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
