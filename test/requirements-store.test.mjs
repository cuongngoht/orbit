// The requirements room: a journal written before the file it describes, documents that
// are never overwritten by an older format, provenance that is written once, and a crash
// between the two that heals itself. Reading creates nothing, and nothing leaves the store.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { Blocked, Refused } from "../src/errors.mjs";
import { loadProject } from "../src/project/index.mjs";
import { requirementsContext } from "../src/requirements/context.mjs";
import { recover } from "../src/requirements/ingest.mjs";
import { decisionId, factDigest, makeDecision, makeFact, makeQuestion, superseded } from "../src/requirements/model.mjs";
import { compared, journaledFacts, replayed } from "../src/requirements/replay.mjs";
import { EMPTY_STATE, createRequirements } from "../src/requirements/store.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { sealed } from "./home.mjs";

const ROOT = "req-aaaaaaaaaaaa";
const AT = "2026-09-30T10:00:00.000Z";
const SRC = "source:src-bbbbbbbbbbbb@7";
const SEEN = { host: "laptop-a", at: AT };

const room = (opts) => {
  const io = fakeIo(opts);
  const port = createRequirements("/store/acme", io).open(ROOT);
  return { io, port };
};

const fact = (over = {}) => makeFact({ root: ROOT, subject: "refund", aspect: "limit", says: "A refund above 500 needs a manager", status: "stated", sources: [SRC], at: AT, seenBy: SEEN, ...over });
const question = (over = {}) => makeQuestion({ root: ROOT, slots: [{ subject: "signup", aspect: "duplicate-email" }], asks: "What happens when the email exists?", blocking: true, state: "open", at: AT, ...over });
const decision = (q, over = {}) => makeDecision({ root: ROOT, question: q.id, says: "reject with a message", human: true, at: AT, seenBy: SEEN, ...over });

test("reading an empty store creates nothing at all", () => {
  const { io, port } = room();
  assert.deepEqual([port.facts(), port.questions(), port.decisions(), port.snapshots(), port.journalLines(), port.findings(), port.versions(fact().id)], [[], [], [], [], [], [], []]);
  assert.equal(port.fact(fact().id), null);
  assert.deepEqual(port.state(), { ...EMPTY_STATE, schema: 1 });
  assert.deepEqual([io.files.size, io.dirs.size], [0, 0]);
});

test("a fact round-trips; the standing ones and the versions they replaced are told apart, and a version is written once", () => {
  const { port } = room();
  const one = fact();
  port.saveFact(one);
  const two = fact({ revision: 2, says: "A refund above 300 needs a manager", supersedes: `${one.id}@1` });
  port.keepAside(superseded(one, `${two.id}@2`));
  port.saveFact(two);
  assert.deepEqual(port.facts().map((f) => [f.id, f.revision]), [[one.id, 2]]);
  assert.deepEqual(port.versions(one.id).map((f) => [f.revision, f.status, f.supersededBy]), [[1, "superseded", `${one.id}@2`]]);
  assert.doesNotThrow(() => port.keepAside(superseded(one, `${two.id}@2`)), "the same version again is nothing");
  assert.throws(() => port.keepAside({ ...superseded(one, `${two.id}@2`), says: "something else" }), (e) => e instanceof Refused && /a superseded version is written once/.test(e.message));
});

test("an id is checked before it becomes a path, and a bad one writes nothing", () => {
  const { io, port } = room();
  for (const bad of ["../../escape", "rf-zzzz", "", "rf-aaaaaaaaaaaa/../x"]) assert.throws(() => port.fact(bad), Refused, bad);
  assert.throws(() => port.saveFact({ ...fact(), id: "rf-../x" }), Refused);
  assert.throws(() => createRequirements("/store/acme", fakeIo()).open("../escape"), Refused);
  assert.equal(io.files.size, 0);
});

test("a document from a newer format is never overwritten, one that is torn is set aside first, and neither is called readable", () => {
  const { io, port } = room();
  const f = fact();
  port.saveFact(f);
  const file = [...io.files.keys()].find((k) => k.endsWith(`${f.id}.json`));
  io.write(file, JSON.stringify({ ...f, v: 2 }));
  assert.equal(port.fact(f.id), null);
  assert.throws(() => port.saveFact(f), /newer Orbit/);
  assert.equal(JSON.parse(io.read(file)).v, 2);
  assert.deepEqual(port.facts(), []);
  assert.ok(io.notes.some((n) => n.kind === "unreadable-requirement"));
  io.write(file, "{ torn");
  port.saveFact(f);
  const aside = [...io.files.keys()].filter((k) => k.includes(".corrupt-"));
  assert.equal(aside.length, 1);
  assert.equal(io.read(aside[0]), "{ torn");
  assert.equal(port.fact(f.id).says, f.says);
});

test("a decision and a snapshot are written once: the same again is nothing, something different is refused", () => {
  const { port } = room();
  const q = question();
  const d = decision(q);
  port.saveDecision(d);
  assert.doesNotThrow(() => port.saveDecision(d));
  assert.throws(() => port.saveDecision({ ...d, says: "reject, but keep the account" }), /a decision is written once/);
  const snap = { v: 1, id: "rs-cccccccccccc", root: ROOT, sources: [], facts: [], decisions: [], open: [], clarity: "complete", authority: "draft", digest: "d1", at: AT };
  port.saveSnapshot(snap);
  assert.doesNotThrow(() => port.saveSnapshot(snap));
  assert.throws(() => port.saveSnapshot({ ...snap, digest: "d2" }), /a snapshot is written once/);
  assert.equal(port.snapshot("rs-cccccccccccc").digest, "d1");
});

test("a question is mutable, and reads back as written", () => {
  const { port } = room();
  const q = question();
  port.saveQuestion(q);
  port.saveQuestion({ ...q, state: "answered", answer: decisionId(q.id, AT) });
  assert.equal(port.question(q.id).state, "answered");
  assert.equal(port.questions().length, 1);
});

test("unsupported and corrupt requirement state is refused without rewriting", () => {
  const { io, port } = room();
  const file = port.paths.state;
  for (const text of ['{"schema":2,"sources":{}}', '{ nope']) {
    io.write(file, text);
    assert.throws(() => port.state(), /Orbit state/);
    assert.throws(() => port.setState({ ...EMPTY_STATE }), /Orbit state/);
    assert.equal(io.read(file), text);
  }
  assert.ok(![...io.files.keys()].some((k) => k.includes("state.json.corrupt-")));
});

test("the journal keeps only what a kind declares, masks free text wherever it sits, refuses a kind it does not know, and numbers its lines", () => {
  const { io, port } = room();
  const a = port.journal({ kind: "recorded", factId: "rf-aaaaaaaaaaaa", outcome: "new", candidate: { says: "needs password=hunter2hunter2", nested: { deep: "Bearer abcdefghijklmnopqrstuvwxyz0123456789" } }, body: "SENTINEL-UNDECLARED", seenBy: SEEN });
  const b = port.journal({ kind: "reopened", questionId: "rq-aaaaaaaaaaaa", because: "the source moved" });
  assert.deepEqual([a.sequence, b.sequence, a.v, a.kind], [1, 2, 1, "recorded"]);
  const stored = io.read(port.paths.journal);
  assert.doesNotMatch(stored, /hunter2|abcdefghijklmnopqrstuvwxyz0123456789|SENTINEL-UNDECLARED/);
  assert.throws(() => port.journal({ kind: "invented" }), /keeps no "invented" line/);
  assert.equal(port.journal({ kind: "reopened", questionId: "rq-aaaaaaaaaaaa", kind2: "x", at: "1999-01-01T00:00:00.000Z" }).at, "2026-09-20T00:00:00.000Z", "the store owns the time");
});

test("inside a transaction the journal is read once, however many lines are appended, and the sequence still runs on", () => {
  const { io, port } = room();
  port.journal({ kind: "reopened", questionId: "rq-aaaaaaaaaaaa", because: "before" });
  const reads = [];
  const real = io.read;
  io.read = (p) => (reads.push(p), real(p));
  const seq = port.transact(() => [1, 2, 3].map(() => port.journal({ kind: "reopened", questionId: "rq-aaaaaaaaaaaa", because: "x" }).sequence));
  const journalReads = reads.filter((p) => p === port.paths.journal).length;
  assert.deepEqual(seq, [2, 3, 4]);
  assert.equal(journalReads, 1, "one read fills the cache and shows whether the last line was torn; an append does not read it again");
  assert.equal(port.journalLines().length, 4);
});

test("a torn last line is ended once, at the start of a transaction, and the lines after it are not glued to it", () => {
  const { io, port } = room();
  port.journal({ kind: "reopened", questionId: "rq-aaaaaaaaaaaa", because: "one" });
  io.write(port.paths.journal, `${io.read(port.paths.journal)}{"v":1,"kind":"reop`);
  port.transact(() => [2, 3].forEach((n) => port.journal({ kind: "reopened", questionId: "rq-aaaaaaaaaaaa", because: `n${n}` })));
  assert.deepEqual(port.journalLines().map((l) => l.because), ["one", "n2", "n3"]);
  assert.deepEqual(port.journalLines().map((l) => l.sequence), [1, 2, 3]);
});

test("a torn last line is dropped, and the next line is not glued to it", () => {
  const { io, port } = room();
  port.journal({ kind: "reopened", questionId: "rq-aaaaaaaaaaaa", because: "one" });
  io.write(port.paths.journal, `${io.read(port.paths.journal)}{"v":1,"kind":"reop`);
  assert.equal(port.journalLines().length, 1);
  port.journal({ kind: "reopened", questionId: "rq-aaaaaaaaaaaa", because: "two" });
  assert.deepEqual(port.journalLines().map((l) => l.because), ["one", "two"]);
  assert.equal(port.journalLines()[1].sequence, 2);
});

test("a writer that cannot get the room's lock is told, in words about this requirement, that it is Blocked", () => {
  const { port } = room({ mkdirFails: 99, backoff: [1, 1] });
  assert.throws(() => port.transact(() => 1), (e) => e instanceof Blocked && /this requirement's facts/.test(e.message));
});

test("findings are kept in this host's own file, masked, and read back as one list", () => {
  const { io, port } = room({ host: "laptop-a" });
  port.addFinding({ kind: "question-reopened", say: "moved, Bearer abcdefghijklmnopqrstuvwxyz0123456789" });
  port.addFinding({ kind: "question-reopened", say: "again" });
  assert.equal(port.findings().length, 2);
  assert.doesNotMatch(JSON.stringify(port.findings()), /abcdefghijklmnopqrstuvwxyz0123456789/);
  assert.deepEqual([...io.files.keys()].filter((k) => k.includes("findings")).map((k) => k.split(/[\\/]/).at(-1)), ["laptop-a.jsonl"]);
});

// ---- a crash between the journal and the file ---------------------------------------------

const recorded = (port, f, extra = {}) => port.journal({ kind: "recorded", factId: f.id, outcome: "new", candidate: { subject: f.subject, aspect: f.aspect }, result: f, seenBy: SEEN, ...extra });

test("a crash after the journal line and before the fact file is healed on the next open: what the journal carries whole is written, and only that", () => {
  const { port } = room();
  const f = fact();
  recorded(port, f);
  assert.equal(port.fact(f.id), null, "the process died here");
  assert.deepEqual(recover(port), { facts: [f.id], questions: [], decisions: [], answers: [] });
  assert.equal(port.fact(f.id).says, f.says);
  assert.deepEqual(recover(port), { facts: [], questions: [], decisions: [], answers: [] }, "healing twice is nothing");
});

test("a crash in the middle of a supersession keeps the old version aside and stands the new one", () => {
  const { port } = room();
  const one = fact();
  port.saveFact(one);
  recorded(port, one);
  const two = fact({ revision: 2, says: "A refund above 300 needs a manager", supersedes: `${one.id}@1` });
  recorded(port, two, { outcome: "changed" });
  recover(port);
  assert.equal(port.fact(one.id).revision, 2);
  assert.deepEqual(port.versions(one.id).map((f) => [f.revision, f.status]), [[1, "superseded"]]);
});

test("recovery invents nothing: a room that is already right, or ahead of the journal, is left alone", () => {
  const { port } = room();
  const one = fact();
  const two = fact({ revision: 2, says: "later", supersedes: `${one.id}@1` });
  port.saveFact(two);
  recorded(port, one);
  assert.deepEqual(recover(port).facts, [], "the room holds a later revision than the journal's last line");
  assert.equal(port.fact(one.id).revision, 2);
});

test("a question or a decision the journal carries whole and the room lacks is restored; one that exists is left as it is", () => {
  const { port } = room();
  const q = question();
  const d = decision(q);
  port.journal({ kind: "asked", questionId: q.id, question: q, seenBy: SEEN });
  port.journal({ kind: "answered", questionId: q.id, decisionId: d.id, decision: d, fact: fact({ status: "decided", decision: d.id, sources: [`decision:${d.id}`], says: "reject" }), seenBy: SEEN });
  const healed = recover(port);
  assert.deepEqual([healed.questions, healed.decisions], [[q.id], [d.id]]);
  assert.equal(port.fact(fact().id).status, "decided", "the fact an answer settled came back through the same door");
  port.saveQuestion({ ...q, state: "answered", answer: d.id });
  assert.deepEqual(recover(port).questions, []);
  assert.equal(port.question(q.id).state, "answered");
});

test("the journal's facts are the newest document per fact, whole", () => {
  const { port } = room();
  const one = fact();
  recorded(port, one);
  recorded(port, fact({ revision: 2, says: "later" }));
  assert.deepEqual([...journaledFacts(port.journalLines()).values()].map((f) => f.revision), [2]);
});

// ---- replay ------------------------------------------------------------------------------

test("replay folds the lines in sequence order through the step it is given, and refuses a line from a format it does not know", () => {
  const lines = [{ v: 1, sequence: 3, kind: "recorded", n: "c" }, { v: 1, sequence: 1, kind: "recorded", n: "a" }, { v: 1, sequence: 2, kind: "recorded", n: "b" }];
  assert.equal(replayed(lines, (acc, l) => acc + l.n, ""), "abc");
  assert.throws(() => replayed([{ v: 2, sequence: 1 }], (a) => a, null), /format 2/);
  assert.deepEqual(lines.map((l) => l.sequence), [3, 1, 2], "the journal's own order is untouched");
});

test("the room is compared with the fold fact by fact: same, differs, missing, or not journaled", () => {
  const same = fact();
  const differs = fact({ subject: "signup", aspect: "email" });
  const missing = fact({ subject: "order", aspect: "total" });
  const stray = fact({ subject: "cart", aspect: "size" });
  const folded = new Map([[same.id, same], [differs.id, { ...differs, says: "changed since" }], [missing.id, missing]]);
  const verdicts = Object.fromEntries(compared([same, differs, stray], folded).map((v) => [v.id, v.verdict]));
  assert.deepEqual(verdicts, { [same.id]: "same", [differs.id]: "differs", [missing.id]: "missing", [stray.id]: "not-journaled" });
  assert.equal(factDigest(same), factDigest({ ...same, at: "2030-01-01T00:00:00.000Z" }));
});

// ---- against a real repository store -------------------------------------------------------

const engine = fileURLToPath(new URL("..", import.meta.url));
const temp = realpathSync.native(mkdtempSync(join(tmpdir(), "orbit-requirements-")));
after(() => rmSync(temp, { recursive: true, force: true }));
const env = sealed({ ORBIT_STORE_DIR: join(temp, "store") });

function initialized(name) {
  const root = join(temp, name);
  mkdirSync(root);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "remote", "add", "origin", `https://example.test/team/${name}.git`]);
  const done = spawnSync(process.execPath, [join(engine, "cli", "init.mjs"), root, "--origin=https://app.example.test"], { cwd: root, env, encoding: "utf8" });
  assert.equal(done.status, 0, done.stderr);
  return loadProject(env, root);
}

test("bound to a repository's store: reading creates no room, the rooms are listed as directories, and the layout stays 3", () => {
  const p = initialized("plain");
  const ctx = requirementsContext({ project: p, config: p.config }, env);
  assert.deepEqual([ctx.requirements.roots(), ctx.requirements.open(ROOT).facts()], [[], []]);
  assert.equal(existsSync(join(p.storeRoot, "requirements")), false);
  const port = ctx.requirements.open(ROOT);
  port.transact(() => port.saveFact(fact()));
  assert.deepEqual(ctx.requirements.roots(), [ROOT]);
  assert.equal(JSON.parse(readFileSync(join(p.storeRoot, "store.json"), "utf8")).layout, 3, "no layout change: the room is additive");
  assert.equal(port.facts().length, 1);
});

test("a symlink where the room should be cannot lead a write out of the store", () => {
  const p = initialized("guarded");
  const outside = join(temp, "escape");
  mkdirSync(outside);
  symlinkSync(outside, join(p.storeRoot, "requirements"), "dir");
  const port = requirementsContext({ project: p, config: p.config }, env).requirements.open(ROOT);
  assert.throws(() => port.transact(() => port.saveFact(fact())), Refused);
  assert.throws(() => port.journal({ kind: "reopened", questionId: "rq-aaaaaaaaaaaa", because: "x" }), Refused);
  assert.deepEqual(readdirSync(outside), []);
});
