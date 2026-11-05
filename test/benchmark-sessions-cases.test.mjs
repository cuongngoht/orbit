// The SESSIONS suite's cases (0.5.0, backlog B3, ADR 0054): each a QA case's application worked in two sessions. What
// this file holds: every case loads and holds to its fields; its ground truth IS acceptance's own for its stack and
// variant, as a QA case's is; the coding host is asked exactly what a QA case's host is, in both sessions; at least two
// cases compare both memory arms, ORBIT-QA-003's application among them; the poisoned case's poison names only shapes
// its truth holds and nothing a plugin carries; every case has the controls that prove its verdict discriminates -- a
// reference that passes, an idle host, a cheating host and a host that does only half that fail, and for the poison a
// host that trusts it (each way) that fails; and the loader refuses what a sessions case must not be.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HARNESS } from "../benchmark/lib/core/freeze.mjs";
import { matchesAny } from "../benchmark/lib/core/paths.mjs";
import { caseFindings, casesOf, MEMORY_ARMS, QA_HOSTS, SESSION_HOSTS } from "../benchmark/lib/core/suites.mjs";
import { HOSTS } from "../benchmark/lib/qa/hosts.mjs";
import { TARGETS } from "../benchmark/lib/qa/invoice.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(import.meta.dirname, "..");
const SESSIONS = casesOf(ROOT, "orbit-sessions");
const QA = casesOf(ROOT, "orbit-qa");
const ACCEPTANCE = JSON.parse(readFileSync(join(ROOT, "acceptance", "truth.json"), "utf8"));
const truthOf = (c) => JSON.parse(readFileSync(join(c.dir, c.acceptance.truth), "utf8"));

test("every sessions case loads, holds to its fields, and plants a variant its application has", () => {
  assert.ok(SESSIONS.length >= 3, `${SESSIONS.length} cases`);
  for (const c of SESSIONS) {
    assert.deepEqual(caseFindings(JSON.parse(readFileSync(join(c.dir, "case.json"), "utf8")), c.dir), [], c.id);
    assert.ok(TARGETS[c.target.app], `${c.id} names an application the harness knows`);
    assert.ok(Object.hasOwn(ACCEPTANCE.stacks[c.target.stack].variants, c.target.variant), `${c.id}: ${c.target.variant}`);
    assert.ok(c.sessions.memory.every((arm) => MEMORY_ARMS.includes(arm)));
  }
});

test("each case's ground truth is acceptance's own, for its stack and variant -- the very truth a QA case of that variant is held to", () => {
  for (const c of SESSIONS) {
    const t = truthOf(c);
    assert.deepEqual([t.default, t.shapes, t.expect], [ACCEPTANCE.default, ACCEPTANCE.shapes, ACCEPTANCE.stacks[c.target.stack].variants[c.target.variant]], c.id);
    const qa = QA.find((q) => q.target.variant === c.target.variant);
    assert.ok(qa, `${c.id} works the application of a QA case`);
    assert.deepEqual(t, truthOf(qa), `${c.id} is judged as ${qa.id} is`);
  }
});

test("the host is asked what a QA case's host is asked, in both sessions, and the request names no variant and no shape", () => {
  const qaRequest = readFileSync(join(QA[0].dir, QA[0].request), "utf8");
  for (const c of SESSIONS) assert.equal(readFileSync(join(c.dir, c.request), "utf8"), qaRequest, c.id);
  assert.ok(SESSIONS.every((c) => c.target.withheld.join() === QA[0].target.withheld.join()), "every case withholds what every QA case does");
});

test("at least two cases compare both memory arms, ORBIT-QA-003's application among them; the poisoned case learns on the clean application", () => {
  const ab = SESSIONS.filter((c) => c.sessions.memory.includes("on") && c.sessions.memory.includes("off"));
  assert.ok(ab.length >= 2, `${ab.length} A/B cases`);
  const qa003 = QA.find((q) => q.id === "ORBIT-QA-003").target.variant;
  assert.ok(ab.some((c) => c.target.variant === qa003 && c.sessions.learn === "planted"), "ORBIT-QA-003's application is compared");
  const poisoned = SESSIONS.filter((c) => c.poison);
  assert.ok(poisoned.length >= 1);
  for (const c of poisoned) assert.deepEqual([c.sessions.learn, c.sessions.memory], ["clean", ["on"]], `${c.id}: its memory goes stale under a moved application, and a poison only means anything to a host with memory`);
});

const control = (c, id) => c.controls.find((k) => k.id === id || k.host === id);

test("every case's controls prove its verdict discriminates: a reference passes; an idle, a cheating and a half host fail -- and a host that trusts a poison fails, either way", () => {
  for (const c of SESSIONS) {
    assert.equal(c.controls.find((k) => k.host === "reference")?.expect, "PASS", `${c.id}: a reference passes`);
    for (const host of ["idle", "cheat", "half"]) assert.equal(control(c, host)?.expect, "FAIL", `${c.id}: ${host} fails`);
    for (const host of c.poison ? ["trusts-poison", "trusts-stale"] : []) assert.equal(control(c, host)?.expect, "FAIL", `${c.id}: ${host} fails`);
  }
  assert.ok(SESSION_HOSTS.every((h) => typeof HOSTS[h] === "function"), "every host a control may name is one the harness has");
  assert.ok(QA_HOSTS.every((h) => SESSION_HOSTS.includes(h)), "a sessions case's hosts are a QA case's and more");
});

// Every file the plugin a host is handed would carry: the repository's own files, less the harness and what is withheld.
const pluginFiles = (c) => spawnSync("git", ["ls-files", "-z", "-co", "--exclude-standard"], { cwd: ROOT, env: sealed(), encoding: "utf8" }).stdout.split("\0").filter(Boolean).filter((rel) => !matchesAny([...HARNESS, ...c.target.withheld], rel));

const textOf = (rel) => {
  try { return readFileSync(join(ROOT, rel), "utf8"); }
  catch { return ""; }
};

test("nothing a sessions host's plugin carries holds the ground truth, names the planted variant, or holds the poison", () => {
  const poisoned = SESSIONS.find((c) => c.poison);
  const files = pluginFiles(poisoned);
  assert.ok(files.length > 500 && files.every((f) => !f.startsWith("benchmark/") && !f.startsWith("acceptance/")));
  const texts = files.map((rel) => [rel, textOf(rel)]);
  for (const c of SESSIONS) assert.deepEqual(texts.filter(([, t]) => t.includes(c.target.variant)).map(([rel]) => rel), [], c.id);
  assert.deepEqual(texts.filter(([, t]) => t.includes(poisoned.poison.stale.key)).map(([rel]) => rel), [], "the stale fact reaches a host only through its memory, planted by the run");
});

test("the loader refuses a poison that names a shape its truth does not, a host that trusts a poison nobody planted, and memory arms out of the vocabulary", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-bench-sessions-case-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const poisoned = SESSIONS.find((c) => c.poison);
  const plain = SESSIONS.find((c) => !c.poison);
  cpSync(poisoned.dir, dir, { recursive: true });
  const c = JSON.parse(readFileSync(join(dir, "case.json"), "utf8"));
  assert.deepEqual(caseFindings(c, dir), []);
  assert.match(caseFindings({ ...c, poison: { ...c.poison, skip: ["a-shape-nobody-has"] } }, dir).join("; "), /its poison names shapes its truth does not: a-shape-nobody-has/);
  assert.match(caseFindings({ ...c, poison: { ...c.poison, note: "poison/missing.md" } }, dir).join("; "), /names a poison note it does not hold: poison\/missing\.md/);
  assert.match(caseFindings({ ...c, poison: undefined }, dir).join("; "), /controls trust a poison the case does not plant: trusts-poison, trusts-stale/);
  assert.match(caseFindings({ ...c, sessions: { learn: "clean", memory: ["on", "on"] } }, dir).join("; "), /memory arms named twice: on/);
  assert.match(caseFindings({ ...c, sessions: { learn: "planted", memory: ["sometimes"] } }, dir).join("; "), /a memory arm is one of on, off, never sometimes/);
  assert.match(caseFindings({ ...c, sessions: { learn: "yesterday", memory: ["on"] } }, dir).join("; "), /sessions: learn must be planted or clean/);
  assert.match(caseFindings({ ...c, controls: [{ id: "x", host: "a-model-of-my-own", expect: "PASS" }] }, dir).join("; "), /host/);
  const raw = JSON.parse(readFileSync(join(plain.dir, "case.json"), "utf8"));
  assert.deepEqual(caseFindings(raw, plain.dir), [], "a case with no poison needs none");
  assert.match(caseFindings({ ...raw, sessions: undefined }, plain.dir).join("; "), /sessions/);
});
