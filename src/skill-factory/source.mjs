// A declared playbook's WORKFLOW as a LIVE SOURCE (0.0.4): which pinned versions a coordinated workflow's runs hold
// (their `skillrun` receipts name each pin), and the projection a viewer draws of each -- its steps, what each waits
// for, asks and must prove -- read through the factory's own pinned read (lifecycle.mjs workflowOf), so a version whose
// files are not what was verified is never drawn and a viewer says what it cannot read. Handed to src/live/ by a
// composition root (cli/live.mjs, Orbit Control's core), never imported there; reading creates nothing.
//
//   SKILL_SOURCE
//     activeRefs(view) -> [pin]                    the pins this task's runs hold, at most eight
//     open(storeRoot, io) -> { read(pin) }         the projection, or null for a version gone, unreadable or changed
//     projectionOf(version) -> { pin, id, version, status, provides, steps, bounds }
//       step: { id, capability, tool, after, required, evidence, approval, retries }   never an input's value
import { workflowOf } from "./lifecycle.mjs";
import { createGeneratedSkills } from "./store.mjs";

const PIN = /^[a-z0-9][a-z0-9-]{1,47}:\d+\.\d+\.\d+:[0-9a-f]{8}$/;

export const activeRefs = (view) => [...new Set((view?.receipts ?? []).filter((r) => r.domain === "skillrun" && PIN.test(String(r.pin ?? ""))).map((r) => r.pin))].slice(0, 8);

const stepOf = (s) => ({ id: s.id, capability: s.capability, tool: s.tool ?? null, after: Array.isArray(s.after) ? s.after : [], required: s.required !== false, evidence: s.evidence ?? "report", approval: s.approval ?? "none", retries: s.retries ?? 0 });

export const projectionOf = (v) => ({ pin: v.pin, id: v.id, version: v.version, status: v.status, provides: v.manifest.provides, steps: v.workflow.steps.slice(0, 16).map(stepOf), bounds: { maxCalls: v.workflow.bounds?.maxCalls ?? 16 } });

function readWorkflow(store, pin) {
  if (!PIN.test(String(pin))) return null;
  try { return projectionOf(workflowOf(store, pin)); }
  catch { return null; }
}

export const SKILL_SOURCE = Object.freeze({
  version: 1,
  activeRefs,
  open: (storeRoot, io) => ((store) => ({ read: (pin) => readWorkflow(store, pin) }))(createGeneratedSkills(storeRoot, io)),
  projectionOf,
});
