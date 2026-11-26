// THE TETRAGON ADAPTER (ADR 0063): the security plane's backend port, spoken to ONE pinned Tetragon container. Policies
// go in and out through `tetra` run inside that container against its own unix socket -- reached only by the allocator,
// the one holder of the Docker socket; the sensor has no network at all and no Docker socket. Telemetry is the sensor's
// JSON export file, mounted read-only into the allocator. Tetragon's words (TP_STATE_ENABLED, TP_MODE_ENFORCE, its
// event fields) stay in this file and sensor-events.ts.
import type { DockerEngine } from "../docker/engine.js";
import { execIn, text } from "../containers.js";
import type { InstalledPolicy, RuntimeSecurityBackend, SensorStatus } from "./backend.js";
import { ExportReader } from "./export-reader.js";
import type { CompiledPolicy } from "./policy.js";

export const TETRAGON_SOCKET = "unix:///var/run/tetragon/tetragon.sock";
// The image the compose override runs, pinned by digest (docker/compose.runtime-security.yaml).
export const TETRAGON_IMAGE = "quay.io/cilium/tetragon:v1.8.0@sha256:5ed9088a1582131d71b06c98e0d549a37a71ae63ab13aabefc7a47553c822a9d";

// The sensor's own command line (the compose override says the same): policies over its unix socket only, no health or
// metrics port (it has no network), JSON export rotated (10 MiB x 3) and readable by the allocator's mount, namespaces in
// every event (the identity cross-check), and a process's ARGUMENTS never exported -- an event that never carried a prompt
// or a token cannot leak one.
export const TETRAGON_ARGS: readonly string[] = [
  "/usr/bin/tetragon",
  "--server-address", TETRAGON_SOCKET,
  "--health-server-address", "",
  "--export-filename", "/var/log/tetragon/tetragon.log",
  "--export-file-max-size-mb", "10",
  "--export-file-max-backups", "3",
  "--export-file-perm", "644",
  "--enable-process-ns",
  "--field-filters", JSON.stringify({ fields: "process.arguments,parent.arguments", action: "EXCLUDE" }),
];

const MODES: Record<string, InstalledPolicy["mode"]> = { TP_MODE_ENFORCE: "enforce", TP_MODE_MONITOR: "monitor", TP_MODE_MONITOR_ONLY: "monitor" };

export function parsePolicyList(json: string): InstalledPolicy[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const list = (raw as { policies?: unknown }).policies ?? [];
  if (!Array.isArray(list)) return null;
  return list.flatMap((p: unknown): InstalledPolicy[] => {
    if (typeof p !== "object" || p === null || typeof (p as { name?: unknown }).name !== "string") return [];
    const r = p as { name: string; state?: unknown; mode?: unknown; kernel_memory_bytes?: unknown; stats?: { action_counters?: { override?: unknown } } };
    const num = (v: unknown): number | null => (typeof v === "string" || typeof v === "number" ? (Number.isFinite(Number(v)) ? Number(v) : null) : null);
    return [{ name: r.name, state: typeof r.state === "string" ? r.state : "unknown", mode: typeof r.mode === "string" ? (MODES[r.mode] ?? "unknown") : "unknown", kernelMemoryBytes: num(r.kernel_memory_bytes), overrides: num(r.stats?.action_counters?.override ?? null) }];
  });
}

export interface TetragonOptions {
  engine: DockerEngine;
  // The sensor's container (ORBIT_WEB_RUNTIME_SECURITY_SENSOR).
  sensor: string;
  eventsDir: string;
  stateFile: string | null;
}

export class TetragonBackend implements RuntimeSecurityBackend {
  readonly kind = "tetragon" as const;
  private readonly reader: ExportReader;
  private versionOf: { generation: string; version: string | null } | null = null;

  constructor(private readonly o: TetragonOptions) {
    this.reader = new ExportReader(o.eventsDir, o.stateFile);
  }

  private async tetra(args: string[], stdin: string | null = null): Promise<{ code: number | null; out: string; err: string }> {
    const r = await execIn(this.o.engine, this.o.sensor, ["tetra", "--server-address", TETRAGON_SOCKET, ...args], { stdin: stdin === null ? null : Buffer.from(stdin), timeoutMs: 30_000, maxOutputBytes: 4 * 1024 * 1024 });
    return { code: r.code, out: text(r.stdout), err: text(r.stderr) };
  }

  async status(): Promise<SensorStatus> {
    const c = await this.o.engine.containerInspect(this.o.sensor).catch(() => null);
    if (c === null) return { state: "UNAVAILABLE", generation: null, since: null, version: null, image: null, detail: `the sensor's container ${this.o.sensor} does not exist` };
    if (!c.State.Running) return { state: "UNAVAILABLE", generation: null, since: c.State.FinishedAt || null, version: null, image: c.Config.Image, detail: `the sensor's container is ${c.State.Status}` };
    const generation = `${c.Id.slice(0, 12)}@${c.State.StartedAt}`;
    const s = await this.tetra(["status"]).catch((err: unknown) => ({ code: null, out: "", err: err instanceof Error ? err.message : String(err) }));
    const healthy = s.code === 0 && /running/i.test(s.out);
    if (this.versionOf?.generation !== generation && healthy) {
      const v = await this.tetra(["version"]).catch(() => null);
      this.versionOf = { generation, version: v !== null && v.code === 0 ? (/v\d+\.\d+\.\d+\S*/.exec(v.out)?.[0] ?? null) : null };
    }
    return {
      state: healthy ? "HEALTHY" : "DEGRADED",
      generation,
      since: c.State.StartedAt,
      version: this.versionOf?.generation === generation ? this.versionOf.version : null,
      image: c.Config.Image,
      detail: healthy ? "the sensor answers on its socket" : `the sensor does not report running: ${(s.err || s.out).slice(0, 300)}`,
    };
  }

  async policies(): Promise<InstalledPolicy[] | null> {
    const r = await this.tetra(["tracingpolicy", "list", "-o", "json"]).catch(() => null);
    return r === null || r.code !== 0 ? null : parsePolicyList(r.out);
  }

  async apply(policy: CompiledPolicy, mode: "enforce" | "monitor"): Promise<{ ok: boolean; detail: string }> {
    const r = await this.tetra(["tracingpolicy", "add", "/dev/stdin", "--mode", mode], policy.yaml).catch((err: unknown) => ({ code: null, out: "", err: err instanceof Error ? err.message : String(err) }));
    return { ok: r.code === 0, detail: (r.code === 0 ? r.out : r.err || r.out).slice(0, 600) };
  }

  async remove(name: string): Promise<{ ok: boolean; detail: string }> {
    const r = await this.tetra(["tracingpolicy", "delete", name]).catch((err: unknown) => ({ code: null, out: "", err: err instanceof Error ? err.message : String(err) }));
    const gone = r.code === 0 || /not found|does not exist/i.test(r.err);
    return { ok: gone, detail: (gone ? r.out : r.err || r.out).slice(0, 600) };
  }

  readLines(maxBytes: number): { lines: string[]; gap: boolean } {
    return this.reader.read(maxBytes);
  }

  async resources(): Promise<{ cpuPercent: number | null; memoryMiB: number | null }> {
    const s = (await this.o.engine.containerStats(this.o.sensor).catch(() => null)) as { memory_stats?: { usage?: number }; cpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number; online_cpus?: number }; precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number } } | null;
    if (s === null) return { cpuPercent: null, memoryMiB: null };
    const cpu = (s.cpu_stats?.cpu_usage?.total_usage ?? 0) - (s.precpu_stats?.cpu_usage?.total_usage ?? 0);
    const sys = (s.cpu_stats?.system_cpu_usage ?? 0) - (s.precpu_stats?.system_cpu_usage ?? 0);
    const cpus = s.cpu_stats?.online_cpus ?? 1;
    return { cpuPercent: sys > 0 ? Math.round((cpu / sys) * cpus * 10_000) / 100 : null, memoryMiB: typeof s.memory_stats?.usage === "number" ? Math.round(s.memory_stats.usage / 1024 / 1024) : null };
  }
}
