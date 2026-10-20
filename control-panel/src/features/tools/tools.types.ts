// The shapes control-server answers with for CLI tools (control-server/src/tools/*.mjs),
// derived by src/tools/effective.mjs: DESIRED (what somebody wants) and OBSERVED
// (what the last detection found) are separate fields, never merged into one.

export interface DetectedSource {
  source: "project" | "orbit-managed" | "system" | "override" | "running" | "nvm" | string;
  found: boolean;
  ok: boolean;
  path: string | null;
  version: string | null;
  reason?: string | null;
}

export interface Tool {
  id: string;
  name: string;
  summary: string;
  provides: string[];
  enabled: boolean;
  /** ready · missing · unknown (nothing has looked, or the look is too old). */
  status: "ready" | "missing" | "unknown";
  available: boolean;
  state: string;
  source: string | null;
  version: string | null;
  path: string | null;
  sources: DetectedSource[];
  reason: string | null;
  checkedAt: string | null;
  stale: boolean;
  install: { strategy: string; supported: boolean; reason: string | null; version: string | null; source: string | null; instructions: string | null };
  managed: { version: string; installedAt: string | null; source: string | null; checksum: string | null } | null;
  update: { from: string; to: string } | null;
}

export interface Installed {
  receipt: { tool: string; version: string; platform: string; arch: string; installedAt: string; source: string | null; checksum: string | null; reused: boolean };
  tool: Tool;
}
