// Running ONE report part: its envelope in on stdin, one JSON result out on
// stdout, its log on stderr -- through the Process port, argv only, with
// exactly the environment src/process/env.mjs says a child needs to start and
// nothing else of this process's (where every credential lives).
//
// What went wrong is kept apart, because it means different things:
//
//   data        the part says the snapshot lacks what it needs (exit 2): a gap
//               the report shows, never a zero and never the part's fault
//   extension   the part failed -- crashed, timed out, wrote too much, answered
//               with something that is not its contract (exit 3, or anything
//               else): the report shows that section as failed, the others
//               stand, and the run is marked degraded
//
// The log is scrubbed by shape and masked by value before it is kept, and
// capped. A part is not a sandbox: the audit guard in its shim is a second
// lock, and this file says what it hands over, not what the code could do.
import { join } from "node:path";
import { maskValues, scrub } from "../scrub.mjs";
import { childEnv } from "../process/env.mjs";
import { readOutputs } from "./outputs.mjs";

export const PART_FLAGS = ["-I", "-S", "-B", "-X", "utf8"];
export const LOG_LIMIT = 64 * 1024;
export const STDOUT_LIMIT = 8 * 1024 * 1024;

// unit: { part, envelope, dir } · deps: { process, python, shim, env, io, secrets, nowMs }
export async function runPart(unit, deps) {
  const began = deps.nowMs();
  deps.io.ensureDir(unit.dir);
  const answer = await deps.process.runAsync(deps.python, [...PART_FLAGS, deps.shim], { input: JSON.stringify(unit.envelope), env: childEnv(deps.env), cwd: unit.dir, timeoutMs: (unit.part.timeoutSec ?? 120) * 1000, maxBuffer: STDOUT_LIMIT });
  return { ...judged(unit, answer, deps), log: logOf(answer, deps), ms: deps.nowMs() - began };
}

// The first row that matches decides, and the last always does.
const OUTCOMES = [
  { when: (a) => a.overflow, is: () => failure("it wrote more output than a part may") },
  { when: (a, r) => !r, is: (a) => failure(a.error ? `it did not answer: ${a.error}` : "it did not answer with its result") },
  { when: (a) => a.status === 2, is: (a, r) => ({ ok: false, kind: "data", status: "unavailable", missing: r.missing ?? [], notes: r.notes ?? [], outputs: {} }) },
  { when: (a) => a.status !== 0, is: (a, r) => failure((r.notes ?? [])[0] ?? `it exited ${a.status}`) },
  { when: () => true, is: null },
];

function judged(unit, answer, deps) {
  const result = resultOf(answer.out);
  const row = OUTCOMES.find((o) => o.when(answer, result));
  return row.is ? scrubbed(row.is(answer, result), deps) : read(unit, result, deps);
}

function resultOf(out) {
  try { return JSON.parse(String(out ?? "").trim() || "null"); }
  catch { return null; }
}

const failure = (why) => ({ ok: false, kind: "extension", status: "failed", error: why, notes: [], missing: [], outputs: {} });

function read(unit, result, deps) {
  const got = readOutputs(unit.part, result, unit.dir, deps.io);
  if (!got.ok) return scrubbed(failure(`its output does not hold: ${got.problems.join("; ")}`), deps);
  return { ok: true, kind: "ok", status: result.status ?? "ok", outputs: got.outputs, files: filesOf(result, got), exports: got.exports, notes: [...(result.notes ?? []), ...got.notes].map((n) => clean(n, deps)), missing: (result.missing ?? []).map(String) };
}

// Which file each kept output came from, so a later part can be handed its path.
const filesOf = (result, got) => Object.fromEntries(Object.entries(result.outputs ?? {}).filter(([k]) => k in got.outputs));

const scrubbed = (outcome, deps) => ({ ...outcome, error: outcome.error ? clean(outcome.error, deps) : undefined, notes: outcome.notes.map((n) => clean(n, deps)) });

const clean = (text, deps, limit = 2000) => maskValues(scrub(String(text)), deps.secrets ?? []).slice(0, limit);

function logOf(answer, deps) {
  const text = clean(answer.err ?? "", deps, LOG_LIMIT + 1);
  return text.length > LOG_LIMIT ? `${text.slice(0, LOG_LIMIT)}\n[… log cut at ${LOG_LIMIT} bytes]` : text;
}

export const partLogFile = (dir, part) => join(dir, "..", "logs", `${part.id}.log`);
