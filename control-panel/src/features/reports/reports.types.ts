// The shapes control-server answers with for PO Reports
// (control-server/src/reports/*.mjs). A page reads them; it never computes a
// number of a report.
import type { Connection, Provider } from "../connections/connections.types";

export interface Unavailable {
  available: false;
  why: string;
}

export interface ReportWindow {
  mode: "months" | "range" | "all";
  months?: number | null;
  from: string | null;
  to: string;
  cutoff: string;
  tz: string;
  partial?: boolean;
}

export interface CollectionState {
  status: "complete" | "partial" | "forbidden" | "missing" | "not-configured" | string;
  reason: string | null;
  items: number | null;
}

export interface PartLine {
  id: string;
  version: string;
  kind: string;
  source: "builtin" | "store";
  from?: string;
  status: string;
  error: string | null;
  errorKind?: string | null;
}

export interface SkippedPart {
  id: string;
  version?: string;
  kind?: string;
  source?: string;
  from?: string;
  rule?: string;
  why: string;
}

export interface RunLine {
  runId: string;
  window: { from: string | null; to: string; cutoff: string; mode: string } | null;
  renders: number;
  status: string;
  report: string | null;
}

export interface ReportsOverview {
  available: true;
  project: { name: string; root: string; initialized: boolean };
  provider: string | null;
  connection: Connection | null;
  connectionMissing: boolean;
  python: { ready: true; version: string; from: string } | { ready: false; reason: string };
  revision: string | null;
  output: string;
  runs: RunLine[];
  latest: { runId: string; window: ReportWindow; completeness: Record<string, CollectionState>; render: { n: number; at: string; status: string; parts: PartLine[]; skipped: SkippedPart[]; report: string; warning: string | null } | null } | null;
}

export interface ReportSection {
  id: string;
  title: string;
  enabled: boolean;
  locked?: boolean;
  note?: string;
}

export type ScopeValue = string | boolean | string[];

export interface ReportSettings {
  provider: string | null;
  connection: string | null;
  scope: Record<string, ScopeValue>;
  docs: { path: string } | null;
  period: { months: number };
  timezone: string | null;
  output: { dir: string | null; formats: string[] };
  sections: Record<string, boolean>;
  mapping: { bots?: string[]; aiMarkers?: string[]; aiHeavyThreshold?: number; iterations?: { start: string; days: number } };
  assumptions: { forecast?: { minSamples?: number; horizon?: number; runs?: number } };
  parts: Record<string, { enabled?: boolean; replace?: boolean }>;
  retention: number;
}

export interface SettingsView {
  available: true;
  settings: ReportSettings;
  revision: string | null;
  exists: boolean;
  providers: Provider[];
  sections: ReportSection[];
  connections: Connection[];
  machineTimezone: string;
}

export interface PartRow {
  id: string;
  version: string;
  kind: string;
  source: "builtin" | "store";
  from: string;
  doc: string;
  provides: string[];
  needs: string[];
  provider: string | null;
  metrics: number;
  enabled: boolean;
  last: { status: string; error: string | null; errorKind: string | null; at: string; runId: string } | null;
}

export interface StorePartRow extends PartRow {
  replaces: string | null;
  approved: boolean;
  basedOn: string[];
  section: { id: string; title: string; placement?: string } | null;
  extension: { id: string; version: string | null; status: string | null; createdFor: string | null; fingerprint: "ok" | "changed" | "absent"; versions: { name: string; version: string | null; at: string | null }[] };
}

export interface PartsView {
  available: true;
  revision: string | null;
  standard: PartRow[];
  project: StorePartRow[];
  refused: { id: string; status?: string; why: string }[];
  contested: { id: string; owners: string[] }[];
  would: { run: string[]; skipped: SkippedPart[] };
}

export interface Saved {
  saved: ReportSettings & { revision: string };
}

export interface Verified {
  extension: string;
  ok: boolean;
  findings: string[];
  fingerprint: string;
}
