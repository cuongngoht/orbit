// WHAT THIS HOST CAN GIVE EMPLOYEE CONTAINERS (plan 6 and 7.1): the total -- detected by the provider's probe (the
// container runtime's CPUs and memory, the workforce storage) or set by the operator (ORBIT_WEB_CAPACITY_*) -- minus the
// HEADROOM: the control plane's fixed limits (Orbit Web, PostgreSQL, the allocator: the compose files' own knobs) and a
// reserve for the OS and the container runtime (a share of the total unless the operator names an amount). Pure.
import type { InfrastructureCapacity } from "@orbit-web/contracts";
import type { Reserve, SandboxConfig } from "../../../../config/sandbox-config.js";
import type { HostCapabilities } from "../../application/sandbox.port.js";

export const reserveOf = (r: Reserve, total: number): number => (r.kind === "amount" ? r.value : Math.ceil((total * r.percent) / 100));

export function infrastructureCapacity(caps: HostCapabilities, config: Pick<SandboxConfig, "capacity" | "headroom">): InfrastructureCapacity {
  const configured = config.capacity.cpuMillis !== null || config.capacity.memoryMiB !== null || config.capacity.storageMiB !== null;
  const cpu = config.capacity.cpuMillis ?? caps.host.cpuMillis;
  const memory = config.capacity.memoryMiB ?? caps.host.memoryMiB;
  const storage = config.capacity.storageMiB ?? caps.host.storageMiB;
  const total = { cpuMillis: cpu ?? 0, memoryMiB: memory ?? 0, storageMiB: storage ?? 0 };
  const control = config.headroom.controlPlane.reduce((sum, c) => ({ cpuMillis: sum.cpuMillis + c.cpuMillis, memoryMiB: sum.memoryMiB + c.memoryMiB }), { cpuMillis: 0, memoryMiB: 0 });
  const headroom = {
    cpuMillis: control.cpuMillis + reserveOf(config.headroom.reserve.cpu, total.cpuMillis),
    memoryMiB: control.memoryMiB + reserveOf(config.headroom.reserve.memory, total.memoryMiB),
    storageMiB: reserveOf(config.headroom.reserve.storage, total.storageMiB),
  };
  return {
    source: configured ? "configured" : cpu === null && memory === null ? "unknown" : "detected",
    total,
    headroom,
    usable: { cpuMillis: Math.max(0, total.cpuMillis - headroom.cpuMillis), memoryMiB: Math.max(0, total.memoryMiB - headroom.memoryMiB), storageMiB: Math.max(0, total.storageMiB - headroom.storageMiB) },
    storage: caps.storage,
    checkedAt: caps.probedAt,
  };
}
