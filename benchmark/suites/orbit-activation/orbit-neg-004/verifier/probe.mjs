// THE PROBE of ORBIT-NEG-004: the one piece of the verifier that runs the TARGET's code. It is handed the target's root as
// its argument and the inputs on stdin, imports the target's own money, API and store modules, and prints ONE line: the
// raw answer to every input -- a line's or an order's total read from `quantity` lines, an order created through the API,
// or which of the named files still name a word -- or why it could not answer. It judges nothing. An API input gets a
// store of its own under this container's /tmp, removed once it is answered.
//
//   node probe.mjs <target-root>   < { "inputs": [{ id, call: line|total|api|names, line, lines, percent, files, word }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { money: ["src/money.mjs", ["lineTotal", "orderTotal"]], api: ["src/api.mjs", ["handle"]], store: ["src/store.mjs", ["openStore"]] };

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : { ...mods, root }))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

function inStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), "probe-"));
  try { return fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

const created = (m, i, dir) => m.api.handle(m.store.openStore(dir), { method: "POST", path: "/orders", body: { lines: i.lines, percent: i.percent } });

// The files that still name the word, as a whole word: a file a tree does not hold names nothing.
const naming = (m, i) => i.files.filter((f) => existsSync(join(m.root, f)) && new RegExp(`\\b${i.word}\\b`).test(readFileSync(join(m.root, f), "utf8")));

const CALLS = {
  line: (m, i) => [`minor=${m.money.lineTotal(i.line)}`],
  total: (m, i) => [`minor=${m.money.orderTotal(i.lines, i.percent)}`],
  api: (m, i) => inStore((dir) => ((r) => [`status=${r.status}`, `minor=${r.body?.totalMinor}`, `total=${r.body?.total}`])(created(m, i, dir))),
  names: (m, i) => naming(m, i),
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
