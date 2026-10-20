// What Orbit may do ON ITS OWN with a project's report parts -- scaffold, verify,
// register, activate, for this project only -- and where that stops: never a
// replacement of a standard part, never a package, never code that reaches
// past the SDK, never a part that crashes or has nothing to say. The same
// workflow a session runs, with its stdin closed: nothing may stop to ask.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyTool } from "../src/extensions/lifecycle.mjs";
import { reportExtensions } from "../src/project-report/context.mjs";
import { createProcess } from "../src/process/index.mjs";
import { realIo } from "../src/store/io.mjs";
import { REPORT_KINDS, checkReport, scaffoldReport } from "../skills/orbit-report/extend.mjs";
import { pythonOr, testPython } from "./project-report/python.mjs";
import { sealed } from "./home.mjs";
import { tempBase } from "./project-report/rctx.mjs";

const ENGINE = join(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "..");
const python = (t) => (pythonOr(t) ? testPython().path : null);
const check = (dir, py, human = false) => checkReport(dir, JSON.parse(readFileSync(join(dir, "extension.json"), "utf8")), { python: py, process: createProcess(), env: process.env, io: realIo(), human, latest: null });

test("every kind scaffolds into a draft the real loader accepts, named for the need it was made for", async (t) => {
  const base = tempBase(t);
  for (const kind of REPORT_KINDS) {
    const made = scaffoldReport(join(base, kind), `demo-${kind}`, kind, "a PO asked for it", realIo());
    const verdict = await verifyTool({ store: () => join(base, "store") }, made.dir, realIo());
    assert.ok(verdict.ok, `${kind}: ${JSON.stringify(verdict.findings)}`);
    assert.equal(JSON.parse(readFileSync(join(made.dir, "extension.json"), "utf8")).createdFor, "a PO asked for it");
  }
});

function part(base, id, code, over = {}) {
  const dir = join(base, id);
  scaffoldReport(dir, id, "metric", "a test need", realIo());
  writeFileSync(join(dir, `${id.replace(/-/g, "_")}.py`), code);
  const reporting = JSON.parse(readFileSync(join(dir, "reporting.json"), "utf8"));
  writeFileSync(join(dir, "reporting.json"), JSON.stringify({ parts: [{ ...reporting.parts[0], ...over }] }));
  return dir;
}

const GOOD = "def run(envelope, sdk):\n    rows = sdk.collection('pullRequests')\n    sdk.metric('{ID}.value', value=len(rows), basis={'samples': len(rows)})\n    return {}\n";

// The scripts below are DATA: Python source handed to the static check, which
// parses it and never runs it -- a finding stops the check before any part runs.
test("a script that reaches past the SDK is refused before it ever runs, and says where", async (t) => {
  const py = python(t);
  if (!py) return;
  const base = tempBase(t);
  const cases = [["uses-os", "import os\n", /imports os/], ["uses-socket", "from socket import socket\n", /imports from socket/], ["opens", "open('/etc/hosts')\n", /uses open\(\)/], ["digs", "x = ().__class__.__bases__\n", /reaches __class__/], ["evals", "eval('1')\n", /uses eval\(\)/]];
  for (const [id, head, says] of cases) {
    const findings = await check(part(base, id, `${head}${GOOD.replaceAll("{ID}", id)}`), py);
    assert.ok(findings.some((f) => says.test(f)), `${id}: ${findings}`);
  }
});

test("a part that crashes on a snapshot, or finds nothing it could compute, is refused with what it said", async (t) => {
  const py = python(t);
  if (!py) return;
  const base = tempBase(t);
  assert.deepEqual(await check(part(base, "fine", GOOD.replaceAll("{ID}", "fine")), py), []);
  const crash = await check(part(base, "crash", "def run(envelope, sdk):\n    raise ValueError('the sum went wrong')\n"), py);
  assert.match(crash.join(" "), /ValueError: the sum went wrong/);
  const empty = await check(part(base, "empty", "def run(envelope, sdk):\n    raise sdk.DataMissing(['burndown'])\n"), py);
  assert.match(empty.join(" "), /had nothing to compute on \(burndown/);
});

test("a replacement of a standard part is a person's: refused on its own, accepted with --human", async (t) => {
  const py = python(t);
  if (!py) return;
  const base = tempBase(t);
  const dir = part(base, "better", GOOD.replaceAll("{ID}", "better"), { replaces: "orbit.report.forecast", provides: ["report.forecast"] });
  assert.match((await check(dir, py)).join(" "), /a replacement is registered by a person \(--human\)/);
  assert.deepEqual(await check(dir, py, true), []);
});

// ---- the workflow, as a session runs it ------------------------------------------------

const cli = (tool, argv, env, cwd, input) => spawnSync(process.execPath, [join(ENGINE, "cli", tool), ...argv], { cwd, env, input: input ?? "", encoding: "utf8" });

function checkout(base, name) {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

test("scaffold, write, register, activate -- each with stdin closed, none of them asking -- and only for this project", async (t) => {
  const py = python(t);
  if (!py) return;
  const base = tempBase(t);
  const env = sealed({ ORBIT_STORE_DIR: join(base, "store"), ORBIT_PYTHON: py });
  const [mine, theirs] = [checkout(base, "mine"), checkout(base, "theirs")];
  const steps = [["new", "counted", "--report=metric", "--for=how many pull requests the window saw"], ["put", "counted", "counted.py"], ["register", "counted"], ["status", "counted", "active"]];
  for (const argv of steps) {
    const r = cli("qc-tool.mjs", argv, env, mine, argv[0] === "put" ? GOOD.replaceAll("{ID}", "counted") : "");
    assert.equal(r.status, 0, `${argv.join(" ")}: ${r.stdout}${r.stderr}`);
  }
  const { reportProject } = await import("../src/project-report/context.mjs");
  const storeOf = (cwd) => reportProject(env, cwd).store.root;
  assert.deepEqual((await reportExtensions(storeOf(mine), realIo())).parts.map((p) => p.id), ["counted.metric"]);
  assert.deepEqual((await reportExtensions(storeOf(theirs), realIo())).parts, [], "another project's store never sees it");
});

// A part id is namespaced by its extension's id, so no two extensions can own
// one: a claim on another's namespace is refused, and the owner's part stands.
test("a part id belongs to its extension: another extension claiming it is refused, and the owner's part stands", async (t) => {
  const base = tempBase(t);
  const store = join(base, "store");
  for (const owner of ["alpha", "beta"]) {
    const dir = join(store, "qc-tools", owner);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "extension.json"), JSON.stringify({ id: owner, version: "0.1.0", apiVersion: "orbit.extension/v2", engine: ">=0.0.1 <1", status: "active", reporting: "./reporting.json" }));
    writeFileSync(join(dir, "reporting.json"), JSON.stringify({ parts: [{ id: "alpha.shared", version: "0.1.0", kind: "section", contract: "orbit.report.part/v1", runtime: "python", entry: "./s.py", doc: "d", section: { id: "alpha.shared", title: "S" } }] }));
    writeFileSync(join(dir, "s.py"), "def run(envelope, sdk):\n    return {}\n");
  }
  const found = await reportExtensions(store, realIo());
  assert.deepEqual(found.parts.map((p) => p.id), ["alpha.shared"], "the first registered, by id order");
  assert.match(found.refused.find((r) => r.id === "beta").why, /alpha\.shared must be namespaced under its extension: beta\.<name>/);
});
