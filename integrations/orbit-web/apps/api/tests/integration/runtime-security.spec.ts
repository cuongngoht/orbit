// RUNTIME SECURITY THROUGH ORBIT WEB (ADR 0063), on PostgreSQL, with the allocator stood in for by the fake provider: the
// requirement composed from the policy and carried to the sandbox; an enforced attempt refused before any container on a
// host that cannot prevent, and refused before it opens when its protection is not proven; what the allocator reports
// kept by account and judged by the rules; a deterministic response that stops exactly the attempt it is about and holds
// its work until a person's review authorizes a retry; telemetry bounded per run and by age; one account's evidence never
// another's. The real kernel's part is tests/sandbox/runtime-security.spec.ts.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type AssignmentView, type EmployeeDetail, type EmployeeRuntimeSecurityView, type IncidentList, type IncidentView, type MissionAccepted, type MissionDetail, type RuntimeConnection, type RuntimeEventPage, type RuntimeSecurityOverview } from "@orbit-web/contracts";
import type { RevisionView } from "@orbit-web/contracts";
import type { Constitution } from "@orbit-web/governance-core";
import { AttemptInputs } from "../../src/contexts/execution/application/attempt-inputs.js";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import type { RuntimePull, WireProtection, WireRuntimeEvent } from "../../src/contexts/execution/infrastructure/sandbox/runtime-security-wire.js";
import { RuntimeSecurityIngestion } from "../../src/contexts/runtime-security/application/ingestion.service.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300", ORBIT_WEB_RUNTIME_SECURITY_MAX_EVENTS_PER_RUN: "100" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const key = () => ({ "idempotency-key": `rs-key-${Date.now()}-${(n += 1)}` });

async function publish(b: Browser, edit: (c: Constitution) => Constitution): Promise<void> {
  const draft = (await b.send("POST", "/api/governance/revisions", {})).body as RevisionView;
  assert.equal((await b.send("PUT", `/api/governance/revisions/${draft.id}`, { document: edit(draft.document as Constitution), expectedDigest: draft.digest })).status, 200);
  const read = (await b.send("POST", `/api/governance/revisions/${draft.id}/validate`)).body as RevisionView;
  const r = await b.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: read.digest, base: read.base, acknowledgedRisk: read.impact?.risk ?? null });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}
const mode = (m: "disabled" | "observe" | "enforce") => (c: Constitution): Constitution => ({ ...c, runtimeSecurity: { mode: m, controls: ["exec.shared-areas"] } });

describe("runtime security through Orbit Web: requirement, gate, evidence, incidents, response, review", () => {
  let h: Harness;
  let b: Browser;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  let ingest: RuntimeSecurityIngestion;

  const hire = async (name: string): Promise<EmployeeDetail> => {
    const model = connection.catalog.models[0];
    assert.ok(model !== undefined);
    const r = await b.send("POST", "/api/employees", {
      name,
      profile: { title: "Engineer", duties: "Builds.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "a test employee",
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (d) => d.sandbox.state === "READY");
  };
  const live: string[] = [];
  const give = async (employeeId: string, goal: string): Promise<string> => {
    const r = await b.send("POST", "/api/missions", { title: goal.slice(0, 60), goal, targetEmployeeId: employeeId, whenBusy: "reject", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: ["Correct"] }, key());
    assert.equal(r.status, 201, JSON.stringify(r.body));
    if (goal.includes("[slow]")) live.push((r.body as MissionAccepted).missionId);
    return (r.body as MissionAccepted).missionId;
  };
  const mission = async (id: string): Promise<MissionDetail> => (await b.get(`/api/missions/${id}`)).body as MissionDetail;
  const root = (m: MissionDetail): AssignmentView => m.assignments.find((a) => a.parentId === null) as AssignmentView;
  const cancel = async (missionId: string) => {
    const a = root(await mission(missionId));
    await b.send("POST", `/api/assignments/${a.id}/cancel`, { reason: "test done" }, { "if-match": `"${a.version}"` });
  };
  const runOf = async (missionId: string) => {
    const a = root(await mission(missionId));
    const rows = await h.sql("SELECT id, account_id, dispatch_key, employee_id, assignment_id, state, detail, sandbox FROM workforce.runs WHERE assignment_id = $1 ORDER BY attempt_no DESC", [a.id]);
    return { assignment: a, run: rows[0] as { id: string; account_id: string; dispatch_key: string; employee_id: string; assignment_id: string; state: string; detail: string | null; sandbox: { protection?: { state: string; mode: string } | null } | null } | undefined };
  };
  const event = (run: { id: string; account_id: string; dispatch_key: string; employee_id: string; assignment_id: string }, over: Partial<WireRuntimeEvent> = {}): WireRuntimeEvent => ({
    seq: 0,
    key: randomUUID().replace(/-/g, ""),
    time: new Date().toISOString(),
    kind: "process.exec",
    outcome: "OBSERVED",
    accountId: run.account_id,
    runKind: "assignment",
    runId: run.id,
    dispatchKey: run.dispatch_key,
    employeeId: run.employee_id,
    assignmentId: run.assignment_id,
    sessionId: null,
    plane: "tool-plane",
    binary: "/usr/bin/node",
    parentBinary: "/usr/bin/sh",
    path: null,
    control: null,
    execId: randomUUID(),
    parentExecId: null,
    exitCode: null,
    signal: null,
    policy: null,
    ...over,
  });
  let epoch = 0;
  const pull = (events: WireRuntimeEvent[], protections: WireProtection[] = [], lost = 0): RuntimePull => {
    epoch += events.length;
    return { epoch: "0123456789abcdef", reset: false, events: events.map((e, i) => ({ ...e, seq: epoch - events.length + i + 1 })), next: epoch, lost, unattributed: 3, gaps: 0, protections, sensor: { state: "HEALTHY", generation: "g1", since: null, version: "v1.8.0", image: "tetragon", detail: "ok" }, canaryProvenAt: new Date().toISOString() };
  };

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    sandbox.readInput = (p) => h.app.get(AttemptInputs).read(p);
    ingest = h.app.get(RuntimeSecurityIngestion);
    b = h.owner as Browser;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Secure office" })).status, 200);
    // A scripted CLI that works until it is stopped ([slow]) or hands its report in at once.
    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        if (t.prompt.includes("[slow]")) {
          for (let i = 0; i < 400 && t.child.signals.length === 0; i += 1) {
            await t.call("list_files", { path: "/work" });
            await sleep(25);
          }
          return;
        }
        await t.call("write_file", { path: "/output/report.md", content: "done" });
        await t.call("submit_handoff", { summary: "Done.", claims: [] });
      }),
    });
  });
  // Whatever a test asserted, the slow attempts it started end, so no test waits on another's budget.
  afterEach(async () => {
    for (const m of live.splice(0)) await cancel(m).catch(() => undefined);
  });
  after(async () => {
    await h?.close();
  });

  test("disabled (a new account's policy): the attempt runs as in 0.8.0 -- nothing claimed, the page says protection is off", async () => {
    const e = await hire("Ada");
    const m = await give(e.id, "Write the report.");
    const { run } = await eventually(() => runOf(m), (x) => x.run?.state === "succeeded");
    assert.equal(run?.sandbox?.protection?.state, "UNREGISTERED");
    assert.equal(run?.sandbox?.protection?.mode, "disabled");
    const o = (await b.get("/api/governance/runtime-security")).body as RuntimeSecurityOverview;
    assert.deepEqual([o.configured.mode, o.effective.mode, o.host.backend, o.host.sensor.state], ["disabled", "disabled", "disabled", "DISABLED"]);
    assert.equal(o.coverage.protected, 0);
  });

  test("enforce on a host that has not proven it can prevent: refused before any container, never quietly observed", async () => {
    await publish(b, mode("enforce"));
    sandbox.runtimePrevention = "UNSUPPORTED";
    try {
      const e = await hire("Bea");
      const m = await give(e.id, "Write the report.");
      const { run } = await eventually(() => runOf(m), (x) => x.run?.state === "failed");
      assert.match(run?.detail ?? "", /runtime_protection_unavailable/);
      assert.equal([...(sandbox as unknown as { attempts: Map<string, unknown> }).attempts.keys()].includes(run?.dispatch_key ?? ""), false, "no container was made");
      const refused = await h.sql("SELECT count(*)::int AS c FROM governance.audit_events WHERE event_type = 'runtime_security.admission.refused'");
      assert.ok(Number(refused[0]?.c) >= 1);
    } finally {
      sandbox.runtimePrevention = "SUPPORTED";
    }
  });

  test("enforce whose protection is not proven: the attempt is never opened, its containers go", async () => {
    sandbox.protectionHolds = false;
    try {
      const e = await hire("Cy");
      const m = await give(e.id, "Write the report.");
      const { run } = await eventually(() => runOf(m), (x) => x.run?.state === "failed");
      assert.match(run?.detail ?? "", /runtime_protection_not_established/);
      assert.equal(sandbox.opened.has(run?.dispatch_key ?? ""), false, "the gate was never asked to open");
    } finally {
      sandbox.protectionHolds = true;
    }
  });

  test("enforce, proven: the attempt opens PROTECTED; a memory-only exec stops exactly it, holds its work, and only a review lets it run again", async () => {
    const e = await hire("Dee");
    const m = await give(e.id, "[slow] Work for a while.");
    const { run, assignment } = await eventually(() => runOf(m), (x) => x.run?.state === "running");
    assert.ok(run !== undefined);
    assert.equal(sandbox.opened.has(run.dispatch_key), true);
    assert.equal((await eventually(() => runOf(m), (x) => x.run?.sandbox?.protection !== undefined)).run?.sandbox?.protection?.state, "PROTECTED");
    // The allocator reports: a process (information), and a program executed from memory (a detection).
    sandbox.runtimePulls.push(pull([event(run), event(run, { binary: "/proc/self/fd/3" })]));
    const took = await ingest.tick();
    assert.deepEqual(took, { events: 2, incidents: 1 });
    const incidents = (await b.get("/api/governance/runtime-security/incidents?open=1")).body as IncidentList;
    const inc = incidents.incidents.find((i) => i.runId === run.id) as IncidentView;
    assert.equal(inc.category, "unexpected_process");
    assert.equal(inc.severity, "HIGH");
    assert.equal(inc.blocksRetry, true);
    // The response: the run token ended, stop asked, the containers stopped and read back stopped.
    const ended = await eventually(() => runOf(m), (x) => x.run?.state === "failed", 15_000);
    assert.match(ended.run?.detail ?? "", /Stopped by runtime security/);
    const detail = (await b.get(`/api/governance/runtime-security/incidents/${inc.id}`)).body as IncidentView;
    assert.equal(detail.state, "CONTAINED");
    assert.deepEqual(detail.actions.map((a) => a.action), ["opened", "revoke", "stop"]);
    // A second report of the same cause is the same incident, counted again.
    sandbox.runtimePulls.push(pull([event(run, { binary: "/proc/self/fd/4" })]));
    await ingest.tick();
    assert.equal(((await b.get(`/api/governance/runtime-security/incidents/${inc.id}`)).body as IncidentView).count, 2);
    // The work is held: a person's Retry is refused until a review authorizes it.
    const a = root(await mission(m));
    const retry = await b.send("POST", `/api/assignments/${a.id}/retry`, {}, { "if-match": `"${a.version}"` });
    assert.equal(retry.status, 409, JSON.stringify(retry.body));
    assert.equal((retry.body as { error: { code: string } }).error.code, "security_review_required");
    const stale = await b.send("POST", `/api/governance/runtime-security/incidents/${inc.id}/review`, { decision: "authorize_retry", note: "Reviewed the tree." }, { "if-match": `"${detail.version - 1}"` });
    assert.equal(stale.status, 412);
    const ok = await b.send("POST", `/api/governance/runtime-security/incidents/${inc.id}/review`, { decision: "authorize_retry", note: "Reviewed the tree: a test fixture." }, { "if-match": `"${detail.version + 1}"` });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((ok.body as IncidentView).blocksRetry, false);
    const fresh = root(await mission(m));
    const again = await b.send("POST", `/api/assignments/${fresh.id}/retry`, {}, { "if-match": `"${fresh.version}"` });
    assert.ok(again.status === 200 || again.status === 202, JSON.stringify(again.body));
    const audit = await h.sql("SELECT event_type FROM governance.audit_events WHERE event_type LIKE 'runtime_security.%' ORDER BY seq");
    for (const t of ["runtime_security.protection.verified", "runtime_security.incident.opened", "runtime_security.containment.requested", "runtime_security.containment.confirmed", "runtime_security.retry.authorized"]) assert.ok(audit.some((r) => r.event_type === t), t);
    void assignment;
  });

  test("a stale incident never stops a newer attempt: a report about an attempt that ended touches nothing", async () => {
    const e = await hire("Eve");
    const m = await give(e.id, "[slow] Work for a while.");
    const first = await eventually(() => runOf(m), (x) => x.run?.state === "running");
    const old = { ...first.run!, id: randomUUID(), dispatch_key: `${first.run!.assignment_id}:0` };
    sandbox.runtimePulls.push(pull([event(old, { binary: "/proc/self/fd/3" })]));
    await ingest.tick();
    await sleep(500);
    assert.equal((await runOf(m)).run?.state, "running", "the running attempt was not touched");
    const stops = await h.sql("SELECT stop_requested FROM workforce.runs WHERE id = $1", [first.run!.id]);
    assert.equal(stops[0]?.stop_requested, null);
    await cancel(m);
  });

  test("observe: a match that would have been refused is reported, never acted on", async () => {
    await publish(b, mode("observe"));
    const e = await hire("Fay");
    const m = await give(e.id, "[slow] Work for a while.");
    const { run } = await eventually(() => runOf(m), (x) => x.run?.state === "running");
    sandbox.runtimePulls.push(pull([event(run!, { kind: "control.match", outcome: "VIOLATION_DETECTED", path: "/team/x.sh", control: "exec.shared-areas", policy: "orbit-a-test" })]));
    await ingest.tick();
    const inc = ((await b.get("/api/governance/runtime-security/incidents?open=1")).body as IncidentList).incidents.find((i) => i.runId === run!.id);
    assert.equal(inc?.category, "policy_violation");
    assert.equal(inc?.blocksRetry, false);
    await sleep(500);
    assert.equal((await runOf(m)).run?.state, "running", "observation stops nothing");
    const page = (await b.get(`/api/governance/runtime-security/events?run=${run!.id}`)).body as RuntimeEventPage;
    assert.ok(page.events.some((x) => x.outcome === "VIOLATION_DETECTED" && x.path === "/team/x.sh"));
    const tab = (await b.get(`/api/office/employees/${e.id}/runtime-security`)).body as EmployeeRuntimeSecurityView;
    assert.equal(tab.current?.runId, run!.id);
    assert.equal(tab.effective.mode, "observe");
    await cancel(m);
  });

  test("telemetry is bounded per run -- what is not kept is said -- and by age; one account never sees another's", async () => {
    const e = await hire("Gus");
    const m = await give(e.id, "Write the report.");
    const { run } = await eventually(() => runOf(m), (x) => x.run?.state === "succeeded");
    sandbox.runtimePulls.push(pull(Array.from({ length: 150 }, () => event(run!))));
    await ingest.tick();
    const rows = await h.sql("SELECT kind, dropped FROM security.events WHERE run_id = $1", [run!.id]);
    assert.equal(rows.filter((r) => r.kind === "process.exec").length, 100);
    assert.equal(rows.find((r) => r.kind === "telemetry.gap")?.dropped, 50);
    // Another account sees none of it.
    const other = await h.as("other-account");
    const theirs = (await other.get(`/api/governance/runtime-security/events?run=${run!.id}`)).body as RuntimeEventPage;
    assert.deepEqual(theirs.events, []);
    assert.equal((await other.get(`/api/office/employees/${e.id}/runtime-security`)).status, 404);
    // Retention: an event older than the cutoff is gone.
    await h.sql("UPDATE security.events SET occurred_at = now() - interval '30 days' WHERE run_id = $1", [run!.id]);
    assert.ok((await ingest.prune()) >= 100);
    assert.equal((await h.sql("SELECT count(*)::int AS c FROM security.events WHERE run_id = $1", [run!.id]))[0]?.c, 0);
  });

  test("the allocator's report of a lost, then contained protection is an incident that holds the work", async () => {
    await publish(b, mode("enforce"));
    const e = await hire("Hal");
    const m = await give(e.id, "[slow] Work for a while.");
    const { run } = await eventually(() => runOf(m), (x) => x.run?.state === "running");
    const report = (state: "UNKNOWN" | "CONTAINED", detail: string, updatedAt: string): WireProtection => ({ backend: "tetragon", backendVersion: "v1.8.0", hostKind: "native-linux", hostId: null, bootId: null, requestedMode: "enforce", mode: "enforce", controls: ["exec.shared-areas"], policy: "orbit-a-x", digest: "d", planes: [], checks: [], state, detail, verifiedAt: null, freshUntil: null, sensorGeneration: "g1", dispatchKey: run!.dispatch_key, runId: run!.id, accountId: run!.account_id, assignmentId: run!.assignment_id, employeeId: run!.employee_id, fence: 1, opened: true, lostSince: null, updatedAt });
    const t0 = Date.now();
    sandbox.runtimePulls.push(pull([], [report("UNKNOWN", "the sensor restarted", new Date(t0).toISOString())]));
    await ingest.tick();
    sandbox.runtimePulls.push(pull([], [report("CONTAINED", "both planes stopped", new Date(t0 + 1000).toISOString())]));
    await ingest.tick();
    // A report older than the one kept is never taken.
    sandbox.runtimePulls.push(pull([], [report("UNKNOWN", "late", new Date(t0 - 5000).toISOString())]));
    await ingest.tick();
    const kept = await h.sql("SELECT state FROM security.protections WHERE run_id = $1", [run!.id]);
    assert.equal(kept[0]?.state, "CONTAINED");
    const inc = ((await b.get("/api/governance/runtime-security/incidents")).body as IncidentList).incidents.find((i) => i.runId === run!.id && i.category === "protection_missing");
    assert.equal(inc?.state, "CONTAINED");
    assert.equal(inc?.blocksRetry, true);
    await cancel(m);
  });
});
