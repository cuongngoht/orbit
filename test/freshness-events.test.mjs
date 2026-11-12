// WHAT EACH OWNER SAYS MOVED when the checkout moves (0.6.0, U4), on a REAL git repository: a committed edit, an
// uncommitted edit, a rename, a delete and a branch switch -- across every owner that keeps a record dated against the
// tree: architecture facts, intelligence facts, engineering facts, knowledge claims (`measured`), investigation receipts
// (`applicabilityOf`) and a work's settled needs (`invalidated`). Each keeps ONE record per scope below, and the test
// asserts, owner by owner, exactly which records the event moved and to what.
//
// Freshness is keyed to a record's own scope, never HEAD (src/freshness.mjs): a committed change is `stale`; an edit the
// index cannot see is `unknown`; a scope the index no longer holds is GONE -- still `unknown` for a record (nothing
// says what the record would say now), but said with a sentence of its own, so a reader tells "the file was deleted or
// moved away" from "nothing could be asked". A conclusion is never reused because the repository is the same: a work's
// need settled on a file that is gone is invalidated, as one settled on a file that moved is.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { builtinEcosystems } from "../src/ecosystems/builtin.mjs";
import { ensureFacts as architectureFacts } from "../src/architecture/facts.mjs";
import { ensureFacts as engineeringFacts } from "../src/engineering/freshen.mjs";
import { FRESH, STALE, UNKNOWN, factState, measure } from "../src/freshness.mjs";
import { createSourceTree } from "../src/frontend/composite.mjs";
import { ensureFacts as intelligenceFacts } from "../src/intelligence/facts.mjs";
import { createIntelligenceRegistry } from "../src/intelligence/registry.mjs";
import { applicabilityOf } from "../src/investigation/receipts.mjs";
import { measured as knowledgeMeasured } from "../src/knowledge/query.mjs";
import { realIo } from "../src/store/io.mjs";
import { addNeeds, settleNeed, startWork } from "../src/work/actions.mjs";
import { invalidated } from "../src/work/freshness.mjs";
import { modelOf } from "../src/work/model.mjs";
import { createWorks, workOf } from "../src/work/store.mjs";
import { registryOf } from "./fakes/knowledge.mjs";
import { sealed } from "./home.mjs";

const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@orbit.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@orbit.invalid" };
const NOW = "2026-11-12T10:00:00.000Z";

const TREE = { "web/login.js": "export const login = () => 1;\n", "web/api.js": "export const api = () => 2;\n", "server/session.py": "def session():\n    return 3\n", "README.md": "# demo\n" };

// One record per scope, in every owner: a file, the directory it lies in, and the same pair on the other side.
const SCOPES = ["web/login.js", "web", "server/session.py", "server"];

const git = (repo, args) => execFileSync("git", args, { cwd: repo, env: sealed(GIT_ENV), stdio: "ignore" });

const write = (repo, rel, text) => (mkdirSync(dirname(join(repo, rel)), { recursive: true }), writeFileSync(join(repo, rel), text));

function repoOf(t) {
  const base = mkdtempSync(join(tmpdir(), "orbit-freshness-events-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  for (const [rel, text] of Object.entries(TREE)) write(repo, rel, text);
  for (const a of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-qm", "one"]]) git(repo, a);
  return { base, repo, source: createSourceTree([repo]) };
}

// ---- the records each owner keeps, stamped against the tree as it was -------------------------------------------

const modelOfTree = (source) => ({ scopes: Object.fromEntries(Object.entries(source.fingerprints(SCOPES)).map(([s, v]) => [s, { hash: v.hash }])), manifests: [] });

const factsAbout = (prefix) => SCOPES.map((s) => ({ id: `${prefix}:${s}`, kind: "module", key: s, scope: [s], status: FRESH }));

const statesBy = (records, scopes, scopeOf) => Object.fromEntries(records.map((r) => [r.id, factState({ scope: scopeOf(r) }, scopes)]));

const OWNERS = {
  architecture: (k, source) => statesBy(k.architecture, architectureFacts({ arch: { model: () => ({ model: k.model }), all: () => k.architecture }, source }).scopes, (f) => f.scope),
  intelligence: (k, source) => statesBy(k.intelligence, intelligenceFacts({ intel: { model: () => ({ model: k.model }), all: () => k.intelligence }, source, registry: createIntelligenceRegistry({ ecosystems: builtinEcosystems() }) }).scopes, (f) => f.scope),
  engineering: (k, source) => ((out) => Object.fromEntries(k.engineering.map((f) => [f.id, out.changes.find((c) => c.fact.id === f.id)?.status ?? f.status])))(engineeringFacts({ eng: { model: () => ({ model: k.model }), all: () => k.engineering }, source })),
  knowledge: (k, source) => knowledgeMeasured({ know: { model: () => ({ model: k.model }) }, source }, k.knowledge),
  investigation: (k, source) => Object.fromEntries(k.receipts.map((r) => [r.id, applicabilityOf(r, source.fingerprints(r.scope))])),
};

function workWorld(base, source) {
  const works = createWorks(join(base, "store"), realIo({ host: "laptop-a", now: () => NOW }));
  return { works, now: () => NOW, session: "s1", source, snapshot: () => null, latestSnapshot: () => null, effective: () => registryOf([]) };
}

const ROOT = "req-3f9a1c0b7e21";
const WID = workOf(ROOT);

// A work whose needs, one per scope, were each SETTLED on what the files hashed to then.
function settledWork(base, source) {
  const w = workWorld(base, source);
  startWork(w, { objective: "fix the login", root: ROOT, identity: { provider: "github", organization: "o", project: "p", id: "1" } });
  const added = addNeeds(w, WID, SCOPES.map((s, at) => ({ type: "proof", capability: "code.read", subject: `scope-${at}`, asks: `prove ${s}`, scope: [s] }))).added;
  for (const { need } of added) settleNeed(w, WID, { need, state: "satisfied", evidence: ["read it"] });
  return { w, scopeOf: Object.fromEntries(added.map(({ need }, at) => [need, SCOPES[at]])) };
}

function kept(t) {
  const r = repoOf(t);
  const receipts = SCOPES.map((s) => ({ id: `investigation:${s}`, scope: [s], fingerprints: { [s]: r.source.fingerprints([s])[s].hash } }));
  const knowledge = SCOPES.map((s) => ({ id: `knowledge:${s}`, subject: "login", relation: "uses", object: "session", scope: [s] }));
  return { ...r, keep: { model: modelOfTree(r.source), architecture: factsAbout("architecture"), intelligence: factsAbout("intelligence"), engineering: factsAbout("engineering"), knowledge, receipts }, work: settledWork(r.base, r.source) };
}

// What every owner says now: owner -> scope -> state, and the scopes a work's invalidation names (as `<scope>#<from>`).
function said(k, source) {
  const states = Object.fromEntries(Object.entries(OWNERS).map(([owner, ask]) => [owner, Object.fromEntries(Object.entries(ask(k.keep, source)).map(([id, state]) => [id.slice(owner.length + 1), state]))]));
  const moved = invalidated(k.work.w, modelOf(k.work.w.works.read(WID))).map((line) => `${k.work.scopeOf[line.need]}#${String(line.from).split("#")[1] === "gone" ? "gone" : "moved"}`);
  return { states, moved: moved.sort() };
}

const everyOwner = (expected) => Object.fromEntries(Object.keys(OWNERS).map((owner) => [owner, expected]));

const scopesNow = (source) => measure([{ scope: SCOPES }], null, source);

test("a committed edit moves the file and the directory it lies in, in every owner, and nothing on the other side", (t) => {
  const k = kept(t);
  write(k.repo, "web/login.js", "export const login = () => 42;\n");
  for (const a of [["add", "-A"], ["commit", "-qm", "edit"]]) git(k.repo, a);
  const now = said(k, k.source);
  assert.deepEqual(now.states, everyOwner({ "web/login.js": STALE, web: STALE, "server/session.py": FRESH, server: FRESH }));
  assert.deepEqual(now.moved, ["web#moved", "web/login.js#moved"], "the work's needs on the moved scopes are invalidated, and only those");
});

test("an uncommitted edit is unknown wherever it lies, and claims nothing moved", (t) => {
  const k = kept(t);
  write(k.repo, "web/login.js", "export const login = () => 42;\n");
  const now = said(k, k.source);
  assert.deepEqual(now.states, everyOwner({ "web/login.js": UNKNOWN, web: UNKNOWN, "server/session.py": FRESH, server: FRESH }));
  assert.deepEqual(now.moved, [], "an edit the index cannot see is not a claim that anything moved");
  assert.match(scopesNow(k.source)["web/login.js"].say, /uncommitted/);
});

test("a committed rename leaves the old path GONE -- said as such -- and its directory stale", (t) => {
  const k = kept(t);
  for (const a of [["mv", "web/login.js", "web/signin.js"], ["commit", "-qm", "rename"]]) git(k.repo, a);
  const now = said(k, k.source);
  assert.deepEqual(now.states, everyOwner({ "web/login.js": UNKNOWN, web: STALE, "server/session.py": FRESH, server: FRESH }));
  assert.deepEqual(now.moved, ["web#moved", "web/login.js#gone"], "a need settled on a path that is gone is never reused");
  const gone = scopesNow(k.source)["web/login.js"];
  assert.deepEqual([gone.state, gone.gone], [UNKNOWN, true]);
  assert.match(gone.say, /holds nothing there now/);
});

test("a committed delete is GONE, told apart from a tree nobody could ask", (t) => {
  const k = kept(t);
  for (const a of [["rm", "-q", "web/login.js"], ["commit", "-qm", "delete"]]) git(k.repo, a);
  const now = said(k, k.source);
  assert.deepEqual(now.states, everyOwner({ "web/login.js": UNKNOWN, web: STALE, "server/session.py": FRESH, server: FRESH }));
  assert.deepEqual(now.moved, ["web#moved", "web/login.js#gone"]);
  const gone = scopesNow(k.source)["web/login.js"];
  const nobody = scopesNow(createSourceTree([join(k.base, "not-a-checkout")]))["web/login.js"];
  assert.equal(gone.gone, true);
  assert.equal(nobody.gone, undefined, "no checkout to ask is not a deleted file");
  assert.notEqual(gone.say, nobody.say, "a reader tells the two apart by what each says");
  assert.match(nobody.say, /nothing could be asked/);
});

test("a delete not yet committed is an edit the index cannot see: unknown, never gone", (t) => {
  const k = kept(t);
  unlinkSync(join(k.repo, "web/login.js"));
  const now = said(k, k.source);
  assert.deepEqual(now.states, everyOwner({ "web/login.js": UNKNOWN, web: UNKNOWN, "server/session.py": FRESH, server: FRESH }));
  assert.deepEqual(now.moved, []);
  assert.equal(scopesNow(k.source)["web/login.js"].gone, undefined);
});

test("a branch switch moves only the scopes the two branches differ in, and switching back makes them fresh again", (t) => {
  const k = kept(t);
  git(k.repo, ["checkout", "-qb", "other"]);
  write(k.repo, "server/session.py", "def session():\n    return 4\n");
  for (const a of [["add", "-A"], ["commit", "-qm", "server"]]) git(k.repo, a);
  const there = said(k, k.source);
  assert.deepEqual(there.states, everyOwner({ "web/login.js": FRESH, web: FRESH, "server/session.py": STALE, server: STALE }));
  assert.deepEqual(there.moved, ["server#moved", "server/session.py#moved"]);
  git(k.repo, ["checkout", "-q", "main"]);
  assert.deepEqual(said(k, k.source).states, everyOwner(Object.fromEntries(SCOPES.map((s) => [s, FRESH]))), "the same content is the same scope: fresh by its fingerprint, never by the repository's name");
});
