// THE PROBE of ORBIT-E2E-002: the one piece of the verifier that runs the TARGET's code. It is handed the target's root
// as its argument and the inputs on stdin, imports the target's own API and store, and sends each input's requests in
// order to a store of the input's own (under this container's /tmp, removed once answered). `$k` in a path is the id
// the k-th order the sequence created was given. It prints ONE line: each request's status and the state its body
// names, or why it could not answer. It judges nothing.
//
//   node probe.mjs <target-root>   < { "inputs": [{ id, call: "ops", steps: [{ method, path, body? }] }] }
//   -> { "answers": [{ id, got: ["<n>:<status>:<state|->"] } | { id, threw }] }  |  { "error": { code, … } }
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

function inStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), "probe-"));
  try { return fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

// `$k` -> the id the k-th created order was given, as the target's own answer said it.
const resolved = (path, made) => String(path).replace(/\$(\d+)/g, (_, k) => made[Number(k) - 1] ?? "ord-9999");

// One request in turn: its answer said as `<n>:<status>:<state>`, and the ids created so far.
function sent(m, store, acc, q) {
  const r = m.api.handle(store, { method: q.method, path: resolved(q.path, acc.made), body: q.body });
  const made = q.method === "POST" && q.path === "/orders" && r?.status === 201 ? [...acc.made, r.body?.id] : acc.made;
  return { made, out: [...acc.out, `${acc.out.length + 1}:${r?.status}:${r?.body?.state ?? "-"}`] };
}

const CALLS = {
  ops: (m, i) => inStore((dir) => ((store) => i.steps.reduce((acc, q) => sent(m, store, acc, q), { made: [], out: [] }).out)(m.store.openStore(dir))),
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
