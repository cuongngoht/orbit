// THE PROBE of a freshness case: the one piece of the verifier that runs the SUBJECT's code. It is handed the subject's
// root as its argument and the inputs on stdin, imports the subject's own freshness module, and prints ONE line: the
// raw answer to every input, reduced to ids, or why it could not answer. It judges nothing -- what an answer should
// have been is computed elsewhere, by a judge that never imports the subject -- so whatever the subject's code does in
// this process, it can only change its own answers.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: scope | fact | measure, … }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
//
//   scope   { now, was }                    -> [scopeState(now, was).state, "hash:<its hash, or none>"]
//   fact    { fact, scopes }                -> [factState(fact, scopes)]
//   measure { facts, recorded, current }    -> ["fact-<k>:<factState>" for every fact, "moved:<scope>" for every scope
//           movedScopes names, "calls:<how often measure asked the source port>"] -- the port answers from `current`,
//           and leaves out a scope that is gone; the model holds `recorded` as each scope's last hash
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { fresh: ["src/freshness.mjs", ["scopeState", "factState", "movedScopes", "measure"]] };

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

// The source port: what each scope hashes to now, counting how often it is asked.
function portOf(current) {
  const port = { calls: 0 };
  port.fingerprints = (wanted) => ((port.calls += 1), Object.fromEntries(wanted.filter((s) => Object.hasOwn(current, s)).map((s) => [s, current[s]])));
  return port;
}

const modelOf = (recorded) => ({ scopes: Object.fromEntries(Object.entries(recorded).map(([s, hash]) => [s, { hash }])) });

function measured(m, i) {
  const port = portOf(i.current);
  const scopes = m.fresh.measure(i.facts, modelOf(i.recorded), port);
  return [...i.facts.map((f, k) => `fact-${k + 1}:${m.fresh.factState(f, scopes)}`), ...m.fresh.movedScopes(scopes).map((s) => `moved:${s}`), `calls:${port.calls}`];
}

const CALLS = {
  scope: (m, i) => ((s) => [String(s.state), `hash:${s.hash ?? "none"}`])(m.fresh.scopeState(i.now, i.was)),
  fact: (m, i) => [String(m.fresh.factState(i.fact, i.scopes))],
  measure: measured,
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
