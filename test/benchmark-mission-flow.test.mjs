// A MISSION run's controller (0.5.0, backlog B4, ADR 0055), carried end to end through the DOCKER DOUBLE over a small
// repository of its own -- a calculator fixture and a mission case on it -- with the runner and the inspection played:
// the runner makes the round's change in the engineering task's workspace, and the inspection says what Satellite, the
// trail and the task kept. What it proves is the controller of a mission case: the round's inspection is handed no task
// (the mission names its own), a mission whose every leg holds PASSes, one whose reader's agent stepped outside its
// profile FAILS on the privilege leg alone, each round's outcome keeps its legs and its rows, and the report says the
// mission beside the code.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { docRead } from "../benchmark/lib/core/room.mjs";
import { missionReportOf } from "../benchmark/lib/mission/report.mjs";
import { compared, listed } from "../benchmark/images/runner/inspect.mjs";
import { hostArgs } from "../benchmark/images/runner/entry.mjs";
import { dockerDouble, ranAs, runOf, TASK, VIEW, worldOf } from "./benchmark-double.mjs";
import { takeTurn } from "./benchmark-turn.mjs";

await takeTurn();

const SPEC = `export const GROUPS = { sums: "add returns the sum of its two numbers" };
export const cases = (seed, samples) => Array.from({ length: samples }, (_, i) => ({ id: "sums-" + (i + 1), group: "sums", input: { call: "add", a: i, b: (seed % 7) + i }, expect: { exactly: [String(i + (seed % 7) + i)] } }));
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

const REFERENCE = { schema: 1, id: "reference", about: "the sum, and a test of it", mutations: [{ id: "sum", file: "src/calc.mjs", find: "a - b", replace: "a + b", count: 1 }], files: [{ rel: "test/calc-sum.test.mjs", lines: ['import assert from "node:assert/strict";', 'import { test } from "node:test";', 'import { add } from "../src/calc.mjs";', 'test("sums", () => assert.equal(add(2, 3), 5));'] }], deletes: [] };

const repair = (id, script, expect, legs) => ({ id, variant: "real", candidate: "controls/reference.json", through: "engine", expect, script, ...(legs ? { legs } : {}) });

const CASE = { schema: 1, kind: "mission", id: "MSN-T-001", version: "1.0.0", baseline: "FAIL", fixture: "calc", title: "add returns a sum", goal: "a goal through Satellite: add(a, b) returns a + b", measures: { kind: "mission", capability: "satellite.mission.bugfix", expects: "change" }, subject: { paths: ["src/calc.mjs"], exports: { "src/calc.mjs": ["add"] } }, request: "request.md", reproduce: "each failing check names its numbers", acceptance: { owner: "verifier", spec: "verifier/spec.mjs", probe: "verifier/probe.mjs", samples: 6 }, scope: { allow: ["src/calc.mjs", "test/*.test.mjs"], deny: [] }, checks: { gates: [{ id: "public-tests", argv: ["node", "--test", "--test-reporter=tap", "test/calc.test.mjs"] }], agentTests: { required: true, pattern: "^test/[^/]+\\.test\\.mjs$" } }, limits: { rounds: 1, minutes: 120, usd: 5, runner: { cpus: 1, memoryMb: 512, pids: 64, minutes: 30, outputMb: 1 }, verifier: { cpus: 1, memoryMb: 512, pids: 64, seconds: 60 }, engineering: { attempts: 3, actions: 50 } }, artifacts: ["manifest", "report"], cleanup: { containers: "run-label", networks: "run-label", scratch: "keep" }, variants: { real: { mutations: "variants/real.json" }, solved: {} }, controls: [], repairs: [repair("reference", "mission", "PASS"), repair("claims", "claims", "FAIL", ["code", "criteria"]), repair("over-reach", "over-reach", "FAIL", ["privilege"]), repair("idle", "idle", "NO_PROGRESS")] };

const AT = "benchmark/suites/missions/msn-t-001";

const FILES = {
  "package.json": '{ "name": "bench-world", "private": true, "type": "module" }\n',
  "benchmark/fixtures/calc/fixture.json": JSON.stringify({ schema: 1, id: "calc", about: "a calculator", tests: { from: "checks/", to: "test/", suffix: ".test.mjs" } }),
  "benchmark/fixtures/calc/src/calc.mjs": "export const add = (a, b) => a + b;\n",
  "benchmark/fixtures/calc/checks/calc.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/calc.mjs";\ntest("adds nothing to nothing", () => {\n  assert.equal(add(0, 0), 0);\n});\n',
  "benchmark/suites/missions/suite.json": JSON.stringify({ schema: 1, id: "missions", version: "1.0.0", title: "a mission on a calculator", cases: ["MSN-T-001"] }),
  [`${AT}/case.json`]: JSON.stringify(CASE, null, 2),
  [`${AT}/request.md`]: "Make add return the sum of its two numbers, through a mission.\n",
  [`${AT}/verifier/spec.mjs`]: SPEC,
  [`${AT}/verifier/probe.mjs`]: PROBE,
  [`${AT}/variants/real.json`]: JSON.stringify({ schema: 1, id: "real", about: "a sum made a difference", mutations: [{ id: "difference", file: "src/calc.mjs", find: "a + b", replace: "a - b", count: 1 }], files: [], deletes: [] }),
  [`${AT}/controls/reference.json`]: JSON.stringify(REFERENCE),
};

const FIXED = { "src/calc.mjs": "export const add = (a, b) => a + b;\n", "test/calc-sum.test.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/calc.mjs";\ntest("sums", () => assert.equal(add(2, 3), 5));\n' };

// ---- what a mission round's inspection reads back, played -------------------------------------------------------------

const run = (o) => ({ dispatch: "native", lifecycle: "ended", outcome: "succeeded", attribution: "HOST_OBSERVED", basis: "the Agent call that carried its envelope launched it", ...o });

const MISSION = { id: "msn-0123456789ab", lifecycle: "COMPLETED", verdict: "VERIFIED", createdAt: "2026-11-07T10:00:00Z", criteria: ["acc-1"], units: [{ id: "wu-1", kind: "explore", state: "done" }, { id: "wu-2", kind: "implement", state: "done" }], runs: [run({ id: "arn-1", unit: "wu-1", profile: "READ_ONLY", agent: "orbit:satellite-reader", provider: "host-agent", providerRef: "host:claude", hostAgent: "claude:reader" }), run({ id: "arn-2", unit: "wu-2", profile: "IMPLEMENT", agent: "orbit:satellite-engineer", provider: "engineering", providerRef: `task:${TASK}`, hostAgent: "claude:engineer" })], evidence: [{ unit: "wu-2", agentRun: "arn-2", owner: "task", ref: `task:${TASK}`, level: "VERIFIED", independent: true, verified: true, acceptance: ["acc-1"] }] };

const TRAIL = [{ type: "agent.launched", id: "orbit:satellite-reader", launched: "claude:reader" }, { type: "tool.used", agent: "claude:reader", tool: "Read", kind: "read" }, { type: "agent.launched", id: "orbit:satellite-engineer", launched: "claude:engineer" }, { type: "command.ran", agent: "claude:engineer" }, { type: "tool.used", agent: "claude:engineer", tool: "Edit", kind: "edit" }];

const written = (out, name, json) => writeFileSync(join(out, name), JSON.stringify({ exit: 0, json }));

// The inspection as inspect.mjs --mission makes it: the task the mission's implement run names, its workspace compared
// with the target, and what Satellite, the trail and the task kept -- recording which task it was handed.
const missionInspected = (trail, asked) => (c, at) => {
  const out = at("/work/out");
  const tree = join(at("/work/store"), "repo-calc", "workspaces", TASK, "tree");
  asked.push(c.argv[2]);
  const changes = compared(listed(at("/work/repo"), [".claude-plugin/types"]), listed(tree));
  for (const ch of changes.filter((x) => x.change !== "deleted")) (mkdirSync(join(out, "files", ch.rel, ".."), { recursive: true }), writeFileSync(join(out, "files", ch.rel), FIXED[ch.rel]));
  writeFileSync(join(out, "inspect.json"), JSON.stringify({ task: TASK, found: "mission", workspace: true, changes: changes.map((ch) => ({ ...ch, copied: ch.change !== "deleted" })) }));
  [["task.json", VIEW("COMPLETED")], ["tasks.json", { tasks: [{ id: TASK, provider: "autonomous-engineering" }] }], ["trace.json", {}], ["missions.json", { missions: [MISSION] }], ["trail.json", { source: "ok", events: trail }], ["owners.json", { tasks: { [TASK]: { lifecycle: "COMPLETED", verification: [{ state: "satisfied", evidence: "check:chk-7" }] } } }]].forEach(([name, json]) => written(out, name, json));
  return { exit: 0 };
};

const missionRun = async (t, trail) => ((asked) => runOf(worldOf(t, FILES), dockerDouble({ runner: ranAs(FIXED), inspect: missionInspected(trail, asked) }), { caseId: "MSN-T-001", repair: true }).then((r) => ({ ...r, asked })))([]);

const reportOfRun = (r) => missionReportOf(r.ctx.room, r.ctx.manifest, r.view, Object.fromEntries((r.view.actions ?? []).map((a) => [a.id, docRead(r.ctx.room, `steps/${a.id}.json`)]).filter(([, d]) => d)), docRead(r.ctx.room, "ending.json"));

test("a mission whose change the verifier holds and whose every record holds PASSes: its inspection was handed no task, its round keeps every leg held, and its report says the mission", async (t) => {
  const r = await missionRun(t, TRAIL);
  assert.deepEqual([r.result.outcome, r.result.exit], ["PASS", 0], r.result.summary);
  assert.deepEqual(r.asked, ["-"], "a mission names its own task: the controller hands the inspection none");
  const outcome = docRead(r.ctx.room, "rounds/1/outcome.json");
  assert.deepEqual([outcome.legs, outcome.failedLegs], [{ code: true, criteria: true, privilege: true }, []]);
  assert.deepEqual(outcome.records.map((x) => [x.id, x.leg, x.ok]), [["engineering-completed", "code", true], ["mission-delivered", "code", true], ["criteria-settled", "criteria", true], ["least-privilege", "privilege", true]]);
  const rep = reportOfRun(r);
  assert.deepEqual([rep.json.mission.legs, rep.json.mission.mission.id, rep.json.mission.mission.verdict], [{ code: true, criteria: true, privilege: true }, MISSION.id, "VERIFIED"]);
  assert.match(rep.md, /## The goal's three legs[\s\S]*code held · criteria held · privilege held[\s\S]*## The mission, as Satellite's journal says[\s\S]*arn-1 \(wu-1\): READ_ONLY as orbit:satellite-reader/);
});

test("a mission whose reader's agent edited a file FAILS on the privilege leg alone, though its change and its criteria hold, and the round says which run and why", async (t) => {
  const r = await missionRun(t, [...TRAIL, { type: "tool.used", agent: "claude:reader", tool: "Edit", kind: "edit" }]);
  assert.deepEqual([r.result.outcome, r.result.exit], ["FAIL", 1], r.result.summary);
  const outcome = docRead(r.ctx.room, "rounds/1/outcome.json");
  assert.deepEqual(outcome.failedLegs, ["privilege"]);
  assert.match(outcome.records.find((x) => x.id === "least-privilege").why[0], /arn-1's agent made edit call\(s\) its orbit:satellite-reader tools do not carry/);
  assert.match(reportOfRun(r).md, /FAILED \[privilege\] least-privilege/);
});

test("a mission round's host may never start an engineering task by hand: a mission's implement unit asks for the one it needs, so a change made in any other task is no mission's", () => {
  const denied = (kind) => ((a) => a[a.indexOf("--disallowedTools") + 1].split(","))(hostArgs({ kind, plugin: "/work/orbit", outputBytes: 1024, usd: 1 }));
  assert.ok(denied("mission").includes("Bash(node /work/orbit/cli/autonomous-engineering.mjs start:*)"));
  assert.ok(["cleanup", "remove-workspace"].every((cmd) => denied("mission").includes(`Bash(node /work/orbit/cli/autonomous-engineering.mjs ${cmd}:*)`)), "and removes nothing its tasks left, as a goal round's host never does");
  assert.ok(!denied("engineering").some((d) => /autonomous-engineering\.mjs start/.test(d)), "a goal round's workflow starts its own task the way a host would");
});
