// THE PROBE of ORBIT-GOV-005: the one piece of the verifier that runs the SUBJECT's code. It is handed the subject's
// root as its argument and the inputs on stdin, imports the subject's own scrub module, and prints ONE line: for every
// input, which of the secrets planted in it survived the masking (`leak:<kind>`) and which of the things it had to keep
// came back changed (`damaged:<name>`) -- or, for a key, whether it reads as a secret's name, and for the declaration,
// the fields it lists -- or why it could not answer. It judges nothing: what an answer should have been is computed
// elsewhere, by a judge that never imports the subject, so whatever the subject's code does in this process, it can
// only change its own answers.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: scrub | scrubbed | record | secret-name | free-text, … }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { scrub: ["src/scrub.mjs", ["scrub", "scrubbed", "scrubRecord", "SECRET_NAME", "FREE_TEXT"]] };

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => mods[k]?.[n] === undefined).map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

// Every string a value holds, at any depth: where a planted secret could still be.
const stringsIn = (v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(stringsIn) : v && typeof v === "object" ? Object.values(v).flatMap(stringsIn) : []);

const leaks = (out, planted) => (planted ?? []).filter((p) => stringsIn(out).some((s) => s.includes(p.value))).map((p) => `leak:${p.kind}`);

const at = (v, path) => (path ?? []).reduce((x, k) => x?.[k], v);

const damagedAt = (before, after, kept) => (kept ?? []).filter((k) => JSON.stringify(at(after, k.path)) !== JSON.stringify(at(before, k.path))).map((k) => `damaged:${k.name}`);

const damagedIn = (text, kept) => (kept ?? []).filter((k) => !String(text).includes(k.value)).map((k) => `damaged:${k.name}`);

// The subject is handed a copy, so a change it makes in place is still seen as a change.
const copied = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const deepIds = (out, before, i) => [...leaks(out, i.planted), ...damagedAt(before, out, i.kept)];

const CALLS = {
  scrub: (m, i) => ((out) => [...leaks(out, i.planted), ...damagedIn(out, i.kept)])(m.scrub.scrub(i.text)),
  scrubbed: (m, i) => deepIds(m.scrub.scrubbed(copied(i.value)), i.value, i),
  record: (m, i) => deepIds(m.scrub.scrubRecord(copied(i.record)), i.record, i),
  "secret-name": (m, i) => [m.scrub.SECRET_NAME.test(String(i.key)) ? "secret-name" : "plain-name"],
  "free-text": (m) => [...m.scrub.FREE_TEXT].map((f) => `free:${f}`),
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
