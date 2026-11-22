// The page's place, kept in the URL hash so a reload or a bookmark comes back to it and the server needs no route but
// `/`: `#/` is a new session, `#/chat/<id>` an open chat, `#/research/<id>` an open research session,
// `#/governance/<page>[/<item>]` the Governance console, `#/office[/<page>[/<item>[/<tab>]]]` the virtual office, and
// `?settings=<section>` opens Settings over any of them.
import { useCallback, useEffect, useState } from "react";

export const SETTINGS_SECTIONS = ["account", "appearance", "code", "ai-connections", "compute", "connectors", "mcp-servers", "claude-connectors", "skills", "plugins", "system"] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

// The pages of the account's governance: `workspaces` (its chats) and `research` (its research workspaces) open one of
// them as `#/governance/workspaces/<id>`, `policy` opens a revision as `#/governance/policy/<id>`.
export const GOVERNANCE_PAGES = ["overview", "policy", "workspaces", "research", "desks", "approvals", "decisions", "audit", "findings", "reports"] as const;

export type GovernancePage = (typeof GOVERNANCE_PAGES)[number];

// The pages of the office: the overview (`#/office`), the work, what needs the owner, the schedules -- and one employee
// or one mission, each its own screen (`#/office/employee/<id>`, `#/office/mission/<id>`, with an optional tab).
export const OFFICE_PAGES = ["overview", "work", "inbox", "schedule", "employee", "mission"] as const;

export type OfficePage = (typeof OFFICE_PAGES)[number];

// The pages that show one record and need its id.
const OFFICE_DETAIL: readonly OfficePage[] = ["employee", "mission"];

export type View =
  | { view: "new" }
  | { view: "chat"; sessionId: string }
  | { view: "research"; sessionId: string }
  | { view: "governance"; page: GovernancePage; item: string | null }
  | { view: "office"; page: OfficePage; item: string | null; tab: string | null };

const isGovernancePage = (v: string | undefined): v is GovernancePage => v !== undefined && (GOVERNANCE_PAGES as readonly string[]).includes(v);
const isOfficePage = (v: string | undefined): v is OfficePage => v !== undefined && (OFFICE_PAGES as readonly string[]).includes(v);

function officeOf(parts: string[]): View {
  const page = isOfficePage(parts[1]) ? parts[1] : "overview";
  const item = parts[2] ? decodeURIComponent(parts[2]) : null;
  // A detail page without its record is the overview.
  if (OFFICE_DETAIL.includes(page) && item === null) return { view: "office", page: "overview", item: null, tab: null };
  return { view: "office", page, item: OFFICE_DETAIL.includes(page) ? item : null, tab: OFFICE_DETAIL.includes(page) && parts[3] ? decodeURIComponent(parts[3]) : null };
}

function viewOf(parts: string[]): View {
  if (parts[0] === "chat" && parts[1]) return { view: "chat", sessionId: decodeURIComponent(parts[1]) };
  if (parts[0] === "research" && parts[1]) return { view: "research", sessionId: decodeURIComponent(parts[1]) };
  if (parts[0] === "governance") return { view: "governance", page: isGovernancePage(parts[1]) ? parts[1] : "overview", item: parts[2] ? decodeURIComponent(parts[2]) : null };
  if (parts[0] === "office") return officeOf(parts);
  return { view: "new" };
}

function officePath(v: Extract<View, { view: "office" }>): string {
  if (v.page === "overview") return "#/office";
  if (!OFFICE_DETAIL.includes(v.page) || v.item === null) return `#/office/${v.page}`;
  return `#/office/${v.page}/${encodeURIComponent(v.item)}${v.tab ? `/${encodeURIComponent(v.tab)}` : ""}`;
}

function pathOf(v: View): string {
  if (v.view === "chat") return `#/chat/${encodeURIComponent(v.sessionId)}`;
  if (v.view === "research") return `#/research/${encodeURIComponent(v.sessionId)}`;
  if (v.view === "governance") return `#/governance/${v.page}${v.item ? `/${encodeURIComponent(v.item)}` : ""}`;
  if (v.view === "office") return officePath(v);
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

// A link that opens a section of Settings over whatever page is open now.
export const settingsHref = (section: SettingsSection): string => hrefOf({ view: parseRoute(window.location.hash).view, settings: section });

// The office's own places, as links.
export const officeHref = (page: OfficePage, item: string | null = null, tab: string | null = null): string => hrefOf({ view: { view: "office", page, item, tab }, settings: null });

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
