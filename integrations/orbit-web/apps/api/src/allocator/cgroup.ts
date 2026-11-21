// WHAT A CONTAINER'S CGROUP SAYS, read from the kernel's own files (cgroupScript) and parsed here: the limits in force
// (observed, never taken from what was asked or applied), the use, the peaks and the OOM kills. cgroup v1 and v2.
export interface CgroupReading {
  version: "v1" | "v2";
  files: Record<string, string | null>;
}

export interface ObservedLimits {
  // As the kernel states them ("200000/100000", "4294967296", "256"; "max" when unlimited).
  cpuQuota: string | null;
  memoryLimit: string | null;
  pidsMax: string | null;
  // The same, as numbers (null: unlimited or unreadable).
  cpuMillis: number | null;
  memoryBytes: number | null;
  pids: number | null;
}

export interface CgroupUsage {
  cpuSeconds: number | null;
  memoryCurrentBytes: number | null;
  memoryPeakBytes: number | null;
  oomKills: number | null;
  pidsCurrent: number | null;
  pidsPeak: number | null;
}

// Above this a v1 memory limit means "no limit" (the kernel's PAGE_COUNTER_MAX rounded to the page size).
const V1_UNLIMITED = 2 ** 62;

const intOf = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || !/^-?\d+$/.test(v.trim())) return null;
  return Number(v.trim());
};

// "key value" lines (memory.events, cpu.stat, memory.oom_control, memory.stat).
export const keyed = (text: string | null | undefined, key: string): number | null => {
  if (!text) return null;
  for (const line of text.split("\n")) {
    const [k, v] = line.trim().split(/\s+/);
    if (k === key) return intOf(v);
  }
  return null;
};

export function parseReading(raw: string): CgroupReading | null {
  try {
    const v = JSON.parse(raw) as CgroupReading;
    return (v.version === "v1" || v.version === "v2") && typeof v.files === "object" && v.files !== null ? v : null;
  } catch {
    return null;
  }
}

export function observedLimits(r: CgroupReading): ObservedLimits {
  const f = r.files;
  if (r.version === "v2") {
    const cpu = f["cpu.max"] ?? null;
    const [q, p] = (cpu ?? "").split(/\s+/);
    const quota = intOf(q);
    const period = intOf(p);
    return {
      cpuQuota: cpu === null ? null : q === "max" ? "max" : `${q}/${p}`,
      memoryLimit: f["memory.max"] ?? null,
      pidsMax: f["pids.max"] ?? null,
      cpuMillis: quota !== null && period !== null && period > 0 ? Math.round((quota / period) * 1000) : null,
      memoryBytes: intOf(f["memory.max"]),
      pids: intOf(f["pids.max"]),
    };
  }
  const quota = intOf(f["cpu.cfs_quota_us"]);
  const period = intOf(f["cpu.cfs_period_us"]);
  const memory = intOf(f["memory.limit_in_bytes"]);
  return {
    cpuQuota: f["cpu.cfs_quota_us"] === null || f["cpu.cfs_quota_us"] === undefined ? null : quota === -1 ? "max" : `${f["cpu.cfs_quota_us"]}/${f["cpu.cfs_period_us"] ?? "?"}`,
    memoryLimit: memory !== null && memory >= V1_UNLIMITED ? "max" : (f["memory.limit_in_bytes"] ?? null),
    pidsMax: f["pids.max"] ?? null,
    cpuMillis: quota !== null && quota > 0 && period !== null && period > 0 ? Math.round((quota / period) * 1000) : null,
    memoryBytes: memory !== null && memory < V1_UNLIMITED ? memory : null,
    pids: intOf(f["pids.max"]),
  };
}

export function cgroupUsage(r: CgroupReading): CgroupUsage {
  const f = r.files;
  if (r.version === "v2") {
    const usec = keyed(f["cpu.stat"], "usage_usec");
    return {
      cpuSeconds: usec === null ? null : usec / 1e6,
      memoryCurrentBytes: intOf(f["memory.current"]),
      memoryPeakBytes: intOf(f["memory.peak"]),
      oomKills: keyed(f["memory.events"], "oom_kill"),
      pidsCurrent: intOf(f["pids.current"]),
      pidsPeak: intOf(f["pids.peak"]),
    };
  }
  const ns = intOf(f["cpuacct.usage"]);
  return {
    cpuSeconds: ns === null ? null : ns / 1e9,
    memoryCurrentBytes: intOf(f["memory.usage_in_bytes"]),
    memoryPeakBytes: intOf(f["memory.max_usage_in_bytes"]),
    oomKills: keyed(f["memory.oom_control"], "oom_kill"),
    pidsCurrent: intOf(f["pids.current"]),
    // cgroup v1 keeps no peak of PIDs.
    pidsPeak: null,
  };
}

// Whether what the kernel enforces is what was asked: CPU within a millicore (rounding), memory and PIDs exactly.
export function limitsMatch(o: ObservedLimits, want: { cpuMillis: number; memoryMiB: number; pidsLimit: number }): string[] {
  const problems: string[] = [];
  if (o.cpuMillis === null || Math.abs(o.cpuMillis - want.cpuMillis) > 1) problems.push(`CPU quota ${o.cpuQuota ?? "unreadable"} is not ${want.cpuMillis} millicores`);
  if (o.memoryBytes !== want.memoryMiB * 1024 * 1024) problems.push(`memory limit ${o.memoryLimit ?? "unreadable"} is not ${want.memoryMiB} MiB`);
  if (o.pids !== want.pidsLimit) problems.push(`PID limit ${o.pidsMax ?? "unreadable"} is not ${want.pidsLimit}`);
  return problems;
}
