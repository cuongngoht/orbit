// RESOURCE ADMISSION, decided (pure): which waiting attempts may start now, which wait, and which can NEVER start as
// things are configured. An attempt's demand is its employee's tool-plane limits (the resource revision current at the
// pass) plus its runtime's model-plane overhead, and its assignment's scratch if not committed yet.
//
//   unschedulable  above the account's budget (CPU, memory, a concurrency of 0, scratch above the storage budget) or
//                  above the host's usable capacity: nothing will free enough -- a person changes something.
//   wait           it could fit, but the account's budget, its concurrency, its storage or the host is in use now.
//   admit          it fits: its demand is added to what the account and the host hold.
//
// FAIRNESS, in one pass:
//   - across accounts: dominant-resource fairness -- the account whose largest share of its budget (CPU or memory) is the
//     smallest goes next, so a busy account never starves a quiet one;
//   - within an account: aged priority (priority + waited / agingMinutes), then the time it started waiting, then its id;
//   - backfill with a guard: a smaller attempt may pass a larger one that does not fit, but once the larger has waited
//     `guardMinutes`, what is freed in its account (and on the host, when it is the host that is short) is held for it.
export interface Demand {
  cpuMillis: number;
  memoryMiB: number;
  // Scratch this attempt would newly commit (0 when its assignment's workspace already holds it).
  scratchMiB: number;
}

export interface Candidate {
  runId: string;
  orbitId: string;
  priority: number;
  waitingSince: string;
  demand: Demand;
}

export interface AccountState {
  cpuMillis: number;
  memoryMiB: number;
  storageMiB: number;
  maxConcurrent: number;
  reservedCpu: number;
  reservedMemory: number;
  running: number;
  committedStorage: number;
}

export interface HostState {
  usableCpu: number;
  usableMemory: number;
  reservedCpu: number;
  reservedMemory: number;
}

export type Verdict = { runId: string; orbitId: string; kind: "admit" } | { runId: string; orbitId: string; kind: "wait" | "unschedulable"; reason: string; code: string };

export interface Policy {
  now: number;
  agingMinutes: number;
  guardMinutes: number;
}

const vcpu = (m: number): string => `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 2)} vCPU`;

function never(c: Candidate, a: AccountState, h: HostState): { reason: string; code: string } | null {
  const d = c.demand;
  if (a.maxConcurrent === 0) return { code: "no_concurrency", reason: "The account's budget allows no attempt to run at once (max concurrent is 0)." };
  if (d.cpuMillis > a.cpuMillis) return { code: "above_budget_cpu", reason: `Needs ${vcpu(d.cpuMillis)} (employee + model plane); the account's budget is ${vcpu(a.cpuMillis)}.` };
  if (d.memoryMiB > a.memoryMiB) return { code: "above_budget_memory", reason: `Needs ${d.memoryMiB} MiB of memory (employee + model plane); the account's budget is ${a.memoryMiB} MiB.` };
  if (d.scratchMiB > a.storageMiB) return { code: "above_budget_storage", reason: `Needs ${d.scratchMiB} MiB of scratch; the account's storage budget is ${a.storageMiB} MiB.` };
  if (d.cpuMillis > h.usableCpu) return { code: "above_capacity_cpu", reason: `Needs ${vcpu(d.cpuMillis)}; this host can give employees ${vcpu(h.usableCpu)} in all.` };
  if (d.memoryMiB > h.usableMemory) return { code: "above_capacity_memory", reason: `Needs ${d.memoryMiB} MiB of memory; this host can give employees ${h.usableMemory} MiB in all.` };
  return null;
}

function short(c: Candidate, a: AccountState, h: HostState): { reason: string; code: string; host: boolean } | null {
  const d = c.demand;
  if (a.running >= a.maxConcurrent) return { code: "concurrency", host: false, reason: `The account already runs ${a.running} of its ${a.maxConcurrent} concurrent attempts.` };
  if (a.reservedCpu + d.cpuMillis > a.cpuMillis) return { code: "budget_cpu", host: false, reason: `The account's attempts hold ${vcpu(a.reservedCpu)} of ${vcpu(a.cpuMillis)}; this needs ${vcpu(d.cpuMillis)}.` };
  if (a.reservedMemory + d.memoryMiB > a.memoryMiB) return { code: "budget_memory", host: false, reason: `The account's attempts hold ${a.reservedMemory} of ${a.memoryMiB} MiB of memory; this needs ${d.memoryMiB} MiB.` };
  if (a.committedStorage + d.scratchMiB > a.storageMiB) return { code: "budget_storage", host: false, reason: `The account's storage is ${a.committedStorage} of ${a.storageMiB} MiB committed; this needs ${d.scratchMiB} MiB of scratch.` };
  if (h.reservedCpu + d.cpuMillis > h.usableCpu) return { code: "host_cpu", host: true, reason: `The host's employee CPU is in use (${vcpu(h.reservedCpu)} of ${vcpu(h.usableCpu)}).` };
  if (h.reservedMemory + d.memoryMiB > h.usableMemory) return { code: "host_memory", host: true, reason: `The host's employee memory is in use (${h.reservedMemory} of ${h.usableMemory} MiB).` };
  return null;
}

const share = (a: AccountState): number => Math.max(a.cpuMillis === 0 ? 1 : a.reservedCpu / a.cpuMillis, a.memoryMiB === 0 ? 1 : a.reservedMemory / a.memoryMiB);

export function agedPriority(c: Candidate, p: Policy): number {
  const waited = Math.max(0, p.now - Date.parse(c.waitingSince)) / 60_000;
  return c.priority + Math.floor(waited / Math.max(1, p.agingMinutes));
}

// The verdicts, in the order the pass made them. `accounts` and `host` are updated as attempts are admitted.
export function decideAdmissions(candidates: readonly Candidate[], accounts: Map<string, AccountState>, host: HostState, p: Policy): Verdict[] {
  const queues = new Map<string, Candidate[]>();
  for (const c of candidates) queues.set(c.orbitId, [...(queues.get(c.orbitId) ?? []), c]);
  for (const q of queues.values()) q.sort((x, y) => agedPriority(y, p) - agedPriority(x, p) || Date.parse(x.waitingSince) - Date.parse(y.waitingSince) || x.runId.localeCompare(y.runId));
  const verdicts: Verdict[] = [];
  const heldAccounts = new Set<string>();
  let hostHeld = false;
  for (;;) {
    const ready = [...queues.entries()].filter(([, q]) => q.length > 0);
    if (ready.length === 0) return verdicts;
    ready.sort(([x], [y]) => share(accounts.get(x) as AccountState) - share(accounts.get(y) as AccountState) || x.localeCompare(y));
    const [orbitId, q] = ready[0] as [string, Candidate[]];
    const c = q.shift() as Candidate;
    const a = accounts.get(orbitId) as AccountState;
    const impossible = never(c, a, host);
    if (impossible !== null) {
      verdicts.push({ runId: c.runId, orbitId, kind: "unschedulable", ...impossible });
      continue;
    }
    if (heldAccounts.has(orbitId) || hostHeld) {
      verdicts.push({ runId: c.runId, orbitId, kind: "wait", code: "held_for_older", reason: "Capacity freed now is held for an attempt that has waited longer." });
      continue;
    }
    const missingNow = short(c, a, host);
    if (missingNow === null) {
      a.reservedCpu += c.demand.cpuMillis;
      a.reservedMemory += c.demand.memoryMiB;
      a.running += 1;
      a.committedStorage += c.demand.scratchMiB;
      host.reservedCpu += c.demand.cpuMillis;
      host.reservedMemory += c.demand.memoryMiB;
      verdicts.push({ runId: c.runId, orbitId, kind: "admit" });
      continue;
    }
    verdicts.push({ runId: c.runId, orbitId, kind: "wait", code: missingNow.code, reason: missingNow.reason });
    const waited = (p.now - Date.parse(c.waitingSince)) / 60_000;
    if (waited >= p.guardMinutes) {
      heldAccounts.add(orbitId);
      if (missingNow.host) hostHeld = true;
    }
  }
}
