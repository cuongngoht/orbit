// THE PROBE of ORBIT-ORC-005: the one piece of the verifier that runs the SUBJECT's code. It is handed the subject's
// root as its argument and the inputs on stdin, imports the subject's own goal modules, and prints ONE line: the raw
// answer to every input (the ids of what it reported), or why it could not answer. It judges nothing -- what an answer
// should have been is computed elsewhere, by a judge that never imports the subject -- so whatever the subject's code
// does in this process, it can only change its own answers.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: findings | units, analysis, digest?, done? }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
//
// A finding is a sentence; each is read as one id by what it says first: `UNKNOWN:` (unknown field), `STAMPED:` (the
// engine's to say), `REQUIRED:` (is required), `SECRET`, `INVALID:` (a field of the intent that is not what it should
// be), `SHAPE`, else `OTHER`. A plan's units are the subject's own, from the reading its own intent module normalised;
// the units of the kinds named `done` are then completed in a goal journal its own model folds.
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { candidate: ["src/goal/candidate.mjs", ["rawFindings"]], intent: ["src/goal/intent.mjs", ["intentOf"]], units: ["src/goal/plan-units.mjs", ["buildPlanUnits"]], model: ["src/goal/model.mjs", ["modelOf", "frontierOf"]] };

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

const inIntent = (where, field) => (where === "intent" ? `intent.${field}` : field);

const READ = [
  { re: /must be a JSON object/, id: () => "SHAPE" },
  { re: /^(analysis|intent): unknown field "([^"]+)"/, id: (m) => `UNKNOWN:${inIntent(m[1], m[2])}` },
  { re: /^(analysis|intent): (\S+) is the engine's to say/, id: (m) => `STAMPED:${inIntent(m[1], m[2])}` },
  { re: /^analysis: intent is required/, id: () => "REQUIRED:intent" },
  { re: /^intent: (\w+) is required/, id: (m) => `REQUIRED:intent.${m[1]}` },
  { re: /secret/i, id: () => "SECRET" },
  { re: /^intent: (category|workKinds|capabilities|verification|dependencies|missing)\b/, id: (m) => `INVALID:intent.${m[1]}` },
  { re: /[\s\S]?/, id: () => "OTHER" },
];

const idOf = (sentence) => ((row) => row.id(row.re.exec(sentence)))(READ.find((r) => r.re.test(sentence)));

const planned = (m, raw, digest) => m.units.buildPlanUnits({ objective: raw.objective, intent: m.intent.intentOf(raw.intent), requirements: [], acceptance: [] }, digest);

const journalOf = (plan, done) => [{ kind: "created", id: "goal-0123456789ab", schema: 1 }, { kind: "planned", id: "gpl-1", plan: "plan-1", units: plan }, ...plan.filter((u) => done.includes(u.kind)).map((u) => ({ kind: "unit", unit: u.id, state: "completed" }))];

const unitIds = (u, kindOf) => [`unit:${u.kind}:${u.state}`, ...(u.dependsOn ?? []).map((d) => `after:${u.kind}:${kindOf.get(d)}`), ...(u.capabilities ?? []).map((c) => `cap:${u.kind}:${c}`)];

function planIds(m, i) {
  const plan = planned(m, i.analysis, i.digest);
  const kindOf = new Map(plan.map((u) => [u.id, u.kind]));
  const next = m.model.frontierOf(m.model.modelOf(journalOf(plan, i.done ?? [])));
  return [...plan.flatMap((u) => unitIds(u, kindOf)), ...next.map((u) => `frontier:${kindOf.get(u.id)}`)];
}

const CALLS = {
  findings: (m, i) => m.candidate.rawFindings(i.analysis).map((s) => idOf(String(s))),
  units: planIds,
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
