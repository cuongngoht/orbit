// The REPORT an agent run returns -- through the host, as one JSON object -- held to its contract whole: one broken
// rule refuses all of it, and nothing is written. A report says what was found, which records show it, what is still
// unknown and what the run would change; it never says whether it worked. Every word that would claim an outcome, a
// level of evidence, a mode or a person's decision is refused BY NAME.
import { canonicalJson, short } from "../../../src/hash.mjs";
import { READABLE } from "../evidence/readback.mjs";
import { refOf } from "../evidence/vocab.mjs";
import { isObject, isSentence, list, secretShaped } from "../store/text.mjs";

export const REPORT_API = "orbit.satellite.report/v1";

export const REPORT_FIELDS = Object.freeze(["schemaVersion", "agentRunId", "executionState", "findings", "artifacts", "evidenceRefs", "remainingUnknowns", "supports", "refutes", "proposes", "summary"]);

export const REPORT_FORBIDDEN = Object.freeze(["verdict", "outcome", "status", "passed", "failed", "approved", "evidenceLevel", "level", "independent", "actionStatus", "mode", "operationKind", "lifecycle", "grants", "score", "confidence", "verified", "succeeded", "success", "done"]);

export const EXECUTION_STATES = Object.freeze(["reported", "blocked"]);

export const REPORT_LIMITS = Object.freeze({ findings: 50, findingChars: 500, artifacts: 4, artifactBytes: 16384, evidenceRefs: 16, remainingUnknowns: 20, hypotheses: 8, proposedUnits: 8, bytes: 65536 });

const ARTIFACT_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const findingOk = (f) => isObject(f) && Object.keys(f).every((k) => ["say", "refs"].includes(k)) && isSentence(f.say, REPORT_LIMITS.findingChars) && list(f.refs).length <= 8;

const artifactOk = (a) => isObject(a) && Object.keys(a).every((k) => ["name", "text"].includes(k)) && ARTIFACT_NAME.test(String(a.name)) && typeof a.text === "string" && Buffer.byteLength(a.text, "utf8") <= REPORT_LIMITS.artifactBytes;

const refOk = (r) => ((x) => Boolean(x) && READABLE.includes(x.domain))(refOf(r));

const hypOk = (v) => v === undefined || (Array.isArray(v) && v.length <= REPORT_LIMITS.hypotheses && v.every((h) => /^hyp-[1-9][0-9]{0,4}$/.test(String(h))));

const proposesOk = (p) => p === undefined || (isObject(p) && Object.keys(p).every((k) => ["units", "because"].includes(k)) && isSentence(p.because) && Array.isArray(p.units) && p.units.length <= REPORT_LIMITS.proposedUnits && p.units.every((u) => isObject(u) && isSentence(u.objective)));

const textsOf = (r) => [r.summary, ...list(r.findings).map((f) => f?.say), ...list(r.remainingUnknowns), ...list(r.artifacts).map((a) => a?.text)].filter((t) => typeof t === "string");

// c: { run } -- the run the report claims to be for.
export const REPORT_RULES = Object.freeze([
  { id: "REPORT_SHAPE", fails: (r) => !isObject(r) || r.schemaVersion !== 1, say: () => 'a report is { "schemaVersion": 1, "agentRunId", "executionState": "reported"|"blocked", "findings", "evidenceRefs", "summary" … }' },
  { id: "REPORT_FORBIDDEN", fails: (r) => REPORT_FORBIDDEN.some((k) => k in r), say: (r) => `a report never says ${REPORT_FORBIDDEN.filter((k) => k in r).join(", ")} — the engine derives what the evidence shows` },
  { id: "REPORT_UNKNOWN_FIELD", fails: (r) => Object.keys(r).some((k) => !REPORT_FIELDS.includes(k) && !REPORT_FORBIDDEN.includes(k)), say: (r) => `unknown field(s): ${Object.keys(r).filter((k) => !REPORT_FIELDS.includes(k) && !REPORT_FORBIDDEN.includes(k)).join(", ")}` },
  { id: "REPORT_RUN", fails: (r, c) => r.agentRunId !== c.run.id, say: (r, c) => `this report is for ${r.agentRunId ?? "no run"}, and the run asked about is ${c.run.id}` },
  { id: "REPORT_STATE", fails: (r) => !EXECUTION_STATES.includes(r.executionState), say: () => `executionState is ${EXECUTION_STATES.join(" or ")}: what the run itself could say` },
  { id: "REPORT_SUMMARY", fails: (r) => !isSentence(r.summary), say: () => "summary is one sentence of at most 240 characters" },
  { id: "REPORT_FINDINGS", fails: (r) => !(r.findings === undefined || (Array.isArray(r.findings) && r.findings.length <= REPORT_LIMITS.findings && r.findings.every(findingOk))), say: () => `findings are at most ${REPORT_LIMITS.findings} { say: one sentence of at most ${REPORT_LIMITS.findingChars} characters, refs? }` },
  { id: "REPORT_ARTIFACTS", fails: (r) => !(r.artifacts === undefined || (Array.isArray(r.artifacts) && r.artifacts.length <= REPORT_LIMITS.artifacts && r.artifacts.every(artifactOk))), say: () => `artifacts are at most ${REPORT_LIMITS.artifacts} { name: a lower-case file name, text: at most ${REPORT_LIMITS.artifactBytes} bytes }` },
  { id: "REPORT_EVIDENCE", fails: (r) => !(r.evidenceRefs === undefined || (Array.isArray(r.evidenceRefs) && r.evidenceRefs.length <= REPORT_LIMITS.evidenceRefs && r.evidenceRefs.every(refOk))), say: () => `evidenceRefs are at most ${REPORT_LIMITS.evidenceRefs} of ${READABLE.map((d) => `${d}:<id>`).join(", ")}` },
  { id: "REPORT_UNKNOWNS", fails: (r) => !(r.remainingUnknowns === undefined || (Array.isArray(r.remainingUnknowns) && r.remainingUnknowns.length <= REPORT_LIMITS.remainingUnknowns && r.remainingUnknowns.every((u) => isSentence(u)))), say: () => `remainingUnknowns are at most ${REPORT_LIMITS.remainingUnknowns} sentences` },
  { id: "REPORT_HYPOTHESES", fails: (r) => !hypOk(r.supports) || !hypOk(r.refutes), say: () => "supports and refutes name hyp-<n> ids the intent recorded" },
  { id: "REPORT_PROPOSES", fails: (r) => !proposesOk(r.proposes), say: () => `proposes is { units: [at most ${REPORT_LIMITS.proposedUnits} unit proposals], because } -- a proposal the orchestrator may act on, never a change made` },
  { id: "REPORT_SECRET", fails: (r) => textsOf(r).some(secretShaped) || list(r.evidenceRefs).some(secretShaped), say: () => "text that looks like a secret is refused" },
  { id: "REPORT_SIZE", fails: (r) => Buffer.byteLength(JSON.stringify(r), "utf8") > REPORT_LIMITS.bytes, say: () => `a report is at most ${REPORT_LIMITS.bytes} bytes` },
]);

export function reportProblems(raw, c) {
  const shape = REPORT_RULES[0];
  if (shape.fails(raw, c)) return [{ id: shape.id, say: shape.say(raw, c) }];
  return REPORT_RULES.slice(1).filter((rule) => rule.fails(raw, c)).map((rule) => ({ id: rule.id, say: rule.say(raw, c) }));
}

export const reportDigest = (r) => short(canonicalJson(r), 16);
