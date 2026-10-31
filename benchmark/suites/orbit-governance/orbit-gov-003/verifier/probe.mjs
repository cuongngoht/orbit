// THE PROBE of ORBIT-GOV-003: the one piece of the verifier that runs the SUBJECT's code. It is handed the subject's
// root as its argument and the inputs on stdin, imports the subject's own authorize module, and prints ONE line: for a
// crossing, who it was decided by and whether it was allowed; for two actions, whether their fingerprints are the
// same -- or why it could not answer. It judges nothing: what an answer should have been is computed elsewhere, by a
// judge that never imports the subject, so whatever the subject's code does in this process, it can only change its
// own answers.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: crossing, action, actor? } | { id, call: request-fingerprint | action-fingerprint, a, b, baseA?, baseB? }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { authorize: ["src/protected/authorize.mjs", ["authorize", "crossing", "fingerprintOf", "requestOf", "actionFingerprint"]] };

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

const crossingIds = (c) => [String(c?.by), c?.allowed === true ? "ALLOWED" : "REFUSED"];

// What a task asks a person for, and what the call that spends the approval carries.
const requestPrint = (m, action, base) => m.authorize.fingerprintOf(m.authorize.requestOf(m.authorize.authorize(action), base ?? {}));

const actionPrint = (m, action) => m.authorize.actionFingerprint(m.authorize.authorize(action));

const compared = (x, y) => [x === y ? "SAME" : "DIFFERENT"];

const CALLS = {
  crossing: (m, i) => crossingIds(m.authorize.crossing(m.authorize.authorize(i.action), i.actor, {})),
  "request-fingerprint": (m, i) => compared(requestPrint(m, i.a, i.baseA), requestPrint(m, i.b, i.baseB ?? i.baseA)),
  "action-fingerprint": (m, i) => compared(actionPrint(m, i.a), actionPrint(m, i.b)),
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
