// AUTONOMOUS BY DEFAULT (0.2.0): src/protected/ is the one table of where Orbit stops for a person -- five boundaries,
// everything else AUTO -- and the one fingerprint an approval is bound to. Every executor and viewer reads it here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { AUTO, BOUNDARY_DOOR, PERSON_ACTS, actionFingerprint, authorize, crossing, fingerprintOf, needsApproval, personAct, requestOf } from "../src/protected/authorize.mjs";
import { ACTION, BOUNDARIES, BOUNDARY_IDS, DECISIONS, DECLARED_KINDS, DESTRUCTIVE_OPERATIONS, HOMES, PRODUCTION_KINDS, boundaryOf } from "../src/protected/boundaries.mjs";
import { capabilityAction, PROTECTED_EFFECTS, READING_EFFECTS } from "../src/protected/capability.mjs";
import { isProduction, strictestTier, tierOf } from "../src/protected/environments.mjs";
import { mcpAction } from "../src/protected/mcp.mjs";
import { fingerprintOf as taskFingerprint } from "../src/task/approvals.mjs";
import { EFFECTS } from "../src/topology/vocab.mjs";

const decision = (a) => authorize(a).decision;

const PUSH = { kind: ACTION.PUSH, repository: "orbit", remote: "origin", url: "a".repeat(64), at: "git.example.invalid/acme/orbit.git", ref: "refs/heads/feature/protected-boundaries", commit: "abc123".padEnd(40, "0"), force: false };
const DEPLOY = { kind: ACTION.DEPLOY, environment: "production", service: "orbit-api", artifact: "orbit-api:1.8.2", revision: "abc123", target: "prod-cluster", capability: "orders.deploy", input: { artifact: "orbit-api:1.8.2" } };
const MIGRATE = { kind: ACTION.MIGRATE, environment: "production", database: "orders", migration: "20261028_add_invoice_index", digest: "d".repeat(64), target: "orders-prod", input: {} };

test("default autonomy: ordinary development is AUTO -- with no allow-list, an unknown kind included", () => {
  const auto = [
    { kind: "repository.read" },
    { kind: ACTION.WRITE, home: HOMES.TASK_WORKSPACE },
    { kind: ACTION.WRITE, home: HOMES.STORE },
    { kind: "workspace.prepare" },
    { kind: "repository.branch" },
    { kind: "repository.commit" },
    { kind: "check" },
    { kind: "build" },
    { kind: "lint" },
    { kind: "test" },
    { kind: "qa.generated" },
    { kind: "sandbox.prepare" },
    { kind: "sandbox.start" },
    { kind: "sandbox.stop" },
    { kind: ACTION.MIGRATE, environment: "local" },
    { kind: ACTION.MIGRATE, environment: "test" },
    { kind: ACTION.MIGRATE, environment: "sandbox" },
    { kind: ACTION.MIGRATE, environment: "development" },
    { kind: ACTION.DEPLOY, environment: "local" },
    { kind: ACTION.DEPLOY, environment: "preview" },
    { kind: ACTION.DEPLOY, environment: "development" },
    { kind: ACTION.DEPLOY, environment: "staging" },
    { kind: ACTION.DEPLOY, environment: "a-remote-nobody-classified" },
    { kind: ACTION.DATA_READ, environment: "production" },
    { kind: ACTION.DATA_WRITE, environment: "production" },
    { kind: ACTION.DATA_MUTATE, environment: "staging" },
    { kind: "database.truncate", environment: "local" },
    { kind: "database.drop", environment: "test" },
    { kind: "an.action.nobody.has.seen.before" },
    {},
  ];
  for (const a of auto) assert.equal(decision(a), DECISIONS.AUTO, JSON.stringify(a));
  assert.equal(authorize(undefined), AUTO, "nothing described is nothing protected");
});

test("primary checkout write is DENY; a task workspace write is AUTO -- the home decides, never the path's spelling", () => {
  const write = { kind: ACTION.WRITE, home: HOMES.PRIMARY_CHECKOUT, repository: "orbit", checkout: "c0ffee", scope: ".devcontainer/devcontainer.json", digest: "ep-0123456789ab" };
  const v = authorize(write);
  assert.deepEqual([v.decision, v.boundary, v.kind, v.person, v.destructive], [DECISIONS.DENY, "PRIMARY_CHECKOUT_WRITE", "repository.primary_checkout.write", true, false]);
  assert.equal(needsApproval(v), false, "nobody is asked to cross a DENY: a person does it themselves");
  assert.equal(decision({ ...write, home: HOMES.TASK_WORKSPACE }), DECISIONS.AUTO);
});

test("a person DENY is crossed only through Orbit Control's door -- never a terminal, a flag, a typed-back id or another door", () => {
  const v = authorize({ kind: ACTION.WRITE, home: HOMES.PRIMARY_CHECKOUT, digest: "ep-1" });
  const w = { lead: "Nothing was written.", where: "Orbit Control" };
  assert.deepEqual(crossing(v, { door: "control" }, w), { allowed: true, by: "CONTROL", says: "a person, through Orbit Control" });
  for (const agent of [{ door: "terminal", human: true, tty: true, confirmed: "ep-1" }, { door: "terminal", human: true, tty: false }, { door: "coordinator", human: true }, { door: null }, {}, null]) assert.equal(crossing(v, agent, w).allowed, false, JSON.stringify(agent));
  assert.match(crossing(v, { door: "terminal", human: true, tty: true, confirmed: "ep-1" }, w).says, /no terminal can prove a person\. Nothing was written\. A person does it themselves, in Orbit Control/);
  assert.equal(crossing(authorize(PUSH), { door: "control" }, w).allowed, false, "an approve-once is never crossed by a door: only a task's approval of exactly it");
  assert.equal(crossing(authorize({ kind: "check" }), null, w).allowed, true, "AUTO asks nobody");
  assert.equal(BOUNDARY_DOOR, "control");
});

test("the test-data home's own transfer rule (storage export) is a person at Control, or typing the preview's id back at a terminal -- never the checkout boundary's", () => {
  const w = { lead: "nothing was written.", what: "the export", command: "node storage.mjs export --all --apply --human" };
  assert.equal(personAct({ door: "control" }, "exp-1", w).allowed, true);
  assert.equal(personAct({ door: "terminal", human: true, tty: true, confirmed: "exp-1" }, "exp-1", w).allowed, true);
  assert.equal(personAct({ door: "terminal", human: true, tty: false }, "exp-1", w).allowed, false);
  assert.deepEqual(PERSON_ACTS.filter((r) => r.allowed).map((r) => r.id), ["CONTROL", "TYPED"]);
  assert.equal(personAct({}, "x", w).allowed, false);
});

test("git push is APPROVE_ONCE; force has its own risk -- and a changed commit, remote, URL, branch or force is another action", () => {
  const v = authorize(PUSH);
  assert.deepEqual([v.decision, v.boundary, v.kind, v.destructive], [DECISIONS.APPROVE_ONCE, "GIT_PUSH", "repository.push", false]);
  assert.match(v.risk, /^publishes commit abc123000000 to refs\/heads\/feature\/protected-boundaries on origin \(git\.example\.invalid\/acme\/orbit\.git\)$/);
  assert.match(authorize({ ...PUSH, force: true }).risk, /^FORCE push: replaces .* whatever the remote held there that this commit lacks is lost$/);
  const fp = (a) => fingerprintOf(requestOf(authorize(a), { tool: "origin", environment: "origin" }));
  for (const changed of [{ commit: "def456".padEnd(40, "0") }, { remote: "upstream" }, { url: "b".repeat(64) }, { ref: "refs/heads/main" }, { force: true }, { repository: "other" }]) assert.notEqual(fp({ ...PUSH, ...changed }), fp(PUSH), JSON.stringify(changed));
  assert.equal(fp({ ...PUSH, at: "shown elsewhere" }), fp(PUSH), "what is only shown is not what is approved");
});

test("production deploy and migration are APPROVE_ONCE; staging is AUTO; a changed artifact, revision, target or digest asks again", () => {
  assert.deepEqual([decision(DEPLOY), authorize(DEPLOY).kind], [DECISIONS.APPROVE_ONCE, "deployment.production"]);
  assert.deepEqual([decision(MIGRATE), authorize(MIGRATE).kind], [DECISIONS.APPROVE_ONCE, "database.production.migrate"]);
  assert.equal(decision({ ...DEPLOY, environment: "staging" }), DECISIONS.AUTO);
  const fp = (a) => actionFingerprint(authorize(a));
  for (const changed of [{ artifact: "orbit-api:1.8.3" }, { revision: "def456" }, { target: "prod-eu" }, { input: { artifact: "orbit-api:1.8.3" } }]) assert.notEqual(fp({ ...DEPLOY, ...changed }), fp(DEPLOY), JSON.stringify(changed));
  assert.notEqual(fp({ ...MIGRATE, digest: "e".repeat(64) }), fp(MIGRATE), "a changed migration digest is another migration");
  assert.equal(authorize(DEPLOY).environment, "production");
  assert.deepEqual(authorize(DEPLOY).shows, { service: "orbit-api", environment: "production", artifact: "orbit-api:1.8.2", revision: "abc123", target: "prod-cluster" });
});

test("destructive production data: delete, truncate, drop, purge, reset -- and a production write nobody declared -- need a person, marked DESTRUCTIVE; the same off production is AUTO", () => {
  for (const op of DESTRUCTIVE_OPERATIONS) {
    const v = authorize({ kind: `database.${op}`, environment: "production", database: "orders", table: "invoices" });
    assert.deepEqual([v.decision, v.boundary, v.kind, v.destructive], [DECISIONS.APPROVE_ONCE_DESTRUCTIVE, "PRODUCTION_DESTRUCTIVE_DATA", `database.production.${op}`, true], op);
    assert.match(v.risk, new RegExp(`^DESTRUCTIVE — ${op} on production data in orders\\.invoices; it cannot be undone$`));
    assert.equal(decision({ kind: `database.${op}`, environment: "test" }), DECISIONS.AUTO);
  }
  assert.deepEqual([decision({ kind: ACTION.DATA_MUTATE, environment: "production" }), authorize({ kind: ACTION.DATA_MUTATE, environment: "production" }).kind], [DECISIONS.APPROVE_ONCE_DESTRUCTIVE, "database.production.mutate"]);
  assert.deepEqual([...PRODUCTION_KINDS].sort(), ["database.production.delete", "database.production.drop", "database.production.migrate", "database.production.mutate", "database.production.purge", "database.production.reset", "database.production.truncate", "deployment.production"]);
});

test("production is only what something that knows DECLARED: one tier per word Orbit already accepts; unknown is never production", () => {
  assert.deepEqual(["production", "PRODUCTION", "staging", "shared-development", "task-isolated", "sandbox", "external-readonly", "prod", "", null].map(tierOf), ["production", "production", "staging", "development", "local", "local", "unknown", "unknown", "unknown", "unknown"]);
  assert.equal(isProduction("prod"), false, "a word nobody listed is not guessed into production");
  assert.equal(strictestTier(["local", "production"]), "production", "any declaration of production wins");
  assert.equal(strictestTier([null, undefined]), "unknown");
});

test("a capability call is the action its DECLARATION describes: effects say what, environment says where, a sandbox binding is local", () => {
  const deploy = { id: "orders.deploy", mutates: true, effects: ["deploy"], environment: "production" };
  assert.deepEqual(capabilityAction(deploy, { artifact: "orders:2", password: "x" }), { artifact: "orders:2", kind: "deployment", environment: "production", target: null, capability: "orders.deploy", input: { artifact: "orders:2", password: "x" } });
  assert.equal(authorize(capabilityAction(deploy, {})).shows.password, undefined, "only the inputs a person reads are shown");
  assert.equal(capabilityAction({ id: "x.read", mutates: false, effects: ["read"] }).kind, ACTION.DATA_READ);
  assert.equal(capabilityAction({ id: "x.write", mutates: true, effects: ["write", "publish"] }).kind, ACTION.DATA_WRITE);
  assert.equal(capabilityAction({ id: "x.what", mutates: true }).kind, ACTION.DATA_MUTATE, "a write nobody described is undeclared");
  assert.equal(capabilityAction({ id: "x.box", mutates: true, effects: ["truncate"], inputSchema: { endpoint: { bind: "endpoint" } } }).environment, "local");
  assert.deepEqual(READING_EFFECTS, EFFECTS.filter((e) => !e.mutates).map((e) => e.id), "the reading effects are the vocabulary's own");
  assert.ok(PROTECTED_EFFECTS.every((p) => EFFECTS.find((e) => e.id === p.effect)?.mutates === true), "every protected effect is a mutating effect of the vocabulary");
});

test("an MCP tool call is what its catalog row declares the tool to be, else what the server says of it", () => {
  const github = { key: "managed:github", protected: { push_files: "repository.push" } };
  assert.equal(decision(mcpAction(github, { name: "push_files" })), DECISIONS.APPROVE_ONCE);
  assert.equal(decision(mcpAction(github, { name: "create_issue" })), DECISIONS.AUTO, "an ordinary integration write is autonomous");
  assert.equal(mcpAction(github, { name: "get_file", annotations: { readOnlyHint: true } }).kind, ACTION.DATA_READ);
  assert.equal(mcpAction({ key: "managed:db", environment: "production" }, { name: "run_sql" }).kind, ACTION.DATA_MUTATE);
  assert.equal(decision(mcpAction({ key: "managed:db", environment: "production" }, { name: "run_sql" })), DECISIONS.APPROVE_ONCE_DESTRUCTIVE);
  assert.equal(decision(mcpAction({ key: "managed:db", environment: "production" }, { name: "insert", annotations: { destructiveHint: false } })), DECISIONS.AUTO);
  assert.deepEqual([...DECLARED_KINDS].sort(), ["database.delete", "database.drop", "database.migrate", "database.purge", "database.reset", "database.truncate", "deployment", "repository.push"]);
});

test("one fingerprint: the task's approvals and every executor hash an action one way, and what a person reads is scrubbed and short", () => {
  assert.equal(taskFingerprint, fingerprintOf, "src/task/approvals.mjs reads the leaf's");
  const v = authorize({ ...PUSH, at: `https://bot:ghp_${"x".repeat(36)}@git.example.invalid/x.git\u001b[2J` });
  assert.ok(Object.values(v.shows).every((s) => typeof s === "string" && s.length <= 120 && !s.includes("\u001b")));
  assert.doesNotMatch(v.shows.at, /ghp_x{36}/, "a token shape is masked");
  assert.ok(v.risk.length <= 240);
  for (const row of BOUNDARIES) assert.ok(row.title && row.say && row.fingerprint.length && row.shows.length, row.id);
  assert.equal(boundaryOf("GIT_PUSH").title, "Git push");
  assert.deepEqual(BOUNDARY_IDS.length, 5);
});

// ---- one definition: nothing outside src/protected/ decides what is protected ---------------------------------------

const ROOT = join(import.meta.dirname, "..");
const walk = (dir) => readdirSync(dir).filter((n) => n !== "node_modules").flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const code = (p) => readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
// A path as the allow-list spells it: "/" on every OS, so a Windows checkout reads the same names.
const posix = (p) => relative(ROOT, p).split(sep).join("/");
const sources = () => ["src", "cli", "skills", "satellite/src", "satellite/cli", "control-server/src"].flatMap((d) => walk(join(ROOT, d))).filter((p) => p.endsWith(".mjs") && !p.includes(`${join("src", "protected")}`));

test("no file outside src/protected/ spells a decision, compares an environment to production, or names a boundary's kind as a string", () => {
  const decisions = /["'](approve_once|approve_once_destructive)["']/;
  const production = /===\s*["']production["']|["']production["']\s*===/;
  const kinds = /["'](deployment\.production|database\.production\.[a-z]+|repository\.primary_checkout\.write)["']/;
  const hits = sources().flatMap((p) => code(p).split("\n").map((l, i) => [posix(p), i + 1, l]).filter(([, , l]) => decisions.test(l) || production.test(l) || kinds.test(l)).map(([f, n, l]) => `${f}:${n}  ${l.trim().slice(0, 100)}`));
  assert.deepEqual(hits.filter((h) => !/^src\/investigation\/(gates|settings)\.mjs/.test(h)), [], "the QA modes' own production rule is the investigation's hard row, not a boundary");
});

test("the leaf is a leaf: it imports only hash, scrub and printable, and names no product, tool or host", () => {
  const files = walk(join(ROOT, "src", "protected")).filter((p) => p.endsWith(".mjs"));
  const imports = files.flatMap((p) => [...code(p).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...new Set(imports.filter((s) => !s.startsWith("./")))].sort(), ["../hash.mjs", "../printable.mjs", "../scrub.mjs"]);
  const products = /\b(github|gitlab|kubectl|terraform|helm|azure|aws|gcloud|postgres|mysql|docker|npm)\b/i;
  assert.deepEqual(files.filter((p) => products.test(code(p))).map(posix), []);
});
