// What a person set for a checkout: per machine, revision-protected, and never a
// command, a secret or a way to make the impossible possible.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BLOCK_DEFAULTS, readSettings, settingsProblems, writeSettings } from "../src/runtime/settings.mjs";
import { settingsFile } from "../src/runtime/rooms.mjs";
import { Refused } from "../src/errors.mjs";
import { STALE_REVISION } from "../src/store/revisioned.mjs";
import { fakeIo } from "./fakes/io.mjs";

const FILE = settingsFile("/store/repo-aaaa", "c".repeat(64));
const NOW = "2026-10-03T10:00:00.000Z";
const write = (io, host, next, revision = null, by = "person") => writeSettings(FILE, io, { host, next, revision, by, now: NOW });

test("nothing set reads as the defaults, with no revision, and reading writes nothing", () => {
  const io = fakeIo();
  const got = readSettings(FILE, io, "laptop-a");
  assert.deepEqual([got.exists, got.settings, got.revision, got.others], [false, BLOCK_DEFAULTS, null, []]);
  assert.equal(io.files.size, 0);
});

test("only a PERSON writes settings, and the refusal says how", () => {
  assert.throws(() => write(fakeIo(), "laptop-a", { strategy: "native" }, null, "engine"), /a person's choice — relay them with --human/);
});

test("a write is kept, read back for this machine, and named by a revision", () => {
  const io = fakeIo();
  const saved = write(io, "laptop-a", { strategy: "native", components: { "node:web": { command: "dev", env: ["NODE_OPTIONS"], readiness: { kind: "http", target: "http://localhost:5173/health", expect: 200 } } } });
  assert.deepEqual([saved.exists, saved.settings.strategy, saved.settings.components["node:web"].command], [true, "native", "dev"]);
  assert.match(saved.revision, /^[a-f0-9]{16}$/);
  assert.equal(readSettings(FILE, io, "laptop-a").revision, saved.revision);
});

test("a write that names an old revision is refused with its own code, and changes nothing", () => {
  const io = fakeIo();
  const first = write(io, "laptop-a", { strategy: "native" });
  write(io, "laptop-a", { strategy: "devcontainer" }, first.revision);
  assert.throws(() => write(io, "laptop-a", { strategy: "auto" }, first.revision), (e) => e instanceof Refused && e.code === STALE_REVISION && /changed since they were read/.test(e.message));
  assert.equal(readSettings(FILE, io, "laptop-a").settings.strategy, "devcontainer");
  assert.throws(() => write(io, "laptop-a", { strategy: "auto" }, null), (e) => e.code === STALE_REVISION, "a writer that read nothing cannot overwrite what is there");
});

test("each machine keeps its own block: another laptop's preference is not inherited, and writing one does not touch the other", () => {
  const io = fakeIo();
  const a = write(io, "laptop-a", { strategy: "native" });
  const seenByB = readSettings(FILE, io, "laptop-b");
  assert.deepEqual([seenByB.settings.strategy, seenByB.others], ["auto", ["laptop-a"]]);
  write(io, "laptop-b", { strategy: "devcontainer" }, seenByB.revision);
  assert.equal(readSettings(FILE, io, "laptop-a").settings.strategy, "native");
  assert.notEqual(readSettings(FILE, io, "laptop-a").revision, a.revision, "the revision covers the whole document");
});

test("a setting is never a command, a secret, a foreign probe or a way to force compatibility", () => {
  const bad = (block) => settingsProblems({ ...BLOCK_DEFAULTS, ...block });
  assert.match(bad({ strategy: "teleport" })[0], /strategy is auto, native, devcontainer/);
  assert.match(bad({ force: true })[0], /unknown setting force/);
  assert.match(bad({ components: { "node web": {} } })[0], /not a component key/);
  assert.match(bad({ components: { "node:bad\u001bkey": {} } })[0], /not a component key/, "a control character never");
  assert.deepEqual(bad({ components: { "node:dir with space/ünï": { provider: "native" }, "dotnet:src/My App": {} } }), [], "a directory named with a space or a non-ASCII letter is a component like any other");
  assert.match(bad({ components: { "node:web": { command: "rm -rf /" } } })[0], /names one of the commands a file declared, by name/);
  assert.match(bad({ components: { "node:web": { provider: "auto" } } })[0], /provider is native or devcontainer/);
  assert.match(bad({ components: { "node:web": { env: ["GOOD", "bad-name"] } } })[0], /env lists variable NAMES/);
  assert.match(bad({ components: { "node:web": { env: ["A=secret"] } } })[0], /env lists variable NAMES/);
  assert.match(bad({ components: { "node:web": { compat: "forced" } } })[0], /unknown setting compat/);
  assert.match(bad({ components: { "node:web": { readiness: { kind: "http", target: "http://example.com/health" } } } })[0], /URL on this machine/);
  assert.match(bad({ components: { "node:web": { readiness: { kind: "http", target: "http://localhost:80/h?token=abcdef0123456789abcdef0123456789" } } } })[0], /must not carry a credential/);
  assert.match(bad({ components: { "node:web": { readiness: { kind: "http", target: "http://user:pw@localhost/h" } } } })[0], /must not carry a credential/);
  assert.match(bad({ components: { "node:web": { readiness: { kind: "tcp", target: 70000 } } } })[0], /a port number/);
  assert.match(bad({ components: { "node:web": { readiness: { kind: "command", target: "touch /tmp/pwned" } } } })[0], /readiness is \{ kind: http\|tcp, target, expect\? \}/, "a command is not a probe: a setting never carries one, and status never runs one");
  assert.match(bad({ components: { "node:web": { readiness: { kind: "http", target: "http://localhost/h", expect: 99 } } } })[0], /HTTP status/);
  assert.deepEqual(bad({ components: { "node:web": { provider: "native", command: "start:https", readiness: { kind: "tcp", target: 8080 } } } }), []);
});

test("an invalid write is refused whole before anything is kept", () => {
  const io = fakeIo();
  assert.throws(() => write(io, "laptop-a", { strategy: "teleport" }), /do not hold: strategy is/);
  assert.equal(io.files.size, 0);
});

test("a document from a newer engine is never overwritten", () => {
  const io = fakeIo();
  io.write(FILE, JSON.stringify({ schema: 99, hosts: {} }));
  assert.throws(() => write(io, "laptop-a", { strategy: "native" }, null), /newer Orbit/);
  assert.throws(() => readSettings(FILE, io, "laptop-a"), /newer Orbit/);
});

// ---- connectivity targets and the retry policy ----------------------------------------------

const TARGET = { label: "Corporate SQL", host: "sql.corp.example", port: 1433, requiredBy: ["dotnet:api"], beforeStart: true };
const reach = (targets, retry) => ({ connectivity: { ...(retry ? { retry } : {}), targets } });
const refused = (next, pattern) => assert.throws(() => write(fakeIo(), "laptop-a", next), (e) => e instanceof Refused && pattern.test(e.message), String(pattern));
const target = (over) => reach({ db: { ...TARGET, ...over } });

test("a document written before connectivity existed reads with none; a target that names only a host and a port reads with every other default", () => {
  const io = fakeIo();
  io.write(FILE, JSON.stringify({ schema: 1, hosts: { "laptop-a": { strategy: "native", reuseExternal: false, components: {} }, "laptop-b": { strategy: "auto", reuseExternal: false, components: {}, connectivity: { targets: { db: { host: "db.internal.example", port: 5432 } } } } } }));
  const a = readSettings(FILE, io, "laptop-a");
  assert.deepEqual([a.exists, a.unreadable, a.settings.strategy, a.settings.connectivity], [true, null, "native", { retry: { attempts: 3, intervalMs: 1000, timeoutMs: 3000 }, targets: {} }]);
  assert.deepEqual(readSettings(FILE, io, "laptop-b").settings.connectivity.targets.db, { label: "db", host: "db.internal.example", port: 5432, protocol: "tcp", requiredBy: [], checkFrom: ["native", "devcontainer"], beforeStart: false, classification: "unknown" });
  const otherBefore = JSON.parse(io.read(FILE)).hosts["laptop-b"];
  const saved = write(io, "laptop-a", { ...a.settings, ...reach({ "corporate-sql": TARGET }, { attempts: 5, intervalMs: 500, timeoutMs: 2000 }) }, a.revision);
  assert.deepEqual(saved.settings.connectivity, { retry: { attempts: 5, intervalMs: 500, timeoutMs: 2000 }, targets: { "corporate-sql": { ...TARGET, protocol: "tcp", checkFrom: ["native", "devcontainer"], classification: "unknown" } } });
  assert.deepEqual(JSON.parse(io.read(FILE)).hosts["laptop-b"], otherBefore, "another machine's block is exactly what it was");
});

test("a connectivity target is a host and a port, and nothing a probe could be pointed at through it: every rule, in order", () => {
  refused(reach({ Db: TARGET }), /"Db" is not a target id/);
  refused(reach({ ["x".repeat(41)]: TARGET }), /is not a target id/);
  refused(reach({ db: "sql.corp.example:1433" }), /db: a target is an object/);
  refused(target({ url: "tcp://x" }), /db: unknown setting url/);
  refused(target({ command: "nc -z x 1" }), /db: unknown setting command/);
  refused(target({ password: "x" }), /db: unknown setting password/);
  refused(target({ label: "x".repeat(81) }), /db: label is up to 80 characters/);
  refused(target({ label: "password=hunter2" }), /db: label is up to 80 characters, and never a credential/);
  for (const host of ["http://db", "user@db", "db/path", "db name", "db\\x"]) refused(target({ host }), /no scheme, no credential and no path/);
  refused(target({ host: "" }), /up to 253 characters/);
  refused(target({ host: "a".repeat(254) }), /up to 253 characters/);
  refused(target({ host: `${"deadbeef".repeat(4)}.example` }), /host must not carry a credential/);
  refused(target({ host: "999.1.1.1" }), /host is not an IPv4 address/);
  refused(target({ host: "10.0.0" }), /host is not an IPv4 address/);
  for (const host of ["-bad-", "db:1433", "[::1]", "a:b", "1:2:3:4:5:6:7:8:9", "1::2::3", "_db"]) refused(target({ host }), /a host name \(letters, digits, dashes, underscores and dots\) or an IPv4 or IPv6 address — no brackets and no port/);
  for (const port of [0, 70000, "1433", 14.5]) refused(target({ port }), /db: port is 1 to 65535/);
  refused(target({ protocol: "udp" }), /db: protocol is tcp/);
  refused(target({ requiredBy: ["web"] }), /db: requiredBy lists component keys/);
  refused(target({ requiredBy: "dotnet:api" }), /db: requiredBy lists component keys/);
  for (const checkFrom of [[], ["native", "native"], ["ci"], "native"]) refused(target({ checkFrom }), /db: checkFrom lists where to ask from: native, devcontainer/);
  refused(target({ beforeStart: "yes" }), /db: beforeStart is true or false/);
  refused(target({ note: "x".repeat(201) }), /db: note is up to 200 characters/);
  refused(target({ note: "token=abcdef0123456789" }), /db: note is up to 200 characters, and never a credential/);
  refused({ connectivity: "x" }, /connectivity is \{ retry, targets \}/);
  refused({ connectivity: { weight: 1 } }, /connectivity: unknown setting weight/);
  refused({ connectivity: { targets: [] } }, /connectivity\.targets maps a target id/);
  refused(reach(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`t${i}`, TARGET]))), /connectivity lists up to 50 targets/);
  for (const host of ["sql.corp.example", "10.0.0.5", "::1", "2001:db8::1", "fe80:0:0:0:0:0:0:1", "localhost", "db-1", "my_db"]) assert.doesNotThrow(() => write(fakeIo(), "laptop-a", target({ host })), host);
});

test("the retry policy is bounded on every side, for every target and for one: no retry forever, no busy loop, no attempt without a deadline", () => {
  for (const attempts of [0, 11, 1000000, 2.5]) refused(reach({}, { attempts }), /retry\.attempts is 1 to 10/);
  for (const intervalMs of [-1, 0, 249, 30001]) refused(reach({}, { intervalMs }), /retry\.intervalMs is 250 to 30000 \(milliseconds\)/);
  for (const timeoutMs of [0, 249, 999999999]) refused(reach({}, { timeoutMs }), /retry\.timeoutMs is 250 to 30000 \(milliseconds\)/);
  refused(reach({}, { forever: true }), /retry: unknown setting forever/);
  refused({ connectivity: { retry: "always", targets: {} } }, /retry is \{ attempts, intervalMs, timeoutMs \}/);
  refused(target({ retry: { attempts: 0 } }), /db: retry\.attempts is 1 to 10/);
  refused(target({ retry: { backoff: 2 } }), /db: retry: unknown setting backoff/);
  assert.doesNotThrow(() => write(fakeIo(), "laptop-a", target({ retry: { attempts: 10 } })), "a target may override only part of the policy");
  assert.doesNotThrow(() => write(fakeIo(), "laptop-a", reach({}, { attempts: 1, intervalMs: 250, timeoutMs: 30000 })), "the bounds themselves hold");
});
