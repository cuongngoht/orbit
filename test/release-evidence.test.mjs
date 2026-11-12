// The release gate (ADR 0057): the release artifact read from a real `git archive` -- what a host refuses, asked of
// the archive itself, and a content digest two archives of one shipped tree share; the fast tier's word; and the publish
// gate (`ship.mjs --evidence --evaluation=<record>`), each PUBLISH row reached on its own, in order, over fixture records
// and a git repository of the test's own -- a record whose candidate commit differs from HEAD only in an export-ignored
// path holds, and any other difference voids it. Last, the evaluator's own `record` command (spawned, never imported:
// the evaluator is a package of its own) makes a record from campaign rooms, and the gate holds it.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { ARCHIVE_RULES, archiveOf, artifactOf, contentDigest, entriesOf } from "../skills/orbit-release/ship/artifact.mjs";
import { AWAITED, ciVerdict, markOf } from "../skills/orbit-release/ship/ci.mjs";
import { candidateArms, comparisonsOf, expectedRuns, factsOf, heldOutTasks, overallOf, PUBLISH, publishableOf, RECORD_KIND, saidEvidence } from "../skills/orbit-release/ship/evidence.mjs";
import { gateEnvOf, gitAt } from "../skills/orbit-release/ship/ports.mjs";
import { canonicalJson, sha as shaOf } from "../src/hash.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(import.meta.dirname, "..");
const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@orbit.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@orbit.invalid" };
const PREREG_REL = "evaluator/prereg/0.6.0.json";
const PREREG_TEXT = readFileSync(join(ROOT, PREREG_REL), "utf8");
const P = JSON.parse(PREREG_TEXT);
const HELD = heldOutTasks(P);

const sha = (text) => shaOf(canonicalJson(JSON.parse(text)));

const git = (cwd, ...a) => execFileSync("git", a, { cwd, env: sealed(GIT_ENV), encoding: "utf8" }).trim();

function repoWith(t, files, links = {}) {
  const repo = mkdtempSync(join(tmpdir(), "orbit-release-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) (mkdirSync(dirname(join(repo, rel)), { recursive: true }), writeFileSync(join(repo, rel), text));
  for (const [rel, target] of Object.entries(links)) symlinkSync(target, join(repo, rel));
  for (const a of [["init", "-q"], ["add", "-A"], ["commit", "-qm", "one"]]) git(repo, ...a);
  return repo;
}

const commitOf = (repo, files, says) => {
  for (const [rel, text] of Object.entries(files)) (mkdirSync(dirname(join(repo, rel)), { recursive: true }), writeFileSync(join(repo, rel), text));
  for (const a of [["add", "-A"], ["commit", "-qm", says]]) git(repo, ...a);
  return git(repo, "rev-parse", "HEAD");
};

const archived = (repo, ref = "HEAD") => archiveOf(gitAt(repo, sealed(GIT_ENV)), ref);

const refused = (buf) => ARCHIVE_RULES.filter((r) => r.fails(entriesOf(buf))).map((r) => r.says.split(" -- ")[0]);

// ---- the artifact ----------------------------------------------------------------------------------------------------------

test("the release artifact is held to what a host refuses on the ARCHIVE: a symlink, a bin/, tooling export-ignore should keep out", (t) => {
  const links = process.platform === "win32" ? {} : { link: "src/a.mjs" };
  const FILES = { ".claude-plugin/plugin.json": "{}\n", "src/a.mjs": "export const a = 1;\n", ".gitattributes": "/acceptance/** export-ignore\n/evaluator export-ignore\n/evaluator/** export-ignore\n/link export-ignore\n", "acceptance/run.mjs": "// tooling\n", "evaluator/cli.mjs": "// the independent evaluator\n" };
  const ok = repoWith(t, FILES, links);
  assert.deepEqual(refused(archived(ok)), [], "export-ignore kept the tooling and the link out");
  assert.ok(entriesOf(archived(ok)).some((e) => e.name === ".claude-plugin/plugin.json"));
  const bad = repoWith(t, { ...FILES, ".gitattributes": "", "bin/orbit": "#!/bin/sh\n" }, links);
  assert.deepEqual(refused(archived(bad)), ["a top-level bin/", ...(process.platform === "win32" ? [] : ["a symbolic link"]), "a file of development tooling that never ships (acceptance/, integrations/, evaluator/)"]);
  const evaluatorShipped = repoWith(t, { ...FILES, ".gitattributes": "/acceptance/** export-ignore\n/link export-ignore\n" }, links);
  assert.deepEqual(refused(archived(evaluatorShipped)), ["a file of development tooling that never ships (acceptance/, integrations/, evaluator/)"], "the evaluator holds hidden tests and gold patches: an archive that carries it is refused");
  assert.deepEqual(refused(archived(repoWith(t, { "src/a.mjs": "1\n" }))), ["no .claude-plugin/plugin.json at the archive's root"]);
});

test("two archives of one shipped tree share their content digest, whatever commit they came from; an export-ignored change keeps it, another tree does not", (t) => {
  const repo = repoWith(t, { ".claude-plugin/plugin.json": "{}\n", "src/a.mjs": "export const a = 1;\n", ".gitattributes": "/evaluator export-ignore\n/evaluator/** export-ignore\n" });
  const first = archived(repo);
  git(repo, "commit", "-q", "--allow-empty", "-m", "the same tree, another commit", "--date=2001-01-01T00:00:00");
  assert.equal(contentDigest(archived(repo)), contentDigest(first));
  commitOf(repo, { "evaluator/results/0.6.0/record.json": "{}\n" }, "an evaluation's results, export-ignored");
  assert.equal(artifactOf(archived(repo)).content, artifactOf(first).content, "what a host unpacks did not move");
  assert.notEqual(artifactOf(archived(repo)).sha256, artifactOf(first).sha256, "the bytes did: git writes the commit into the zip");
  commitOf(repo, { "src/a.mjs": "export const a = 2;\n" }, "another tree");
  assert.notEqual(contentDigest(archived(repo)), contentDigest(first));
  assert.throws(() => archived(repo, "f".repeat(40)), /could not build the archive/);
});

// ---- the fast tier ------------------------------------------------------------------------------------------------------------

test("the definition of done runs without a coding host's credential or endpoint, under any name a release session keeps it", () => {
  const env = { PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "k", CLAUDE_CODE_OAUTH_TOKEN: "t", ANTHROPIC_AUTH_TOKEN: "a", ANTHROPIC_BASE_URL: "https://api.anthropic.com", ORBIT_CODE_OAUTH_TOKEN: "o", ORBIT_EVAL_ANTHROPIC_API_KEY: "e" };
  assert.deepEqual(gateEnvOf(env), { PATH: "/bin", HOME: "/h" });
});

test("a green fast tier is never release qualification: the evaluator's record is awaited, said as wait", () => {
  assert.equal(markOf(AWAITED), "wait");
  assert.deepEqual([{ ok: true }, { ok: false, required: false }, { ok: false }].map(markOf), ["ok  ", "opt ", "FAIL"]);
  assert.match(AWAITED.detail, /node evaluator\/cli\.mjs record/);
  assert.match(AWAITED.detail, /--evidence --evaluation=/);
  assert.match(ciVerdict([{ ok: true }, AWAITED]), /release qualification is awaited/);
  assert.doesNotMatch(ciVerdict([{ ok: true }, AWAITED]), /^shippable/i);
  assert.doesNotMatch(`${AWAITED.name} ${AWAITED.detail} ${ciVerdict([AWAITED])}`, /benchmark|docker/i, "the old benchmark qualifies nothing any more");
  assert.match(ciVerdict([{ ok: false }, AWAITED]), /^NOT shippable/);
});

// ---- the publish gate: fixtures -------------------------------------------------------------------------------------------------

const FINAL = ["plain", "orbit-0.5.0", "orbit-0.6.0"];
const MINI = ["mini", "mini-orbit-0.6.0"];

// Every held-out run, each worded by `word(arm, task)`; the mini arms NOT_RUN (their credential never came).
const runsWith = (word) => [...FINAL.flatMap((arm) => HELD.map((task) => ({ campaign: "final-060", phase: "final", arm, task, trial: 1, word: word(arm, task), why: null, costUsd: 0.3, minutes: 4 }))), ...MINI.flatMap((arm) => HELD.map((task) => ({ campaign: "mini-060", phase: "mini", arm, task, trial: 1, word: "NOT_RUN", why: "credential", costUsd: null, minutes: null })))];

// The release resolves one more held-out task than either arm it is compared with: INCONCLUSIVE, said plainly.
const ONE_MORE = (arm, task) => (task === HELD[0] && arm !== "orbit-0.6.0" ? "UNRESOLVED" : "RESOLVED");

const recordWith = (commit, runs, over = {}) => ((rec) => ({ ...rec, comparisons: comparisonsOf(P, rec), ...over }))({ schema: 1, kind: RECORD_KIND, release: "0.6.0", prereg: { file: PREREG_REL, digest: sha(PREREG_TEXT) }, arms: { plain: { kind: "claude", rev: null, commit: null }, "orbit-0.5.0": { kind: "claude+orbit", rev: "v0.5.0", commit: "5".repeat(40) }, "orbit-0.6.0": { kind: "claude+orbit", rev: commit, commit }, mini: { kind: "mini", rev: null, commit: null }, "mini-orbit-0.6.0": { kind: "mini+orbit", rev: commit, commit } }, runs });

const PLUGIN = { ".claude-plugin/plugin.json": "{}\n", "src/a.mjs": "export const a = 1;\n", "package.json": "{\"version\":\"0.6.0\"}\n", ".gitattributes": "/evaluator export-ignore\n/evaluator/** export-ignore\n", [PREREG_REL]: PREREG_TEXT };

// A world where every row holds: a clean checkout, a fast tier that held, HEAD = the commit the evaluation ran.
function world(t, over = {}) {
  const repo = over.repo ?? repoWith(t, PLUGIN);
  const commit = over.commit ?? git(repo, "rev-parse", "HEAD");
  const record = over.record ?? recordWith(commit, runsWith(ONE_MORE));
  const asked = { fastTier: 0 };
  const ports = { dirty: () => [], fastTier: () => (asked.fastTier++, [{ name: "the suite", ok: true }, { name: "native host acceptance", ok: false, required: false }]), version: () => "0.6.0", recordText: () => ({ file: "record.json", text: typeof record === "string" ? record : JSON.stringify(record) }), read: (rel) => (existsSync(join(repo, rel)) ? readFileSync(join(repo, rel), "utf8") : null), archive: (rev) => archived(repo, rev), given: () => null, ...over.ports };
  return { repo, commit, record, asked, e: () => publishableOf(factsOf(ports)) };
}

const codeOf = (w) => w.e().code;

// ---- the publish gate: each row alone ---------------------------------------------------------------------------------------------

test("PUBLISHABLE: every row held -- the comparison table printed, an INCONCLUSIVE verdict said plainly as what it is", (t) => {
  const w = world(t);
  const e = w.e();
  assert.equal(e.code, "PUBLISHABLE", e.says);
  assert.equal(e.publishable, true);
  assert.deepEqual(e.comparisons.map((c) => [c.a, c.b, c.gate, c.difference, c.verdict]), [["orbit-0.6.0", "plain", true, 1, "INCONCLUSIVE"], ["orbit-0.6.0", "orbit-0.5.0", true, 1, "INCONCLUSIVE"], ["mini-orbit-0.6.0", "mini", false, 0, "INCONCLUSIVE"]]);
  assert.equal(e.verdict, "INCONCLUSIVE");
  const said = saidEvidence(e);
  assert.match(said, /orbit-0\.6\.0 against plain: 6 paired · resolved 6 \/ 5 \(\+1\) · regressed 0 \/ 0 · false done 0 \/ 0 · median cost \$0\.30 \/ \$0\.30 · median minutes 4\.0 \/ 4\.0 -> INCONCLUSIVE: too few paired tasks, or a difference smaller than the registered margin/);
  assert.match(said, /mini-orbit-0\.6\.0 against mini \(reported, not part of the verdict\): 0 paired/);
  assert.match(said, /release verdict INCONCLUSIVE: .*cannot tell the arms apart/);
  assert.equal(w.asked.fastTier, 1, "the fast tier ran, once, on this tree");
});

test("a commit that only touches export-ignored paths (the evaluator's results) keeps the evidence; any other commit voids it", (t) => {
  const w = world(t);
  commitOf(w.repo, { "evaluator/results/0.6.0/final-060/report.json": "{}\n" }, "the evaluation's results");
  assert.equal(codeOf(world(t, { repo: w.repo, commit: w.commit })), "PUBLISHABLE");
  commitOf(w.repo, { "src/a.mjs": "export const a = 2;\n" }, "a change that ships");
  const moved = world(t, { repo: w.repo, commit: w.commit }).e();
  assert.equal(moved.code, "ARTIFACT_MOVED");
  assert.match(moved.says, new RegExp(`orbit-0\\.6\\.0 ran ${w.commit.slice(0, 12)}`));
  assert.match(moved.next, /prereg campaign <phase> --rev=HEAD/);
});

test("DIRTY: a checkout with uncommitted or untracked files is refused before anything else is asked", (t) => {
  const w = world(t, { ports: { dirty: () => ["src/a.mjs", "notes.txt"] } });
  const e = w.e();
  assert.deepEqual([e.code, e.reads], ["DIRTY", "git status of this checkout"]);
  assert.match(e.says, /src\/a\.mjs, notes\.txt/);
  assert.equal(w.asked.fastTier, 0, "the fast tier is not run for a tree that is not the committed one");
});

test("FAST_TIER: a required gate that failed on this tree is refused, naming it; a reported row that did not hold never is", (t) => {
  const e = world(t, { ports: { fastTier: () => [{ name: "the suite passes", ok: false }, { name: "Five Lines", ok: true }] } }).e();
  assert.equal(e.code, "FAST_TIER");
  assert.match(e.says, /the suite passes/);
  assert.match(e.next, /ship\.mjs --ci/);
});

test("NO_RECORD: no --evaluation, a file that cannot be read, or one that is not JSON", (t) => {
  assert.match(world(t, { ports: { recordText: () => null } }).e().says, /no --evaluation/);
  assert.equal(world(t, { ports: { recordText: () => ({ file: "gone.json", text: null }) } }).e().code, "NO_RECORD");
  const e = world(t, { record: "{ half" }).e();
  assert.deepEqual([e.code, e.says], ["NO_RECORD", "record.json is not JSON"]);
  assert.match(e.next, /node evaluator\/cli\.mjs record --prereg=/);
});

test("RECORD_SHAPE: what the evaluator does not write is refused by what is wrong with it", (t) => {
  const w = world(t);
  const shaped = (over) => world(t, { repo: w.repo, record: { ...w.record, ...over } }).e();
  assert.match(shaped({ kind: "release-evidence" }).says, /kind is not orbit-evaluation-record/);
  assert.match(shaped({ prereg: { file: "../outside.json", digest: w.record.prereg.digest } }).says, /prereg names no file inside the repository/);
  assert.match(shaped({ runs: [...w.record.runs, w.record.runs[0]] }).says, /a run is listed twice/);
  assert.match(shaped({ runs: [{ ...w.record.runs[0], arm: "nobody" }] }).says, /names an arm the record does not declare/);
  assert.match(shaped({ runs: [{ ...w.record.runs[0], trial: "1" }] }).says, /runs is not a list/);
  assert.equal(world(t, { repo: w.repo, record: [] }).e().code, "RECORD_SHAPE");
});

test("OTHER_RELEASE: a record about another release than this tree's version", (t) => {
  const e = world(t, { ports: { version: () => "0.6.1" } }).e();
  assert.deepEqual([e.code, e.says], ["OTHER_RELEASE", "the record is about 0.6.0, and this tree is version 0.6.1"]);
});

test("PREREG_MOVED: the pre-registration the record names is not the committed one, or not here", (t) => {
  const w = world(t);
  const moved = world(t, { repo: w.repo, record: { ...w.record, prereg: { ...w.record.prereg, digest: "0".repeat(64) } } }).e();
  assert.equal(moved.code, "PREREG_MOVED");
  assert.match(moved.says, /is not the pre-registration the record was made under/);
  assert.equal(world(t, { repo: w.repo, ports: { read: () => null } }).e().code, "PREREG_MOVED");
});

test("ARTIFACT_REFUSED: HEAD's archive is one a host refuses", (t) => {
  const bad = repoWith(t, { ...PLUGIN, "bin/orbit": "#!/bin/sh\n" });
  const w = world(t);
  const e = world(t, { repo: w.repo, ports: { archive: (rev) => (rev === "HEAD" ? archived(bad) : archived(w.repo, rev)) } }).e();
  assert.equal(e.code, "ARTIFACT_REFUSED");
  assert.match(e.says, /a top-level bin\//);
});

test("REV_UNKNOWN: a candidate commit this repository does not hold, or a candidate arm with none", (t) => {
  const w = world(t);
  const absent = world(t, { repo: w.repo, record: recordWith("f".repeat(40), w.record.runs) }).e();
  assert.equal(absent.code, "REV_UNKNOWN");
  assert.match(absent.next, /git fetch/);
  const none = world(t, { repo: w.repo, record: { ...w.record, arms: { ...w.record.arms, "orbit-0.6.0": { kind: "claude+orbit", rev: null, commit: null } } } }).e();
  assert.match(none.says, /orbit-0\.6\.0: the record names no commit/);
  assert.deepEqual(candidateArms(P), ["orbit-0.6.0", "mini-orbit-0.6.0"], "the candidate arms are the pre-registration's own: registered with no revision");
});

test("ARTIFACT_OTHER: an archive handed with --artifact that is not what HEAD ships", (t) => {
  const other = repoWith(t, { ...PLUGIN, "src/a.mjs": "export const a = 3;\n" });
  assert.equal(world(t, { ports: { given: () => archived(other) } }).e().code, "ARTIFACT_OTHER");
  const w = world(t);
  assert.equal(world(t, { repo: w.repo, ports: { given: () => archived(w.repo) } }).e().code, "PUBLISHABLE");
});

test("INCOMPLETE: a pre-registered held-out run absent or without a word, or NOT_RUN where the verdict rests on its arm", (t) => {
  const w = world(t);
  const runs = w.record.runs;
  const without = (drop) => world(t, { repo: w.repo, record: recordWith(w.commit, runs.filter((r) => !drop(r))) }).e();
  const absent = without((r) => r.arm === "plain" && r.task === HELD[2]);
  assert.equal(absent.code, "INCOMPLETE");
  assert.match(absent.says, new RegExp(`plain on ${HELD[2]}`));
  const pending = world(t, { repo: w.repo, record: recordWith(w.commit, runs.map((r) => (r.arm === "orbit-0.6.0" && r.task === HELD[1] ? { ...r, word: "PENDING" } : r))) }).e();
  assert.match(pending.says, new RegExp(`orbit-0\\.6\\.0 on ${HELD[1]}`));
  const notRun = world(t, { repo: w.repo, record: recordWith(w.commit, runs.map((r) => (r.arm === "orbit-0.5.0" && r.task === HELD[0] ? { ...r, word: "NOT_RUN" } : r))) }).e();
  assert.match(notRun.says, new RegExp(`orbit-0\\.5\\.0 on ${HELD[0]}`), "the verdict rests on 0.5.0: it may not go unrun");
  assert.equal(without((r) => r.arm === "mini").code, "INCOMPLETE", "an arm the verdict does not rest on may be NOT_RUN, never absent");
  assert.equal(expectedRuns(P).length, HELD.length * 5);
  const infra = world(t, { repo: w.repo, record: recordWith(w.commit, runs.map((r) => (r.arm === "plain" && r.task === HELD[3] ? { ...r, word: "INFRA_ERROR" } : r))) }).e();
  assert.equal(infra.code, "PUBLISHABLE", "INFRA_ERROR is an outcome word: listed, excluded from the rates, and never owed again");
});

test("RECORD_DISAGREES: a record whose comparisons are not what its own runs say, worked out again by the registered rule", (t) => {
  const w = world(t);
  const comparisons = w.record.comparisons.map((c, i) => (i === 0 ? { ...c, verdict: "IMPROVED" } : c));
  const e = world(t, { repo: w.repo, record: { ...w.record, comparisons } }).e();
  assert.equal(e.code, "RECORD_DISAGREES");
  assert.match(e.says, /orbit-0\.6\.0 against plain/);
});

test("REGRESSED: the release resolved two fewer than the plain host -- not publishable; IMPROVED and NO_DIFFERENCE are", (t) => {
  const w = world(t);
  const worse = (arm, task) => (arm === "orbit-0.6.0" && HELD.indexOf(task) < 2 ? "UNRESOLVED" : "RESOLVED");
  const e = world(t, { repo: w.repo, record: recordWith(w.commit, runsWith(worse)) }).e();
  assert.equal(e.code, "REGRESSED");
  const regressions = (arm, task) => (arm === "orbit-0.6.0" && HELD.indexOf(task) < 2 ? "REGRESSED" : "RESOLVED");
  assert.equal(world(t, { repo: w.repo, record: recordWith(w.commit, runsWith(regressions)) }).e().code, "REGRESSED", "two regressions beyond the other arm's");
  const better = (arm, task) => (arm === "orbit-0.6.0" || HELD.indexOf(task) >= 2 ? "RESOLVED" : "UNRESOLVED");
  assert.deepEqual(((x) => [x.code, x.verdict])(world(t, { repo: w.repo, record: recordWith(w.commit, runsWith(better)) }).e()), ["PUBLISHABLE", "IMPROVED"]);
  assert.deepEqual(((x) => [x.code, x.verdict])(world(t, { repo: w.repo, record: recordWith(w.commit, runsWith(() => "RESOLVED")) }).e()), ["PUBLISHABLE", "NO_DIFFERENCE"]);
  assert.deepEqual([overallOf(["IMPROVED", "NO_DIFFERENCE"]), overallOf(["IMPROVED", "REGRESSED"]), overallOf([])], ["INCONCLUSIVE", "REGRESSED", "INCONCLUSIVE"]);
});

test("the table is ordered and the first row that fails decides; every row says what it read and what a person does next", (t) => {
  assert.deepEqual(PUBLISH.map((r) => r.code), ["DIRTY", "FAST_TIER", "NO_RECORD", "RECORD_SHAPE", "OTHER_RELEASE", "PREREG_MOVED", "ARTIFACT_REFUSED", "REV_UNKNOWN", "ARTIFACT_MOVED", "ARTIFACT_OTHER", "INCOMPLETE", "RECORD_DISAGREES", "REGRESSED", "PUBLISHABLE"]);
  assert.ok(PUBLISH.every((r) => r.reads && r.next), "what it read, and the one thing a person does next");
  const both = world(t, { ports: { fastTier: () => [{ name: "the suite", ok: false }], recordText: () => null } }).e();
  assert.equal(both.code, "FAST_TIER", "the fast tier is asked before the record");
  assert.match(saidEvidence(both), /^NOT PUBLISHABLE — FAST_TIER: .*\n {2}read: the fast tier \(what --ci runs\) on this tree\n {2}next: node skills\/orbit-release\/ship\.mjs --ci/);
});

// ---- the evaluator's record, held by the gate ----------------------------------------------------------------------------------------

// A campaign room as the evaluator keeps it: its frozen campaign.json (made from the pre-registration) and its journal.
function campaignRoom(home, id, phase, commit, word) {
  const ph = P.phases.find((x) => x.id === phase);
  const plan = HELD.flatMap((task) => ph.arms.map((arm) => ({ arm, task, trial: 1, key: `${arm}__${task.replace(/[:/]/g, "_")}__t1` })));
  const arms = Object.fromEntries(ph.arms.map((a) => [a, { ...P.arms[a], rev: P.arms[a].rev ?? commit, frozen: P.arms[a].kind.endsWith("+orbit") ? { commit: P.arms[a].rev === null ? commit : "5".repeat(40) } : {} }]));
  const lines = plan.flatMap((r) => (word(r.arm, r.task) === "NOT_RUN" ? [{ kind: "skipped", run: r.key, reason: "credential" }] : [{ kind: "started", run: r.key, attempt: 1, capUsd: 1 }, { kind: "ended", run: r.key, attempt: 1, chargedUsd: 0.3, wallMs: 240000, summary: { costUsd: 0.3 } }, { kind: "outcome", run: r.key, attempt: 1, word: word(r.arm, r.task), why: null }]));
  mkdirSync(join(home, "campaigns", id), { recursive: true });
  writeFileSync(join(home, "campaigns", id, "campaign.json"), JSON.stringify({ id, prereg: { release: P.release, phase, digest: sha(PREREG_TEXT) }, model: P.host.model, effort: P.host.effort, limits: P.limits, budgetUsd: ph.budgetUsd, claudeCode: "2.1.322", arms, plan, evaluator: { commit: "e", dirty: false } }));
  writeFileSync(join(home, "campaigns", id, "journal.jsonl"), [...lines, { kind: "finished" }].map((l) => JSON.stringify(l)).join("\n") + "\n");
}

test("the evaluator's own record command makes a record from campaign rooms, and the gate holds it: one shape, one verdict rule, two readers", (t) => {
  const w = world(t);
  const home = mkdtempSync(join(tmpdir(), "orbit-evalhome-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  campaignRoom(home, "final-060", "final", w.commit, ONE_MORE);
  campaignRoom(home, "mini-060", "mini", w.commit, () => "NOT_RUN");
  const out = join(home, "record.json");
  const r = spawnSync(process.execPath, [join(ROOT, "evaluator", "cli.mjs"), "record", "--campaign=final-060,mini-060", `--prereg=${join(ROOT, PREREG_REL)}`, `--out=${out}`], { encoding: "utf8", env: sealed({ ORBIT_EVAL_HOME: home }) });
  assert.equal(r.status ?? 0, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /^error:/m, r.stdout);
  const made = JSON.parse(readFileSync(out, "utf8"));
  const e = world(t, { repo: w.repo, record: made }).e();
  assert.equal(e.code, "PUBLISHABLE", e.says);
  assert.equal(e.verdict, made.verdict, "the evaluator and the gate work the verdict out alike");
});
