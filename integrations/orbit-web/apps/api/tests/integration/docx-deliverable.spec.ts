// DOCX DELIVERABLE VALIDATION (Issue #3, kept separate from CEO binary-forwarding):
// Verifies that submit_handoff validates `.docx` bytes before storing or recording a handoff:
//   - Plain text saved as `.docx` -> rejected with actionable error, never recorded, required deliverable NOT satisfied
//   - Damaged or incomplete ZIP saved as `.docx` -> rejected with actionable error, never recorded
//   - Valid OOXML `.docx` -> accepted, satisfies required deliverable, downloadable with identical SHA-256
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type AssignmentView, type Department, type EmployeeDetail, type MissionAccepted, type MissionDetail, type RuntimeConnection } from "@orbit-web/contracts";
import { AttemptInputs } from "../../src/contexts/execution/application/attempt-inputs.js";
import { validateDocx } from "../../src/contexts/execution/application/docx-validate.js";
import { SANDBOX_PROVIDER, type AttemptHandle } from "../../src/contexts/execution/application/sandbox.port.js";
import { buildRealDocx, buildZip, CONTENT_TYPES_DOCX } from "../../src/testing/docx-fixtures.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

describe("DOCX deliverable validation before handoff recording (Issue #3)", () => {
  let h: Harness;
  let b: Browser;
  let connection: RuntimeConnection;
  let employeeId: string;
  const sandbox = new FakeSandboxProvider();
  const seen: Record<string, { text: string; isError: boolean }> = {};

  const validDocx = buildRealDocx({
    title: "Technical Summary",
    paragraphs: ["Verified OOXML deliverable."],
    table: [["Item", "Status"], ["Validation", "Passed"]],
  });
  const incompleteZip = buildZip([{ name: "[Content_Types].xml", content: CONTENT_TYPES_DOCX }]);
  const damagedZip = validDocx.subarray(0, Math.floor(validDocx.length / 2));

  // Into the workspace of the attempt the command runs in (its handle), never whichever attempt runs first.
  const putOutputBinary = (handle: AttemptHandle, name: string, bytes: Buffer): void => {
    const attempt = sandbox.attempts.get(handle.dispatchKey);
    assert.ok(attempt !== undefined, "the command runs in an attempt this provider started");
    sandbox.workspaces.get(attempt.spec.assignmentId)?.set(`/output/${name}`, Buffer.from(bytes));
  };

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    sandbox.readInput = (p) => h.app.get(AttemptInputs).read(p);
    b = h.owner as Browser;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Docs Co" })).status, 200);
    const dept = ((await b.send("POST", "/api/office/departments", { name: "Research" })).body as Department).id;

    sandbox.exec_ = (req, handle) => {
      const cmd = req.argv[2] ?? "";
      if (cmd === "write-incomplete-docx") putOutputBinary(handle, "report.docx", incompleteZip);
      if (cmd === "write-damaged-docx") putOutputBinary(handle, "report.docx", damagedZip);
      if (cmd === "write-valid-docx") putOutputBinary(handle, "report.docx", validDocx);
      return { code: 0, signal: null, stdout: "ok\n", stderr: "", timedOut: false, truncated: false };
    };

    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        if (t.prompt.includes("[docx-reject-only]")) {
          // 1. Plain text saved with .docx extension.
          await t.call("write_file", { path: "/output/report.docx", content: "This is plain text pretending to be a Word document." });
          seen.plainText = await t.call("submit_handoff", { summary: "Plain text attempt" });
          // 2. Incomplete ZIP missing _rels/.rels and word/document.xml.
          await t.call("shell", { command: "write-incomplete-docx" });
          seen.incomplete = await t.call("submit_handoff", { summary: "Incomplete ZIP attempt" });
          // 3. Damaged/truncated ZIP archive.
          await t.call("shell", { command: "write-damaged-docx" });
          seen.damaged = await t.call("submit_handoff", { summary: "Damaged ZIP attempt" });
          return;
        }
        if (t.prompt.includes("[docx-recover-valid]")) {
          // First attempt fails validation; agent then produces a valid DOCX and submits cleanly.
          await t.call("write_file", { path: "/output/report.docx", content: "Not a docx" });
          seen.badBeforeFix = await t.call("submit_handoff", { summary: "Bad attempt" });
          await t.call("shell", { command: "write-valid-docx" });
          seen.validSubmit = await t.call("submit_handoff", { summary: "Valid DOCX deliverable." });
        }
      }),
    });

    const model = connection.catalog.models[0];
    assert.ok(model !== undefined);
    const hired = await b.send("POST", "/api/employees", {
      name: "Lan",
      departmentId: dept,
      profile: { title: "Analyst", duties: "Write reports.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "test",
    });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
    const ready = await eventually(async () => (await b.get(`/api/employees/${(hired.body as EmployeeDetail).id}`)).body as EmployeeDetail, (x) => x.sandbox.state === "READY");
    employeeId = ready.id;
  });

  after(() => h?.close());

  test("rejects plain text, incomplete ZIP, and damaged ZIP with actionable errors and records no handoff", async () => {
    const made = await b.send(
      "POST",
      "/api/missions",
      {
        title: "Invalid DOCX test",
        goal: "[docx-reject-only] Produce report.docx.",
        target: { kind: "employee", employeeId },
        whenBusy: "reject",
        deliverables: [{ name: "report.docx", required: true }],
        acceptanceCriteria: ["Valid Word document"],
      },
      { "idempotency-key": `docx-invalid-${Date.now()}` },
    );
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const missionId = (made.body as MissionAccepted).missionId;

    // Because all submit_handoff calls were rejected, the assignment ends BLOCKED (never AWAITING_ACCEPTANCE) with zero handoffs.
    const m = await eventually(async () => (await b.get(`/api/missions/${missionId}`)).body as MissionDetail, (x) => x.assignment.state === "BLOCKED", 60_000);
    assert.equal(m.handoffs.length, 0, "invalid DOCX submissions must never create a handoff or satisfy the required deliverable");
    assert.equal(seen.plainText?.isError, true);
    assert.match(seen.plainText?.text ?? "", /not a valid Word \(\.docx\) document.*plain text/i);
    assert.equal(seen.incomplete?.isError, true);
    assert.match(seen.incomplete?.text ?? "", /not a valid Word \(\.docx\) document.*_rels\/\.rels/i);
    assert.equal(seen.damaged?.isError, true);
    assert.match(seen.damaged?.text ?? "", /not a valid Word \(\.docx\) document/i);

    // Cancel so the employee is free for the next test.
    const root = m.assignments[0] as AssignmentView;
    assert.equal((await b.send("POST", `/api/assignments/${root.id}/cancel`, { reason: "cleanup" }, { "if-match": `"${root.version}"` })).status, 200);
  });

  test("records a valid DOCX after rejecting an invalid one, satisfies the required deliverable, and serves identical bytes", async () => {
    const made = await b.send(
      "POST",
      "/api/missions",
      {
        title: "Valid DOCX test",
        goal: "[docx-recover-valid] Produce report.docx.",
        target: { kind: "employee", employeeId },
        whenBusy: "reject",
        deliverables: [{ name: "report.docx", required: true }],
        acceptanceCriteria: ["Valid Word document"],
      },
      { "idempotency-key": `docx-valid-${Date.now()}` },
    );
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const missionId = (made.body as MissionAccepted).missionId;

    const m = await eventually(async () => (await b.get(`/api/missions/${missionId}`)).body as MissionDetail, (x) => x.assignment.state === "AWAITING_ACCEPTANCE", 60_000);
    assert.equal(seen.badBeforeFix?.isError, true);
    assert.equal(seen.validSubmit?.isError, false);
    assert.equal(m.handoffs.length, 1);
    const handoff = m.handoffs[0];
    assert.ok(handoff !== undefined);
    assert.deepEqual(handoff.missing, [], "valid DOCX satisfies the required deliverable");
    assert.equal(handoff.artifacts.length, 1);
    const art = handoff.artifacts[0]!;
    assert.equal(art.name, "report.docx");
    assert.equal(art.sha256, sha256(validDocx));

    const res = await fetch(`${h.url}/api/artifacts/${art.id}/content`, { headers: { cookie: b.cookie } });
    assert.equal(res.status, 200);
    const downloaded = Buffer.from(await res.arrayBuffer());
    assert.equal(sha256(downloaded), sha256(validDocx));
    assert.equal(validateDocx(downloaded).ok, true);
  });
});
