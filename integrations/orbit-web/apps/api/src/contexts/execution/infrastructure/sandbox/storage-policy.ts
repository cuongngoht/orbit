// HOW STORAGE IS ENFORCED, decided from what was TRIED (plan 7.3). The allocator's probe tries each quota mechanism in
// order on this host; a mechanism is HARD only when the kernel REFUSED a write past a quota it set (an over-quota write
// test), never because a value was configured. Measuring (SOFT_MONITORED) is never shown as isolation. Pure functions:
// the probe gathers the evidence, these decide.
import type { EnforcementLevel, StorageArea, StorageMechanism } from "@orbit-web/contracts";

// The candidates, in the order they are tried. `measured` always works and enforces nothing.
export const MECHANISM_ORDER: readonly StorageMechanism[] = ["xfs-project", "xfs-loop-pool", "btrfs-qgroup", "loop-per-volume", "measured"];

// What this build can run areas on (a mechanism the probe may find supported but this build does not implement for
// areas is reported, and passed over).
export const IMPLEMENTED: ReadonlySet<StorageMechanism> = new Set<StorageMechanism>(["xfs-project", "xfs-loop-pool", "btrfs-qgroup", "measured"]);

export type CandidateOutcome = "hard" | "not_enforced" | "failed" | "not_tried" | "not_implemented";

export interface CandidateResult {
  mechanism: StorageMechanism;
  outcome: CandidateOutcome;
  evidence: string;
}

export interface Choice {
  mechanism: StorageMechanism;
  perArea: EnforcementLevel;
  evidence: string;
}

// The first candidate whose over-quota write was refused and that this build implements; else measurement (SOFT), and
// with no workforce volume at all, none.
export function chooseMechanism(results: readonly CandidateResult[], volumeUsable: boolean): Choice {
  const said = results.map((r) => `${r.mechanism}: ${r.outcome}${r.evidence ? ` (${r.evidence})` : ""}`).join("; ");
  const hard = results.find((r) => r.outcome === "hard" && IMPLEMENTED.has(r.mechanism) && r.mechanism !== "measured");
  if (hard) return { mechanism: hard.mechanism, perArea: "HARD_ENFORCED", evidence: said };
  if (!volumeUsable) return { mechanism: "none", perArea: "UNSUPPORTED", evidence: said || "no workforce volume could be made" };
  return { mechanism: "measured", perArea: "SOFT_MONITORED", evidence: said };
}

// Whether filling every workforce area could fill the host's own disk. HARD only when the areas live on a filesystem of
// their own whose size is fixed (a preallocated pool image).
export function hostProtectionOf(mechanism: StorageMechanism, pool: { sizeMiB: number; preallocated: boolean } | null): { level: EnforcementLevel; evidence: string } {
  if ((mechanism === "xfs-loop-pool" || mechanism === "btrfs-qgroup") && pool !== null) {
    return pool.preallocated
      ? { level: "HARD_ENFORCED", evidence: `the areas live in a pool of their own: a preallocated ${pool.sizeMiB} MiB image on its own loop device, so filling it cannot fill the host's disk` }
      : { level: "SOFT_MONITORED", evidence: `the pool image (${pool.sizeMiB} MiB) is sparse: it grows on the host's disk as it fills, and only the host's free space, measured, bounds it` };
  }
  if (mechanism === "xfs-project") return { level: "SOFT_MONITORED", evidence: "the areas share the host's filesystem; each is held by its own project quota, and their sum only by admission" };
  if (mechanism === "measured") return { level: "UNSUPPORTED", evidence: "the areas are directories on the host's own filesystem: nothing keeps them from filling it" };
  return { level: "UNSUPPORTED", evidence: "no workforce storage" };
}

export interface AreaLevel {
  area: StorageArea;
  level: EnforcementLevel;
}

// The admission rule (7.3): an attempt is given a shell only when every WRITABLE area is HARD_ENFORCED -- or the operator
// explicitly accepted SOFT_MONITORED areas, and only while host-disk protection is HARD. Otherwise the reason is
// `storage_not_enforceable`.
export function storageAdmits(areas: readonly AreaLevel[], hostProtection: EnforcementLevel, acceptSoft: boolean): { ok: boolean; detail: string } {
  const unsupported = areas.filter((a) => a.level === "UNSUPPORTED");
  const soft = areas.filter((a) => a.level === "SOFT_MONITORED");
  if (unsupported.length > 0) return { ok: false, detail: `storage_not_enforceable: nothing enforces ${unsupported.map((a) => a.area).join(", ")}` };
  if (soft.length === 0) return { ok: true, detail: `every writable area (${areas.map((a) => a.area).join(", ")}) is HARD_ENFORCED` };
  const names = soft.map((a) => a.area).join(", ");
  if (!acceptSoft) return { ok: false, detail: `storage_not_enforceable: ${names} ${soft.length === 1 ? "is" : "are"} only SOFT_MONITORED (the operator has not accepted that: ORBIT_WEB_ACCEPT_SOFT_STORAGE)` };
  if (hostProtection !== "HARD_ENFORCED") return { ok: false, detail: `storage_not_enforceable: ${names} ${soft.length === 1 ? "is" : "are"} SOFT_MONITORED and the host's disk is not protected (accepting SOFT needs HARD host protection)` };
  return { ok: true, detail: `${names} SOFT_MONITORED, accepted by the operator while the host's disk is HARD protected` };
}

// The memory-backed /tmp: min(512 MiB, a quarter of the memory limit), at least 16 MiB.
export const tmpSizeMiB = (memoryMiB: number): number => Math.max(16, Math.min(512, Math.floor(memoryMiB / 4)));
