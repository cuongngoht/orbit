// THE PROBE of ORBIT-ORC-004: the one piece of the verifier that runs the SUBJECT's code. It is handed the subject's
// root as its argument and the inputs on stdin, imports the subject's own decision module, and prints ONE line: the raw
// answer to every input (the ids of what it reported), or why it could not answer. It judges nothing -- what an answer
// should have been is computed elsewhere, by a judge that never imports the subject -- so whatever the subject's code
// does in this process, it can only change its own answers.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: "form", decision }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
//
// A decision that passes the form answers nothing. A refusal answers REFUSED, the rule's id (what its message says
// before the first colon) and `named:<field>` for every field of the decision its message names as a word. Anything
// thrown that is not a refusal is a throw, never a refusal.
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { decision: ["src/orchestration/decision.mjs", ["judgeForm"]] };

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

const keysOf = (d) => (typeof d === "object" && d !== null && !Array.isArray(d) ? Object.keys(d) : []);

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const says = (message, word) => new RegExp(`(^|[^A-Za-z0-9_])${escaped(word)}([^A-Za-z0-9_]|$)`).test(message);

const refusedIds = (d, message) => ["REFUSED", message.split(":")[0].trim(), ...keysOf(d).filter((k) => says(message, k)).map((k) => `named:${k}`)];

const rethrown = (e) => {
  throw e;
};

// A refusal is the engine's Refused (src/errors.mjs), known by its class: the probe imports nothing but the subject.
const refusalOf = (m, d, e) => (e?.constructor?.name === "Refused" ? refusedIds(d, String(e.message)) : rethrown(e));

function formIds(m, d) {
  try { return (m.decision.judgeForm(d), []); }
  catch (e) { return refusalOf(m, d, e); }
}

const CALLS = {
  form: (m, i) => formIds(m, i.decision),
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
