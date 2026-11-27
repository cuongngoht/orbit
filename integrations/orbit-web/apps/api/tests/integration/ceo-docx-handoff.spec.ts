// PRESERVE WORD DOCUMENTS ACROSS EMPLOYEE -> MANAGER -> CEO HANDOFFS (Issue #2):
// End-to-end CEO-routed regression test:
//   1. Owner gives a mission requiring `board-brief.docx` to the CEO (An, who has NO shell tool).
//   2. CEO delegates to the Research department (manager Minh).
//   3. Manager Minh delegates to analyst Lan.
//   4. Analyst Lan builds a real OOXML `.docx` containing a `<w:tbl>` table and non-ASCII text (Vietnamese, Japanese,
//      euro sign) and hands it in as revision 1.
//   5. Manager Minh accepts Lan's revision 1 and forwards `board-brief.docx` verbatim via `attach_artifacts` without
//      reading it as text or rewriting it.
//   6. CEO An first confirms unauthorized references (grandchild `draft`, nonexistent part, unaccepted part) are refused,
//      then accepts Minh's revision 1 and attaches `board-brief.docx` verbatim via `attach_artifacts` (no shell!).
//   7. Owner downloads the final artifact via GET /api/artifacts/:id/content and verifies:
//      - Exact byte-for-byte SHA-256 matches Lan's original `.docx`
//      - Opens cleanly (`validateDocx` + `docxOf` + ZIP `word/document.xml`)
//      - Preserves the `<w:tbl>` table structure and exact non-ASCII text
//      - Provenance (`attachedFrom` and `origin`) accurately records Minh (rev 1) and Lan (rev 1)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type AssignmentView, type Department, type EmployeeDetail, type MissionAccepted, type MissionDetail, type MissionTargetPreview, type ResourceSummary, type RuntimeConnection } from "@orbit-web/contracts";
import { AttemptInputs } from "../../src/contexts/execution/application/attempt-inputs.js";
import { validateDocx } from "../../src/contexts/execution/application/docx-validate.js";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { docxOf } from "../../src/modules/research/ingestion/extract/docx.js";
import { readZipEntry } from "../../src/modules/research/ingestion/extract/zip.js";
import { buildRealDocx } from "../../src/testing/docx-fixtures.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const ifMatch = (v: number) => ({ "if-match": `"${v}"` });
const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const unitLines = (p: string, keys: string[]): string[] => p.split("\n").filter((l) => new RegExp(`^- (${keys.join("|")}): `).test(l));
const digestOf = (line: string): string | undefined => /digest ([0-9a-f]{64})/.exec(line)?.[1];
const pending = (lines: string[]): boolean => lines.some((l) => !l.includes("awaiting acceptance") && !l.includes(", completed"));

describe("preserve Word documents across employee, manager, and CEO handoffs (Issue #2)", () => {
  let h: Harness;
  let b: Browser;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  const ids: Record<string, string> = {};
  const seen: Record<string, { text: string; isError: boolean }> = {};

  const nonAsciiHeading = "Báo cáo chiến lược Đông Nam Á — Quý 4";
  const nonAsciiParagraph = "Tổng hợp dữ liệu Tiếng Việt, 日本語テスト, và ngân sách €1,250,000.";
  const tableRows = [
    ["Thị trường", "Doanh thu", "Ghi chú"],
    ["Việt Nam", "€750,000", "Tăng trưởng mạnh"],
    ["Nhật Bản (日本)", "€500,000", "Ổn định"],
  ];
  const originalDocx = buildRealDocx({
    title: nonAsciiHeading,
    paragraphs: [nonAsciiParagraph],
    table: tableRows,
    compress: true,
  });
  const originalSha = sha256(originalDocx);

  const hire = async (name: string, departmentId: string | null, title: string): Promise<EmployeeDetail> => {
    const model = connection.catalog.models[0];
    assert.ok(model !== undefined);
    const r = await b.send("POST", "/api/employees", {
      name,
      ...(departmentId !== null ? { departmentId } : {}),
      profile: { title, duties: "Deliver executive documents.", instructions: "", skills: [], languages: ["en", "vi"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "test",
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const d = await eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (x) => x.sandbox.state === "READY");
    ids[name] = d.id;
    return d;
  };

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    sandbox.readInput = (p) => h.app.get(AttemptInputs).read(p);
    b = h.owner as Browser;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Executive Docs Co" })).status, 200);
    const researchDept = ((await b.send("POST", "/api/office/departments", { name: "Research" })).body as Department).id;

    sandbox.exec_ = (req, handle) => {
      if ((req.argv[2] ?? "") === "create-board-brief-docx") {
        // Into the workspace of the attempt the command runs in, never whichever attempt runs first.
        const attempt = sandbox.attempts.get(handle.dispatchKey);
        assert.ok(attempt !== undefined);
        sandbox.workspaces.get(attempt.spec.assignmentId)?.set("/output/board-brief.docx", Buffer.from(originalDocx));
      }
      return { code: 0, signal: null, stdout: "created /output/board-brief.docx\n", stderr: "", timedOut: false, truncated: false };
    };

    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        const p = t.prompt;
        // ---- CEO An: no shell, delegates to Research, tests authorization boundaries, then forwards board-brief.docx verbatim.
        if (p.includes("[ceo-docx]")) {
          const lines = unitLines(p, ["research"]);
          if (lines.length === 0) {
            seen.ceoShellDenied = await t.call("shell", { command: "echo no-shell" });
            await t.call("delegate", {
              parts: [{ key: "research", department: "Research", title: "Board brief", goal: "[mgr-docx] Prepare board-brief.docx.", deliverables: ["board-brief.docx"] }],
            });
            return;
          }
          // Before accepting Minh's hand-in, attaching from unaccepted part must be refused.
          seen.ceoBeforeAccept = await t.call("submit_handoff", {
            summary: "Premature attach",
            attach_artifacts: [{ part: "research", name: "board-brief.docx" }],
          });
          // Attempting to reach past direct child directly to grandchild ("draft") must also be refused.
          seen.ceoGrandchildRefused = await t.call("submit_handoff", {
            summary: "Grandchild attach",
            attach_artifacts: [{ part: "draft", name: "board-brief.docx" }],
          });
          for (const l of lines.filter((x) => x.includes("awaiting acceptance"))) {
            await t.call("review_unit", { part: "research", decision: "accept", digest: digestOf(l) });
          }
          if (pending(lines)) return;
          // CEO never reads board-brief.docx as text or calls write_file on it; attaches directly by reference!
          seen.ceoSubmit = await t.call("submit_handoff", {
            summary: "Executive synthesis with verbatim Word deliverable from Research.",
            attach_artifacts: [{ part: "research", name: "board-brief.docx" }],
          });
          return;
        }
        // ---- Manager Minh: delegates to Lan, reviews & accepts Lan's DOCX, forwards verbatim via attach_artifacts.
        if (p.includes("[mgr-docx]")) {
          const lines = unitLines(p, ["draft"]);
          if (lines.length === 0) {
            await t.call("delegate", {
              parts: [{ key: "draft", employee: "Lan", title: "Draft DOCX", goal: "[emp-docx] Build board-brief.docx.", deliverables: ["board-brief.docx"] }],
            });
            return;
          }
          for (const l of lines.filter((x) => x.includes("awaiting acceptance"))) {
            await t.call("review_unit", { part: "draft", decision: "accept", digest: digestOf(l) });
          }
          if (pending(lines)) return;
          seen.mgrSubmit = await t.call("submit_handoff", {
            summary: "Reviewed and forwarding Lan's Word brief verbatim.",
            attach_artifacts: [{ part: "draft", name: "board-brief.docx" }],
          });
          return;
        }
        // ---- Employee Lan: creates the real DOCX via shell and hands it in.
        if (p.includes("[emp-docx]")) {
          await t.call("shell", { command: "create-board-brief-docx" });
          seen.empSubmit = await t.call("submit_handoff", { summary: "Built board-brief.docx with table and non-ASCII text." });
        }
      }),
    });

    await hire("An", null, "Chief Executive Officer");
    await hire("Minh", researchDept, "Research Manager");
    await hire("Lan", researchDept, "Senior Analyst");
    for (const body of [
      { role: "ceo", employeeId: ids.An },
      { role: "manager", departmentId: researchDept, employeeId: ids.Minh },
    ]) {
      const r = await b.send("POST", "/api/office/appointments", { ...body, reason: "leadership" });
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
    const r = (await b.get("/api/office/resources")).body as ResourceSummary;
    assert.equal((await b.send("PATCH", "/api/office/resources/budget", { maxConcurrent: 1 }, ifMatch(r.budget.version))).status, 200);
  });

  after(() => h?.close());

  test("CEO downloads exact byte-identical DOCX created by employee through manager, preserving table, non-ASCII text, and lineage", async () => {
    const preview = (await b.get("/api/missions/target?kind=ceo")).body as MissionTargetPreview;
    assert.equal(preview.responsible?.employeeId, ids.An);
    const made = await b.send(
      "POST",
      "/api/missions",
      {
        title: "Southeast Asia Board Brief",
        goal: "[ceo-docx] Produce the Southeast Asia board brief in Word format.",
        target: { kind: "ceo" },
        expectedAssignee: { employeeId: ids.An, appointmentId: preview.responsible?.appointmentId, appointmentRevision: preview.responsible?.appointmentRevision },
        whenBusy: "reject",
        deliverables: [{ name: "board-brief.docx", required: true }],
        acceptanceCriteria: ["Valid .docx with table and Vietnamese/Japanese text"],
      },
      { "idempotency-key": `ceo-docx-${Date.now()}` },
    );
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const missionId = (made.body as MissionAccepted).missionId;

    const m = await eventually(async () => (await b.get(`/api/missions/${missionId}`)).body as MissionDetail, (x) => x.assignment.state === "AWAITING_ACCEPTANCE", 120_000);

    // Authorization checks verified along the way:
    assert.equal(seen.ceoShellDenied?.isError, true, "CEO must remain without shell");
    assert.equal(seen.ceoBeforeAccept?.isError, true, "cannot attach from unaccepted child hand-in");
    assert.match(seen.ceoBeforeAccept?.text ?? "", /no accepted hand-in/i);
    assert.equal(seen.ceoGrandchildRefused?.isError, true, "cannot reach past direct child to grandchild");
    assert.match(seen.ceoGrandchildRefused?.text ?? "", /No direct part named "draft"/i);
    assert.equal(seen.empSubmit?.isError, false);
    assert.equal(seen.mgrSubmit?.isError, false);
    assert.equal(seen.ceoSubmit?.isError, false);

    // Final root handoff from CEO has board-brief.docx with no missing deliverables and clear lineage.
    const rootAssignment = m.assignments.find((a) => a.parentId === null) as AssignmentView;
    const ceoHandoff = m.handoffs.find((x) => x.assignmentId === rootAssignment.id && x.revision === 1);
    assert.ok(ceoHandoff !== undefined);
    assert.deepEqual(ceoHandoff.missing, []);
    assert.equal(ceoHandoff.artifacts.length, 1);
    const finalArt = ceoHandoff.artifacts[0]!;
    assert.equal(finalArt.name, "board-brief.docx");
    assert.equal(finalArt.sha256, originalSha);
    assert.equal(finalArt.attachedFrom?.employeeName, "Minh");
    assert.equal(finalArt.attachedFrom?.unitKey, "research");
    assert.equal(finalArt.attachedFrom?.revision, 1);
    assert.equal(finalArt.origin?.employeeName, "Lan");
    assert.equal(finalArt.origin?.unitKey, "draft");
    assert.equal(finalArt.origin?.revision, 1);

    // Owner downloads the final artifact over HTTP and verifies byte-for-byte identity, valid DOCX, table, and non-ASCII text.
    const res = await fetch(`${h.url}/api/artifacts/${finalArt.id}/content`, { headers: { cookie: b.cookie } });
    assert.equal(res.status, 200);
    const downloaded = Buffer.from(await res.arrayBuffer());
    assert.equal(sha256(downloaded), originalSha, "downloaded DOCX SHA-256 must exactly match employee original");
    assert.equal(downloaded.equals(originalDocx), true, "downloaded DOCX bytes must be byte-identical");
    assert.deepEqual(validateDocx(downloaded), { ok: true, documentPart: "word/document.xml" });

    // Opens cleanly with research's DOCX reader and preserves table XML + non-ASCII text.
    const extracted = docxOf(downloaded);
    const allText = extracted.blocks.map((bl) => bl.text).join("\n");
    assert.ok(allText.includes(nonAsciiHeading), allText);
    assert.ok(allText.includes(nonAsciiParagraph), allText);
    for (const row of tableRows) {
      for (const cell of row) assert.ok(allText.includes(cell), `missing table cell ${cell} in: ${allText}`);
    }
    const docXml = readZipEntry(downloaded, "word/document.xml", 1024 * 1024)?.toString("utf8") ?? "";
    assert.ok(docXml.includes("<w:tbl>") && docXml.includes("<w:tr>") && docXml.includes("<w:tc>"), "table structure preserved");
    assert.ok(docXml.includes("Việt Nam") && docXml.includes("日本語テスト") && docXml.includes("€750,000"), "non-ASCII text preserved in XML");
  });
});
