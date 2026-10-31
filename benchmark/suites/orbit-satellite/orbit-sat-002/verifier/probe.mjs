// THE PROBE of a work-graph case: the one piece of the verifier that runs the SUBJECT's code. It is handed the
// subject's root as its argument and the inputs on stdin, imports the subject's own graph module, and prints ONE line:
// the raw answer to every input (the rule a proposal broke, or the order topo gave), or why it could not answer. It
// judges nothing -- what an answer should have been is computed elsewhere, by a judge that never imports the subject --
// so whatever the subject's code does in this process, it can only change its own answers.
//
// An input is plain JSON; the mission it describes is made into the shape the engine folds a journal into: units held
// in a Map by id (each with the `resetAt` the fold gives it), unit states in a Map.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: graph, existing, states, limits, spent, units, cancel,
//                                                    reset } | { id, call: topo, nodes }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { graph: ["satellite/src/planning/graph.mjs", ["graphFinding", "topo"]] };

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

const unitsOf = (list) => new Map(list.map((u) => [u.id, { ...u, resetAt: 0 }]));

const proposalOf = (i) => ({ m: { units: unitsOf(i.existing) }, states: new Map(Object.entries(i.states)), limits: i.limits, spent: i.spent, units: i.units, cancel: i.cancel, reset: i.reset });

const CALLS = {
  graph: (m, i) => ((f) => (f ? [String(f.rule)] : []))(m.graph.graphFinding(proposalOf(i))),
  topo: (m, i) => ((order) => (order === null ? ["CYCLE"] : order.map(String)))(m.graph.topo(i.nodes)),
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
