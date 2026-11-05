// THE PROBE of a memory-first case: the one piece of the verifier that runs the SUBJECT's code. It is handed the
// subject's root as its argument and the inputs on stdin. For every input it makes a small git checkout of its own under
// the temporary directory, an architecture store beside it, and LOOKS at the checkout through the subject's own
// `architecture ensure`: every git call the subject makes is counted on the way out, every file it reads is named, the
// store's bytes are compared before and after each look, and each look is timed. It judges nothing -- what a look
// should have come to is computed elsewhere, by a judge that never imports the subject -- so whatever the subject's code
// does in this process, it can only change its own answers. Every checkout lives in a fresh directory, removed when its
// plan is played.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: "looks", tree: { <rel>: <text> }, plan: [step] }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
//
//   step   { look: [arg] }      one look: `architecture ensure` with those arguments
//          { again: n }         n looks in a row with nothing changed between them, said as ONE look: the first one's
//                               facts, the best of the n's times, and "<k>:unsteady" when they did not all agree
//          { commit: <rel> }    the file changed -- a JSON object keeps parsing, anything else gains a line, a file the
//                               tree does not hold is added -- and committed alone: an earlier edit stays uncommitted
//          { edit: <rel> }      the same change, left uncommitted
//          { settle: true }     whatever is left uncommitted, committed as it is
//   ->     per look k (1, 2, …, in the order the plan looks):
//          "<k>:<DECISION>"              what the look said it decided (the first line it printed)
//          "<k>:reads:<n>"               how many files it read -- a `git show` of one path each
//          "<k>:read:<path>"             each of them
//          "<k>:listing:<n>"             how often it listed the tree (`ls-files` without its index entries)
//          "<k>:search:<n>"              how often it searched the index (`grep`)
//          "<k>:index:<n>"               how often it asked for the index's entries (`ls-files -s`: a fingerprint)
//          "<k>:calls:<n>"               every git call it made
//          "<k>:store:same" | "<k>:store:changed"    the architecture store's bytes after the look, against before it
//          "ms:<k>:<milliseconds>"       how long the look took, measured here
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = {
  view: ["src/architecture/views/ensure.mjs", ["ensure"]],
  store: ["src/architecture/store.mjs", ["createArchitecture"]],
  tree: ["src/frontend/composite.mjs", ["createSourceTree"]],
  io: ["src/store/io.mjs", ["realIo"]],
};

const NOW = "2026-11-05T00:00:00.000Z";

// Every git this process runs -- the probe's own and the subject's -- with no configuration of the machine's.
Object.assign(process.env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "probe", GIT_AUTHOR_EMAIL: "probe@orbit.invalid", GIT_COMMITTER_NAME: "probe", GIT_COMMITTER_EMAIL: "probe@orbit.invalid" });

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

// ---- the checkout: made, changed and committed by the probe's own git, which is never counted ------------------------

const git = (repo, args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });

const written = (repo, rel, text) => (mkdirSync(dirname(join(repo, rel)), { recursive: true }), writeFileSync(join(repo, rel), text));

function checkoutOf(root, tree) {
  const repo = join(root, "repo");
  Object.entries(tree).forEach(([rel, text]) => written(repo, rel, text));
  for (const a of [["init", "-q"], ["add", "-A"], ["commit", "-qm", "the tree"]]) git(repo, a);
  return repo;
}

function objectOf(text) {
  try { return ((v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null))(JSON.parse(text)); }
  catch { return null; }
}

const textAt = (repo, rel) => (existsSync(join(repo, rel)) ? readFileSync(join(repo, rel), "utf8") : null);

const changedText = (text) => ((j) => (j ? `${JSON.stringify({ ...j, probeChange: (j.probeChange ?? 0) + 1 })}\n` : `${text ?? ""}a change the probe made\n`))(text === null ? null : objectOf(text));

// A commit of what `paths` names (`.`: everything left uncommitted) -- and of nothing else, so an edit the plan left
// uncommitted stays uncommitted.
const committed = (w, why, paths) => (git(w.repo, ["add", "--", ...paths]), git(w.repo, ["commit", "-q", "--allow-empty", "-m", why]), []);

function changed(w, rel, commit) {
  written(w.repo, rel, changedText(textAt(w.repo, rel)));
  return commit ? committed(w, `a change to ${rel}`, [rel]) : [];
}

// ---- one look, measured -------------------------------------------------------------------------------------------------

// Every git call the subject makes, counted on the way out: its arguments after `-C <root>`.
function counterOf() {
  const calls = [];
  return { calls, exec: (file, args, o) => (calls.push(args.slice(2)), execFileSync(file, args, o)) };
}

const filesUnder = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((rel) => statSync(join(dir, rel)).isFile()).sort() : []);

const storeDigest = (dir) => createHash("sha256").update(filesUnder(dir).map((rel) => `${rel}\u0000${readFileSync(join(dir, rel)).toString("base64")}`).join("\n")).digest("hex");

// What the look printed, kept here and never on this process's stdout, where the probe's one line goes.
function quietly(fn) {
  const said = [];
  const log = console.log;
  console.log = (...a) => said.push(a.join(" "));
  try { fn(); } finally { console.log = log; }
  return said;
}

const decisionOf = (said) => /^ARCHITECTURE ([A-Z_]+)/.exec(String(said[0] ?? "").trim())?.[1] ?? "SILENT";

function looked(w, args) {
  const before = (w.counter.calls.splice(0), storeDigest(w.store));
  const t0 = performance.now();
  const said = quietly(() => w.m.view.ensure(w.ctx, args));
  return { decision: decisionOf(said), ms: performance.now() - t0, calls: w.counter.calls.splice(0), store: before === storeDigest(w.store) ? "same" : "changed" };
}

// A git call by what it is: a read of one file, a search of the index, the index's entries, a listing of the tree.
const KIND = [
  { kind: "read", when: (a) => a[0] === "show" },
  { kind: "search", when: (a) => a[0] === "grep" },
  { kind: "index", when: (a) => a[0] === "ls-files" && a.includes("-s") },
  { kind: "listing", when: (a) => a[0] === "ls-files" },
  { kind: "other", when: () => true },
];

const kindOf = (a) => KIND.find((r) => r.when(a)).kind;

const shownPath = (a) => /^(?:HEAD|:0):(.*)$/.exec(String(a[1] ?? ""))?.[1] ?? String(a[1] ?? "");

const counted = (calls, kind) => calls.filter((a) => kindOf(a) === kind).length;

const factsOf = (k, l) => [`${k}:${l.decision}`, `${k}:reads:${counted(l.calls, "read")}`, ...l.calls.filter((a) => kindOf(a) === "read").map((a) => `${k}:read:${shownPath(a)}`), ...["listing", "search", "index"].map((x) => `${k}:${x}:${counted(l.calls, x)}`), `${k}:calls:${l.calls.length}`, `${k}:store:${l.store}`];

const idsOf = (k, l) => [...new Set([...factsOf(k, l), ...(l.unsteady ? [`${k}:unsteady`] : []), `ms:${k}:${Math.round(l.ms * 1000) / 1000}`])];

// n looks with nothing between them, said as one: the first one's facts, the best time, and whether they agreed.
function again(w, n) {
  const looks = Array.from({ length: Math.max(1, n) }, () => looked(w, []));
  const same = looks.every((l) => JSON.stringify(factsOf(0, l)) === JSON.stringify(factsOf(0, looks[0])));
  return [{ ...looks[0], ms: Math.min(...looks.map((l) => l.ms)), unsteady: !same }];
}

const STEPS = {
  look: (w, s) => [looked(w, Array.isArray(s.look) ? s.look : [])],
  again: (w, s) => again(w, Number(s.again) || 1),
  commit: (w, s) => changed(w, s.commit, true),
  edit: (w, s) => changed(w, s.edit, false),
  settle: (w) => committed(w, "what was left uncommitted", ["."]),
};

const stepOf = (s) => Object.keys(STEPS).find((k) => Object.hasOwn(s ?? {}, k));

// ---- one input: a checkout of its own, its plan played, its looks said as ids -------------------------------------------

function worldOf(m, root, tree) {
  const repo = checkoutOf(root, tree);
  const counter = counterOf();
  const store = join(root, "store");
  const ctx = { arch: m.store.createArchitecture(store, m.io.realIo({ host: "probe", now: () => NOW })), source: m.tree.createSourceTree([repo], counter.exec), config: {}, project: { layout: 3, root: repo }, now: () => NOW };
  return { m, ctx, counter, store, repo };
}

function played(m, i) {
  const root = mkdtempSync(join(tmpdir(), "orbit-probe-memory-"));
  try { return ((w) => i.plan.flatMap((s) => STEPS[stepOf(s)](w, s)))(worldOf(m, root, i.tree)).flatMap((l, n) => idsOf(n + 1, l)); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

const CALLS = { looks: played };

const answered = (m, i) => {
  try { return { id: i.id, got: CALLS[i.call](m, i) }; }
  catch (e) { return { id: i.id, threw: String(e?.message ?? e).slice(0, 200) }; }
};

const planned = (i) => Array.isArray(i?.plan) && i.plan.every((s) => stepOf(s)) && i.tree && typeof i.tree === "object";

function inputsOf(text) {
  try { return JSON.parse(text).inputs.filter((i) => Object.hasOwn(CALLS, i?.call) && planned(i)); }
  catch { return null; }
}

async function main() {
  const inputs = inputsOf(await stdin());
  const m = inputs ? await loaded(process.argv[2]) : { error: { code: "INPUT", message: "the inputs could not be read" } };
  process.stdout.write(`${JSON.stringify(m.error ? { error: m.error } : { answers: inputs.map((i) => answered(m, i)) })}\n`);
}

main();
