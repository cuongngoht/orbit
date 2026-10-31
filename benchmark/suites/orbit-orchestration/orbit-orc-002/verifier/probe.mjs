// THE PROBE of ORBIT-ORC-002: the one piece of the verifier that runs the SUBJECT's code. It is handed the subject's
// root as its argument and the inputs on stdin, imports the subject's own obligations and verification modules, and
// prints ONE line: the raw answer to every input (the ids of what it reported), or why it could not answer. It judges
// nothing -- what an answer should have been is computed elsewhere, by a judge that never imports the subject -- so
// whatever the subject's code does in this process, it can only change its own answers.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: plan | completion, world }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
//
// A world is a task as the loop hands it to the rules, as data: its view, its journal lines with their positions, the
// declared checks, the investigations it linked, and -- when there are any -- the component graph and the source trees,
// which the probe hands over as the functions the rules ask.
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { obligations: ["src/orchestration/obligations.mjs", ["planOf"]], verification: ["src/orchestration/verification.mjs", ["unmet"]] };

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

const asked = (w) => ({ ...(w.graph ? { graph: () => w.graph } : {}), ...(w.tree ? { tree: () => w.tree } : {}), ...(w.baseTree ? { baseTree: () => w.baseTree } : {}) });

const lwOf = (w) => ({ id: w.id, now: w.now, view: w.view, events: w.events, checks: w.checks, investigations: new Map(Object.entries(w.investigations ?? {})), ...asked(w) });

const planIds = (p) => [...p.required.map((c) => `required:${c.id}:${c.state}`), ...p.excluded.map((c) => `excluded:${c.id}`), ...p.missing.map((m) => `missing:${m.what}`), `word:${p.word}`];

const CALLS = {
  plan: (m, i) => planIds(m.obligations.planOf(lwOf(i.world))),
  completion: (m, i) => m.verification.unmet(lwOf(i.world)).map((u) => String(u.id)),
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
