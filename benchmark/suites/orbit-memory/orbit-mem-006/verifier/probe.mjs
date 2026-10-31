// THE PROBE of a journal case: the one piece of the verifier that runs the SUBJECT's code. It is handed the subject's
// root as its argument and the inputs on stdin, imports the subject's own journal stores and its real file io, plays
// every plan against a journal of its own under the temporary directory, and prints ONE line: what was read back,
// reduced to ids, or why it could not answer. It judges nothing -- what an answer should have been is computed
// elsewhere, by a judge that never imports the subject -- so whatever the subject's code does in this process, it can
// only change its own answers. Every journal lives in a fresh directory, removed when its plan is played.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: "journal", store: task | goal | mission, plan }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
//
//   plan  [{ write: k } | { tear: text }]   k records appended through the journal's own door, numbered r1, r2, … in
//         the order written; or a fragment written straight onto the journal file, as a killed process leaves it
//   ->    ["kept:<n>" for every record read back, "lost:<n>" for every one written and not read back, "foreign" when
//         a line the door never wrote was read as a record, "order:kept" | "order:broken" for the order read back]
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = {
  io: ["src/store/io.mjs", ["realIo"]],
  task: ["src/task/store.mjs", ["createTasks"]],
  goal: ["src/goal/store.mjs", ["createGoals"]],
  mission: ["satellite/src/store/journal.mjs", ["createJournal"]],
};

const TASK = "tsk-0123456789ab";
const GOAL = "goal-0123456789ab";

// A mission journal's spec, as its own callers hand one in: the kinds it keeps and the free text it masks.
const SPEC = { kinds: { noted: { fields: ["n"] } }, freeText: [], noun: "probe", busy: "another probe is writing this journal" };

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

const ioOf = (m) => m.io.realIo({ host: "probe", now: () => "2026-10-31T00:00:00.000Z" });

// Each journal behind one face: where its file is, how a record goes in through its door, and what reads back.
const STORES = {
  task: (m, root) => ((t) => ({ file: t.journalFile(TASK), write: (n) => t.append(TASK, "stage", { stage: n }), read: () => (t.read(TASK) ?? []).map((l) => l?.stage) }))(m.task.createTasks(root, ioOf(m))),
  goal: (m, root) => ((g) => ({ file: g.journalFile(GOAL), write: (n) => g.append(GOAL, "unit", { unit: n }), read: () => (g.read(GOAL) ?? []).map((l) => l?.unit) }))(m.goal.createGoals(root, ioOf(m))),
  mission: (m, root) => ((j) => ({ file: j.file, write: (n) => j.append("noted", { n }), read: () => (j.read() ?? []).map((l) => l?.n) }))(m.mission.createJournal(ioOf(m), join(root, "mission"), SPEC)),
};

// A killed process's leftovers: the fragment, straight onto the file, with no end.
const torn = (file, text, n) => (mkdirSync(dirname(file), { recursive: true }), appendFileSync(file, text), n);

const wrote = (store, k, n) => Array.from({ length: k }, (_, j) => n + j + 1).reduce((_, x) => (store.write(`r${x}`), x), n);

function played(store, plan) {
  plan.reduce((n, step) => (typeof step.tear === "string" ? torn(store.file, step.tear, n) : wrote(store, step.write, n)), 0);
  return store.read();
}

const numberOf = (v) => (typeof v === "string" && /^r[1-9]\d*$/.test(v) ? Number(v.slice(1)) : null);

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

const inOrder = (list) => list.every((x, i) => i === 0 || x > list[i - 1]);

function idsOf(read, total) {
  const numbers = read.map(numberOf);
  const kept = numbers.filter((x) => x !== null && x <= total);
  return [...kept.map((x) => `kept:${x}`), ...range(total).filter((x) => !kept.includes(x)).map((x) => `lost:${x}`), ...(numbers.some((x) => x === null || x > total) ? ["foreign"] : []), inOrder(kept) ? "order:kept" : "order:broken"];
}

const writtenBy = (plan) => plan.reduce((n, step) => n + (step.write ?? 0), 0);

function journaled(m, i) {
  const root = mkdtempSync(join(tmpdir(), "orbit-probe-journal-"));
  try { return idsOf(played(STORES[i.store](m, root), i.plan), writtenBy(i.plan)); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

const CALLS = { journal: journaled };

const answered = (m, i) => {
  try { return { id: i.id, got: CALLS[i.call](m, i) }; }
  catch (e) { return { id: i.id, threw: String(e?.message ?? e).slice(0, 200) }; }
};

function inputsOf(text) {
  try { return JSON.parse(text).inputs.filter((i) => Object.hasOwn(CALLS, i?.call) && Object.hasOwn(STORES, i?.store) && Array.isArray(i?.plan)); }
  catch { return null; }
}

async function main() {
  const inputs = inputsOf(await stdin());
  const m = inputs ? await loaded(process.argv[2]) : { error: { code: "INPUT", message: "the inputs could not be read" } };
  process.stdout.write(`${JSON.stringify(m.error ? { error: m.error } : { answers: inputs.map((i) => answered(m, i)) })}\n`);
}

main();
