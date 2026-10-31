// THE PROBE of ORBIT-GOV-004: the one piece of the verifier that runs the SUBJECT's code. It is handed the subject's
// root as its argument and the inputs on stdin, imports the subject's own policy module, and prints ONE line: the
// verdict or the operation each input came to -- a call held, as the invocation gate holds it, to the strictest of its
// capability verdict and its operation's rule, both the subject's own -- or why it could not answer. It judges
// nothing: what an answer should have been is computed elsewhere, by a judge that never imports the subject, so
// whatever the subject's code does in this process, it can only change its own answers.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: strictest | capability | undeclared | operation | operation-verdict | call, … }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { policy: ["src/policy.mjs", ["strictest", "capabilityVerdict", "undeclaredVerdict", "operationOf", "operationVerdict"]] };

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

// What a call asks for: one capability, or -- when it names none -- everything the resource provides.
const asked = (p, i) => (typeof i.capability === "string" ? p.capabilityVerdict(i.policy, i.capability, i.workflow ?? null) : p.undeclaredVerdict(i.policy, i.provides, i.workflow ?? null));

const CALLS = {
  strictest: (m, i) => [String(m.policy.strictest(i.verdicts))],
  capability: (m, i) => [String(m.policy.capabilityVerdict(i.policy, i.capability, i.workflow ?? null))],
  undeclared: (m, i) => [String(m.policy.undeclaredVerdict(i.policy, i.provides, i.workflow ?? null))],
  operation: (m, i) => [String(m.policy.operationOf(i.tool))],
  "operation-verdict": (m, i) => [String(m.policy.operationVerdict(i.policy, i.operation))],
  call: (m, i) => [String(m.policy.strictest([asked(m.policy, i), m.policy.operationVerdict(i.policy, m.policy.operationOf(i.tool))]))],
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
