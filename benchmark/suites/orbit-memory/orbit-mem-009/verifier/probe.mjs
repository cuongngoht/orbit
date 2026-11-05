// THE PROBE of a knowledge-recall case: the one piece of the verifier that runs the SUBJECT's code. It is handed the
// subject's root as its argument and the inputs on stdin. For every input it makes a small git checkout of its own under
// the temporary directory and a knowledge store beside it, records the input's claims through the subject's own one door
// (`ingest`), and then RECALLS them through the subject's own `knowledge claims` view: every git call the recall makes
// is counted on the way out, every file it reads is named, the store's bytes are compared before and after each recall,
// and each recall is timed. It judges nothing -- what a recall should have come to is computed elsewhere, by a judge
// that never imports the subject -- so whatever the subject's code does in this process, it can only change its own
// answers. Every checkout lives in a fresh directory, removed when its plan is played.
//
//   node probe.mjs <subject-root>   < { "inputs": [{ id, call: "recall", tree: { <rel>: <text> },
//                                                     claims: [{ subject, scope }], plan: [step] }] }
//   -> { "answers": [{ id, got } | { id, threw }] }  |  { "error": { code: IMPORT | MISSING_EXPORT | INPUT, … } }
//
//   claim  { subject, scope }   recorded before the plan, through `ingest`: `<subject> holds behaviour`, observed in
//                               the repository, its evidence the first file of the tree under its scope
//   step   { recall: true }     one recall: `knowledge claims --subject=<every claim's subject> --json`
//          { commit: <rel> }    the file changed -- a JSON object keeps parsing, anything else gains a line, a file the
//                               tree does not hold is added -- and committed alone: an earlier edit stays uncommitted
//          { edit: <rel> }      the same change, left uncommitted
//          { settle: true }     whatever is left uncommitted, committed as it is
//   ->     per recall k (1, 2, …):
//          "<k>:claim:<subject>:<fresh|stale|unknown|…>"   each claim's freshness as the recall MEASURED it (`unseen`
//                                                           when the recall did not show the claim at all)
//          "<k>:reads:<n>" · "<k>:read:<path>" · "<k>:listing:<n>" · "<k>:search:<n>" · "<k>:index:<n>"
//          "<k>:calls:<n>" · "<k>:store:same" | "<k>:store:changed" · "ms:<k>:<milliseconds>"   as the architecture
//                                                           probes count them
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = {
  view: ["src/knowledge/views/claims.mjs", ["claims"]],
  ingest: ["src/knowledge/ingest.mjs", ["ingest"]],
  store: ["src/knowledge/store.mjs", ["createKnowledge"]],
  parts: ["src/extensions/knowledge-parts.mjs", ["createKnowledgeParts"]],
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

// ---- the claims, recorded through the subject's own door --------------------------------------------------------------

const under = (rel, scope) => rel === scope || rel.startsWith(`${scope}/`);

const candidateOf = (c, tree) => ({ subject: c.subject, relation: "holds", object: "behaviour", evidence: [Object.keys(tree).sort().find((rel) => under(rel, c.scope)) ?? c.scope], scope: [c.scope], source: "repository", strength: "observed" });

const recorded = (w, claims, tree) => w.m.ingest.ingest(w.ctx, claims.map((c) => candidateOf(c, tree)), { seenBy: { host: "probe", at: NOW } });

// ---- one recall, measured -----------------------------------------------------------------------------------------------

function counterOf() {
  const calls = [];
  return { calls, exec: (file, args, o) => (calls.push(args.slice(2)), execFileSync(file, args, o)) };
}

const filesUnder = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((rel) => statSync(join(dir, rel)).isFile()).sort() : []);

const storeDigest = (dir) => createHash("sha256").update(filesUnder(dir).map((rel) => `${rel}\u0000${readFileSync(join(dir, rel)).toString("base64")}`).join("\n")).digest("hex");

// What the recall printed, kept here and never on this process's stdout, where the probe's one line goes.
function quietly(fn) {
  const said = [];
  const log = console.log;
  console.log = (...a) => said.push(a.join(" "));
  try { fn(); } finally { console.log = log; }
  return said;
}

function parsed(text) {
  try { return JSON.parse(text); }
  catch { return null; }
}

// Each claim's freshness as the recall measured it, by subject: every row it shows -- what prevails, its rivals, what
// holds only in another context.
const shownOf = (json) => Object.fromEntries((json?.answers ?? []).flatMap((a) => [...(a.prevails ?? []), ...(a.rivals ?? []), ...(a.conditional ?? [])].map((r) => [a.subject, r.measured])));

function recalled(w, subjects) {
  const before = (w.counter.calls.splice(0), storeDigest(w.store));
  const t0 = performance.now();
  const said = quietly(() => w.m.view.claims(w.ctx, [`--subject=${subjects.join(",")}`, "--json"]));
  return { shown: shownOf(parsed(said.join("\n"))), subjects, ms: performance.now() - t0, calls: w.counter.calls.splice(0), store: before === storeDigest(w.store) ? "same" : "changed" };
}

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

const idsOf = (k, l) => [...l.subjects.map((s) => `${k}:claim:${s}:${l.shown[s] ?? "unseen"}`), `${k}:reads:${counted(l.calls, "read")}`, ...l.calls.filter((a) => kindOf(a) === "read").map((a) => `${k}:read:${shownPath(a)}`), ...["listing", "search", "index"].map((x) => `${k}:${x}:${counted(l.calls, x)}`), `${k}:calls:${l.calls.length}`, `${k}:store:${l.store}`, `ms:${k}:${Math.round(l.ms * 1000) / 1000}`];

const STEPS = {
  recall: (w, s, i) => [recalled(w, i.claims.map((c) => c.subject))],
  commit: (w, s) => changed(w, s.commit, true),
  edit: (w, s) => changed(w, s.edit, false),
  settle: (w) => committed(w, "what was left uncommitted", ["."]),
};

const stepOf = (s) => Object.keys(STEPS).find((k) => Object.hasOwn(s ?? {}, k));

// ---- one input: a checkout of its own, its claims recorded, its plan played, its recalls said as ids --------------------

function worldOf(m, root, i) {
  const repo = checkoutOf(root, i.tree);
  const counter = counterOf();
  const store = join(root, "store");
  const ctx = { know: m.store.createKnowledge(store, m.io.realIo({ host: "probe", now: () => NOW })), source: m.tree.createSourceTree([repo], counter.exec), parts: m.parts.createKnowledgeParts(), now: () => NOW, notes: [] };
  return ((w) => (recorded(w, i.claims, i.tree), w))({ m, ctx, counter, store, repo });
}

function played(m, i) {
  const root = mkdtempSync(join(tmpdir(), "orbit-probe-recall-"));
  try { return ((w) => i.plan.flatMap((s) => STEPS[stepOf(s)](w, s, i)))(worldOf(m, root, i)).flatMap((l, n) => idsOf(n + 1, l)); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

const CALLS = { recall: played };

const answered = (m, i) => {
  try { return { id: i.id, got: CALLS[i.call](m, i) }; }
  catch (e) { return { id: i.id, threw: String(e?.message ?? e).slice(0, 200) }; }
};

const planned = (i) => Array.isArray(i?.plan) && i.plan.every((s) => stepOf(s)) && i.tree && typeof i.tree === "object" && Array.isArray(i.claims);

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
