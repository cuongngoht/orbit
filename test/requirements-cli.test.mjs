// The composition root: every command a person or a model can run, as they run it. The
// tables are held to their own columns; the real CLI is driven through a whole
// requirement -- source, facts, a question, a person's answer, a snapshot, an acceptance --
// offline, against a source record the test seeds where an acquisition would have put it;
// and the world the CLI composes (connection -> reader -> registry -> ladder -> acquire) is
// driven once with a fake network, to prove the wiring and that no credential lands anywhere.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createConnections } from "../src/connections/manage.mjs";
import { connectionStore } from "../src/connections/store.mjs";
import { withExtensions } from "../src/extensions/index.mjs";
import { storeBase } from "../src/project/repository.mjs";
import { requirementsContext } from "../src/requirements/context.mjs";
import { COMMANDS as REQUIREMENT_COMMANDS } from "../src/requirements/index.mjs";
import { createRequirements } from "../src/requirements/store.mjs";
import { createContext } from "../src/run/context.mjs";
import { acquire } from "../src/sources/acquire.mjs";
import { sourcesContext } from "../src/sources/context.mjs";
import { COMMANDS as SOURCE_COMMANDS } from "../src/sources/index.mjs";
import { rootId, sourceRecord, workitemText } from "../src/sources/model.mjs";
import { createSources } from "../src/sources/store.mjs";
import { secretSource } from "../src/secrets.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { documented, headerOf } from "../src/trace/commands.mjs";
import { realWorld } from "../skills/orbit-control/world.mjs";
import { providers } from "../skills/orbit-report/pack.mjs";
import { sourceWorld } from "../skills/orbit-requirements/bind.mjs";
import { sealed } from "./home.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "cli", "requirements.mjs");
const FIXTURE = join(REPO, "test", "fixtures", "ui-tests");
const NOW = "2026-09-30T10:00:00.000Z";
const IDENTITY = { provider: "azure-devops", organization: "acme", project: "Web Shop", id: "4312" };
const ADO_URL = "https://dev.azure.com/acme/Web%20Shop/_workitems/edit/4312";
const TOKEN = "SENTINEL-TOKEN-0123456789";
const BODY = "SENTINEL-BODY refunds above the limit need approval";

const TABLE = { ...SOURCE_COMMANDS, ...REQUIREMENT_COMMANDS };

test("every command declares what it writes and what it needs, and how to say its answer; the two tables never share a name", () => {
  for (const [name, c] of Object.entries(TABLE)) {
    assert.ok(["nothing", "store"].includes(c.writes), `${name} writes`);
    assert.ok(["store", "sources", "resources"].includes(c.needs), `${name} needs`);
    assert.equal(typeof c.run, "function", name);
    assert.equal(typeof c.say, "function", name);
  }
  assert.equal(Object.keys(TABLE).length, Object.keys(SOURCE_COMMANDS).length + Object.keys(REQUIREMENT_COMMANDS).length);
});

test("reading commands write nothing; the ones that need to read the network are the only ones that need resources", () => {
  const reads = Object.entries(TABLE).filter(([, c]) => c.writes === "nothing").map(([n]) => n).sort();
  assert.deepEqual(reads, ["show", "status", "where", "why"]);
  assert.deepEqual(Object.entries(TABLE).filter(([, c]) => c.needs === "resources").map(([n]) => n).sort(), ["acquire", "resolve"]);
});

test("the usage header documents every subcommand, so the session trail may name each and nothing else", () => {
  const subs = documented(headerOf(readFileSync(CLI, "utf8")), "requirements");
  assert.deepEqual([...subs].sort(), Object.keys(TABLE).sort());
});

test("what speaks for a person is refused without --human, before anything else is looked at", () => {
  const inert = new Proxy({}, { get: () => { throw new Error("touched the context"); } });
  const refused = (name, args) => assert.throws(() => TABLE[name].run(inert, args), /a person's — relay it with --human/, name);
  refused("answer", ["req-aaaaaaaaaaaa", "--question=rq-aaaaaaaaaaaa", "--says=x"]);
  refused("withdraw", ["req-aaaaaaaaaaaa", "--question=rq-aaaaaaaaaaaa"]);
  refused("bind", ["github", "--organization=acme"]);
  refused("accept", ["src-aaaaaaaaaaaa"]);
});

test("a root id is required and must look like one; a requirement nobody acquired is not made by a typo", () => {
  const inert = { requirements: { open: () => ({ state: () => ({}), journalLines: () => [] }) } };
  assert.throws(() => TABLE.status.run(inert, ["not-a-root"]), /name the requirement by its root id/);
  assert.throws(() => TABLE.record.run(inert, ["req-aaaaaaaaaaaa"]), /no requirement req-aaaaaaaaaaaa is kept here — acquire its source first/);
});

// ---- the real CLI, offline ---------------------------------------------------------------------

const base = mkdtempSync(join(tmpdir(), "orbit-req-cli-"));
const env = sealed({ ORBIT_STORE_DIR: base, ORBIT_UI_TESTS: FIXTURE });
const cli = (args, input) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8", input });
const json = (args, input) => {
  const r = cli([...args, "--json"], input);
  assert.equal(r.status, 0, `${args.join(" ")}\n${r.stderr}${r.stdout}`);
  return JSON.parse(r.stdout);
};
const lines = (...rows) => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;

test("with no help asked, an unknown command prints the usage and exits 0; where creates nothing", () => {
  const help = cli(["nonsense"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /REQUIREMENT INTELLIGENCE/);
  const where = json(["where"]);
  assert.deepEqual(where.kept, []);
  assert.equal(existsSync(join(where.store, "requirements")), false);
  assert.equal(existsSync(join(where.store, "sources")), false);
});

test("refusals are exit 2 with a sentence, and a person's word is required where it is", () => {
  for (const [args, re] of [[["record", "req-aaaaaaaaaaaa"], /no requirement req-aaaaaaaaaaaa is kept here/], [["answer", "req-aaaaaaaaaaaa", "--question=rq-aaaaaaaaaaaa", "--says=x"], /--human/], [["bind", "github", "--organization=acme"], /--human/], [["accept", "src-aaaaaaaaaaaa"], /--human/], [["status", "nope"], /root id/]]) {
    const r = cli(args);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, re);
  }
});

test("a link on an empty machine is a GAP -- an opportunity knowledge keeps, exit 0 -- and asking again raises no second", () => {
  const first = json(["resolve", ADO_URL]);
  assert.deepEqual([first.rung, first.gap, first.identity.id], ["explicit", true, "4312"]);
  assert.match(first.opportunity, /^opp-[0-9a-f]{12}$/);
  const again = json(["resolve", ADO_URL]);
  assert.equal(again.opportunity, first.opportunity);
  const known = spawnSync(process.execPath, [join(REPO, "cli", "knowledge.mjs"), "opportunities", "--json"], { env, encoding: "utf8" });
  assert.equal(known.status, 0, known.stderr);
  const mine = JSON.parse(known.stdout).filter((o) => o.capability === "workitem.read");
  assert.deepEqual([mine.length, mine[0].id, mine[0].remedy, mine[0].state, mine[0].history[0].workflow], [1, first.opportunity, "enable", "candidate", "orbit-requirements"], "it is the opportunity knowledge already keeps, raised by this workflow");
});

test("a whole requirement through the CLI: facts, a blocking question, a person's answer, a snapshot, an acceptance -- and the trail holds counts, never words", () => {
  const where = json(["where"]);
  const sources = createSources(where.store, realIo());
  const rec = sourceRecord({ identity: IDENTITY, kind: "workitem", ref: "4312", revision: "7", text: workitemText({ title: "t", body: BODY }), now: NOW });
  sources.saveRecord(rec);
  const root = rootId(IDENTITY);
  const port = createRequirements(where.store, realIo()).open(root);
  port.transact(() => port.setState({ sources: {}, position: 0, lastSnapshot: null, identity: IDENTITY }));
  const cite = `source:${rec.id}@7`;

  const recorded = json(["record", root], lines({ subject: "refund", aspect: "limit", says: "A refund above 500 needs a manager", sources: [`${cite}#ac-1`] }));
  assert.deepEqual([recorded.outcomes, recorded.results[0].status], [{ new: 1 }, "stated"]);
  const refusedBatch = cli(["record", root], lines({ subject: "refund", aspect: "cap", says: "x", sources: [`${cite}`] }, { subject: "refund", aspect: "y", says: "z", sources: ["src/app/refunds.ts"] }));
  assert.equal(refusedBatch.status, 2);
  assert.match(refusedBatch.stderr, /nothing was recorded — a batch is all or nothing/);

  const asked = json(["ask", root], lines({ slots: [{ subject: "signup", aspect: "duplicate-email" }], asks: "What happens when the email already exists?", blocking: true, dependsOn: [cite] }));
  assert.equal(asked.questions[0].blocking, true);
  assert.equal(json(["status", root]).clarity, "blocked");
  const q = asked.questions[0].id;

  assert.match(cli(["answer", root, `--question=${q}`, "--says=Reject; no account is created"]).stderr, /--human/);
  const decided = json(["answer", root, `--question=${q}`, "--says=Reject; no account is created", "--human"]);
  assert.deepEqual(decided.facts.map((f) => f.status), ["decided"]);

  const frozen = json(["snapshot", root]);
  assert.deepEqual([frozen.created, frozen.clarity, frozen.authority], [true, "complete", "draft"]);
  assert.deepEqual(json(["snapshot", root]).created, false);
  assert.equal(json(["snapshot", root]).snapshot, frozen.snapshot);

  const accepted = json(["accept", rec.id, "--human"]);
  assert.equal(accepted.authority, "accepted");
  const stronger = json(["snapshot", root]);
  assert.deepEqual([stronger.created, stronger.authority, stronger.snapshot === frozen.snapshot], [true, "accepted", false]);

  const shown = json(["show", stronger.snapshot, `--root=${root}`]);
  assert.deepEqual(shown.facts.map((f) => f.says).sort(), ["A refund above 500 needs a manager", "Reject; no account is created"]);
  assert.equal(json(["show", root]).snapshot.id, stronger.snapshot);
  assert.equal(json(["why", root, q]).history.at(-1).kind, "answered");
  assert.equal(json(["replay", root, "--check"]).differences, 0);
  assert.equal(json(["replay", root]).differences, 0);
  assert.match(cli(["status", root]).stdout, /CLARITY     complete\nAUTHORITY   accepted/);

  const trail = readdirSync(join(base, "control", "activity", "trace")).flatMap((f) => readFileSync(join(base, "control", "activity", "trace", f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  const types = trail.map((e) => e.type).filter((t) => t.startsWith("requirements."));
  assert.deepEqual([...new Set(types)].sort(), ["requirements.decision.recorded", "requirements.question.asked", "requirements.recorded", "requirements.snapshot.created"]);
  const raw = JSON.stringify(trail);
  for (const word of ["refund", "manager", "email", "SENTINEL", "no account"]) assert.equal(raw.includes(word), false, `the trail holds no word of the requirement: ${word}`);
});

test("a person may withdraw a question through the CLI, and only with --human", () => {
  const where = json(["where"]);
  const root = rootId(IDENTITY);
  const [q] = json(["ask", root], lines({ slots: [{ subject: "cart", aspect: "size" }], asks: "How many lines may a cart hold?", blocking: false })).questions;
  assert.equal(cli(["withdraw", root, `--question=${q.id}`]).status, 2);
  assert.equal(json(["withdraw", root, `--question=${q.id}`, "--why=not needed", "--human"]).state, "withdrawn");
  assert.ok(where.kept.includes(root));
});

// ---- the roundtable, through the real CLI -----------------------------------------------------------------

const roundBase = mkdtempSync(join(tmpdir(), "orbit-req-round-"));
const roundEnv = sealed({ ORBIT_STORE_DIR: roundBase, ORBIT_UI_TESTS: FIXTURE });
const rcli = (args, input) => spawnSync(process.execPath, [CLI, ...args], { env: roundEnv, encoding: "utf8", input });
const rjson = (args, input) => {
  const r = rcli([...args, "--json"], input);
  assert.equal(r.status, 0, `${args.join(" ")}\n${r.stderr}${r.stdout}`);
  assert.equal(/\u001b/.test(r.stdout), false, "JSON carries no escape sequence");
  return JSON.parse(r.stdout);
};
const proposal = (aspect, over = {}) => ({ slots: [{ subject: "export", aspect }], asks: `What happens with export ${aspect}?`, blocking: false, ...over });
const verdicts = (...rows) => lines(...rows);

function seeded(identity) {
  const store = rjson(["where"]).store;
  const rec = sourceRecord({ identity, kind: "workitem", ref: identity.id, revision: "3", text: workitemText({ title: "t", body: "SENTINEL-ROUND-BODY export results" }), now: NOW });
  createSources(store, realIo()).saveRecord(rec);
  const root = rootId(identity);
  const port = createRequirements(store, realIo()).open(root);
  port.transact(() => port.setState({ sources: {}, position: 0, lastSnapshot: null, identity }));
  return { root, store, cite: `source:${rec.id}@3` };
}

const journalLength = (store, root) => readFileSync(join(store, "requirements", root, "journal.jsonl"), "utf8").split("\n").filter(Boolean).length;

test("the roundtable through the real CLI: short calls, a board in words, JSON that is only JSON, one line when quiet", () => {
  const { root, store, cite } = seeded({ ...IDENTITY, id: "5000" });
  rjson(["record", root], lines({ subject: "export", aspect: "scope", says: "Search results can be exported", sources: [`${cite}#ac-1`] }));

  const first = rjson(["clarify", root]);
  assert.deepEqual([first.stage, first.round, first.stop, first.next, first.envelope.perspective, first.identity.id], ["handoff", 1, null, "product", "product", "5000"]);
  const text = rcli(["clarify", root]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, new RegExp(`^Requirement Roundtable · ${root} \\(azure-devops 5000\\) · Round 1\n\n◐ Product\n {2}reviewing actor, goal and scope\.\.\.\n○ Domain\n○ QA\n○ Socrates\n\nENVELOPE {2}\\{`));
  assert.equal(/\u001b/.test(text.stdout), false, "the board is plain text, so it works in any terminal and in a log");
  const quiet = rcli(["clarify", root, "--quiet"]);
  assert.equal(quiet.stdout, `ROUNDTABLE  ${root} round 1 · next product\n`);
  assert.equal(JSON.parse(rcli(["clarify", root, "--quiet", "--json"]).stdout).stage, "handoff", "--json wins over --quiet");

  const product = rjson(["clarify", root, "--review=product", `--digest=${first.digest}`], lines(proposal("authorization", { blocking: true, proposed: "Only users with export permission" }), proposal("filters")));
  assert.deepEqual([product.stage, product.did, product.next, product.envelope.perspective], ["review", "product reviewed (2 candidates)", "domain", "domain"]);
  assert.equal(rjson(["clarify", root, "--review=domain"], lines(proposal("snapshot", { blocking: true }))).next, "qa");
  const qa = rjson(["clarify", root, "--review=qa", "--failed"]);
  assert.deepEqual([qa.failed, qa.next, qa.envelope.perspective, qa.envelope.pooled.map((c) => c.id)], [["qa"], "socrates", "socrates", ["product-1", "product-2", "domain-1"]]);

  const critic = lines({ candidate: "product-1", verdict: "keep" }, { candidate: "product-2", verdict: "drop", because: "an implementation detail" }, { candidate: "domain-1", verdict: "keep" });
  const closed = rcli(["clarify", root, "--critique"], critic);
  assert.equal(closed.status, 0, closed.stderr);
  assert.match(closed.stdout, /✓ Socrates\n {2}3 candidates → 2 retained · 2 asked · 0 already settled\n\n\? Human decision required · 2 questions\n {2}rq-[0-9a-f]{12} {2}BLOCKING {2}/);
  assert.match(closed.stdout, /suggestion, not a decision: Only users with export permission/);
  const waiting = rjson(["clarify", root]);
  assert.deepEqual([waiting.stop, waiting.questions.length, waiting.questions.every((q) => q.blocking)], ["waiting-human", 2, true]);
  assert.equal(rcli(["clarify", root, "--quiet"]).stdout, `ROUNDTABLE  ${root} round 1 · waiting-human · 2 question(s)\n`);

  const length = journalLength(store, root);
  assert.equal(rjson(["clarify", root]).stop, "waiting-human");
  assert.equal(journalLength(store, root), length, "asking about an unchanged state writes nothing");

  for (const q of waiting.questions) assert.equal(rjson(["answer", root, `--question=${q.id}`, `--says=Decision for ${q.id}`, "--human"]).facts[0].status, "decided");
  const second = rjson(["clarify", root]);
  assert.deepEqual([second.stop, second.round, second.next], [null, 2, "product"]);
  for (const p of ["product", "domain", "qa"]) rjson(["clarify", root, `--review=${p}`], "");
  const done = rjson(["clarify", root, "--critique"], "");
  assert.deepEqual([done.stop, done.round, done.counts.asked, done.events[3].state], ["no-new-questions", 2, 0, "skipped"]);
  const frozen = rjson(["snapshot", root]);
  assert.deepEqual([frozen.created, frozen.clarity, frozen.open], [true, "complete", 0]);
  assert.equal(rjson(["replay", root, "--check"]).differences, 0, "the round's lines change nothing the journal re-derives");
  assert.deepEqual(Object.keys(rjson(["status", root])).includes("clarity"), true);

  const trail = readdirSync(join(roundBase, "control", "activity", "trace")).flatMap((f) => readFileSync(join(roundBase, "control", "activity", "trace", f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  const rounds = trail.filter((e) => e.type.startsWith("requirements.roundtable."));
  assert.deepEqual([rounds.filter((e) => e.type.endsWith("reviewed")).length, rounds.filter((e) => e.type.endsWith("closed")).length], [6, 2]);
  const raw = JSON.stringify(trail);
  for (const word of ["authorization", "permission", "SENTINEL-ROUND-BODY", "What happens", "implementation detail", "Decision for"]) assert.equal(raw.includes(word), false, `the trail holds no word of the round: ${word}`);
});

test("the roundtable refuses what it must, with a sentence and exit 2, and a refused hand-in writes nothing", () => {
  const { root, store, cite } = seeded({ ...IDENTITY, id: "5001" });
  rjson(["record", root], lines({ subject: "export", aspect: "scope", says: "Search results can be exported", sources: [cite] }));
  const refused = (args, re, input) => {
    const r = rcli(args, input);
    assert.equal(r.status, 2, `${args.join(" ")} -> ${r.stdout}`);
    assert.match(r.stderr, re, args.join(" "));
  };
  const length = journalLength(store, root);
  refused(["clarify", "nope"], /name the requirement by its root id/);
  refused(["clarify", "req-ffffffffffff"], /no requirement req-ffffffffffff is kept here/);
  refused(["clarify", root, "--human"], /clarify is the engine's/);
  refused(["clarify", root, "--review"], /name the perspective/);
  refused(["clarify", root, "--review=socrates"], /socrates is not a reviewer/, "");
  refused(["clarify", root, "--review=product", "--critique"], /two stages of a round/);
  refused(["clarify", root, "--failed"], /goes with --review/);
  refused(["clarify", root, "--critique"], /product, domain, qa have not reviewed/, "");
  refused(["clarify", root, "--review=product"], /a person decides/, lines({ ...proposal("authorization"), status: "decided", human: true }));
  refused(["clarify", root, "--review=product"], /line 2: not valid JSON/, `${JSON.stringify(proposal("authorization"))}\nnot json\n`);
  refused(["clarify", root, "--review=product", "--digest=0000000000000000"], /moved while this was being reviewed/, "");
  assert.equal(journalLength(store, root), length, "not one refusal wrote a line");
  assert.equal(rjson(["status", root]).open.length, 0, "and nothing was asked");
});

// ---- the world the CLI composes ---------------------------------------------------------------------

const reply = (status, body) => ({ status, headers: { get: (k) => (k.toLowerCase() === "content-type" ? "application/json" : null) }, json: async () => body, text: async () => JSON.stringify(body) });

const ADO_ITEM = { id: 4312, rev: 7, fields: { "System.Title": "Refund limit", "System.WorkItemType": "Product Backlog Item", "System.State": "Active", "System.Description": `<p>${BODY}</p>`, "System.TeamProject": "Web Shop", "System.ChangedDate": "2026-09-29T00:00:00Z" }, relations: [{ rel: "System.LinkTypes.Related", url: "https://dev.azure.com/acme/_apis/wit/workItems/55" }, { rel: "ArtifactLink", url: "vstfs:///Git/PullRequestId/p%2Fr%2F77", attributes: { name: "Pull Request" } }] };

function network() {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, authorization: init.headers.authorization });
    if (/comments/.test(url)) return reply(200, { comments: [{ id: 1, createdDate: "t", createdBy: { displayName: "Someone" }, text: "<p>please cap it</p>" }] });
    const id = /workitems\/(\d+)/.exec(url)?.[1];
    return id ? reply(200, id === "4312" ? ADO_ITEM : { id: Number(id), rev: 1, fields: { "System.Title": `Item ${id}`, "System.TeamProject": "Web Shop" } }) : reply(404, {});
  };
  return { fetch, calls };
}

test("the composed world reads a work item end to end: a connection makes its reader ready, the ladder chooses it from the link, acquire keeps records and no text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-req-world-"));
  const worldEnv = sealed({ ORBIT_STORE_DIR: dir, ORBIT_UI_TESTS: FIXTURE, REQ_TEST_TOKEN: TOKEN });
  const base2 = await withExtensions(createContext({}, worldEnv));
  const req = requirementsContext(base2, worldEnv);
  const src = sourcesContext(base2, worldEnv);
  const real = realWorld({ pluginRoot: REPO, projectRoot: FIXTURE, env: worldEnv, nativeFactory: () => ({}) });
  const connections = createConnections({ store: connectionStore(stateRooms(storeBase(worldEnv)), realIo()), secrets: secretSource({ env: worldEnv }), providers: providers(), now: () => NOW });
  connections.create({ id: "ado", provider: "azure-devops", host: "https://dev.azure.com", organization: "acme" });
  await connections.setCredential("ado", { env: "REQ_TEST_TOKEN" });
  const net = network();
  const w = sourceWorld({ base: base2, real, sources: src.sources, io: src.io, fetch: net.fetch, nowMs: () => 0, opportunities: { docs: () => [], settle: () => ({ written: [], refused: [] }) } });
  const got = await acquire(w, { ref: ADO_URL });
  assert.equal(got.provider, "pack:orbit-requirements/azure-devops");
  assert.deepEqual([got.root, got.binding, got.identity.project], [rootId(IDENTITY), "engine", "Web Shop"]);
  assert.match(JSON.stringify(got.envelope.content), /SENTINEL-BODY/);
  assert.deepEqual(got.items.map((i) => i.status).sort(), ["context", "new", "new"], "the item, the related item, and the pull request as context");
  assert.ok(net.calls.length > 0 && net.calls.every((c) => c.authorization === `Basic ${Buffer.from(`:${TOKEN}`).toString("base64")}`), "the credential went to the source in one header");
  const files = allFiles(dir);
  assert.ok(files.length > 5);
  for (const f of files) assert.equal(readFileSync(f, "utf8").includes(TOKEN), false, `${f} holds the credential`);
  for (const f of files.filter((x) => !/connections/.test(x))) assert.equal(readFileSync(f, "utf8").includes("SENTINEL-BODY"), false, `${f} holds the text of the work item`);
  assert.equal(req.requirements.roots().length, 0, "reading a source does not make a requirement");
});

function allFiles(dir) {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? allFiles(join(dir, n)) : [join(dir, n)]));
}
