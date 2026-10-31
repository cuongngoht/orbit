// THE PROBE of a session case: the one piece of the verifier that runs the SUBJECT's code. It is handed the subject's
// root as its argument and the inputs on stdin, imports the subject's own session module, and prints ONE line: the raw
// answer to every input, reduced to ids, or why it could not answer. It judges nothing -- what an answer should have
// been is computed elsewhere, by a judge that never imports the subject -- so whatever the subject's code does in this
// process, it can only change its own answers.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: day | same | count | pair | among, … }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
//
//   day    { run }          -> ["day:<dayOf(run)>"]
//   same   { a, b }         -> ["SAME" | "DIFFERENT"]      sessionId(a) against sessionId(b)
//   count  { runs }         -> ["sessions:<independent(runs)>"]
//   pair   { a, b }         -> ["SAME" | "INDEPENDENT"]    knownIn(sessionMarks(a), b)
//   among  { prior, seen }  -> ["KNOWN" | "NEW"]           knownIn(every mark the prior observations leave, seen)
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { session: ["src/memory/session.mjs", ["sessionId", "independent", "sessionMarks", "knownIn", "dayOf"]] };

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

const marksOf = (m, list) => list.flatMap((o) => m.session.sessionMarks(o));

const CALLS = {
  day: (m, i) => [`day:${m.session.dayOf(i.run)}`],
  same: (m, i) => [m.session.sessionId(i.a) === m.session.sessionId(i.b) ? "SAME" : "DIFFERENT"],
  count: (m, i) => [`sessions:${m.session.independent(i.runs)}`],
  pair: (m, i) => [m.session.knownIn(marksOf(m, [i.a]), i.b) ? "SAME" : "INDEPENDENT"],
  among: (m, i) => [m.session.knownIn(marksOf(m, i.prior), i.seen) ? "KNOWN" : "NEW"],
};

const answered = (m, i) => {
  try { return { id: i.id, got: CALLS[i.call](m, i) }; }
  catch (e) { return { id: i.id, threw: String(e?.message ?? e).slice(0, 200) }; }
};

function inputsOf(text) {
  try { return JSON.parse(text).inputs.filter((i) => Object.hasOwn(CALLS, i?.call)); }
  catch { return null; }
}

async function main() {
  const inputs = inputsOf(await stdin());
  const m = inputs ? await loaded(process.argv[2]) : { error: { code: "INPUT", message: "the inputs could not be read" } };
  process.stdout.write(`${JSON.stringify(m.error ? { error: m.error } : { answers: inputs.map((i) => answered(m, i)) })}\n`);
}

main();
