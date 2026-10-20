import type { ReportsOverview, Unavailable } from "./reports.types";

export const REPORTS_PATH = "/reports";

export type ReportsTab = "overview" | "settings" | "connection" | "sections" | "extensions";

export const REPORT_TABS: readonly { id: ReportsTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "settings", label: "Settings" },
  { id: "connection", label: "Connection" },
  { id: "sections", label: "Report sections" },
  { id: "extensions", label: "Extensions" },
];

export const reportTabPath = (tab: ReportsTab) => (tab === "overview" ? REPORTS_PATH : `${REPORTS_PATH}/${tab}`);

export const isReportsTab = (value: unknown): value is ReportsTab => REPORT_TABS.some((t) => t.id === value);

export const isAvailable = <T extends { available: true }>(view: T | Unavailable | undefined): view is T => view !== undefined && view.available === true;

// A collection's status in a person's words, and whether it needs a look.
export const COLLECTION_COLOR: Record<string, "success" | "warning" | "danger" | "informative"> = { complete: "success", partial: "warning", forbidden: "danger", missing: "danger", "not-configured": "informative" };

export const RUN_COLOR: Record<string, "success" | "warning" | "danger" | "informative"> = { ok: "success", degraded: "warning", failed: "danger", collected: "informative" };

export const pythonLine = (p: ReportsOverview["python"]) => (p.ready ? `Python ${p.version} (${p.from})` : `No Python: ${p.reason}`);
