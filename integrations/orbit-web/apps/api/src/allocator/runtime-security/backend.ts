// THE RUNTIME SECURITY BACKEND PORT (ADR 0063): what the security plane asks of a sensor, and nothing more -- its health,
// the policies it holds, installing and removing one policy, and the lines it exported since the last read. Management
// and telemetry are separate methods over separate channels (the sensor's unix socket, reached through the allocator's
// own exec; its export file, mounted read-only). A sensor's own schema stays inside its adapter (tetragon.ts).
import type { SensorState } from "@orbit-web/contracts";
import type { CompiledPolicy } from "./policy.js";

export interface SensorStatus {
  state: SensorState;
  // Changes with every start of the sensor: a policy installed under another generation is gone.
  generation: string | null;
  since: string | null;
  version: string | null;
  image: string | null;
  detail: string;
}

export interface InstalledPolicy {
  name: string;
  state: string;
  mode: "enforce" | "monitor" | "unknown";
  kernelMemoryBytes: number | null;
  overrides: number | null;
}

export interface RuntimeSecurityBackend {
  readonly kind: "tetragon" | "disabled";
  status(): Promise<SensorStatus>;
  // null: they could not be read (never "none").
  policies(): Promise<InstalledPolicy[] | null>;
  apply(policy: CompiledPolicy, mode: "enforce" | "monitor"): Promise<{ ok: boolean; detail: string }>;
  remove(name: string): Promise<{ ok: boolean; detail: string }>;
  // Complete lines the sensor exported since the last read (at most about `maxBytes`), and whether some were lost.
  readLines(maxBytes: number): { lines: string[]; gap: boolean };
  resources(): Promise<{ cpuPercent: number | null; memoryMiB: number | null }>;
}

// No sensor on this host: nothing is observed, nothing can be proven -- said, never pretended.
export class DisabledBackend implements RuntimeSecurityBackend {
  readonly kind = "disabled" as const;

  status(): Promise<SensorStatus> {
    return Promise.resolve({ state: "DISABLED", generation: null, since: null, version: null, image: null, detail: "No runtime security backend is configured on this host (ORBIT_WEB_RUNTIME_SECURITY=off)." });
  }

  policies(): Promise<InstalledPolicy[] | null> {
    return Promise.resolve(null);
  }

  apply(): Promise<{ ok: boolean; detail: string }> {
    return Promise.resolve({ ok: false, detail: "no runtime security backend on this host" });
  }

  remove(): Promise<{ ok: boolean; detail: string }> {
    return Promise.resolve({ ok: true, detail: "no runtime security backend on this host" });
  }

  readLines(): { lines: string[]; gap: boolean } {
    return { lines: [], gap: false };
  }

  resources(): Promise<{ cpuPercent: number | null; memoryMiB: number | null }> {
    return Promise.resolve({ cpuPercent: null, memoryMiB: null });
  }
}
