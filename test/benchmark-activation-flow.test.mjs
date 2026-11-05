// THE ACTIVATION CONTROLLER (0.5.0, B22 M4), carried end to end over a small repository of its own through the DOCKER
// DOUBLE: its seed round, the host's round, the inspection and -- for an outcome case -- the verifier's hidden checks,
// before the round and over what the host delivered, each a container the double runs here. The scripted host and the
// inspection are the real ones (scripted.mjs, inspect.mjs), run with this checkout's Orbit at the paths each container
// mounts -- every container of a run sees the target at one path, as Docker mounts it at /work/repo -- and the judge, the
// report and the task door are the real ones. What it proves is the flow: every control of a case comes to what it
// declares through `controls`; the seed is laid in by the run's own Orbit; the switches reach the host by name and value;
// the brief and the plugin a host is handed carry nothing of the truth; and the case runs on three arms -- no Orbit at
// all, the previous release, this one -- read back each time with this release's own Orbit, folded apart by `metrics`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { hostArgs } from "../benchmark/images/runner/entry.mjs";
import { COMMANDS } from "../benchmark/lib/commands.mjs";
import { docRead, roomOf } from "../benchmark/lib/core/room.mjs";
import { asContained, briefPlayed, inspectorRan } from "./benchmark-activation-play.mjs";
import { dockerDouble, GIT_ENV, harnessOf, ROOT, worldOf } from "./benchmark-double.mjs";
import { sealed } from "./home.mjs";
import { takeTurn } from "./benchmark-turn.mjs";

await takeTurn();

// ---- the world: a fixture, and an activation suite of two cases ------------------------------------------------------------

const PROMPT = "Where would a new payment-provider integration belong in this codebase, and does anything already handle payments?\n";

const LIMITS = { rounds: 1, minutes: 45, usd: 3, maxTurns: 25, runner: { cpus: 1, memoryMb: 512, pids: 64, minutes: 20, outputMb: 1 } };

const COMMON = { schema: 1, kind: "activation", version: "1.0.0", request: "request.md", language: "en", fixture: { id: "calc" }, arms: ["none", "baseline", "release"], baselinePlugin: "v-base", withheld: ["SECRET.md"], artifacts: ["manifest", "seed", "host-stream", "inspection", "judged", "report"], cleanup: { containers: "run-label", networks: "run-label", scratch: "keep" } };

const ARCHITECTURE = [{ do: "skill", name: "orbit:orbit-architecture" }, { do: "orbit", argv: ["architecture.mjs", "ensure", "--for=a payment-provider integration"] }];

const SELECTION = { ...COMMON, id: "ACT-T-001", title: "where an integration belongs is an architecture question", goal: "the host asks Orbit's architecture memory, and keeps the map it was seeded with as it was", measures: { kind: "activation", capability: "architecture", tier: "selection" }, seed: { files: "seed/files" }, switches: { ORBIT_AGENT_QA_AGENT: "off" }, acceptance: { owner: "verifier", truth: "verifier/truth.json" }, limits: LIMITS, variants: { real: {} }, controls: [{ id: "reference", host: "reference", expect: "PASS", file: "controls/reference.json" }, { id: "idle", host: "idle", expect: "FAIL", class: "HOST_DIVERGED" }, { id: "forging", host: "forging", expect: "FAIL", class: "INSUFFICIENT_EVIDENCE" }] };

const SELECTION_TRUTH = { schema: 1, activate: true, strategy: ["DIRECT"], how: [], selection: [{ skills: { require: ["orbit-architecture"], allow: [] }, agents: { require: [], allow: ["orbit-architecture-scanner"], max: 1 } }], forbid: { skills: ["orbit-engineer"], agents: [], commands: [] }, readOnly: {}, records: [{ id: "architecture-ensured", read: "architecture", expect: {} }, { id: "map-unchanged", read: "store", expect: {} }], relevant: null, grounding: null };

const SUM = { mutations: [{ id: "sum", file: "src/calc.mjs", find: "a - b", replace: "a + b", count: 1 }], files: [], deletes: [] };

const OUTCOME = { ...COMMON, id: "ACT-T-002", title: "a plain fix is made, and holds", goal: "add returns a sum, by the developer workflow", measures: { kind: "activation", capability: "development", tier: "outcome" }, request: "request.md", acceptance: { owner: "verifier", truth: "verifier/truth.json", spec: "verifier/spec.mjs", probe: "verifier/probe.mjs", samples: 6 }, scope: { allow: ["src/*.mjs", "test/*.test.mjs"], deny: [] }, checks: { gates: [{ id: "public-tests", argv: ["node", "--test", "--test-reporter=tap", "test/calc.test.mjs"] }], agentTests: { required: false, pattern: "^test/[^/]+\\.test\\.mjs$" } }, limits: { ...LIMITS, minutes: 120, usd: 5, maxTurns: 60, verifier: { cpus: 1, memoryMb: 512, pids: 64, seconds: 60 } }, variants: { real: { mutations: "variants/real.json" } }, controls: [{ id: "reference", host: "reference", expect: "PASS", file: "controls/reference.json" }, { id: "half", host: "half", expect: "FAIL", class: "HOST_DIVERGED", file: "controls/half.json" }] };

const OUTCOME_TRUTH = { ...SELECTION_TRUTH, selection: [{ skills: { require: ["orbit-develop"], allow: [] }, agents: { require: [], allow: [], max: 0 } }], records: [] };

const SPEC = `export const GROUPS = { sums: "add returns the sum of its two numbers" };
export const cases = (seed, samples) => Array.from({ length: samples }, (_, i) => ({ id: "sums-" + (i + 1), group: "sums", input: { a: i + 1, b: (seed % 7) + i }, expect: { exactly: [String(i + 1 + (seed % 7) + i)] } }));
export const selfTest = () => [];
`;

const PROBE = `import { join } from "node:path";
import { pathToFileURL } from "node:url";
const chunks = [];
process.stdin.on("data", (d) => chunks.push(d)).on("end", async () => {
  const inputs = JSON.parse(Buffer.concat(chunks).toString()).inputs;
  try { const m = await import(pathToFileURL(join(process.argv[2], "src/calc.mjs")).href); process.stdout.write(JSON.stringify({ answers: inputs.map((i) => ({ id: i.id, got: [String(m.add(i.a, i.b))] })) }) + "\\n"); }
  catch (e) { process.stdout.write(JSON.stringify({ error: { code: "IMPORT", message: String(e.message) } }) + "\\n"); }
});
`;

const control = (steps, edits) => JSON.stringify({ schema: 1, steps, ...(edits ? { edits } : {}) });

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

const FILES = {
  "MARKER.md": "the plugin as it is now\n",
  "SECRET.md": "what no host is handed\n",
  "benchmark/fixtures/calc/fixture.json": json({ schema: 1, id: "calc", about: "a calculator", tests: { from: "checks/", to: "test/", suffix: ".test.mjs" } }),
  "benchmark/fixtures/calc/package.json": '{ "name": "calc", "private": true, "type": "module" }\n',
  "benchmark/fixtures/calc/src/calc.mjs": "export const add = (a, b) => a + b;\n",
  "benchmark/fixtures/calc/checks/calc.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/calc.mjs";\ntest("adds nothing to nothing", () => {\n  assert.equal(add(0, 0), 0);\n});\n',
  "benchmark/suites/acts/suite.json": json({ schema: 1, id: "acts", version: "1.0.0", title: "two activation cases", cases: ["ACT-T-001", "ACT-T-002"] }),
  "benchmark/suites/acts/act-t-001/case.json": json(SELECTION),
  "benchmark/suites/acts/act-t-001/request.md": PROMPT,
  "benchmark/suites/acts/act-t-001/verifier/truth.json": json(SELECTION_TRUTH),
  "benchmark/suites/acts/act-t-001/controls/reference.json": control(ARCHITECTURE),
  "benchmark/suites/acts/act-t-001/seed/files/ui-tests/project.json": '{ "name": "calc", "origin": "http://localhost:3000" }\n',
  "benchmark/suites/acts/act-t-001/seed/files/ui-tests/graph/screens.json": '[\n  { "id": "sums", "name": "Sums", "url": "/sums", "seen": "src" }\n]\n',
  "benchmark/suites/acts/act-t-002/case.json": json(OUTCOME),
  "benchmark/suites/acts/act-t-002/request.md": "add(a, b) should return the sum of its two numbers. Fix it.\n",
  "benchmark/suites/acts/act-t-002/verifier/truth.json": json(OUTCOME_TRUTH),
  "benchmark/suites/acts/act-t-002/verifier/spec.mjs": SPEC,
  "benchmark/suites/acts/act-t-002/verifier/probe.mjs": PROBE,
  "benchmark/suites/acts/act-t-002/variants/real.json": json({ schema: 1, id: "real", about: "a sum made a difference", mutations: [{ id: "difference", file: "src/calc.mjs", find: "a + b", replace: "a - b", count: 1 }], files: [], deletes: [] }),
  "benchmark/suites/acts/act-t-002/controls/reference.json": control([{ do: "skill", name: "orbit:orbit-develop" }, { do: "read", path: "src/calc.mjs" }, { do: "edit" }], SUM),
  "benchmark/suites/acts/act-t-002/controls/half.json": control([{ do: "skill", name: "orbit:orbit-develop" }]),
};

const gitIn = (cwd, ...a) => execFileSync("git", a, { cwd, env: sealed(GIT_ENV), encoding: "utf8" }).trim();

// The world, with the revision its baseline arm names: the plugin as it was (`v-base`), then one commit after it.
function world(t) {
  const w = worldOf(t, { ...FILES, "MARKER.md": "the plugin as it was\n" });
  gitIn(w.repo, "tag", "v-base");
  writeFileSync(join(w.repo, "MARKER.md"), FILES["MARKER.md"]);
  gitIn(w.repo, "commit", "-qam", "the plugin moved on");
  return w;
}

// ---- the containers, played -----------------------------------------------------------------------------------------------

// Where every container of a run sees the target: the directory a container mounts at /work/repo, moved to one path for
// the container's life -- as Docker mounts every container's at /work/repo, so the checkout is one checkout to Orbit --
// and moved back after.
const mountAt = (w) => join(w.base, "work", "repo");

function mountedAt(w, dir, fn) {
  mkdirSync(dirname(mountAt(w)), { recursive: true });
  renameSync(dir, mountAt(w));
  try { return fn(mountAt(w)); } finally { renameSync(mountAt(w), dir); }
}

// What a container was handed in its environment file, by name and value.
const envOf = (c) => Object.fromEntries((c.flags["--env-file"] ?? []).flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])));

const mountsOf = (c) => Object.fromEntries(c.mounts.map((m) => [m.target, { source: m.source, readOnly: m.readOnly === true }]));

// A coding host, as the double plays one: on an arm with Orbit it does what a careful engineer would (`w.model`); with
// none, it reads the code.
const asHost = (w, brief) => (brief.script ? brief : { ...brief, script: { id: "model", mode: "activation", kind: "reference", steps: brief.plugin ? w.model : [{ do: "read", path: "src/calc.mjs" }], session: "model-session" } });

const hasMount = (c, target) => c.mounts.some((m) => m.target === target);

// The runner (the seed's round and the host's), as /bench/entry.mjs plays its scripted host: this checkout's Orbit, the
// target where the container mounts it, the runner's store, the container's own environment.
const runnerOf = (w, seen) => async (c, at) => {
  const brief = JSON.parse(readFileSync(at("/run/brief/brief.json"), "utf8"));
  seen.push({ round: brief.round, brief, env: envOf(c), mounts: mountsOf(c) });
  const r = mountedAt(w, at("/work/repo"), (repo) => briefPlayed(asHost(w, brief), { plugin: ROOT, repo, env: { ...w.env, ...envOf(c), ORBIT_STORE_DIR: at("/work/store") }, out: at("/work/out"), seed: hasMount(c, "/run/seed") ? at("/run/seed") : null }));
  const text = asContained({ plugin: ROOT, repo: mountAt(w), store: at("/work/store") }, r.text);
  writeFileSync(join(at("/work/out"), "host.jsonl"), text);
  writeFileSync(join(at("/work/out"), "runner.json"), JSON.stringify({ round: brief.round, task: null, exit: r.problems.length ? 1 : 0, egress: { holds: true } }));
  return { exit: 0, stdout: text };
};

// The inspection, as inspect.mjs --activation reads a round back: the frozen target where the host's was, the worktree
// the host changed, the runner's store -- with this checkout's Orbit.
const inspectionOf = (w, seen) => (c, at) => {
  seen.push({ round: "inspect", argv: c.argv, mounts: mountsOf(c) });
  return { exit: mountedAt(w, at("/work/repo"), (repo) => inspectorRan({ repo, store: at("/work/store"), out: at("/work/out"), tree: at("/work/worktree"), env: w.env })) };
};

const harnessFor = (w, seen) => harnessOf(w, dockerDouble({ runner: runnerOf(w, seen), inspect: inspectionOf(w, seen) }));

const roomFor = (w, run) => roomOf(w.storeRoot, run);

// ---- the controls, through the controller ----------------------------------------------------------------------------------

test("every control of a selection case comes to what it declares through `controls`: the seed laid in by the run's own Orbit, the host's round, the inspection, the judge", async (t) => {
  const w = world(t);
  const seen = [];
  const r = await COMMANDS.controls.run(harnessFor(w, seen), ["ACT-T-001"]);
  assert.deepEqual(r.rows.map((x) => [x.id, x.got, x.class, x.matched]), [["reference", "PASS", null, true], ["idle", "FAIL", "HOST_DIVERGED", true], ["forging", "FAIL", "INSUFFICIENT_EVIDENCE", true]], JSON.stringify(r.rows.map((x) => x.summary)));
  assert.equal(r.exit, 0);
  const room = roomFor(w, r.rows[0].run);
  const judged = docRead(room, "judged.json");
  assert.deepEqual([judged.verdict, judged.agreement.verdict, judged.observed.strategy, judged.observed.skills, judged.records.map((x) => [x.id, x.ok])], ["PASS", "AGREES", "DIRECT", ["orbit-architecture"], [["architecture-ensured", true], ["map-unchanged", true]]]);
  assert.ok(existsSync(room.at("rounds", "1", "host.stream.jsonl")), "the stream the controller captured, which the judge read");
  const report = docRead(room, "report.json");
  assert.deepEqual([report.kind, report.hostBasis, report.activation.arm, report.activation.language, report.activation.verdict, report.rounds.length], ["activation", "scripted", "release", "en", "PASS", 1]);
  const seed = seen.find((x) => x.round === 0);
  assert.deepEqual([seed.brief.script.mode, seed.mounts["/work/repo"].readOnly, seed.mounts["/run/seed"].readOnly, seed.mounts["/work/store"].readOnly], ["seed", true, true, false], "the seed reads the target, and writes only the runner's store");
  const seeded = JSON.parse(readFileSync(room.at("seed", "out", "seed.json"), "utf8"));
  assert.deepEqual([seeded.problems, Object.keys(seeded.digests)], [[], ["graph/screens.json"]], "the map laid where Orbit keeps the project's test data, and what the store's reader compares with");
});

test("a host is handed the prompt verbatim, the case's switches by name and value, and a plugin that carries nothing of the truth", async (t) => {
  const w = world(t);
  const seen = [];
  const r = await COMMANDS.controls.run(harnessFor(w, seen), ["ACT-T-001", "--only=reference"]);
  assert.equal(r.exit, 0);
  const host = seen.find((x) => x.round === 1);
  assert.deepEqual([host.brief.prompt, host.env.ORBIT_AGENT_QA_AGENT, host.mounts["/work/repo"].readOnly, host.mounts["/work/orbit"].readOnly], [PROMPT, "off", false, true]);
  const brief = JSON.stringify(host.brief);
  for (const word of ["architecture-ensured", "map-unchanged", "selection", "forbid", "readOnly", "truth.json"]) assert.ok(!brief.includes(word), word);
  const plugin = host.mounts["/work/orbit"].source;
  assert.ok(existsSync(join(plugin, "MARKER.md")) && !existsSync(join(plugin, "SECRET.md")) && !existsSync(join(plugin, "benchmark")), "the harness and what the case withholds never reach the plugin");
  const inspection = seen.find((x) => x.round === "inspect");
  assert.ok(inspection.argv.includes("--activation") && inspection.mounts["/work/repo"].readOnly && inspection.mounts["/work/worktree"].readOnly && inspection.mounts["/work/store"].readOnly, "the inspection reads, and writes nothing but its own out");
});

test("an outcome case: its target held to its hidden checks before the round, then what the host delivered -- a fix that holds passes, a skill chosen and nothing done fails", async (t) => {
  const w = world(t);
  const r = await COMMANDS.controls.run(harnessFor(w, []), ["ACT-T-002"]);
  assert.deepEqual(r.rows.map((x) => [x.id, x.got, x.class, x.matched]), [["reference", "PASS", null, true], ["half", "FAIL", "HOST_DIVERGED", true]], JSON.stringify(r.rows.map((x) => x.summary)));
  const judged = docRead(roomFor(w, r.rows[0].run), "judged.json");
  assert.deepEqual([judged.outcome.delivered, judged.outcome.held, judged.outcome.changes], ["host", true, 1]);
  const half = docRead(roomFor(w, r.rows[1].run), "judged.json");
  assert.deepEqual([half.row, half.outcome.delivered, half.outcome.held], ["OUTCOME", "nothing", false]);
  const verified = docRead(roomFor(w, r.rows[0].run), "report.json").judged.outcome;
  assert.equal(verified.complete, true, "the hidden checks came to an answer");
});

// ---- three arms --------------------------------------------------------------------------------------------------------------

test("--arm=all runs the case with no Orbit, with the previous release and with this one -- each read back with this release's own Orbit, and folded apart by `metrics`", async (t) => {
  const w = { ...world(t), model: ARCHITECTURE };
  const seen = [];
  const h = harnessFor(w, seen);
  const r = await COMMANDS.run.run(h, ["ACT-T-001", "--arm=all", "--seed=3"]);
  assert.deepEqual(r.runs.map((x) => [x.arm, x.outcome]), [["none", "PASS"], ["baseline", "PASS"], ["release", "PASS"]], JSON.stringify(r.runs.map((x) => x.summary)));
  const hosts = seen.filter((x) => x.round === 1);
  const inspections = seen.filter((x) => x.round === "inspect");
  assert.deepEqual(hosts.map((x) => [x.brief.arm, x.brief.plugin, Boolean(x.mounts["/work/orbit"])]), [["none", null, false], ["baseline", "/work/orbit", true], ["release", "/work/orbit", true]], "no plugin where the host runs on the none arm");
  const said = (b, flag) => ((a) => (a.includes(flag) ? a[a.indexOf(flag) + 1] : null))(hostArgs(b));
  assert.deepEqual(["--max-turns", "--max-budget-usd", "--disallowedTools", "--plugin-dir"].map((f) => said(hosts[2].brief, f)), ["25", "3", "WebFetch,WebSearch", "/work/orbit"], "Claude Code held to a selection case's caps, nothing but the web denied");
  assert.equal(said(hosts[0].brief, "--plugin-dir"), null, "and on the none arm handed no plugin");
  assert.equal(readFileSync(join(hosts[1].mounts["/work/orbit"].source, "MARKER.md"), "utf8"), "the plugin as it was\n", "the baseline arm's host is handed the previous release");
  assert.equal(readFileSync(join(inspections[1].mounts["/work/orbit"].source, "MARKER.md"), "utf8"), FILES["MARKER.md"], "and is read back with this one");
  assert.ok(inspections.every((x) => readFileSync(join(x.mounts["/work/orbit"].source, "MARKER.md"), "utf8") === FILES["MARKER.md"]), "every arm is read back with this release's own Orbit");
  const judged = r.runs.map((x) => docRead(roomFor(w, x.run), "judged.json"));
  assert.deepEqual(judged.map((j) => [j.observed.activated, j.metric.applies, j.agreement.verdict]), [[false, false, "AGREES"], [true, true, "AGREES"], [true, true, "AGREES"]], "no trail and no Orbit call where no Orbit was handed");
  const m = COMMANDS.metrics.run(h, ["--by=arm"]);
  const arm = (name) => m.byArm.find((g) => g.arm === name);
  assert.deepEqual(["none", "baseline", "release"].map((a) => arm(a).bases["coding-host"].activation_recall.value), ["unknown", 1, 1], "with no plugin there is nothing to select");
  assert.equal(m.bases["coding-host"].activation_recall.denominator, 2);
  assert.match(COMMANDS.metrics.say(m), /BY ARM/);
});
