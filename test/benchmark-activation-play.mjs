// What the activation suite's Docker-free tests share: a case's CONTROL played the way its runner would play it, outside any
// container -- the case's target checked out with its variant and its origin, its seed laid in by the scripted seed, the
// control's scripted host delivering every hook to Orbit's own entry points and running Orbit's own CLIs, the real
// inspect.mjs reading back what it left -- and the hidden checks of an outcome case run by the case's own probe over what
// was delivered (its gates are the verifier's containers' to run: test/benchmark-activation-flow.test.mjs runs them
// through the Docker double). Then the case's truth and the activation judge decide. Nothing here is Docker, a network
// or a model. It is harness (test/benchmark-*.mjs): never part of a subject, and it runs nothing when a test runner loads it.
//
//   targetOf(t, c) -> at { base, repo, store, out, origin, env, entries }      seededAt(c, at) -> seed document | null
//   playedAt(c, k, at) -> { text, problems }          inspectedAt(at) -> the inspection's documents, as round.mjs reads them
//   judgedPlay(t, c, k) -> { judged, facts, at, play, seed, ins }
//   briefPlayed(brief, o) -> { text, problems }       a round's brief, played as the runner's entry plays its scripted host
//   asContained(at, text) -> the stream as a host in the run's containers prints it        inspectorRan(o) -> exit
//   playedApart(c, k) -> Promise<{ verdict, class, row, why, agreement, problems }>   one control judged in a process of
//                                                       its own (`node test/benchmark-activation-play.mjs <case> <control>`)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { fixtureEntries, ORIGIN_OF, variantEntries } from "../benchmark/lib/core/context.mjs";
import { activationTruthOf, casesOf } from "../benchmark/lib/core/suites.mjs";
import { deliveredOf, factsFrom } from "../benchmark/lib/activation/flow.mjs";
import { judgedActivation } from "../benchmark/lib/activation/judge.mjs";
import { INSPECTED, PLUGIN_AT, REPO_AT, requestOf, scriptOf } from "../benchmark/lib/activation/round.mjs";
import { seedBriefOf } from "../benchmark/lib/activation/seed.mjs";
import { judgedAll, probeInput } from "../benchmark/lib/source/judge.mjs";
import { SCRIPTS, stateOf } from "../benchmark/images/runner/scripted.mjs";
import { shaBytes } from "../src/hash.mjs";
import { GIT_ENV, ROOT } from "./benchmark-double.mjs";
import { sealed } from "./home.mjs";

const FIXTURES = "benchmark/fixtures";

const filesUnder = (dir) => readdirSync(dir, { recursive: true }).filter((rel) => statSync(join(dir, rel)).isFile()).map((rel) => rel.split(sep).join("/"));

// The fixture as frozen entries carry it (`benchmark/fixtures/<id>/…`), read from this checkout.
const frozenFixture = (id) => filesUnder(join(ROOT, FIXTURES, id)).map((rel) => ((bytes) => ({ rel: `${FIXTURES}/${id}/${rel}`, mode: "file", bytes, digest: shaBytes(bytes) }))(readFileSync(join(ROOT, FIXTURES, id, rel))));

const NONE = [{ rel: "README.md", mode: "file", bytes: Buffer.from("A new project. Nothing is here yet.\n"), digest: "" }];

// The target a run of the case hands its host: the fixture with the variant applied -- or the empty project.
export const entriesOf = (c) => (c.fixture.id === "none" ? NONE : variantEntries({ ...c, kind: "engineering", fixture: c.fixture.id }, "real", fixtureEntries({ ...c, fixture: c.fixture.id }, frozenFixture(c.fixture.id))).entries);

const git = (cwd, env, ...a) => spawnSync("git", a, { cwd, env, encoding: "utf8" });

// A checkout of the target as the run makes one: its files, one commit, and the origin its identity is keyed by.
function checkedOut(at, dir) {
  for (const e of at.entries) (mkdirSync(dirname(join(dir, e.rel)), { recursive: true }), writeFileSync(join(dir, e.rel), e.bytes));
  [["init", "-q", "--initial-branch=subject"], ["add", "-A", "-f"], ["commit", "-q", "-m", "target"], ["remote", "add", "origin", at.origin]].forEach((a) => git(dir, at.env, ...a));
  return dir;
}

export function targetOf(t, c) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-act-play-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const at = { base, repo: join(base, "repo"), store: join(base, "store"), out: join(base, "out"), origin: ORIGIN_OF(c), env: sealed({ ...GIT_ENV, ORBIT_STORE_DIR: join(base, "store") }), entries: entriesOf(c) };
  return (mkdirSync(at.out, { recursive: true }), checkedOut(at, at.repo), at);
}

const jsonAt = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

// ---- a round's brief, played as the runner's entry plays its scripted host -------------------------------------------------

const initOf = (s) => ({ type: "system", subtype: "init", model: `scripted:${s.script.id ?? "unnamed"}`, session_id: s.session ?? `scripted-${s.task ?? "goal"}`, claude_code_version: null });

const endOf = (s, problems) => ({ type: "result", subtype: problems.length ? "error_during_execution" : "success", is_error: problems.length > 0, num_turns: s.steps.length, total_cost_usd: 0, result: problems.join("; ").slice(0, 300) || "the script ran to its end" });

// A seed's steps name the checkout where its container mounts it; here it is wherever the test put it.
const located = (script, repo) => ({ ...script, steps: script.steps?.map((st) => (Array.isArray(st.argv) ? { ...st, argv: st.argv.map((a) => (a === REPO_AT ? repo : a)) } : st)) });

// o: { plugin: this checkout's Orbit, repo, env, out, seed } -- the paths the brief's container would have had. A brief
// that names no plugin (the arm with no Orbit) is played with none.
export function briefPlayed(brief, o) {
  const events = [];
  const b = { ...brief, plugin: brief.plugin ? o.plugin : null, script: located(brief.script ?? {}, o.repo) };
  const s = { ...stateOf(b, "-"), repo: o.repo, env: o.env, say: (e) => events.push(e), out: o.out, seed: o.seed ?? null };
  const problems = (events.push(initOf(s)), SCRIPTS[s.script.mode](s));
  return { problems, text: [...events, endOf(s, problems)].map((e) => JSON.stringify(e)).join("\n") };
}

// The stream as a host in the run's containers prints it: Orbit at /work/orbit, the target at /work/repo, the store at
// /work/store -- where a test put them is this machine's, never the run's.
export const asContained = (at, text) => [[at.plugin ?? ROOT, PLUGIN_AT], [at.repo, REPO_AT], [at.store, "/work/store"]].reduce((t, [from, to]) => t.split(from).join(to), text);

// ---- a control, played -----------------------------------------------------------------------------------------------------

const asRun = (c, k) => ({ case: c, frozenCase: c.dir, host: k ? `scripted:${k.id}` : null });

// The control's round as round.mjs briefs it: its script as the case declares it, and the prompt verbatim.
const briefOf = (c, k) => ((ctx) => ({ kind: "activation", round: 1, host: ctx.host, arm: "release", plugin: PLUGIN_AT, script: scriptOf(ctx), prompt: requestOf(ctx) }))(asRun(c, k));

// The seed laid in as the seed round lays it: the case's steps through Orbit's own CLIs, its files where Orbit says.
export function seededAt(c, at) {
  if (!c.seed) return null;
  briefPlayed(seedBriefOf(asRun(c, null)), { plugin: ROOT, repo: at.repo, env: at.env, out: at.out, seed: c.seed.files ? join(c.dir, c.seed.files) : null });
  return jsonAt(join(at.out, "seed.json"));
}

// The control's scripted host, its stream kept as Claude Code prints it.
export const playedAt = (c, k, at) => ((r) => ({ ...r, text: asContained(at, r.text) }))(briefPlayed(briefOf(c, k), { plugin: ROOT, repo: at.repo, env: { ...at.env, ...(c.switches ?? {}) }, out: at.out }));

// ---- the inspection --------------------------------------------------------------------------------------------------------

// The real inspect.mjs, its paths named by its environment: the frozen target (where the host's was: a checkout is known by
// its path, as /work/repo is in both containers), the store, the target as the host left it, this checkout's Orbit.
// o: { repo, store, out, tree, env }
export const inspectorRan = (o) => spawnSync(process.execPath, [join(ROOT, "benchmark", "images", "runner", "inspect.mjs"), "-", "--activation"], { cwd: o.repo, env: { ...o.env, ORBIT_STORE_DIR: o.store, ORBIT_BENCH_REPO: o.repo, ORBIT_BENCH_STORE: o.store, ORBIT_BENCH_OUT: o.out, ORBIT_BENCH_PLUGIN: ROOT, ORBIT_BENCH_TREE: o.tree }, encoding: "utf8", timeout: 300000 }).status;

// The host's checkout moved beside the frozen one put where it was -- as the run mounts them at /work/worktree and /work/repo.
function frozenInPlace(at) {
  const tree = join(at.base, "worktree");
  renameSync(at.repo, tree);
  return (checkedOut(at, at.repo), tree);
}

export function inspectedAt(at) {
  const out = join(at.base, "inspect");
  const exit = inspectorRan({ repo: at.repo, store: at.store, out: (mkdirSync(out, { recursive: true }), out), tree: frozenInPlace(at), env: at.env });
  return { end: `EXIT_${exit}`, refused: null, dir: out, ...Object.fromEntries(INSPECTED.map((n) => [n, jsonAt(join(out, `${n}.json`))])) };
}

// ---- an outcome case's hidden checks ---------------------------------------------------------------------------------------

const spec = async (c) => import(pathToFileURL(join(c.dir, c.acceptance.spec)).href);

const entriesIn = (dir, rel) => ((bytes) => ({ rel, mode: "file", bytes, digest: shaBytes(bytes) }))(readFileSync(join(dir, rel)));

// What was delivered, as the target it leaves: the frozen target with the delivered changes laid over it.
function deliveredTree(at, ins) {
  const d = deliveredOf(ins);
  const changed = new Map(d.changes.filter((x) => x.change !== "deleted").map((x) => [x.rel, entriesIn(d.dir, x.rel)]));
  const gone = new Set(d.changes.filter((x) => x.change === "deleted").map((x) => x.rel));
  return { d, entries: [...at.entries.filter((e) => !changed.has(e.rel) && !gone.has(e.rel)), ...changed.values()] };
}

function treeDir(at, entries) {
  const dir = mkdtempSync(join(at.base, "tree-"));
  for (const e of entries) (mkdirSync(dirname(join(dir, e.rel)), { recursive: true }), writeFileSync(join(dir, e.rel), e.bytes));
  return dir;
}

// The case's own probe over what was delivered, judged by its own spec.
async function outcomeAt(c, at, ins) {
  const sp = await spec(c);
  const t = deliveredTree(at, ins);
  const cases = sp.cases(4242, c.acceptance.samples);
  const r = spawnSync(process.execPath, [join(c.dir, c.acceptance.probe), treeDir(at, t.entries)], { input: probeInput(cases), env: sealed(), encoding: "utf8", timeout: 120000 });
  return ((j) => ({ delivered: t.d.by, changes: t.d.changes.length, complete: !j.error, held: !j.error && j.checks.every((x) => x.ok) && t.d.changes.length > 0, failing: [...new Set(j.checks.filter((x) => !x.ok).map((x) => x.group))], problem: null, problemEnds: [], says: "the probe, run here over what was delivered" }))(judgedAll(cases, r.stdout, sp));
}

// ---- a control, judged -----------------------------------------------------------------------------------------------------

export async function judgedPlay(t, c, k) {
  const at = targetOf(t, c);
  const seed = seededAt(c, at);
  const play = playedAt(c, k, at);
  const ins = inspectedAt(at);
  const cand = c.acceptance.spec ? { outcome: await outcomeAt(c, at, ins) } : null;
  const facts = factsFrom({ c, truth: activationTruthOf(c), arm: "release", switches: c.switches, text: play.text, host: {}, ins, seed, cand, entries: at.entries });
  return { judged: judgedActivation(facts), facts, at, play, seed, ins };
}

// ---- a control, judged in a process of its own ----------------------------------------------------------------------------
//
// Every play waits on Orbit's own processes, one after another, so plays in one process never overlap: a test that plays
// a suite's controls plays each in a process of its own, a few at a time. The program prints the judge's word, one line.

const SELF = import.meta.filename;

const childEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT"));

const lastJson = (text) => JSON.parse(String(text).trim().split("\n").at(-1) || "null");

export const playedApart = (c, k) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [SELF, c.id, k.id], { env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
  const out = [];
  const err = [];
  p.stdout.on("data", (d) => out.push(d));
  p.stderr.on("data", (d) => err.push(d));
  p.on("close", (code) => (code === 0 ? resolve(lastJson(Buffer.concat(out))) : reject(new Error(`${c.id} ${k.id} ended ${code}: ${Buffer.concat(err).toString().slice(-2000)}`))));
});

async function playedHere([caseId, controlId]) {
  const c = casesOf(ROOT, "orbit-activation").find((x) => x.id === caseId);
  const after = [];
  try {
    const r = await judgedPlay({ after: (fn) => after.push(fn) }, c, c.controls.find((k) => k.id === controlId));
    process.stdout.write(`${JSON.stringify({ verdict: r.judged.verdict, class: r.judged.class, row: r.judged.row, why: r.judged.why, agreement: r.judged.agreement.verdict, problems: r.play.problems })}\n`);
  } finally {
    after.forEach((fn) => fn());
  }
}

// A program only when it is named a case and a control: `node --test` runs every module under test/ as a test file, and
// this one is harness -- loaded that way, it runs nothing.
if (process.argv[1] === SELF && process.argv.length === 4 && !process.env.NODE_TEST_CONTEXT) await playedHere(process.argv.slice(2));
