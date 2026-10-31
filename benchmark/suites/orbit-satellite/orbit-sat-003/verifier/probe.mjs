// THE PROBE of a handoff case: the one piece of the verifier that runs the SUBJECT's code. It is handed the subject's
// root as its argument and the inputs on stdin, imports the subject's own handoff module, and prints ONE line: the raw
// answer to every input (the rule a consumer came to, or nothing), or why it could not answer. It judges nothing --
// what an answer should have been is computed elsewhere, by a judge that never imports the subject -- so whatever the
// subject's code does in this process, it can only change its own answers.
//
// A record is sealed the way it was published, with the subject's OWN digest function: an input says only how the
// record stands against that (`seal`: published or none; `edit`: fields changed afterwards; `reseal`: digested again
// over the change; `journal`: the journal line names the same digest or another). The mission's units go into a Map by
// id, as the engine folds them.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: consume, record, seal, edit, reseal, journal, unit,
//                                                    published, units, tree }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { handoff: ["satellite/src/handoff/handoff.mjs", ["consumeFinding", "handoffDigest"]] };

const OTHER_DIGEST = "ffffffffffffffff";

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const sealed = (m, rec) => ({ ...rec, digest: m.handoff.handoffDigest(rec) });

// The record as it was published, then as it is read back now.
const asPublished = (m, i) => (isObject(i.record) && i.seal !== "none" ? sealed(m, i.record) : i.record);

const readBack = (m, i, first) => (isObject(first) && i.edit ? ((rec) => (i.reseal ? sealed(m, rec) : rec))({ ...first, ...i.edit }) : first);

function consumed(m, i) {
  const first = asPublished(m, i);
  const published = { ...i.published, digest: i.journal === "other" ? OTHER_DIGEST : first?.digest };
  return m.handoff.consumeFinding({ m: { units: new Map(i.units.map((u) => [u.id, u])) }, unit: i.unit, record: readBack(m, i, first), tree: i.tree, published });
}

const CALLS = {
  consume: (m, i) => ((f) => (f ? [String(f.rule)] : []))(consumed(m, i)),
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
