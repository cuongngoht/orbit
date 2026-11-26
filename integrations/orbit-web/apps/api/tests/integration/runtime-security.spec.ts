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
import { ResourcesService } from "../../src/contexts/execution/application/resources.service.js";
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

  test("a response nobody could read back is never called contained: it is carried out again on later pulls, recorded once, until both planes read back stopped", async () => {
    await publish(b, mode("enforce"));
    const e = await hire("Ida");
    const m = await give(e.id, "[slow] Work for a while.");
    const { run } = await eventually(() => runOf(m), (x) => x.run?.state === "running");
    // The allocator does not answer the read-back: the stop is not verified, so the incident is not contained.
    sandbox.findFails = true;
    try {
      sandbox.runtimePulls.push(pull([event(run!, { binary: "/proc/self/fd/3" })]));
      await ingest.tick();
    } finally {
      sandbox.findFails = false;
    }
    const inc = ((await b.get("/api/governance/runtime-security/incidents?open=1")).body as IncidentList).incidents.find((i) => i.runId === run!.id) as IncidentView;
    assert.equal(inc.state, "CONTAINING", "an unanswered read-back is not a stop");
    // It answers, and a plane still runs: carried out again, still not contained, and nothing recorded twice.
    sandbox.readsBackRunning.add(run!.dispatch_key);
    await ingest.tick();
    assert.equal(((await b.get(`/api/governance/runtime-security/incidents/${inc.id}`)).body as IncidentView).state, "CONTAINING", "a plane read back running: not contained");
    sandbox.readsBackRunning.delete(run!.dispatch_key);
    await ingest.tick();
    const detail = (await b.get(`/api/governance/runtime-security/incidents/${inc.id}`)).body as IncidentView;
    assert.equal(detail.state, "CONTAINED");
    assert.deepEqual(
      detail.actions.map((a) => [a.action, a.outcome]),
      [
        ["opened", "containing"],
        ["revoke", "run token ended"],
        ["stop", "containment could not be verified"],
        ["stop", "both planes stopped, read back"],
      ],
    );
    const audit = await h.sql("SELECT event_type FROM governance.audit_events WHERE event_type LIKE 'runtime_security.containment.%' AND data->>'incidentId' = $1 ORDER BY seq", [inc.id]);
    assert.deepEqual(audit.map((r) => r.event_type), ["runtime_security.containment.requested", "runtime_security.containment.confirmed"]);
    await ingest.tick();
    assert.equal(((await b.get(`/api/governance/runtime-security/incidents/${inc.id}`)).body as IncidentView).actions.length, 4, "a response carried out is never carried out again");
  });

  test("owed responses take turns: twenty that cannot finish never starve a new one", async () => {
    await publish(b, mode("enforce"));
    const e1 = await hire("Jon");
    const m1 = await give(e1.id, "[slow] Work for a while.");
    const stuck = (await eventually(() => runOf(m1), (x) => x.run?.state === "running")).run!;
    sandbox.readsBackRunning.add(stuck.dispatch_key);
    try {
      const long = new Date(Date.now() - 3_600_000).toISOString();
      for (let i = 0; i < 20; i += 1) {
        await h.sql(
          `INSERT INTO security.incidents (id, account_id, fingerprint, category, severity, state, title, run_id, first_seen, last_seen, count, blocks_retry, respond, dispatch_key, response_due, evidence, created_at, updated_at)
           VALUES ($1, $2, $3, 'unexpected_process', 'HIGH', 'CONTAINING', 'a stop that never reads back', $4, $5, $5, 1, true, '{stop}', $6, true, '{}', $5, $5)`,
          [`inc-stuck-${i}-${randomUUID()}`, stuck.account_id, `stuck:${i}:${randomUUID()}`, stuck.id, long, stuck.dispatch_key],
        );
      }
      await ingest.tick();
      const e2 = await hire("Kim");
      const m2 = await give(e2.id, "[slow] Work for a while.");
      const fresh = (await eventually(() => runOf(m2), (x) => x.run?.state === "running")).run!;
      sandbox.runtimePulls.push(pull([event(fresh, { binary: "/proc/self/fd/3" })]));
      await ingest.tick();
      const inc = ((await b.get("/api/governance/runtime-security/incidents?open=1")).body as IncidentList).incidents.find((i) => i.runId === fresh.id) as IncidentView;
      assert.equal(inc.state, "CONTAINED", "the new incident's response was carried out on its first pull");
    } finally {
      sandbox.readsBackRunning.delete(stuck.dispatch_key);
    }
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

  test("an event of an account this database does not hold is dropped, and never poisons the pull it came in", async () => {
    const e = await hire("Liv");
    const m = await give(e.id, "Write the report.");
    const { run } = await eventually(() => runOf(m), (x) => x.run?.state === "succeeded");
    // What an allocator still remembers after the database was reset: an attempt of an account that is gone.
    const stranger = { ...run!, account_id: randomUUID(), id: randomUUID() };
    sandbox.runtimePulls.push(pull([event(stranger, { kind: "workload.contained", outcome: "WORKLOAD_CONTAINED", plane: null, binary: null }), event(run!)]));
    assert.equal((await ingest.tick())?.events, 1);
    const kept = await h.sql("SELECT account_id FROM security.events WHERE run_id = ANY($1::text[])", [[run!.id, stranger.id]]);
    assert.deepEqual(kept.map((r) => r.account_id), [run!.account_id]);
    sandbox.runtimePulls.push(pull([event(run!)]));
    assert.equal((await ingest.tick())?.events, 1, "the next pull goes on from there");
  });

  test("a flood of notable events is bounded too: the stream keeps its cap and says the rest, the incident counts every one", async () => {
    const e = await hire("Ivo");
    const m = await give(e.id, "Write the report.");
    const { run } = await eventually(() => runOf(m), (x) => x.run?.state === "succeeded");
    const refused = () => event(run!, { kind: "control.match", outcome: "OPERATION_PREVENTED", path: "/team/x.sh", control: "exec.shared-areas", policy: "orbit-a-test" });
    sandbox.runtimePulls.push(pull(Array.from({ length: 150 }, refused)));
    await ingest.tick();
    const rows = await h.sql("SELECT kind, dropped FROM security.events WHERE run_id = $1", [run!.id]);
    assert.equal(rows.filter((r) => r.kind === "control.match").length, 100);
    assert.equal(rows.find((r) => r.kind === "telemetry.gap")?.dropped, 50);
    const inc = ((await b.get("/api/governance/runtime-security/incidents")).body as IncidentList).incidents.find((i) => i.runId === run!.id);
    assert.equal(inc?.count, 150);
    // Information has its own budget: a flood of it never crowds out what is notable.
    sandbox.runtimePulls.push(pull(Array.from({ length: 120 }, () => event(run!))));
    await ingest.tick();
    const after = await h.sql("SELECT kind, dropped FROM security.events WHERE run_id = $1", [run!.id]);
    assert.equal(after.filter((r) => r.kind === "process.exec").length, 100);
    assert.equal(after.find((r) => r.kind === "telemetry.gap")?.dropped, 70);
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
    // The account's chain says it: lost, then lost and contained -- once each (the late report is not taken).
    const lost = await h.sql("SELECT data FROM governance.audit_events WHERE event_type = 'runtime_security.protection.lost' AND data->>'runId' = $1 ORDER BY seq", [run!.id]);
    assert.deepEqual(lost.map((r) => [(r.data as { contained: boolean }).contained, (r.data as { cause: string }).cause]), [[false, "the sensor restarted"], [true, "both planes stopped"]]);
    await cancel(m);
  });

  // What this host can do, as its probe decided it, is the deployment's record too -- when it changes, never each probe.
  test("a change of what the host's probe proved is recorded once on the deployment's chain", async () => {
    const probed = async () => h.sql("SELECT data FROM governance.audit_events WHERE account_id = '00000000-0000-4000-8000-000000000001' AND event_type = 'runtime_security.capability.probed' ORDER BY seq");
    const resources = h.app.get(ResourcesService);
    await resources.refreshCapacity();
    const before = (await probed()).length;
    await resources.refreshCapacity();
    assert.equal((await probed()).length, before, "the same answer is not recorded again");
    sandbox.runtimePrevention = "UNSUPPORTED";
    try {
      await resources.refreshCapacity();
      await resources.refreshCapacity();
    } finally {
      sandbox.runtimePrevention = "SUPPORTED";
    }
    const after = (await probed()).slice(before);
    assert.equal(after.length, 1);
    assert.deepEqual(after[0]?.data, { backend: "tetragon", version: "test", observation: null, prevention: "UNSUPPORTED", scope: null, hostKind: "unknown" });
    await resources.refreshCapacity();
  });

  // The deployment's chain (the system account's) records the sensor's state as Orbit Web saw it change -- never each pull.
  test("a change of the sensor's state or generation is recorded once on the deployment's chain", async () => {
    const changed = async () => h.sql("SELECT data FROM governance.audit_events WHERE account_id = '00000000-0000-4000-8000-000000000001' AND event_type = 'runtime_security.sensor.changed' ORDER BY seq");
    const before = (await changed()).length;
    const sensor = (state: "HEALTHY" | "UNAVAILABLE", generation: string | null) => ({ ...pull([]), sensor: { state, generation, since: null, version: "v1.8.0", image: "tetragon", detail: state === "HEALTHY" ? "ok" : "the sensor container is not running" } });
    sandbox.runtimePulls.push(sensor("HEALTHY", "g1"), sensor("UNAVAILABLE", null), sensor("UNAVAILABLE", null), sensor("HEALTHY", "g2"), sensor("HEALTHY", "g2"));
    for (let i = 0; i < 5; i += 1) await ingest.tick();
    const after = (await changed()).slice(before).map((r) => [(r.data as { state: string }).state, (r.data as { generation: string | null }).generation]);
    assert.deepEqual(after.slice(-2), [["UNAVAILABLE", null], ["HEALTHY", "g2"]]);
    assert.ok(after.length <= 3, `recorded on a change only: ${JSON.stringify(after)}`);
  });
});
