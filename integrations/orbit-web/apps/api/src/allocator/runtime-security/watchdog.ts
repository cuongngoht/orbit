// THE WATCHDOG'S DECISION (ADR 0063): given what the sensor, its installed policies and the host canary say right now,
// what happens to each protected workload -- a pure function, so every rule is a test. The loop that feeds it lives in
// the allocator (it needs no API, no worker, no model and no page to act), and acts only through the allocator's own
// lifecycle (stopping exactly one attempt's two containers).
//
//   enforce   protection holds only while the sensor is HEALTHY, of the same GENERATION it was proven under (a restart
//             drops every policy), its policy is listed ENABLED in ENFORCE mode, and the host canary was proven lately.
//             Otherwise it is LOST at once (nobody may call it protected), and CONTAINED once the deadline passes without
//             it being proven again -- never before, never instantly promised.
//   observe   never contained: a faltering sensor makes it DEGRADED; a healthy one whose policy is gone re-applies it.
//   reap      an Orbit policy no live workload owns (its attempt ended, its deletion never read back) is removed; a
//             policy that is not Orbit's is never touched.
import type { ProtectionState, SensorState } from "@orbit-web/contracts";
import type { RuntimeMode } from "@orbit-web/governance-core";
import { isOrbitPolicy } from "./policy.js";

export interface WatchSnapshot {
  now: number;
  containAfterMs: number;
  freshMs: number;
  canaryMaxAgeMs: number;
  sensor: { state: SensorState; generation: string | null };
  canary: { provenAt: number | null };
  // null: the installed policies could not be read.
  installed: { name: string; state: string; mode: "enforce" | "monitor" | "unknown" }[] | null;
  // restarted: a plane runs with another start time than the one its protection was proven for -- new namespaces.
  workloads: { dispatchKey: string; mode: RuntimeMode; state: ProtectionState; policy: string | null; sensorGeneration: string | null; lostSince: number | null; restarted?: boolean }[];
  // Orbit's own policies that belong to no workload (the host canary's).
  keep?: readonly string[];
}

export type WatchAction =
  | { type: "renew"; dispatchKey: string; freshUntil: number }
  | { type: "lost"; dispatchKey: string; cause: string }
  | { type: "contain"; dispatchKey: string; cause: string }
  | { type: "degrade"; dispatchKey: string; cause: string }
  | { type: "reapply"; dispatchKey: string; cause: string }
  | { type: "reap"; policy: string };

const SETTLED: readonly ProtectionState[] = ["CONTAINING", "CONTAINED", "CLEANED_UP", "UNREGISTERED"];

function problemOf(s: WatchSnapshot, w: WatchSnapshot["workloads"][number]): string | null {
  if (w.restarted === true) return "a plane restarted since its protection was proven: its namespaces are new, and no policy binds them";
  if (s.sensor.state !== "HEALTHY") return `the sensor is ${s.sensor.state.toLowerCase()}`;
  if (s.sensor.generation !== w.sensorGeneration) return "the sensor restarted since the protection was proven: every policy it held is gone";
  if (s.installed === null) return "the sensor's installed policies could not be read";
  const p = s.installed.find((x) => x.name === w.policy);
  if (p === undefined) return "its policy is no longer installed";
  if (p.state !== "TP_STATE_ENABLED") return `its policy is ${p.state}`;
  if (w.mode === "enforce" && p.mode !== "enforce") return "its policy no longer enforces";
  if (w.mode === "enforce" && (s.canary.provenAt === null || s.now - s.canary.provenAt > s.canaryMaxAgeMs)) return "the host canary has not been proven lately";
  return null;
}

function enforced(s: WatchSnapshot, w: WatchSnapshot["workloads"][number]): WatchAction[] {
  const problem = problemOf(s, w);
  if (problem === null) return [{ type: "renew", dispatchKey: w.dispatchKey, freshUntil: s.now + s.freshMs }];
  if (w.lostSince === null) return [{ type: "lost", dispatchKey: w.dispatchKey, cause: problem }];
  if (s.now - w.lostSince >= s.containAfterMs) return [{ type: "contain", dispatchKey: w.dispatchKey, cause: problem }];
  return [];
}

function observed(s: WatchSnapshot, w: WatchSnapshot["workloads"][number]): WatchAction[] {
  const problem = problemOf(s, w);
  if (problem === null) return [{ type: "renew", dispatchKey: w.dispatchKey, freshUntil: s.now + s.freshMs }];
  if (w.restarted !== true && s.sensor.state === "HEALTHY" && s.installed !== null && !s.installed.some((x) => x.name === w.policy && x.state === "TP_STATE_ENABLED")) return [{ type: "reapply", dispatchKey: w.dispatchKey, cause: problem }];
  return [{ type: "degrade", dispatchKey: w.dispatchKey, cause: problem }];
}

export function decide(s: WatchSnapshot): WatchAction[] {
  const actions: WatchAction[] = [];
  for (const w of s.workloads) {
    if (w.mode === "disabled" || SETTLED.includes(w.state) || w.policy === null) continue;
    actions.push(...(w.mode === "enforce" ? enforced(s, w) : observed(s, w)));
  }
  // Reaping acts on the sensor's own list: only while the sensor is healthy and the list was read.
  if (s.installed !== null && s.sensor.state === "HEALTHY") {
    const owned = new Set([...s.workloads.map((w) => w.policy), ...(s.keep ?? [])]);
    for (const p of s.installed) if (isOrbitPolicy(p.name) && !owned.has(p.name)) actions.push({ type: "reap", policy: p.name });
  }
  return actions;
}
