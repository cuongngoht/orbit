// A MISSION'S REPOSITORIES, through the real API: work given to an employee may bring repositories the employee may use
// (its Access tab) -- never another. Each attempt gets a snapshot of each one, at its branch, as a git bundle in /input
// that the employee clones with its own git: Orbit Web cloned it with the installation's sign-in, on its own side, and
// nothing of that sign-in reaches the sandbox. The bundles are gone from Orbit Web once the attempt has them.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type EmployeeDetail, type MissionAccepted, type MissionDetail, type RuntimeConnection } from "@orbit-web/contracts";
import { AttemptInputs } from "../../src/contexts/execution/application/attempt-inputs.js";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { AZURE, AZURE_REPOSITORY, azureSignedIn, eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };

describe("a mission's repositories", () => {
  let h: Harness;
  let b: Browser;
  let employee: EmployeeDetail;
  const sandbox = new FakeSandboxProvider();
  const prompts: string[] = [];

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    sandbox.readInput = (p) => h.app.get(AttemptInputs).read(p);
    azureSignedIn(h.fake);
    b = h.owner as Browser;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Repository office" })).status, 200);
    const connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((c) => c.runtime === "claude" && c.auth === "connected") as RuntimeConnection;
    const model = connection.catalog.models[0] as { id: string; efforts: string[] };
    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        prompts.push(`${t.prompt}\n${t.args.join("\n")}`);
        await t.call("write_file", { path: "/output/summary.md", content: "Read.\n" });
        await t.call("submit_handoff", { summary: "Read the repository." });
      }),
    });
    const hired = await b.send("POST", "/api/employees", {
      name: "Nam",
      profile: { title: "Developer", duties: "Read the code.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "A summary.", reportingRule: "Say what was read.", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "a test employee",
    });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
    employee = await eventually(async () => (await b.get(`/api/employees/${(hired.body as EmployeeDetail).id}`)).body as EmployeeDetail, (d) => d.sandbox.state === "READY");
  });
  after(() => h?.close());

  const give = (goal: string, repositories: unknown) =>
    b.send("POST", "/api/missions", { title: goal, goal, targetEmployeeId: employee.id, whenBusy: "enqueue", repositories, deliverables: [{ name: "summary.md", required: true }], acceptanceCriteria: [] }, { "Idempotency-Key": `k-${goal.replace(/[^A-Za-z0-9]/g, "-")}` });

  test("a repository the employee may not use is refused when the work is given", async () => {
    const r = await give("Read the web app", [{ source: "azure", id: AZURE_REPOSITORY }]);
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.match(JSON.stringify(r.body), /Access/);
  });

  test("a granted repository reaches the attempt as a git bundle the employee clones: the branch's files, Orbit Web's sign-in nowhere", async () => {
    assert.equal((await b.send("PUT", `/api/employees/${employee.id}/access`, { connectors: [{ connector: "azure", enabled: true, repositories: [AZURE_REPOSITORY] }] })).status, 200);
    const given = await give("Read the web app now", [{ source: "azure", id: AZURE_REPOSITORY }]);
    assert.equal(given.status, 201, JSON.stringify(given.body));
    const missionId = (given.body as MissionAccepted).missionId;
    const m = await eventually(async () => (await b.get(`/api/missions/${missionId}`)).body as MissionDetail, (x) => x.handoffs.length === 1, 15_000);
    assert.deepEqual(m.repositories, [{ source: "azure", fullName: `${AZURE.organization}/${AZURE.project}/${AZURE.name}`, branch: null }]);
    const attempt = [...sandbox.attempts.values()].at(-1);
    const input = attempt?.spec.inputs.find((i) => i.name.endsWith(".bundle"));
    assert.equal(input?.name, `repo-${AZURE.name}.bundle`);
    const bytes = sandbox.workspaces.get(attempt?.spec.assignmentId as string)?.get(`/input/${input?.name}`) as Buffer;
    assert.ok(bytes !== undefined && bytes.length > 0, "the bundle is in /input");
    const dir = mkdtempSync(join(tmpdir(), "ow-bundle-"));
    writeFileSync(join(dir, "r.bundle"), bytes);
    assert.equal(spawnSync("git", ["clone", "-q", join(dir, "r.bundle"), join(dir, "work")], { encoding: "utf8" }).status, 0);
    assert.equal(readFileSync(join(dir, "work", "README.md"), "utf8"), "# sum fixture\n");
    assert.match(spawnSync("git", ["-C", join(dir, "work"), "log", "--format=%s"], { encoding: "utf8" }).stdout, new RegExp(`${AZURE.organization}/${AZURE.project}/${AZURE.name} main at [0-9a-f]{40}`));
    // The employee is told what it is and how to open it.
    assert.match(prompts.at(-1) ?? "", new RegExp(`git clone /input/repo-${AZURE.name}\\.bundle`));
    // Orbit Web cloned it with its own sign-in, and keeps nothing of it once the attempt has it.
    const clone = h.fake.calls.find((c) => c.args.includes("clone") && c.args.includes("--depth=1"));
    assert.ok(clone !== undefined, "a shallow clone, through the source's sign-in");
    assert.equal(JSON.stringify(attempt?.spec).includes("azureGitHelper"), false);
    const room = join(h.config.data.control, "repo-bundles");
    assert.deepEqual(existsSync(room) ? readdirSync(room) : [], []);
    first = missionId;
  });

  let first = "";

  test("a repository the employee may no longer use is not brought in, and the employee is told so", async () => {
    // Given while the last work still waits for review: it waits its turn.
    const queued = await give("Read the web app later", [{ source: "azure", id: AZURE_REPOSITORY }]);
    assert.equal(queued.status, 202, JSON.stringify(queued.body));
    assert.equal((await b.send("PUT", `/api/employees/${employee.id}/access`, { connectors: [{ connector: "azure", enabled: false, repositories: null }] })).status, 200);
    const done = (await b.get(`/api/missions/${first}`)).body as MissionDetail;
    const root = done.assignments[0] as { id: string; version: number };
    assert.equal((await b.send("POST", `/api/assignments/${root.id}/accept`, { handoffDigest: done.handoffs.at(-1)?.digest }, { "if-match": `"${root.version}"` })).status, 200);
    const later = (queued.body as MissionAccepted).missionId;
    await eventually(async () => (await b.get(`/api/missions/${later}`)).body as MissionDetail, (x) => x.handoffs.length === 1, 15_000);
    const attempt = [...sandbox.attempts.values()].at(-1);
    assert.equal(attempt?.spec.inputs.some((i) => i.name.endsWith(".bundle")), false);
    assert.match(prompts.at(-1) ?? "", /not brought in -- you may no longer use it on Azure DevOps/);
  });
});
