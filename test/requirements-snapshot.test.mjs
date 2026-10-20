// The snapshot: an immutable freezing of the requirement that downstream work rests on.
// What is under test is what it is a function of, that it can never change, that it holds
// no text and can still be shown WITH the text -- checked against what was frozen -- and
// that whose word it is moves with the sources and never with the clock.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { Refused } from "../src/errors.mjs";
import { loadProject } from "../src/project/index.mjs";
import { requirementsContext } from "../src/requirements/context.mjs";
import { answer, ask, ingest } from "../src/requirements/ingest.mjs";
import { factId } from "../src/requirements/model.mjs";
import { freeze, identify } from "../src/requirements/snapshot.mjs";
import { createRequirements } from "../src/requirements/store.mjs";
import { show } from "../src/requirements/views/show.mjs";
import { status } from "../src/requirements/views/status.mjs";
import { why } from "../src/requirements/views/why.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { sealed } from "./home.mjs";

const ROOT = "req-aaaaaaaaaaaa";
const T1 = "2026-09-30T10:00:00.000Z";
const SEEN = { host: "laptop-a", at: T1 };
const A = (rev) => `source:src-aaaaaaaaaaaa@${rev}`;
const IDENTITY = { provider: "tracker-a", organization: "acme", project: "web", id: "4312" };
// The in-memory disk lists files, not directories, so the requirement is named to `show`.
const IN = { root: ROOT };
const WORDS = "SENTINEL-WORDS a refund above 500 needs a manager";

function world() {
  const clock = { at: T1 };
  const io = fakeIo({ now: () => clock.at });
  const requirements = createRequirements("/store/acme", io);
  const port = requirements.open(ROOT);
  const sources = { "src-aaaaaaaaaaaa": { kind: "workitem", authority: "draft", revision: "1" } };
  const resolves = (ref) => {
    const m = /^source:(src-[0-9a-f]{12})@(.+)$/.exec(ref);
    const s = m && sources[m[1]];
    return s ? { sid: m[1], cited: m[2], revision: s.revision, digest: `d${s.revision}`, kind: s.kind, authorityBearing: true } : null;
  };
  const ctx = { requirements, now: () => clock.at, world: { resolves, source: (sid) => sources[sid] ?? null }, seenBy: SEEN, engine: "1.7.1-test" };
  return { io, port, sources, clock, ctx, requirements, put: (c) => ingest(ctx, ROOT, c), ask: (s) => ask(ctx, ROOT, s), answer: (a) => answer(ctx, ROOT, a), freeze: () => freeze(ctx, ROOT) };
}

const cand = (over = {}) => ({ subject: "refund", aspect: "limit", says: WORDS, status: "stated", sources: [A(1)], ...over });
const spec = () => ({ slots: [{ subject: "signup", aspect: "duplicate-email" }], asks: "What happens when the email already exists?", blocking: true, dependsOn: [A(1)] });

test("a snapshot freezes which sources at which revisions, which facts at which digests, which decisions, what was still open, how clear and whose word", () => {
  const w = world();
  w.put([cand()]);
  const [q] = w.ask([spec()]);
  const { snapshot, created } = w.freeze();
  assert.equal(created, true);
  assert.match(snapshot.id, /^rs-[0-9a-f]{12}$/);
  assert.deepEqual([snapshot.root, snapshot.clarity, snapshot.authority, snapshot.open, snapshot.decisions, snapshot.engine], [ROOT, "blocked", "draft", [q.id], [], "1.7.1-test"]);
  assert.deepEqual(snapshot.sources, [{ id: "src-aaaaaaaaaaaa", revision: "1", kind: "workitem", authority: "draft", digest: "d1" }]);
  assert.deepEqual(snapshot.facts.map((f) => [f.id, f.revision, f.status]), [[factId(ROOT, "refund", "limit"), 1, "stated"], [factId(ROOT, "signup", "duplicate-email"), 1, "unknown"]].sort((a, b) => a[0].localeCompare(b[0])));
  assert.match(snapshot.facts[0].digest, /^[0-9a-f]{16}$/);
});

test("a snapshot holds no text: not a fact's words, not a question's", () => {
  const w = world();
  w.put([cand()]);
  w.ask([spec()]);
  const { snapshot } = w.freeze();
  const stored = w.io.read([...w.io.files.keys()].find((k) => k.includes("snapshots") && k.endsWith(`${snapshot.id}.json`)));
  assert.doesNotMatch(stored, /SENTINEL-WORDS|What happens when the email/);
});

test("freezing the same state again is the same snapshot and writes nothing", () => {
  const w = world();
  w.put([cand()]);
  const first = w.freeze();
  const lines = w.port.journalLines().length;
  const files = new Map(w.io.files);
  w.clock.at = "2027-01-01T00:00:00.000Z";
  const second = w.freeze();
  assert.deepEqual([second.created, second.snapshot.id, second.snapshot.at], [false, first.snapshot.id, T1]);
  assert.equal(w.port.journalLines().length, lines);
  assert.deepEqual([...w.io.files.entries()], [...files.entries()], "not one byte anywhere moved");
  assert.equal(w.port.state().lastSnapshot, first.snapshot.id);
});

test("the id is a function of the state alone: the same requirement built the same way in two rooms is the same snapshot", () => {
  const one = world();
  const two = world();
  for (const w of [one, two]) w.put([cand()]);
  two.clock.at = "2030-05-05T05:05:05.000Z";
  assert.equal(one.freeze().snapshot.id, two.freeze().snapshot.id);
});

test("anything that changes what it says is a DIFFERENT snapshot, and the first stays exactly as it was", () => {
  const w = world();
  w.put([cand()]);
  const [q] = w.ask([spec()]);
  const first = w.freeze().snapshot;
  const file = [...w.io.files.keys()].find((k) => k.endsWith(`${first.id}.json`));
  const before = w.io.read(file);
  w.answer({ question: q.id, says: "Reject; no account is created", human: true });
  const second = w.freeze().snapshot;
  assert.notEqual(second.id, first.id);
  assert.deepEqual([second.clarity, second.open, second.decisions.length], ["complete", [], 1]);
  assert.equal(w.io.read(file), before, "the earlier snapshot did not move");
  assert.deepEqual(w.port.snapshots().map((s) => s.id).sort(), [first.id, second.id].sort());
  assert.equal(w.port.state().lastSnapshot, second.id);
});

test("whose word it is moves with the sources, never with the clock: complete and a draft, then accepted -- a new snapshot, the old one still a draft", () => {
  const w = world();
  w.put([cand()]);
  const draft = w.freeze().snapshot;
  assert.deepEqual([draft.clarity, draft.authority], ["complete", "draft"], "clear and still not anybody's accepted word");
  w.sources["src-aaaaaaaaaaaa"].authority = "accepted";
  const accepted = w.freeze().snapshot;
  assert.deepEqual([accepted.clarity, accepted.authority, accepted.sources[0].authority], ["complete", "accepted", "accepted"]);
  assert.notEqual(accepted.id, draft.id);
  assert.equal(w.port.snapshot(draft.id).authority, "draft");
});

test("a decision is the team's word whatever its source was: a draft source and a decided slot make a snapshot that is still a draft while anything stated rests on the draft", () => {
  const w = world();
  w.put([cand(), cand({ subject: "signup", aspect: "email", says: "An email is required" })]);
  w.ask([{ ...spec(), slots: [{ subject: "signup", aspect: "email" }] }]);
  w.answer({ question: w.port.questions()[0].id, says: "Required, and verified", human: true });
  assert.equal(w.freeze().snapshot.authority, "draft", "the refund limit still rests on a draft");
});

test("an older revision a fact still rests on is listed at that revision, with no digest: only what was last read has one", () => {
  const w = world();
  w.put([cand()]);
  w.sources["src-aaaaaaaaaaaa"].revision = "2";
  const { snapshot } = w.freeze();
  assert.deepEqual(snapshot.sources, [{ id: "src-aaaaaaaaaaaa", revision: "1", kind: "workitem", authority: "draft", digest: "d1" }]);
  w.put([cand({ subject: "cart", aspect: "size", says: "At most 50", sources: [A(2)] })]);
  const later = w.freeze().snapshot;
  assert.deepEqual(later.sources.map((s) => [s.revision, s.digest]), [["1", undefined], ["2", "d2"]]);
});

test("the identity of the root is set once and rides in every snapshot", () => {
  const w = world();
  w.put([cand()]);
  assert.equal(w.freeze().snapshot.identity, undefined);
  identify(w.ctx, ROOT, IDENTITY);
  assert.deepEqual(w.freeze().snapshot.identity, IDENTITY);
  assert.deepEqual(identify(w.ctx, ROOT, IDENTITY), IDENTITY, "the same again is nothing");
  assert.throws(() => identify(w.ctx, ROOT, { ...IDENTITY, id: "9" }), /already the requirement of another item/);
});

test("freezing needs to know whose word the sources are, and heals what a crash left out first", () => {
  const w = world();
  w.put([cand()]);
  assert.throws(() => freeze({ ...w.ctx, world: { resolves: () => null } }, ROOT), (e) => e instanceof Refused && /none is bound here/.test(e.message));
  w.io.removeFile([...w.io.files.keys()].find((k) => k.endsWith(`${factId(ROOT, "refund", "limit")}.json`)));
  assert.equal(w.freeze().snapshot.facts.length, 1, "the fact the journal carries came back before it was frozen");
});

// ---- showing it ---------------------------------------------------------------------------------

test("show reads the words from the room, checked against what was frozen; a requirement's latest is found by its root", () => {
  const w = world();
  w.put([cand()]);
  const [q] = w.ask([spec()]);
  const { snapshot } = w.freeze();
  const shown = show(w.ctx, snapshot.id, IN);
  assert.deepEqual([shown.snapshot.id, shown.snapshot.clarity, shown.snapshot.authority], [snapshot.id, "blocked", "draft"]);
  assert.deepEqual(shown.facts.map((f) => [f.subject, f.says]).sort(), [["refund", WORDS], ["signup", ""]]);
  assert.deepEqual(shown.open, [{ id: q.id, asks: "What happens when the email already exists?", blocking: true, slots: q.slots, state: "open" }]);
  assert.equal(show(w.ctx, ROOT).snapshot.id, snapshot.id);
});

test("a snapshot shows what it froze even after the requirement moved on: the version it used is read from where it was kept", () => {
  const w = world();
  w.put([cand()]);
  const { snapshot } = w.freeze();
  w.sources["src-aaaaaaaaaaaa"].revision = "2";
  w.put([cand({ says: "A refund above 300 needs a manager", sources: [A(2)] })]);
  assert.equal(w.port.fact(factId(ROOT, "refund", "limit")).revision, 2);
  const old = show(w.ctx, snapshot.id, IN);
  assert.deepEqual([old.facts[0].revision, old.facts[0].says, old.facts[0].status], [1, WORDS, "stated"]);
  assert.equal(show(w.ctx, w.freeze().snapshot.id, IN).facts[0].says, "A refund above 300 needs a manager");
});

test("show REFUSES anything that no longer matches: an altered snapshot, an altered fact, a missing version", () => {
  const w = world();
  w.put([cand()]);
  const { snapshot } = w.freeze();
  const snapFile = [...w.io.files.keys()].find((k) => k.endsWith(`${snapshot.id}.json`));
  const original = w.io.read(snapFile);
  w.io.write(snapFile, JSON.stringify({ ...snapshot, authority: "accepted" }));
  assert.throws(() => show(w.ctx, snapshot.id, IN), /has been altered/);
  w.io.write(snapFile, original);
  const factFile = [...w.io.files.keys()].find((k) => k.endsWith(`${factId(ROOT, "refund", "limit")}.json`));
  const fact = JSON.parse(w.io.read(factFile));
  w.io.write(factFile, JSON.stringify({ ...fact, says: "Something nobody froze" }));
  assert.throws(() => show(w.ctx, snapshot.id, IN), /no longer says what it did when it was frozen/);
  w.io.removeFile(factFile);
  assert.throws(() => show(w.ctx, snapshot.id, IN), /is not in the room any more/);
});

test("a ref that is neither a snapshot nor a requirement kept here is refused, and a requirement that never froze one says so", () => {
  const w = world();
  assert.throws(() => show(w.ctx, "nonsense"), /neither a snapshot/);
  assert.throws(() => show(w.ctx, "rs-eeeeeeeeeeee", IN), /no snapshot for rs-eeeeeeeeeeee/);
  assert.throws(() => show(w.ctx, ROOT), /no requirement req-aaaaaaaaaaaa is kept here/);
  w.put([cand()]);
  assert.throws(() => show(w.ctx, ROOT), /no snapshot for req-aaaaaaaaaaaa/);
});

test("provenance is immutable: a superseded version is kept whole through every later change", () => {
  const w = world();
  w.put([cand()]);
  w.sources["src-aaaaaaaaaaaa"].revision = "2";
  w.put([cand({ says: "A refund above 300 needs a manager", sources: [A(2)] })]);
  const kept = [...w.io.files.entries()].find(([k]) => /@1\.json$/.test(k));
  w.sources["src-aaaaaaaaaaaa"].revision = "3";
  w.put([cand({ says: "A refund above 200 needs a manager", sources: [A(3)] })]);
  assert.equal(w.io.read(kept[0]), kept[1], "version 1 is still exactly what it was");
  assert.deepEqual(w.port.versions(factId(ROOT, "refund", "limit")).map((f) => f.revision), [1, 2]);
});

// ---- the other views ------------------------------------------------------------------------------

test("status says where a requirement stands, and which sources have moved on since it was read -- without fetching anything", () => {
  const w = world();
  w.put([cand()]);
  w.ask([spec()]);
  const before = status(w.ctx, ROOT);
  assert.deepEqual([before.clarity, before.authority, before.facts, before.open.map((q) => q.blocking), before.sources[0].stale], ["blocked", "draft", { stated: 1, unknown: 1 }, [true], false]);
  w.sources["src-aaaaaaaaaaaa"].revision = "2";
  assert.deepEqual(status(w.ctx, ROOT).sources, [{ id: "src-aaaaaaaaaaaa", cited: "1", now: "2", stale: true }]);
  assert.equal(status({ ...w.ctx, world: undefined }, ROOT).authority, null, "no sources bound: authority is not claimed rather than guessed");
  assert.equal(status(w.ctx, ROOT).lastSnapshot, null);
});

test("why is the journal about one thing, oldest first, and what it is now", () => {
  const w = world();
  w.put([cand()]);
  w.sources["src-aaaaaaaaaaaa"].revision = "2";
  w.put([cand({ says: "A refund above 300 needs a manager", sources: [A(2)] })]);
  const [q] = w.ask([spec()]);
  const got = w.answer({ question: q.id, says: "Reject", human: true });
  const snap = w.freeze().snapshot;
  const fact = why(w.ctx, ROOT, factId(ROOT, "refund", "limit"));
  assert.deepEqual([fact.kind, fact.history.map((l) => l.outcome), fact.now.revision, fact.versions.map((v) => v.revision)], ["fact", ["new", "changed"], 2, [1]]);
  assert.deepEqual(why(w.ctx, ROOT, q.id).history.map((l) => l.kind), ["asked", "answered"]);
  assert.deepEqual([why(w.ctx, ROOT, got.decision.id).kind, why(w.ctx, ROOT, got.decision.id).now.by], ["decision", "person"]);
  assert.deepEqual(why(w.ctx, ROOT, snap.id).history.map((l) => [l.kind, l.clarity]), [["snapshot", "complete"]]);
  assert.throws(() => why(w.ctx, ROOT, "k-aaaaaaaaaaaa"), /is not a fact \(rf-…\)/);
});

// ---- against a real repository store ------------------------------------------------------------

const engine = fileURLToPath(new URL("..", import.meta.url));
const temp = realpathSync.native(mkdtempSync(join(tmpdir(), "orbit-snapshot-")));
after(() => rmSync(temp, { recursive: true, force: true }));
const env = sealed({ ORBIT_STORE_DIR: join(temp, "store") });

test("on a real disk a snapshot is found by its own id across the requirements kept here, and by its requirement's id", () => {
  const root = join(temp, "repo");
  mkdirSync(root);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "remote", "add", "origin", "https://example.test/team/repo.git"]);
  const init = spawnSync(process.execPath, [join(engine, "cli", "init.mjs"), root, "--origin=https://app.example.test"], { cwd: root, env, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  const p = loadProject(env, root);
  const bound = requirementsContext({ project: p, config: p.config }, env);
  const w = world();
  const ctx = { ...w.ctx, requirements: bound.requirements };
  ingest(ctx, ROOT, [cand()]);
  const { snapshot } = freeze(ctx, ROOT);
  assert.equal(show(ctx, snapshot.id).snapshot.id, snapshot.id, "no root named: every requirement kept here is looked in");
  assert.equal(show(ctx, ROOT).snapshot.id, snapshot.id);
  assert.throws(() => show(ctx, "req-bbbbbbbbbbbb"), /no requirement req-bbbbbbbbbbbb is kept here/);
});
