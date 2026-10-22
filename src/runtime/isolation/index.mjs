// The isolation providers this engine ships, in the order a person's policy may name them -- the one place they
// are bound, the way src/runtime/providers/index.mjs is for the ways a component runs (ADR 0038).
//
// A registration, never a branch: a caller asks for the provider a person's policy names (`isolation.provider`),
// and nothing below this file tests which one it holds. A host where no provider answers its doctor has NO
// isolation, which is a capability gap said in a sentence -- never a fallback to running a generated test natively.
import { Refused } from "../../errors.mjs";
import { isolationProblems } from "./contract-v1.mjs";
import { docker } from "./docker.mjs";

export const ISOLATION_PROVIDERS = [docker];

export function boundIsolation(list = ISOLATION_PROVIDERS) {
  const bad = list.flatMap(isolationProblems);
  if (bad.length) throw new Refused(`cannot bind the isolation providers — ${bad.join("; ")}`);
  return list;
}

export const isolationOf = (id, list = ISOLATION_PROVIDERS) => (list ?? []).find((p) => p.id === id) ?? null;

const GAP = (id, why) => `no isolation provider answers on this machine (${id}: ${why}) — an active generated test is BLOCKED here; discovery and validation go on, and a person makes one usable (start the container runtime) or runs the test on a host that has one`;

// -> { provider, version } | { provider: null, gap }: the provider a policy names, and whether it answers HERE.
export function usableIsolation(id, list, deps) {
  const provider = isolationOf(id, list);
  if (!provider) return { provider: null, gap: GAP(id, "this engine has no such provider") };
  const doctor = provider.doctor(deps);
  return doctor.ok ? { provider, version: doctor.version ?? null } : { provider: null, gap: GAP(id, doctor.why) };
}
