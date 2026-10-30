// What a CANDIDATE must be before it is evaluated -- and again before it is promoted: untrusted until every rule holds,
// every finding at once. The owner's own contract has already held it (the skill factory's validation, Satellite's
// role rules); these are the rules an improvement adds, and none of them can be relaxed to let a candidate through.
//
//   factsOf(kind, version) -> { pin, digest, intact, provides, tools, files, successorOf, oracle }
//   safetyOf(c) -> [{ id, says }]      c: { parent, candidate, ownerFindings, suppressed }
import { canonicalJson } from "../hash.mjs";
import { oracleOf, weakenings } from "./oracle.mjs";

// A version, as the rules below read it, whichever owner keeps it. A skill: what the skill factory's
// versionContentOf answers (data, never text). A Satellite definition: its record, read back intact by its pin.
export const FACTS = {
  skill: (v) => ({ pin: v.pin, digest: v.digest, intact: v.intact === true, provides: v.manifest?.provides ?? [], tools: v.manifest?.allowedTools ?? [], files: (v.files ?? []).map((f) => f.name), successorOf: v.manifest?.successorOf ?? null, oracle: oracleOf("workflow", v.workflow) }),
  satellite: (v) => ({ pin: v.pin, digest: v.contentDigest, intact: Boolean(v.contentDigest), provides: [v.kind, v.id], tools: [v.content?.requestedPermissionProfile ?? null], files: [], successorOf: v.provenance?.successorOf ?? null, oracle: oracleOf("role", v.content) }),
};

export const factsOf = (kind, version) => (version ? FACTS[kind](version) : null);

export const suppressionKey = (parentPin, digest) => `${parentPin}>${digest}`;

const widened = (c) => c.candidate.tools.filter((t) => !c.parent.tools.includes(t));

export const SAFETY = [
  { id: "CAND_DIGEST", fails: (c) => !c.candidate.intact, say: () => "the candidate's files are not what was staged — it is never evaluated" },
  { id: "CAND_UNCHANGED", fails: (c) => c.candidate.digest === c.parent.digest, say: () => "the candidate says what the version it succeeds says" },
  { id: "CAND_PARENT", fails: (c) => c.candidate.successorOf !== c.parent.pin, say: (c) => `the candidate succeeds ${c.candidate.successorOf ?? "nothing named"}, not ${c.parent.pin}` },
  { id: "CAND_PROVIDES", fails: (c) => canonicalJson(c.candidate.provides) !== canonicalJson(c.parent.provides), say: () => "the candidate provides something other than the version it succeeds" },
  { id: "CAND_TOOLS_WIDENED", fails: (c) => widened(c).length > 0, say: (c) => `it asks for ${widened(c).join(", ")}, which the version it succeeds never had — a candidate never grants itself authority` },
  { id: "CAND_EXECUTABLE", fails: (c) => c.candidate.files.some((n) => !/\.(md|json)$/.test(n)), say: () => "it carries a file that is not instruction text or declared data — executable candidates are refused (improvement.allowExecutableCandidates is fixed at false)" },
  { id: "CAND_ORACLE_WEAKENED", fails: (c) => weakenings(c.parent.oracle, c.candidate.oracle).length > 0, say: (c) => `it weakens what counts as a pass: ${weakenings(c.parent.oracle, c.candidate.oracle).map((w) => `${w.id} ${w.says}`).join("; ").slice(0, 200)}` },
  { id: "CAND_SUPPRESSED", fails: (c) => (c.suppressed ?? []).includes(suppressionKey(c.parent.pin, c.candidate.digest)), say: () => "the same candidate already failed against the same version — it is reconsidered only on a changed definition or new evidence" },
  { id: "CAND_OWNER_REFUSED", fails: (c) => (c.ownerFindings ?? []).length > 0, say: (c) => `its owner's contract refuses it: ${c.ownerFindings.slice(0, 3).join(", ")}` },
];

export const SAFETY_IDS = SAFETY.map((r) => r.id);

export const safetyOf = (c) => (c.parent && c.candidate ? SAFETY.filter((r) => r.fails(c)).map((r) => ({ id: r.id, says: r.say(c) })) : [{ id: "CAND_DIGEST", says: "the candidate or the version it succeeds could not be read back intact" }]);
