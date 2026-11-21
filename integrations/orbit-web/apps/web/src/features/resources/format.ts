// How resources are said: CPU in vCPU (the API counts millicores), memory and storage in GiB or MiB (the API counts
// MiB), and an enforcement level as what it means -- a limit the kernel holds, a measurement, or nothing.
import type { EnforcementLevel, StorageArea, StorageCategory } from "@orbit-web/contracts";

const n = (v: number, digits = 2): string => v.toLocaleString("en-US", { maximumFractionDigits: digits });

export const cpuText = (millis: number | null | undefined): string => (millis === null || millis === undefined ? "unknown" : `${n(millis / 1000)} vCPU`);

export const sizeText = (mib: number | null | undefined): string => {
  if (mib === null || mib === undefined) return "unknown";
  if (Math.abs(mib) >= 1024) return `${n(mib / 1024, 1)} GiB`;
  return `${n(mib, 0)} MiB`;
};

export const LEVEL_TEXT: Record<EnforcementLevel, string> = {
  HARD_ENFORCED: "Hard limit — the kernel refuses past it",
  SOFT_MONITORED: "Measured only — not a hard limit",
  UNSUPPORTED: "Not enforced",
};

export const LEVEL_TONE: Record<EnforcementLevel, "success" | "warning" | "danger"> = { HARD_ENFORCED: "success", SOFT_MONITORED: "warning", UNSUPPORTED: "danger" };

export const AREA_TEXT: Record<StorageArea, string> = { desk: "Desk and toolbox", cache: "Dependency cache", scratch: "Assignment scratch", team: "Team room", tmp: "Memory temp (/tmp)" };

export const CATEGORY_TEXT: Record<StorageCategory, string> = { desk: "Desks and toolboxes", cache: "Dependency caches", team: "Team rooms", scratch: "Scratch of admitted work", artifacts: "Artifacts", research: "Research snapshots", logs: "Logs" };

export const CAPACITY_SOURCE_TEXT: Record<"detected" | "configured" | "unknown", string> = {
  detected: "Detected from this host",
  configured: "Set by the operator",
  unknown: "Not known",
};

// vCPU and GiB as a person types them, and back.
export const toVcpu = (millis: number): number => millis / 1000;
export const fromVcpu = (vcpu: number): number => Math.round(vcpu * 1000);
export const toGiB = (mib: number): number => Math.round((mib / 1024) * 100) / 100;
export const fromGiB = (gib: number): number => Math.round(gib * 1024);
