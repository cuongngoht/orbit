// THE PROBE of a support case: the one piece of the verifier that runs the SUBJECT's code. It is handed the subject's
// root as its argument and the inputs on stdin, imports the subject's own support module, and prints ONE line: the raw
// answer to every input, reduced to ids, or why it could not answer. It judges nothing -- what an answer should have
// been is computed elsewhere, by a judge that never imports the subject -- so whatever the subject's code does in this
// process, it can only change its own answers.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: support | derive, … }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
//
//   support { events: [{ list: seen | contested, by }] } -> [derive(s), "sessions:<s.sessions>", "against:<s.against>"]
//           where s is a record with no support, folded through counted(s, by, list) one event at a time
//   derive  { sessions, against }                        -> [derive({ sessions, against, … })]
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { support: ["src/memory/support.mjs", ["counted", "derive"]] };

// A record nobody has observed yet: the support contract's own fields, all empty.
const EMPTY = () => ({ examples: 0, sessions: 0, against: 0, seen: [], contested: [] });

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

const folded = (m, events) => events.reduce((s, e) => m.support.counted(s, e.by, e.list), EMPTY());

const reported = (m, s) => [String(m.support.derive(s)), `sessions:${s.sessions}`, `against:${s.against}`];

const CALLS = {
  support: (m, i) => reported(m, folded(m, i.events)),
  derive: (m, i) => [String(m.support.derive({ ...EMPTY(), sessions: i.sessions, against: i.against }))],
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
