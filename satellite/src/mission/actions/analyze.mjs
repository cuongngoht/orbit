// ANALYZE: the host's model reads the goal into a structured intent (src/mission/intent.mjs), and the engine keeps it
// -- the first time as the mission's intent, every later time as an AMENDMENT that may add what was learned and settle
// unknowns with evidence, never touch the acceptance criteria.
import { intentFindings, intentOf, LISTS } from "../intent.mjs";
import { ENGINE, ORCHESTRATOR, finding } from "./common.mjs";

const counted = (intent) => Object.keys(LISTS).map((k) => `${intent[k].length} ${k}`).join(", ");

function analyzed(ports, lw, a) {
  const intent = intentOf(a.intent, lw.m);
  lw.append("intent.recorded", { ...intent, action: lw.action });
  return { outcome: intent.n === 1 ? "recorded" : "amended", level: "CONTRACT_MET", summary: `intent ${intent.n}: ${counted(intent)}`, refs: [`intent:${intent.digest}`] };
}

export const analyze = {
  fields: ["intent"],
  required: ["intent"],
  plan: (ports, lw, a) => ({ findings: intentFindings(a.intent, lw.m) }),
  mode: () => "ANALYZING",
  operation: () => "schema.validate",
  provider: ENGINE,
  profile: ORCHESTRATOR,
  contract: (ports, lw, a, plan) => (plan.findings.length ? finding("INTENT_INVALID", plan.findings.join("; ")) : null),
  run: analyzed,
};
