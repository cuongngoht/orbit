// How strong a piece of evidence is, ordered weakest first, and which OWNERS are independent of the agent that
// reported it. A tool that completed proves the tool ran; a report that holds to its contract proves the report; only
// an independent owner's own record -- an engineering task's verification rows and check receipts, a QA
// investigation's outcome -- can make anything VERIFIED. A model's statement is never evidence of more than itself.
export const EVIDENCE_LEVELS = Object.freeze(["UNKNOWN", "BLOCKED", "TOOL_COMPLETED", "CONTRACT_MET", "BEHAVIOR_OBSERVED", "VERIFIED"]);

export const rankOf = (level) => EVIDENCE_LEVELS.indexOf(level);

export const atLeast = (level, min) => rankOf(level) >= rankOf(min);

export const strongest = (levels) => levels.reduce((best, l) => (rankOf(l) > rankOf(best) ? l : best), "UNKNOWN");

// domain -> whether its record is independent of the agent that named it, and what the domain is.
export const OWNERS = Object.freeze({
  report: { independent: false, say: "the agent run's own report" },
  file: { independent: false, say: "a file the report cited, found in the checkout" },
  handoff: { independent: false, say: "a handoff Satellite published" },
  definition: { independent: false, say: "a definition kept in the store" },
  context: { independent: false, say: "what Orbit's project context answered" },
  knowledge: { independent: false, say: "what Orbit's project knowledge answered" },
  capability: { independent: false, say: "what a provider answered through its gate" },
  checkout: { independent: false, say: "the primary checkout, witnessed before and after a run" },
  task: { independent: true, say: "an Orbit autonomous-engineering task's own journal" },
  check: { independent: true, say: "a declared check an engineering task's runner ran" },
  investigation: { independent: true, say: "an Orbit autonomous-QA investigation's own journal" },
});

export const REF = /^([a-z]+):(.{1,200})$/;

export const refOf = (text) => ((m) => (m && OWNERS[m[1]] ? { domain: m[1], id: m[2] } : null))(REF.exec(String(text ?? "")));
