// RECORD: what an agent concluded from prose, written down with its reasons.
//
// Deterministic discovery reads manifests, version files, container files and
// pipelines; it does not read a README. Whether a script implies Windows-only
// behaviour, whether a service is mandatory or optional, whether a documented
// command is a development shortcut -- those are questions an agent can answer by
// reading, and the answer is worth keeping. But it is a HYPOTHESIS, and it is
// stored as one:
//
//   source       always `inference`. Never verified
//   confidence   always `possible`. Never certain
//   counted      never. An inference is shown beside the evidence and is not held
//                against a machine, so a wrong one cannot make something that runs
//                look incompatible or something that cannot look ready
//   a command    shown and NEVER launched: an inferred command has no argument list and
//                is not safe, whatever the candidate said. A command Orbit runs is one a
//                FILE declared
//   its key      prefixed `inference|`, so it cannot collide with -- and so cannot
//                overwrite -- a fact a file derived
//   evidence     paths the checkout tracks, and a reason that says how it was concluded
//
// A batch is all or nothing: one bad candidate refuses them all, with every reason,
// so a half-recorded investigation is never what the next session reads.
import { Refused } from "../errors.mjs";
import { measure } from "../freshness.mjs";
import { factFindings, makeFact } from "./model.mjs";

// What an inference may be ABOUT. Not a component or an environment definition: those
// reshape what a checkout IS, and only a file can say that.
export const INFERABLE = ["requirement", "command", "service", "port", "os-constraint", "readiness-signal"];

// What the engine stamps, and what an inference may not claim for itself.
const FORBIDDEN = ["id", "at", "commit", "status", "fingerprint", "checkout", "source", "confidence", "argv", "safe"];

export function parseCandidates(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Refused("no candidates were given: one JSON object per line, from a file or stdin");
  return lines.map((line, i) => parsed(line, i));
}

function parsed(line, i) {
  try {
    return JSON.parse(line);
  } catch {
    throw new Refused(`line ${i + 1} is not JSON, so nothing was recorded`);
  }
}

// -> [sentence]: why this candidate cannot be recorded.
function candidateProblems(row, i, tracked) {
  const at = `candidate ${i + 1}`;
  if (!row || typeof row !== "object" || Array.isArray(row)) return [`${at}: must be a JSON object`];
  return [...claimed(row, at), ...shaped(row, at), ...untracked(row, at, tracked), ...factFindings(asFact(row), at)];
}

const claimed = (row, at) => FORBIDDEN.filter((k) => k in row).map((k) => `${at}: ${k} is stamped by the engine, never claimed`);

const shaped = (row, at) => [...(INFERABLE.includes(row.kind) ? [] : [`${at}: kind is ${INFERABLE.join(", ")}`]), ...(typeof row.because === "string" && row.because.trim() ? [] : [`${at}: because says how it was concluded`])];

const untracked = (row, at, tracked) => [...(row.scope ?? []), ...(row.evidence ?? [])].filter((p) => !tracked.has(p)).map((p) => `${at}: ${p} is not a tracked path of this checkout`);

const asFact = (row) => ({ ...row, key: `inference|${row.key}`, source: "inference", confidence: "possible", ...(row.kind === "command" ? { argv: [], safe: false } : {}) });

// -> the facts recorded.
export function recordInferences(ctx, rows) {
  refusedIfBad(ctx, rows);
  const raw = rows.map(asFact);
  const scopes = measure(raw, null, ctx.source);
  const made = raw.map((r) => stampedAs(ctx, r, scopes));
  return made.map((f) => (ctx.store.save(f), f));
}

function refusedIfBad(ctx, rows) {
  const tracked = new Set(ctx.source.files() ?? []);
  const problems = rows.flatMap((r, i) => candidateProblems(r, i, tracked));
  if (problems.length) throw new Refused(`nothing was recorded — a batch is all or nothing:\n  ${problems.join("\n  ")}`);
}

function stampedAs(ctx, raw, scopes) {
  const hashes = raw.scope.map((s) => scopes[s]?.hash);
  return makeFact(raw, { commit: ctx.source.commit(), fingerprint: hashes.find(Boolean) ?? undefined, status: hashes.every(Boolean) ? "fresh" : "unknown", now: ctx.now, checkout: ctx.checkout });
}
