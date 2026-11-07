// THE PROBE of ORBIT-MSN-002: the one piece of the verifier that runs the TARGET's code. It is handed the target's root as
// its argument and the inputs on stdin, imports the target's own API and store modules, and prints ONE line: the raw
// answer to every input, or why it could not answer. It judges nothing -- what an answer should have been is computed
// elsewhere, by a judge that never imports the target. Each input is a sequence of requests on a store of its own under
// this container's /tmp, removed once the sequence is answered; an order is named by when it was created (1, 2, …),
// with the id the target gave it, and each answer by its place in the sequence.
//
//   node probe.mjs <target-root>   < { "inputs": [{ id, call: sequence, ops: [{ op, order }] }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { api: ["src/api.mjs", ["handle"]], store: ["src/store.mjs", ["openStore"]] };

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

// A store of the input's own, removed once the input is answered.
function inStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), "probe-"));
  try { return fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

// The id an order was given when it was made -- or one nobody made, for an order named past the ones made so far.
const idOf = (made, n) => made[n - 1] ?? `ord-${String(9000 + n).padStart(4, "0")}`;

const REQUESTS = {
  create: () => ({ method: "POST", path: "/orders", body: { lines: [{ qty: 1, unitMinor: 700 }] } }),
  get: (id) => ({ method: "GET", path: `/orders/${id}` }),
  ship: (id) => ({ method: "POST", path: `/orders/${id}/ship` }),
  cancel: (id) => ({ method: "POST", path: `/orders/${id}/cancel` }),
  deliver: (id) => ({ method: "POST", path: `/orders/${id}/deliver` }),
};

const said = (op, r) => (typeof r.body?.state === "string" ? `${op}=${r.status}:${r.body.state}` : `${op}=${r.status}`);

function step(m, store, made, s) {
  const r = m.api.handle(store, REQUESTS[s.op](idOf(made, s.order)));
  if (s.op === "create" && r.status === 201) made.push(r.body.id);
  return said(s.op, r);
}

const sequenced = (m, i) => inStore((dir) => ((store, made) => i.ops.map((s, n) => `${n + 1}.${step(m, store, made, s)}`))(m.store.openStore(dir), []));

const CALLS = { sequence: sequenced };

const answered = (m, i) => {
  try { return { id: i.id, got: CALLS[i.call](m, i) }; }
  catch (e) { return { id: i.id, threw: String(e?.message ?? e).slice(0, 200) }; }
};

const knownOps = (i) => Array.isArray(i?.ops) && i.ops.every((s) => Object.hasOwn(REQUESTS, s?.op));

function inputsOf(text) {
  try { return JSON.parse(text).inputs.filter((i) => Object.hasOwn(CALLS, i?.call) && knownOps(i)); }
  catch { return null; }
}

async function main() {
  const inputs = inputsOf(await stdin());
  const m = inputs ? await loaded(process.argv[2]) : { error: { code: "INPUT", message: "the inputs could not be read" } };
  process.stdout.write(`${JSON.stringify(m.error ? { error: m.error } : { answers: inputs.map((i) => answered(m, i)) })}\n`);
}

main();
