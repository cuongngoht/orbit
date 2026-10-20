// The composition root of a WORK: every command a person or a model runs, as they run it. The
// table is held to its own columns, and the real CLI is driven through a whole work -- start,
// needs, a binding on a machine with nothing, settling on evidence, a checkpoint, a requirement
// that moves, a resume on another day -- against a requirement the test seeds where an
// acquisition would have put it. Nothing here reaches a network or a provider.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createRequirements } from "../src/requirements/store.mjs";
import { rootId, sourceRecord, workitemText } from "../src/sources/model.mjs";
import { createSources } from "../src/sources/store.mjs";
import { realIo } from "../src/store/io.mjs";
import { documented, headerOf } from "../src/trace/commands.mjs";
import { COMMANDS } from "../src/work/index.mjs";
import { workOf } from "../src/work/store.mjs";
import { sealed } from "./home.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "cli", "work.mjs");
const REQ = join(REPO, "cli", "requirements.mjs");
const FIXTURE = join(REPO, "test", "fixtures", "ui-tests");
const NOW = "2026-09-30T10:00:00.000Z";
const IDENTITY = { provider: "azure-devops", organization: "acme", project: "Web Shop", id: "4312" };
const OTHER = { provider: "github", organization: "acme", project: "shop", id: "4312" };
const SENTINEL = "SENTINEL-SENTENCE about refunds";

test("every command declares what it writes and what it needs, and how to say its answer", () => {
  for (const [name, c] of Object.entries(COMMANDS)) {
    assert.ok(["nothing", "store"].includes(c.writes), `${name} writes`);
    assert.ok(["store", "resources"].includes(c.needs), `${name} needs`);
    assert.equal(typeof c.run, "function", name);
    assert.equal(typeof c.say, "function", name);
  }
});

test("only the commands that look never write, and only the ones that ask a provider or a registry need resources", () => {
  assert.deepEqual(Object.entries(COMMANDS).filter(([, c]) => c.writes === "nothing").map(([n]) => n).sort(), ["list", "recall", "show", "where"]);
  assert.deepEqual(Object.entries(COMMANDS).filter(([, c]) => c.needs === "resources").map(([n]) => n).sort(), ["checkpoint", "claim", "invoke", "resolve", "resume"]);
});

test("the usage header documents every subcommand, so the session trail may name each and nothing else", () => {
  const subs = documented(headerOf(readFileSync(CLI, "utf8")), "work");
  assert.deepEqual([...subs].sort(), Object.keys(COMMANDS).sort());
});

test("a work is named before anything is looked at, and a need before a provider is asked", () => {
  const inert = new Proxy({}, { get: () => { throw new Error("touched the context"); } });
  for (const name of ["show", "need", "resolve", "settle", "claim", "checkpoint", "resume"]) assert.throws(() => COMMANDS[name].run(inert, []), /name the work/, name);
  assert.throws(() => COMMANDS.start.run(inert, []), /start needs the item it is about/);
});

test("invoke is asked the same, as a promise: the work first, then the need", async () => {
  const inert = new Proxy({}, { get: () => { throw new Error("touched the context"); } });
  await assert.rejects(COMMANDS.invoke.run(inert, []), /name the work/);
});

// ---- the real CLI, offline ---------------------------------------------------------------------

const base = mkdtempSync(join(tmpdir(), "orbit-work-cli-"));
const env = sealed({ ORBIT_STORE_DIR: base, ORBIT_UI_TESTS: FIXTURE });
const run = (file) => (args, input) => spawnSync(process.execPath, [file, ...args], { env, encoding: "utf8", input, timeout: 120000 });
const cli = run(CLI);
const req = run(REQ);
const jsonOf = (call, args, input) => {
  const r = call([...args, "--json"], input);
  assert.equal(r.status, 0, `${args.join(" ")}\n${r.stderr}${r.stdout}`);
  return JSON.parse(r.stdout);
};
const json = (args, input) => jsonOf(cli, args, input);
const lines = (...rows) => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
const refused = (args, re, input) => {
  const r = cli(args, input);
  assert.equal(r.status, 2, `${args.join(" ")} should be refused:\n${r.stdout}`);
  assert.match(r.stderr, re);
};

// A requirement, as an acquisition would have left it: a source record and an identity.
function seed(identity, revision = "7") {
  const store = json(["where"]).store;
  const rec = sourceRecord({ identity, kind: "workitem", ref: identity.id, revision, text: workitemText({ title: "t", body: SENTINEL }), now: NOW });
  createSources(store, realIo()).saveRecord(rec);
  const root = rootId(identity);
  const port = createRequirements(store, realIo()).open(root);
  port.transact(() => port.setState({ sources: {}, position: 0, lastSnapshot: null, identity }));
  return { root, cite: `source:${rec.id}@${revision}` };
}

let root;
let cite;
let first;

test("on an empty machine nothing is kept, nothing is created by looking, and a work needs a requirement first", () => {
  const where = json(["where"]);
  assert.deepEqual(where.kept, []);
  assert.equal(existsSync(join(where.store, "work")), false);
  assert.equal(cli(["recall", "--for=implement PBI 4312"]).stdout.trim(), "no work is in progress here");
  refused(["start", "Implement the refund limit", "--ref=4312"], /no requirement is kept for 4312 — acquire it first/);
  refused(["show", "--ref=4312"], /no work is kept for 4312/);
  assert.equal(existsSync(join(where.store, "work")), false, "a refused start makes no room");
});

test("a requirement with two facts and a snapshot is what a work rests on", () => {
  ({ root, cite } = seed(IDENTITY));
  const recorded = jsonOf(req, ["record", root], lines({ subject: "refund", aspect: "limit", says: `A refund above 500 needs a manager ${SENTINEL}`, sources: [`${cite}#ac-1`] }, { subject: "cart", aspect: "size", says: "A cart holds at most 50 lines", sources: [`${cite}#ac-2`] }));
  assert.deepEqual(recorded.outcomes, { new: 2 });
  first = jsonOf(req, ["snapshot", root]);
  assert.deepEqual([first.created, first.clarity], [true, "complete"]);
});

test("a work is one per requirement: started once, found by its work id, its item's id, its root or its snapshot", () => {
  const started = json(["start", "Implement the refund limit", "--ref=4312", `--snapshot=${first.snapshot}`]);
  assert.deepEqual([started.created, started.work, started.adopted], [true, workOf(root), first.snapshot]);
  const again = json(["start", "Something else entirely", "--ref=4312", `--snapshot=${first.snapshot}`]);
  assert.deepEqual([again.created, again.work, again.adopted], [false, started.work, null], "the same work, the objective it began with, nothing adopted twice");
  assert.equal(json(["start", "x", `--ref=${root}`]).work, started.work);
  assert.equal(json(["start", "x", `--ref=${first.snapshot}`]).work, started.work);
  for (const ref of [started.work, "4312", root]) assert.equal(json(["show", `--ref=${ref}`]).work, started.work);
  assert.equal(json(["show", started.work]).objective, "Implement the refund limit");
});

test("the same item id in two systems is two requirements, and a bare id that fits both is asked about, never guessed", () => {
  seed(OTHER);
  refused(["start", "x", "--ref=4312"], /is the id of more than one requirement here/);
  assert.equal(json(["start", "x", `--ref=${root}`]).created, false);
});

test("a snapshot another requirement froze, or one that was never frozen, is not adopted", () => {
  refused(["start", "x", `--ref=${root}`, "--snapshot=rs-aaaaaaaaaaaa"], /no snapshot rs-aaaaaaaaaaaa is kept for this requirement/);
});

test("work already started on an item is what a bare id resolves to, before the registry is asked", () => {
  const found = jsonOf(req, ["resolve", "4312"]);
  assert.deepEqual([found.rung, found.identity.provider, found.identity.id], ["work", "azure-devops", "4312"], "the item is known from the work; whether anything can read it here is a separate question");
});

const wid = () => workOf(root);
const factId = (subject) => jsonOf(req, ["show", first.snapshot, `--root=${root}`]).facts.find((f) => f.subject === subject).id;
const journalOf = () => readFileSync(join(json(["where"]).work, wid(), "journal.jsonl"), "utf8");

test("a batch of needs is all or nothing, judged against what the work stands on", () => {
  const before = journalOf();
  const limit = factId("refund");
  for (const [row, re] of [
    [{ type: "knowledge", subject: "limit", asks: "what is the limit" }, /names the capability that could serve it/],
    [{ type: "action", subject: "edit", asks: "edit the form", dependsOn: ["rf-ffffffffffff"] }, /not a fact of the snapshot this work adopted/],
    [{ type: "action", subject: "edit", asks: "edit", dependsOn: ["nd-ffffffffff"] }, /not a need proposed before this one/],
    [{ type: "action", subject: "edit", asks: "edit", scope: ["../secrets.txt"] }, /inside the project by relative path/],
    [{ type: "action", subject: "edit", asks: "edit", provider: "managed:docs" }, /unknown field "provider"/],
    [{ type: "ritual", subject: "edit", asks: "edit" }, /type/],
  ]) refused(["need", wid()], re, lines({ type: "action", subject: "ok", asks: "fine" }, row));
  assert.equal(journalOf(), before, "not one line of a refused batch was kept");
  const added = json(["need", wid()], lines({ type: "knowledge", subject: "limit", capability: "documentation.search", asks: "What does the documentation say about the refund limit?", dependsOn: [limit] }, { type: "action", subject: "form", asks: "Add the limit check to the refund form", scope: ["src/app/refunds.ts"] }));
  assert.equal(added.added.length, 2);
  assert.equal(json(["need", wid()], lines({ type: "action", subject: "form", asks: "Add the limit check to the refund form" })).existing.length, 1, "the same need again is the same need");
});

test("a need may depend on an earlier need, and only an earlier one", () => {
  const [first$, second$] = json(["show", wid()]).needs;
  const chained = json(["need", wid()], lines({ type: "proof", subject: "after", capability: "qa.investigation", asks: "Prove the limit holds", dependsOn: [first$.need, second$.need] }));
  assert.equal(chained.added.length, 1);
});

test("with the requirement settled the frontier holds what is ready, proof before knowledge before action", () => {
  const shown = json(["show", wid()]);
  assert.deepEqual(shown.frontier.map((f) => f.type), ["knowledge", "action"], "the proof waits on both");
  assert.equal(shown.needs.length, 3);
  assert.equal(shown.needs.every((n) => n.state === "pending"), true);
});

test("a need is settled on evidence and a reason, never on nothing", () => {
  const [knowledge, action] = json(["show", wid()]).needs;
  refused(["settle", wid(), action.need, "--state=satisfied"], /takes evidence/);
  refused(["settle", wid(), action.need, "--state=blocked"], /say why it is blocked/);
  refused(["settle", wid(), action.need, "--state=not-applicable"], /say why it is not needed/);
  refused(["settle", wid(), action.need, "--state=done", "--evidence=x"], /--state is one of/);
  refused(["settle", wid(), "nd-ffffffffff", "--state=blocked", "--why=x"], /there is no need/);
  refused(["settle", wid(), knowledge.need, "--state=satisfied", "--receipt=rct-9"], /is not an answered receipt/);
  const done = json(["settle", wid(), action.need, "--state=satisfied", "--evidence=the form check was added and the unit test for it passes"]);
  assert.deepEqual([done.need, done.state], [action.need, "satisfied"]);
  assert.equal(json(["show", wid()]).needs.find((n) => n.need === action.need).state, "satisfied");
});

test("on a machine with nothing to serve them, resolving blocks the need and remembers the gap once", () => {
  const first$ = json(["resolve", wid()]);
  assert.equal(first$.checked, 2, "the settled need is left alone");
  assert.deepEqual(first$.bound.map((b) => b.status).sort(), ["gap", "provided"], "nothing serves the documentation search, and a skill of Orbit's is what serves a proof");
  assert.equal(first$.opportunities.length >= 1, true);
  const known = spawnSync(process.execPath, [join(REPO, "cli", "knowledge.mjs"), "opportunities", "--json"], { env, encoding: "utf8" });
  const mine = JSON.parse(known.stdout).filter((o) => o.capability === "documentation.search");
  assert.equal(mine.length, 1, "one opportunity for the one capability nothing serves");
  const again = json(["resolve", wid()]);
  assert.equal(again.bound.length, 0, "asking again writes nothing");
  assert.equal(json(["show", wid()]).needs.find((n) => n.capability === "documentation.search").state, "blocked");
  assert.equal(json(["show", wid()]).needs.find((n) => n.capability === "documentation.search").binding.status, "gap");
});

test("nothing is asked of a need that nothing serves, and a claim needs an answer to rest on", () => {
  const [knowledge] = json(["show", wid()]).needs;
  refused(["invoke", wid(), knowledge.need, "--tool=search", '--input={"q":"x"}'], /nothing serves documentation\.search yet/);
  refused(["invoke", wid(), knowledge.need, "--tool=search", "--input=[1]"], /--input is one JSON object/);
  refused(["invoke", wid(), knowledge.need, "--tool=search", "--input=not json"], /not valid JSON/);
  refused(["invoke", wid()], /name the need to ask on behalf of/);
  const proof = json(["show", wid()]).needs.find((n) => n.type === "proof");
  refused(["invoke", wid(), proof.need, "--tool=anything"], /skill orbit-qa is followed, not invoked/);
  refused(["claim", wid(), knowledge.need], /has no answered receipt/, lines({ subject: "refund.limit", relation: "results-in", object: "manager.approval" }));
});

test("a checkpoint marks the frontier after looking again, and leaves a line on the trail with counts only", () => {
  const cp = json(["checkpoint", wid(), "--why=end of the first session"]);
  assert.match(cp.checkpoint, /^ckp-1$/);
  assert.equal(cp.frontier.length, 0, "the knowledge need is blocked, the proof waits on it, the action is done");
  const lastLine = journalOf().trim().split("\n").map((l) => JSON.parse(l)).at(-1);
  assert.deepEqual([lastLine.kind, lastLine.id, lastLine.frontier], ["checkpoint", "ckp-1", []]);
});

// ---- another day -------------------------------------------------------------------------------

let second;

test("the requirement moves: a person decides what a fact said, and a newer snapshot exists", () => {
  const asked = jsonOf(req, ["ask", root], lines({ slots: [{ subject: "refund", aspect: "limit" }], asks: "Is the limit before or after tax?", blocking: false, dependsOn: [cite] }));
  const decided = jsonOf(req, ["answer", root, `--question=${asked.questions[0].id}`, "--says=Before tax", "--human"]);
  assert.deepEqual(decided.facts.map((f) => [f.status, f.revision]), [["decided", 2]]);
  second = jsonOf(req, ["snapshot", root]);
  assert.equal(second.created, true);
  assert.notEqual(second.snapshot, first.snapshot);
});

test("resuming says a newer snapshot exists, stales only the need that depended on the fact, and never adopts it by itself", () => {
  const resumed = json(["resume", `--ref=${wid()}`]);
  assert.equal(resumed.newer, second.snapshot);
  assert.equal(resumed.snapshot, first.snapshot);
  assert.equal(resumed.stale.length, 1);
  const states = Object.fromEntries(resumed.needs.map((n) => [n.subject, n.state]));
  assert.deepEqual([states.limit, states.form], ["stale", "satisfied"], "the need that rested on the fact, and only that one");
  const again = json(["resume", wid()]);
  assert.equal(again.stale.length, 0, "the same fact at the same revision is not a new reason");
});

test("adopting the newer snapshot is a choice, written once, and the need is settled again on new evidence", () => {
  const adopted = json(["start", "ignored", `--ref=${root}`, `--snapshot=${second.snapshot}`]);
  assert.equal(adopted.adopted, second.snapshot);
  assert.equal(json(["show", wid()]).newer, null);
  const knowledge = json(["show", wid()]).needs.find((n) => n.capability === "documentation.search");
  const done = json(["settle", wid(), knowledge.need, "--state=blocked", "--why=nothing here can search documentation yet"]);
  assert.equal(done.state, "blocked");
});

test("recall names the work a task is about and where to pick it up, in a bounded number of lines", () => {
  const out = cli(["recall", "--for=Implement the refund limit"]).stdout;
  assert.match(out, new RegExp(`WORK ${wid()} — Implement the refund limit`));
  assert.match(out, /snapshot rs-[0-9a-f]{12}/);
  assert.ok(out.split("\n").length <= 24);
  assert.match(cli(["recall", "--for=refactor the logging module"]).stdout, /1 work\(s\) kept here, none about this task/);
  assert.match(cli(["recall", "--for-stdin"], "PBI 4312 next steps").stdout, new RegExp(wid()), "a bare item id names it, and stdin is how a task crosses a process");
});

test("project context shows the WORK section for the task", () => {
  const r = spawnSync(process.execPath, [join(REPO, "cli", "context.mjs"), "--for=Continue PBI 4312"], { env, encoding: "utf8", timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`== WORK ==\\nWORK ${wid()}`));
});

test("list says which works wait on a requirement, and reading never writes", () => {
  const before = journalOf();
  const listed = json(["list"]);
  assert.deepEqual([listed.works.length, listed.works[0].id, listed.works[0].clarity, listed.open], [1, wid(), "complete", 0]);
  json(["show", wid()]);
  cli(["recall", "--for=refund limit"]);
  assert.equal(journalOf(), before);
});

test("a journal from a newer Orbit is refused with a sentence and left exactly as it was", () => {
  const dir = join(json(["where"]).work, "w-aaaaaaaaaaaa");
  mkdirSync(dir, { recursive: true });
  const line = `${JSON.stringify({ at: NOW, kind: "created", id: "w-aaaaaaaaaaaa", objective: "from the future", schema: 99 })}\n`;
  writeFileSync(join(dir, "journal.jsonl"), line);
  refused(["show", "w-aaaaaaaaaaaa"], /written by a newer Orbit/);
  refused(["resume", "w-aaaaaaaaaaaa"], /written by a newer Orbit/);
  assert.equal(readFileSync(join(dir, "journal.jsonl"), "utf8"), line);
  assert.equal(json(["list"]).works.length, 2, "and it does not stop the others from being listed");
});

test("the trail holds counts and ids only, never a need's sentence, an answer or a word of the requirement", () => {
  const dir = join(base, "control", "activity", "trace");
  const trail = readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  const types = trail.map((e) => e.type).filter((t) => t.startsWith("work."));
  assert.deepEqual([...new Set(types)].sort(), ["work.checkpoint", "work.need.settled", "work.resumed", "work.started"]);
  const raw = JSON.stringify(trail);
  for (const word of ["refund", "documentation", "SENTINEL", "Before tax", "form check", "objective"]) assert.equal(raw.includes(word), false, `the trail holds no word of the work: ${word}`);
});
