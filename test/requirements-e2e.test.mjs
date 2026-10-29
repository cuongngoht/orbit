// "Implement PBI 4312" on one day, and "continue PBI 4312" on the next, by another session that
// remembers nothing -- driven through the commands' own `run`, in process, with no network and no
// browser. Everything is real except the machine: the stores are real directories, the registry,
// the resolver, the MCP broker and its gates, the capability pipeline and knowledge's stamped door
// are the engine's own; a work item is a scripted reader, and a managed server is a function.
//
// Day 1 settles the requirement and does the first half of the work. Day 2 builds every port anew
// over the same store, with another host and another date, and must find the exact frontier
// without reading the item again, asking an answered question again or rebuilding what exists.
// Then the requirement moves under the work, and only what rested on what moved goes stale.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { settle } from "../src/knowledge/opportunities.mjs";
import { authorityOf } from "../src/knowledge/vocab.mjs";
import { setEnabled } from "../src/mcp/manage.mjs";
import { COMMANDS as REQUIREMENT_COMMANDS } from "../src/requirements/index.mjs";
import { createRequirements } from "../src/requirements/store.mjs";
import { identify } from "../src/requirements/snapshot.mjs";
import { PROVIDERS } from "../src/resources/providers/index.mjs";
import { getEffectiveResources } from "../src/resources/registry.mjs";
import { COMMANDS as SOURCE_COMMANDS } from "../src/sources/index.mjs";
import { sourceId } from "../src/sources/model.mjs";
import { createSources } from "../src/sources/store.mjs";
import { realIo } from "../src/store/io.mjs";
import { COMMANDS as WORK_COMMANDS } from "../src/work/index.mjs";
import { latestIn, snapshotIn } from "../src/work/requirement.mjs";
import { createWorks, workOf } from "../src/work/store.mjs";
import { listed } from "../src/work/summary.mjs";
import { descriptorsOf, readerResources, requirementWorld } from "../skills/orbit-requirements/bind.mjs";
import { matchRef } from "../skills/orbit-requirements/descriptor.mjs";
import { fakeServer, managedMcp } from "./fakes/managed-mcp.mjs";
import { knowledgeWorld } from "./fakes/knowledge.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(HERE, "fixtures", "requirements", "workitem-4312.json"), "utf8"));
const DESCRIPTORS = descriptorsOf();
const ADO_URL = "https://dev.azure.com/acme/Web%20Shop/_workitems/edit/4312";
const IDENTITY = (id) => ({ provider: "azure-devops", organization: "acme", project: "Web Shop", id: String(id) });
const DAY1 = { host: "laptop-a", at: "2026-09-30T10:00:00.000Z" };
const DAY2 = { host: "laptop-b", at: "2026-10-01T09:00:00.000Z" };
const ANSWER = "SENTINEL-E2E-ANSWER the refund limit page";
const SECRET = "sk-live-e2e-0001";

const REQ = { ...SOURCE_COMMANDS, ...REQUIREMENT_COMMANDS };
const lines = (...rows) => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;

// ---- the machine -------------------------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), "orbit-e2e-store-"));
after(() => rmSync(root, { recursive: true, force: true }));

const knowledge = knowledgeWorld({ files: { "src/app/signup.ts": "x" } });
const server = fakeServer({ reply: JSON.stringify({ hits: [{ title: ANSWER, url: "https://docs.example/refunds?token=abc#limit" }] }) });
const mcp = managedMcp({ after }, { server });

const machine = { revision: "7", readerCalls: [], input: "", caps: [], connected: true };

const connections = { list: () => (machine.connected ? [{ id: "ado-acme", provider: "azure-devops", organization: "acme", credential: { set: true, from: "env", name: "T" }, configured: true }] : []), record: () => ({ credential: "T" }) };

// A scripted reader of the fixture at the revision the machine is on, counting every read.
const reader = {
  key: "pack:orbit-requirements/azure-devops",
  kind: "pack",
  provides: ["workitem.read", "workitem.relations.read", "workitem.comments.read"],
  resolves: (ref) => matchRef(DESCRIPTORS.find((d) => d.id === "azure-devops"), ref),
  read: async (identity, capability) => {
    machine.readerCalls.push(`${identity.id}@${machine.revision}:${capability}`);
    const { comments, parent, children, related, ...base } = FIXTURE.revisions[machine.revision][identity.id];
    const parts = { "workitem.read": { ...base, parent, children, related }, "workitem.relations.read": { parent, children, related }, "workitem.comments.read": { comments } };
    return Object.fromEntries(Object.entries(parts[capability]).filter(([, v]) => v !== undefined));
  },
};

const effective = () => getEffectiveResources({ env: {}, plugin: "orbit", components: () => [], builtins: () => ({}), capabilities: () => machine.caps, packCapabilities: () => readerResources(connections, DESCRIPTORS), tools: () => [], mcp: () => mcp.entries() }, PROVIDERS);

// One session: every port built afresh over the same store, by whoever is speaking now.
function session({ host, at }) {
  const io = realIo({ host, now: () => at });
  const base = { project: { root, layout: 3 } };
  const ctx = { ...base, io, store: { root }, now: () => at, session: `s-${host}`, by: "session", seenBy: { host, at, session: `s-${host}` }, read: () => machine.input };
  ctx.requirements = createRequirements(root, io);
  ctx.sources = createSources(root, io);
  ctx.works = createWorks(root, io);
  ctx.world = requirementWorld(ctx.sources);
  ctx.identify = (r, identity) => identify({ requirements: ctx.requirements }, r, identity);
  ctx.sourceWorld = () => ({ descriptors: DESCRIPTORS, readers: [reader], works: () => listed(ctx.works).filter((w) => w.root), bindings: () => ctx.sources.bindings(), connections, effective, observe: () => [], probe: () => ({ ok: false }), opportunities, now: ctx.now, sources: ctx.sources, io, runtimeDir: join(root, "runtime") });
  ctx.snapshot = (id, r) => snapshotIn(ctx, id, r);
  ctx.latestSnapshot = (r) => latestIn(ctx, r);
  ctx.source = { fingerprints: () => ({}), files: () => ["src/app/signup.ts"] };
  ctx.effective = effective;
  ctx.opportunities = opportunities;
  ctx.workflow = "orbit-requirements";
  ctx.capabilityContext = { capabilities: { resolve: () => { throw new Error("no project capability is asked in this test"); } } };
  Object.defineProperty(ctx, "mcp", { get: () => mcp.context(), enumerable: true });
  ctx.memory = { knowledge: { ...knowledge, now: () => at }, tracked: knowledge.tracked() };
  return ctx;
}

const opportunities = { docs: () => knowledge.know.opportunities(), settle: (docs) => settle(knowledge, docs) };

const ask = (ctx, table, name, args, input = "") => {
  machine.input = input;
  return table[name].run(ctx, args);
};
const req = (ctx, name, args, input) => ask(ctx, REQ, name, args, input);
const work = (ctx, name, args, input) => ask(ctx, WORK_COMMANDS, name, args, input);

// Every file the work left in the store, read as text.
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const everything = () => walk(root).map((f) => readFileSync(f, "utf8")).join("\n");

const state = {};

// ---- day 1 ----------------------------------------------------------------------------------------------

test("day 1: a link is resolved to its system and its reader, and read once -- the text comes back once and is kept nowhere", async () => {
  const d1 = session(DAY1);
  const resolved = await req(d1, "resolve", [ADO_URL]);
  assert.deepEqual([resolved.rung, resolved.identity.id, resolved.provider.key], ["explicit", "4312", "pack:orbit-requirements/azure-devops"]);
  const got = await req(d1, "acquire", [ADO_URL]);
  state.root = got.root;
  state.workItem = sourceId(IDENTITY(4312), "workitem");
  state.parent = sourceId(IDENTITY(100), "workitem");
  assert.match(got.root, /^req-[0-9a-f]{12}$/);
  assert.deepEqual(got.items.map((i) => i.status).sort(), ["context", "new", "new"], "the item and its parent are read once each; the pull request is context");
  assert.equal(got.envelope.untrusted, true);
  assert.match(JSON.stringify(got.envelope), /SENTINEL-E2E-BODY/, "the caller is handed the text, once");
  assert.equal(machine.readerCalls.some((c) => c.startsWith("pr-77")), false, "a pull request is context and is never read");
  assert.equal(everything().includes("SENTINEL-E2E"), false, "and not a word of it reached the store");
});

test("day 1: what the item says is recorded as atomic facts, each citing its source and revision", () => {
  const d1 = session(DAY1);
  const out = req(d1, "record", [state.root], lines(
    { subject: "refund", aspect: "limit", says: "A refund above 500 needs a manager", sources: [`source:${state.workItem}@7#ac-1`] },
    { subject: "cart", aspect: "size", says: "A cart holds at most 50 lines", sources: [`source:${state.workItem}@7#ac-2`] },
    { subject: "refunds", aspect: "scope", says: "Refunds are a feature of the shop", sources: [`source:${state.parent}@3`] },
  ));
  assert.deepEqual(out.outcomes, { new: 3 });
  const refused = () => req(d1, "record", [state.root], lines({ subject: "x", aspect: "y", says: "z", sources: ["src/app/refunds.ts"] }));
  assert.throws(refused, /nothing was recorded — a batch is all or nothing/);
});

test("day 1: what nobody said is a blocking question; only a person's word answers it", () => {
  const d1 = session(DAY1);
  const asked = req(d1, "ask", [state.root], lines({ slots: [{ subject: "signup", aspect: "duplicate-email" }], asks: "What happens when the email already exists?", blocking: true, proposed: "Reject with a validation message", dependsOn: [`source:${state.workItem}@7`] }));
  state.question = asked.questions[0].id;
  assert.equal(req(d1, "status", [state.root]).clarity, "blocked");
  assert.throws(() => req(d1, "answer", [state.root, `--question=${state.question}`, "--says=Reject; no account is created"]), /a person's — relay it with --human/);
  const decided = req(d1, "answer", [state.root, `--question=${state.question}`, "--says=Reject; no account is created", "--human"]);
  assert.deepEqual(decided.facts.map((f) => [f.status, f.revision]), [["decided", 2]]);
  assert.equal(req(d1, "status", [state.root]).clarity, "complete");
});

test("day 1: the roundtable reviews the requirement before it is frozen -- an answered question is not asked again, nothing is decided, and the round ends where it began", () => {
  const d1 = session(DAY1);
  const first = req(d1, "clarify", [state.root]);
  assert.deepEqual([first.stop, first.next, first.envelope.perspective], [null, "product", "product"]);
  const again = lines({ slots: [{ subject: "signup", aspect: "duplicate-email" }], asks: "What should happen when the email already exists?", blocking: true });
  assert.equal(req(d1, "clarify", [state.root, "--review=product"], again).next, "domain");
  req(d1, "clarify", [state.root, "--review=domain"], "");
  req(d1, "clarify", [state.root, "--review=qa"], "");
  const closed = req(d1, "clarify", [state.root, "--critique"], lines({ candidate: "product-1", verdict: "keep" }));
  assert.deepEqual([closed.stop, closed.counts], ["no-new-questions", { pooled: 1, retained: 1, asked: 0, settled: 1 }], "a person already answered it: it is counted as settled and never put again");
  const status = req(d1, "status", [state.root]);
  assert.deepEqual([status.clarity, status.open.length], ["complete", 0], "the round decided nothing and asked nothing");
  assert.equal(req(d1, "clarify", [state.root]).stop, "no-new-questions", "the same state is not reviewed twice");
});

test("day 1: the requirement is frozen as one immutable snapshot, clear and still a draft", () => {
  const d1 = session(DAY1);
  const frozen = req(d1, "snapshot", [state.root]);
  state.snapshot1 = frozen.snapshot;
  assert.deepEqual([frozen.created, frozen.clarity, frozen.authority], [true, "complete", "draft"]);
  assert.equal(req(d1, "snapshot", [state.root]).created, false, "the same state is the same snapshot");
  const shown = req(d1, "show", [state.snapshot1, `--root=${state.root}`]);
  state.fact = Object.fromEntries(shown.facts.map((f) => [`${f.subject}/${f.aspect}`, f.id]));
  assert.equal(shown.facts.length, 4);
});

test("day 1: a work starts on the snapshot, says what it needs by capability, and binds each need through the resolver", () => {
  const d1 = session(DAY1);
  const started = work(d1, "start", ["Implement the refund limit", "--ref=4312", `--snapshot=${state.snapshot1}`]);
  state.work = started.work;
  assert.deepEqual([started.created, started.work, started.adopted], [true, workOf(state.root), state.snapshot1]);
  const added = work(d1, "need", [state.work], lines(
    { type: "knowledge", subject: "refund-limit", capability: "documentation.search", asks: "What does the documentation say about refund limits?", dependsOn: [state.fact["refund/limit"]] },
    { type: "action", subject: "signup-form", asks: "Reject a duplicate email in the signup form", dependsOn: [state.fact["signup/duplicate-email"]], scope: ["src/app/signup.ts"] },
  ));
  [state.knowledgeNeed, state.actionNeed] = added.added.map((n) => n.need);
  const bound = work(d1, "resolve", [state.work]);
  assert.deepEqual(bound.bound.map((b) => [b.need, b.status, b.provider]), [[state.knowledgeNeed, "provided", "managed:corp"]], "the action names no capability and is not bound");
});

test("day 1: the bound server is asked through the broker's gates, the receipt keeps digests and where the answer came from, and a claim rests on it", async () => {
  const d1 = session(DAY1);
  const out = await work(d1, "invoke", [state.work, state.knowledgeNeed, "--tool=search", '--input={"q":"refund limit"}']);
  assert.deepEqual([out.receipt.outcome, out.receipt.sourceRefs], ["ok", ["https://docs.example/refunds"]]);
  assert.match(out.result.text, /SENTINEL-E2E-ANSWER/, "the caller sees the answer");
  assert.equal(server.asked.filter((m) => m === "tools/call").length, 1);
  const claimed = work(d1, "claim", [state.work, state.knowledgeNeed], lines({ subject: "refund.limit", relation: "results-in", object: "manager.approval", because: "the documentation says a refund above the limit needs a manager" }));
  assert.deepEqual([claimed.state, claimed.projected], ["synced", 1]);
  const [claim] = knowledge.know.all();
  assert.deepEqual([claim.source, claim.strength], ["work-receipt", "observed"]);
  assert.equal(authorityOf({ ...claim, measured: claim.status }).tier, "inference", "one session, one observation");
  assert.deepEqual(work(d1, "settle", [state.work, state.knowledgeNeed, "--state=satisfied", `--receipt=${out.receipt.id}`]).state, "satisfied");
});

test("day 1: a checkpoint marks the frontier, and nothing the work kept holds a word of the item, an answer or a secret", () => {
  const d1 = session(DAY1);
  const cp = work(d1, "checkpoint", [state.work, "--why=end of the first day"]);
  assert.deepEqual(cp.frontier.map((f) => f.need), [state.actionNeed]);
  const kept = everything();
  for (const leak of ["SENTINEL-E2E", SECRET, "refund limit page"]) assert.equal(kept.includes(leak), false, `${leak} reached the store`);
  state.readsOnDay1 = machine.readerCalls.length;
});

// ---- day 2 ----------------------------------------------------------------------------------------------

test("day 2: another host, another date, every port built anew -- the work is found by the item's id, and the frontier is exact", async () => {
  const d2 = session(DAY2);
  assert.equal(work(d2, "show", ["--ref=4312"]).work, state.work);
  const resumed = await work(d2, "resume", ["--ref=4312"]);
  assert.deepEqual([resumed.stale.length, resumed.bound.length, resumed.checked], [0, 0, 0], "nothing moved, nothing was bound again, nothing needed to be");
  assert.deepEqual(resumed.frontier.map((f) => f.need), [state.actionNeed], "the knowledge need is done; only the action is left");
  assert.equal(resumed.snapshot, state.snapshot1);
  assert.equal(resumed.newer, null);
});

test("day 2: the item is not read again, the answered question is not asked again, and there is no second adapter or credential prompt", async () => {
  const d2 = session(DAY2);
  const again = await req(d2, "acquire", [ADO_URL]);
  assert.equal(machine.readerCalls.length, state.readsOnDay1, "a plain acquire reuses what was read");
  assert.equal(again.root, state.root);
  const refreshed = await req(d2, "acquire", [ADO_URL, "--refresh"]);
  assert.deepEqual([...new Set(refreshed.items.filter((i) => i.status !== "context").map((i) => i.status))], ["unchanged"], "a refresh that finds the same revision and digest changes nothing");
  state.readsAfterRefresh = machine.readerCalls.length;
  const status = req(d2, "status", [state.root]);
  assert.deepEqual([status.clarity, status.open.length], ["complete", 0]);
  const reasked = req(d2, "ask", [state.root], lines({ slots: [{ subject: "signup", aspect: "duplicate-email" }], asks: "What happens when the email already exists?", blocking: true }));
  assert.equal(reasked.questions[0].state, "answered", "an answer stays an answer");
  assert.equal(req(d2, "status", [state.root]).open.length, 0);
  assert.equal(server.asked.filter((m) => m === "tools/call").length, 1, "and nothing was asked of the server again");
});

test("day 2: the item moves to a revision that contradicts what was decided and changes one fact", async () => {
  const d2 = session(DAY2);
  machine.revision = "8";
  const refreshed = await req(d2, "acquire", [ADO_URL, "--refresh"]);
  assert.deepEqual(refreshed.items.find((i) => i.id === state.workItem).status, "changed");
  assert.deepEqual(refreshed.items.find((i) => i.id === state.parent).status, "unchanged");
  const out = req(d2, "record", [state.root], lines(
    { subject: "refund", aspect: "limit", says: "A refund above 1000 needs a manager", sources: [`source:${state.workItem}@8#ac-1`] },
    { subject: "signup", aspect: "duplicate-email", says: "A duplicate email creates a second account", sources: [`source:${state.workItem}@8#ac-3`] },
  ));
  assert.deepEqual(out.results.map((r) => r.outcome).sort(), ["changed", "held"], "a stated fact is replaced by its newer revision; a decision holds");
  const status = req(d2, "status", [state.root]);
  assert.deepEqual(status.open.map((q) => q.id), [state.question], "exactly the question that was answered is asked again");
  assert.equal(status.clarity, "blocked");
  assert.equal(req(d2, "show", [state.root]).facts.find((f) => f.subject === "signup").status, "decided", "until a person answers, the decision still holds");
  state.snapshot2 = req(d2, "snapshot", [state.root]).snapshot;
  assert.notEqual(state.snapshot2, state.snapshot1);
});

test("day 2: the requirement moved under the roundtable, so a new round begins -- and it SEES the question that was reopened", () => {
  const d2 = session(DAY2);
  const doc = req(d2, "clarify", [state.root]);
  assert.deepEqual([doc.stop, doc.round, doc.next], [null, 2, "product"], "a moved requirement is a new state, and round one is not repeated over it");
  assert.deepEqual(doc.envelope.open.map((q) => [q.id, q.blocking]), [[state.question, true]]);
});

test("day 2: only the need that rested on the fact that moved goes stale, and the newer snapshot is reported, never adopted", async () => {
  const d2 = session(DAY2);
  const resumed = await work(d2, "resume", [state.work]);
  assert.deepEqual([resumed.newer, resumed.snapshot], [state.snapshot2, state.snapshot1]);
  assert.deepEqual(resumed.stale.map((s) => [s.need, s.because]), [[state.knowledgeNeed, "fact"]]);
  const states = Object.fromEntries(resumed.needs.map((n) => [n.need, n.state]));
  assert.deepEqual([states[state.knowledgeNeed], states[state.actionNeed]], ["stale", "pending"]);
  assert.deepEqual(resumed.frontier.map((f) => f.need), [state.actionNeed]);
  assert.equal((await work(d2, "resume", [state.work])).stale.length, 0, "the same fact at the same revision is not a new reason");
});

test("day 2: the server is switched off and a project capability takes its place -- the binding moves, the need does not", async () => {
  const d2 = session(DAY2);
  setEnabled(mcp.manage, "corp", false);
  machine.caps = [{ id: "acme.docs", doc: "a project's own documentation reader", provides: ["documentation.search"] }];
  const resumed = await work(d2, "resume", [state.work]);
  assert.deepEqual(resumed.stale.map((s) => [s.need, s.because]), [[state.knowledgeNeed, "binding"]]);
  assert.deepEqual(resumed.bound.map((b) => [b.need, b.provider?.key, b.status]), [[state.knowledgeNeed, "acme.docs", "provided"]]);
  const need = resumed.needs.find((n) => n.need === state.knowledgeNeed);
  assert.deepEqual([need.capability, need.state], ["documentation.search", "stale"], "it still asks for the same capability, and still rests on a fact that moved");
  assert.equal(resumed.needs.find((n) => n.need === state.actionNeed).state, "pending");
});

test("day 2: settled again on new evidence, the work resumes clean -- and what a person decided is still theirs", async () => {
  const d2 = session(DAY2);
  work(d2, "settle", [state.work, state.knowledgeNeed, "--state=satisfied", "--evidence=re-read against revision 8: the limit is 1000"]);
  const resumed = await work(d2, "resume", [state.work]);
  assert.equal(resumed.stale.length, 0);
  assert.deepEqual(resumed.needs.map((n) => n.state).sort(), ["pending", "satisfied"]);
  const answered = req(d2, "answer", [state.root, `--question=${state.question}`, "--says=Reject; no account is created", "--human"]);
  assert.deepEqual(answered.facts.map((f) => f.status), ["decided"]);
  assert.equal(req(d2, "status", [state.root]).open.length, 0, "a person answering again settles the reopened question");
});

test("the whole of it left the store with no word of the item, no answer and no secret, and one work", () => {
  const kept = everything();
  for (const leak of ["SENTINEL-E2E", SECRET, "the refund limit page"]) assert.equal(kept.includes(leak), false, `${leak} reached the store`);
  assert.equal(listed(createWorks(root, realIo())).length, 1, "one work for one requirement, across both days");
  assert.equal(knowledge.know.all().length, 1, "and one claim, credited to the session that got the answer");
  assert.ok(machine.readerCalls.length > state.readsAfterRefresh, "the moved revision WAS read, when a refresh asked for it");
});
