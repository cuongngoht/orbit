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
import { DEFAULT_PRESETS, type Department, type EmployeeDetail, type MissionAccepted, type MissionDetail, type MissionTargetPreview, type RuntimeConnection } from "@orbit-web/contracts";
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

  test("a repository URL mentioned in the brief is never auto-attached or staged even when the employee has Access", async () => {
    // Re-grant Azure access to Nam and accept the prior mission so Nam is free.
    assert.equal((await b.send("PUT", `/api/employees/${employee.id}/access`, { connectors: [{ connector: "azure", enabled: true, repositories: [AZURE_REPOSITORY] }] })).status, 200);
    const prev = (await b.get(`/api/missions/${first}`)).body as MissionDetail;
    const prevOpen = ((await b.get("/api/missions?state=open")).body as { missions: { id: string }[] }).missions;
    for (const openM of prevOpen) {
      const detail = (await b.get(`/api/missions/${openM.id}`)).body as MissionDetail;
      const root = detail.assignments[0];
      if (root && detail.handoffs.length > 0 && root.state === "AWAITING_ACCEPTANCE") {
        await b.send("POST", `/api/assignments/${root.id}/accept`, { handoffDigest: detail.handoffs[0]?.digest }, { "if-match": `"${root.version}"` });
      }
    }
    assert.ok(prev.id.length > 0);

    const urlInBrief = `Inspect https://dev.azure.com/${AZURE.organization}/${AZURE.project}/_git/${AZURE.name} for bugs.`;
    const given = await b.send(
      "POST",
      "/api/missions",
      { title: "Brief URL without attachment", goal: urlInBrief, targetEmployeeId: employee.id, whenBusy: "enqueue", deliverables: [{ name: "summary.md", required: true }], acceptanceCriteria: [] },
      { "Idempotency-Key": "k-brief-url-unattached" },
    );
    assert.equal(given.status, 201, JSON.stringify(given.body));
    const missionId = (given.body as MissionAccepted).missionId;
    const m = await eventually(async () => (await b.get(`/api/missions/${missionId}`)).body as MissionDetail, (x) => x.handoffs.length === 1, 15_000);
    assert.deepEqual(m.repositories, []);
    const attempt = [...sandbox.attempts.values()].at(-1);
    assert.equal(attempt?.spec.inputs.some((i) => i.name.endsWith(".bundle")), false, "must never silently stage an unattached repository");
    const root = m.assignments[0]!;
    assert.equal((await b.send("POST", `/api/assignments/${root.id}/accept`, { handoffDigest: m.handoffs[0]?.digest }, { "if-match": `"${root.version}"` })).status, 200);
  });
});

describe("CEO-routed repository attachment and per-assignee authorization (Issue #4)", () => {
  let h: Harness;
  let b: Browser;
  const sandbox = new FakeSandboxProvider();
  const attemptMeta = new Map<string, { prompt: string; inputs: string[]; bundleBytes: Buffer | null }>();
  const unitLines = (p: string, keys: string[]): string[] => p.split("\n").filter((l) => new RegExp(`^- (${keys.join("|")}): `).test(l));
  const digestOf = (line: string): string | undefined => /digest ([0-9a-f]{64})/.exec(line)?.[1];

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    sandbox.readInput = (p) => h.app.get(AttemptInputs).read(p);
    azureSignedIn(h.fake);
    b = h.owner as Browser;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Delegated Repo Co" })).status, 200);
    const connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((c) => c.runtime === "claude" && c.auth === "connected") as RuntimeConnection;
    const model = connection.catalog.models[0] as { id: string; efforts: string[] };
    const dept = ((await b.send("POST", "/api/office/departments", { name: "Engineering" })).body as Department).id;

    const hire = async (name: string, departmentId: string | null, title: string): Promise<EmployeeDetail> => {
      const r = await b.send("POST", "/api/employees", {
        name,
        ...(departmentId !== null ? { departmentId } : {}),
        profile: { title, duties: "Work on repositories.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
        resources: DEFAULT_PRESETS[0]?.profile,
        skipProbation: true,
        skipReason: "test",
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (d) => d.sandbox.state === "READY");
    };

    const ceo = await hire("Eve", null, "CEO");
    const manager = await hire("Mai", dept, "Engineering Manager");
    const permitted = await hire("Nam", dept, "Permitted Engineer");
    await hire("Linh", dept, "Unauthorized Engineer");

    assert.equal((await b.send("POST", "/api/office/appointments", { role: "ceo", employeeId: ceo.id })).status, 201);
    assert.equal((await b.send("POST", "/api/office/appointments", { role: "manager", departmentId: dept, employeeId: manager.id })).status, 201);
    // Only Nam is granted read access to the Azure repository. Neither Eve (CEO), Mai (Manager), nor Linh has a grant.
    assert.equal((await b.send("PUT", `/api/employees/${permitted.id}/access`, { connectors: [{ connector: "azure", enabled: true, repositories: [AZURE_REPOSITORY] }] })).status, 200);

    const recordAttempt = (tag: string, prompt: string) => {
      const running = [...sandbox.attempts.values()].find((a) => a.running);
      const inputs = running?.spec.inputs.map((i) => i.name) ?? [];
      const bundleName = inputs.find((n) => n.endsWith(".bundle"));
      const bundleBytes = bundleName && running ? (sandbox.workspaces.get(running.spec.assignmentId)?.get(`/input/${bundleName}`) ?? null) : null;
      attemptMeta.set(tag, { prompt, inputs, bundleBytes });
    };

    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        const p = t.prompt;
        if (p.includes("[ceo-repo-flow]")) {
          const lines = unitLines(p, ["eng"]);
          if (lines.length === 0) {
            recordAttempt("ceo", p);
            await t.call("delegate", {
              parts: [{ key: "eng", department: "Engineering", title: "Audit repo", goal: "[mgr-repo-flow] Delegate repo audit.", deliverables: ["summary.md"], share_repositories: true }],
            });
            return;
          }
          for (const l of lines.filter((x) => x.includes("awaiting acceptance"))) {
            await t.call("review_unit", { part: "eng", decision: "accept", digest: digestOf(l) });
          }
          await t.call("write_file", { path: "/output/summary.md", content: "CEO synthesis.\n" });
          await t.call("submit_handoff", { summary: "CEO done." });
          return;
        }
        if (p.includes("[mgr-repo-flow]")) {
          const lines = unitLines(p, ["permitted", "unauthorized", "unshared"]);
          if (lines.length === 0) {
            recordAttempt("manager", p);
            await t.call("delegate", {
              parts: [
                { key: "permitted", employee: "Nam", title: "Permitted audit", goal: "[part-permitted] Read repo snapshot.", deliverables: ["p.md"], share_repositories: true },
                { key: "unauthorized", employee: "Linh", title: "Unauthorized audit", goal: "[part-unauthorized] Attempt to read repo.", deliverables: ["u.md"], share_repositories: true },
                { key: "unshared", employee: "Nam", title: "Unshared audit", goal: "[part-unshared] No repo shared.", deliverables: ["n.md"], waits_for: ["permitted"] },
              ],
            });
            return;
          }
          for (const l of lines.filter((x) => x.includes("awaiting acceptance"))) {
            const key = /^- ([a-z]+): /.exec(l)?.[1];
            if (key) await t.call("review_unit", { part: key, decision: "accept", digest: digestOf(l) });
          }
          const stillOpen = unitLines(p, ["permitted", "unauthorized", "unshared"]).some((l) => !l.includes(", completed") && !l.includes("awaiting acceptance"));
          if (stillOpen) return;
          // Once all three are done (permitted + unauthorized accepted, then unshared accepted), hand in.
          if (lines.length === 3 && lines.every((l) => l.includes(", completed") || l.includes("awaiting acceptance"))) {
            await t.call("write_file", { path: "/output/summary.md", content: "Manager synthesis.\n" });
            await t.call("submit_handoff", { summary: "Manager done." });
          }
          return;
        }
        if (p.includes("[part-permitted]")) {
          recordAttempt("permitted", p);
          await t.call("write_file", { path: "/output/p.md", content: "Permitted done.\n" });
          await t.call("submit_handoff", { summary: "Permitted done." });
          return;
        }
        if (p.includes("[part-unauthorized]")) {
          recordAttempt("unauthorized", p);
          await t.call("write_file", { path: "/output/u.md", content: "Unauthorized done.\n" });
          await t.call("submit_handoff", { summary: "Unauthorized done." });
          return;
        }
        if (p.includes("[part-unshared]")) {
          recordAttempt("unshared", p);
          await t.call("write_file", { path: "/output/n.md", content: "Unshared done.\n" });
          await t.call("submit_handoff", { summary: "Unshared done." });
        }
      }),
    });
  });

  after(() => h?.close());

  test("explicitly attached repository reaches only the permitted delegated assignee and is never silently staged for unauthorized or unshared assignees", async () => {
    const preview = (await b.get("/api/missions/target?kind=ceo")).body as MissionTargetPreview;
    assert.ok(preview.responsible !== null);
    const given = await b.send(
      "POST",
      "/api/missions",
      {
        title: "CEO delegated repo audit",
        goal: `[ceo-repo-flow] Audit https://dev.azure.com/${AZURE.organization}/${AZURE.project}/_git/${AZURE.name}`,
        target: { kind: "ceo" },
        expectedAssignee: { employeeId: preview.responsible.employeeId, appointmentId: preview.responsible.appointmentId, appointmentRevision: preview.responsible.appointmentRevision },
        whenBusy: "enqueue",
        repositories: [{ source: "azure", id: AZURE_REPOSITORY, branch: null }],
        deliverables: [{ name: "summary.md", required: true }],
        acceptanceCriteria: [],
      },
      { "Idempotency-Key": "k-ceo-delegated-repo" },
    );
    assert.equal(given.status, 201, JSON.stringify(given.body));
    const missionId = (given.body as MissionAccepted).missionId;
    const m = await eventually(async () => (await b.get(`/api/missions/${missionId}`)).body as MissionDetail, (x) => x.assignment.state === "AWAITING_ACCEPTANCE", 20_000);
    assert.deepEqual(m.repositories, [{ source: "azure", fullName: `${AZURE.organization}/${AZURE.project}/${AZURE.name}`, branch: null }]);

    // CEO sees the attached repository listed for delegation, never receives a git bundle.
    const ceoMeta = attemptMeta.get("ceo");
    assert.ok(ceoMeta !== undefined);
    assert.equal(ceoMeta.bundleBytes, null);
    assert.match(ceoMeta.prompt, new RegExp(`${AZURE.organization}/${AZURE.project}/${AZURE.name}`));

    // Manager without an Access grant never receives a git bundle either.
    const mgrMeta = attemptMeta.get("manager");
    assert.ok(mgrMeta !== undefined);
    assert.equal(mgrMeta.bundleBytes, null);

    // Permitted delegated engineer (Nam, with Access grant + share_repositories: true) receives and can clone the snapshot.
    const permittedMeta = attemptMeta.get("permitted");
    assert.ok(permittedMeta !== undefined);
    assert.ok(permittedMeta.inputs.includes(`repo-${AZURE.name}.bundle`), `expected bundle in ${JSON.stringify(permittedMeta.inputs)}`);
    assert.ok(permittedMeta.bundleBytes !== null && permittedMeta.bundleBytes.length > 0);
    const dir = mkdtempSync(join(tmpdir(), "ow-ceo-bundle-"));
    writeFileSync(join(dir, "r.bundle"), permittedMeta.bundleBytes);
    assert.equal(spawnSync("git", ["clone", "-q", join(dir, "r.bundle"), join(dir, "work")], { encoding: "utf8" }).status, 0);
    assert.equal(readFileSync(join(dir, "work", "README.md"), "utf8"), "# sum fixture\n");

    // Unauthorized delegated engineer (Linh, NO Access grant, even with share_repositories: true) NEVER receives a bundle.
    const unauthMeta = attemptMeta.get("unauthorized");
    assert.ok(unauthMeta !== undefined);
    assert.equal(unauthMeta.bundleBytes, null);
    assert.equal(unauthMeta.inputs.some((n) => n.endsWith(".bundle")), false);
    assert.match(unauthMeta.prompt, /not brought in -- you may no longer use it on Azure DevOps/);

    // Permitted engineer on a part where lead did NOT set share_repositories NEVER receives a bundle either.
    const unsharedMeta = attemptMeta.get("unshared");
    assert.ok(unsharedMeta !== undefined);
    assert.equal(unsharedMeta.bundleBytes, null);
    assert.equal(unsharedMeta.inputs.some((n) => n.endsWith(".bundle")), false);
  });
});
