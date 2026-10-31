// THE PROBE of an evidence case: the one piece of the verifier that runs the SUBJECT's code. It is handed the subject's
// root as its argument and the inputs on stdin, imports the subject's own run conclusion and mission verdict, and prints
// ONE line: the raw answer to every input (how a run ended; a mission's verdict and the criteria it still owes), or why
// it could not answer. It judges nothing -- what an answer should have been is computed elsewhere, by a judge that never
// imports the subject -- so whatever the subject's code does in this process, it can only change its own answers.
//
// A mission arrives as plain JSON and is made into the shape the engine folds a journal into: its units, runs, evidence
// rows and actions each in a Map by id, every unit carrying the `resetAt` line of its last reset and every run the line
// `n` it was created on.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: outcome, state, unit, rows }
//                                                  | { id, call: verdict, settled, intent, units, runs, evidence, actions }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { conclude: ["satellite/src/mission/conclude.mjs", ["outcomeOf"]], verdict: ["satellite/src/evidence/verdict.mjs", ["verdictOf"]] };

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

const byId = (list) => new Map(list.map((x) => [x.id, x]));

const missionOf = (i) => ({ intent: i.intent, units: byId(i.units), runs: byId(i.runs), evidence: byId(i.evidence), actions: byId(i.actions) });

const CALLS = {
  outcome: (m, i) => [String(m.conclude.outcomeOf({ unit: i.unit, rows: i.rows, state: i.state }))],
  verdict: (m, i) => ((v) => [String(v.verdict), ...v.owed.map((o) => `owed:${o.acceptance}`)])(m.verdict.verdictOf(missionOf(i), i.settled)),
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
