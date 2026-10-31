// THE PROBE of ORBIT-GOV-002: the one piece of the verifier that runs the SUBJECT's code. It is handed the subject's
// root as its argument and the inputs on stdin, imports the subject's own tier reader, capability action and
// authorize, and prints ONE line: the raw answer to every input -- a tier, whether it is production, or a capability's
// kind, landing and verdict as ids -- or why it could not answer. It judges nothing: what an answer should have been
// is computed elsewhere, by a judge that never imports the subject, so whatever the subject's code does in this
// process, it can only change its own answers.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: tier | production | strictest | capability, … }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = {
  environments: ["src/protected/environments.mjs", ["tierOf", "isProduction", "strictestTier"]],
  capability: ["src/protected/capability.mjs", ["capabilityAction"]],
  authorize: ["src/protected/authorize.mjs", ["authorize"]],
};

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

// A capability call as ids: what it does, where it lands, and the verdict -- its decision and any boundary it meets.
const actionIds = (action, v) => [`kind:${action.kind}`, `env:${action.environment}`, String(v?.decision), ...(v?.boundary ? [String(v.boundary)] : [])];

const capabilityIds = (m, cap, input) => ((action) => actionIds(action, m.authorize.authorize(action)))(m.capability.capabilityAction(cap, input));

const CALLS = {
  tier: (m, i) => [String(m.environments.tierOf(i.word))],
  production: (m, i) => [m.environments.isProduction(i.word) === true ? "production" : "not-production"],
  strictest: (m, i) => [String(m.environments.strictestTier(i.words))],
  capability: (m, i) => capabilityIds(m, i.capability, i.input),
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
