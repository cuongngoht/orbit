// How changes here get CHECKED, from what the session actually ran.
//
// The working set knows a check of some class passed (never its arguments --
// src/engineering/working-set/collect.mjs keeps a class and an outcome), and
// architecture already knows which gates this project declares on itself
// (handed in as `gates`, the paths its invariant facts cite). Together they say
// something neither says alone: a change in this project was verified by its
// own gate of that class, in a real session.
//
// Nothing without both. A passing check with no declared gate cites nothing a
// reader could open, and a declared gate nobody ran is architecture's fact,
// not an observation of how anybody works.
import { CHECKS } from "../working-set/collect.mjs";

export const MAX_GATES = 4;

export function workflow(input) {
  const gates = [...(input.gates ?? [])].sort().slice(0, MAX_GATES);
  const passed = [...new Set((input.commands ?? []).filter((c) => c.ok && CHECKS.includes(c.class)).map((c) => c.class))];
  if (!gates.length) return { candidates: [], unknowns: passed.length ? ["which gate a passing check ran — this project declares none architecture could read"] : [] };
  return { candidates: passed.map((cls) => candidate(cls, gates)), unknowns: [] };
}

const candidate = (cls, gates) => ({
  kind: "workflow",
  key: `check-with-${cls}`,
  statement: `changes in this project are checked with its own ${cls} gate`,
  scope: gates,
  evidence: gates,
  source: "test-suite",
  strength: "observed",
  because: `a session ran a ${cls} check after changing code, and it passed; the gate is one the project declares`,
  unknowns: ["which of the declared gates the check was — only its class is kept", "whether every change must pass it before it lands — that is a rule, and rules are adopted, not observed"],
});
