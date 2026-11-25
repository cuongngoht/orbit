// A PROFILE DRAFTED BY THE CEO FOR A FORM, end to end through HTTP on PostgreSQL with a scripted CEO (ADR 0062). The
// owner describes the job; the CEO drafts in a turn of its own (a profile section in its prompt: the role, its
// department, the people there) and Orbit keeps the draft for the form -- a profile's descriptive fields alone. Nobody is
// hired; a draft that is not a profile says why; a profile written in an ordinary answer is ignored; a draft is asked
// again, never retried; another account sees nothing of it.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type Department, type EmployeeDetail, type ExecutiveConversationDetail, type ExecutiveSent, type ProfileDraftAccepted, type ProfileDraftView, type RuntimeConnection } from "@orbit-web/contracts";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { executiveAnswer, executiveRun } from "../../src/testing/executive-fixtures.js";
import { FakeProcessPort, program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee } from "../../src/testing/fake-sandbox.js";
import { eventually, signedIn, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const code = (r: { body: unknown }): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
let n = 0;
const key = () => ({ "idempotency-key": `draft-${Date.now()}-${(n += 1)}` });
const DRAFT = { title: "Chuyên viên tuyển dụng", duties: "Tìm và sàng lọc ứng viên cho các phòng.", instructions: "Đọc mô tả công việc trước; hỏi trưởng phòng khi chưa rõ.", skills: ["phỏng vấn", "sàng lọc hồ sơ"], languages: ["vi"], handoffStandard: "Danh sách ứng viên kèm đánh giá." };
const block = (v: unknown): string => `Đây là bản nháp.\n\n\`\`\`orbit-profile\n${JSON.stringify(v)}\n\`\`\``;

describe("a profile draft: the CEO drafts one profile for a form, and nobody is hired", () => {
  let h: Harness;
  let b: Browser;
  let connection: RuntimeConnection;
  let hr: string;
  const sandbox = new FakeSandboxProvider();
  let answer: (prompt: string) => string = () => "Noted.";
  const fake = signedIn(new FakeProcessPort(new NodeProcessPort()));
  fake.on(executiveRun, { spawn: (c, call) => executiveAnswer((p) => answer(p))(c, call) });
  const ceoPrompts = (): string[] => fake.children.filter((c) => executiveRun(c.call.file, c.call.args)).map((c) => c.child.written.join(""));
  const draft = async (id: string): Promise<ProfileDraftView> => (await b.get(`/api/executive/drafts/${id}`)).body as ProfileDraftView;
  const ended = (id: string) => eventually(() => draft(id), (d) => d.state !== "drafting", 30_000);
  const people = async () => Number((await h.sql("SELECT count(*) AS n FROM workforce.employees WHERE account_id = $1", [h.accountId as string]))[0]?.n);
  const hire = async (name: string, departmentId: string | null, title: string): Promise<string> => {
    const model = connection.catalog.models[0];
    assert.ok(model !== undefined);
    const r = await b.send("POST", "/api/employees", { name, ...(departmentId !== null ? { departmentId } : {}), profile: { title, duties: "Lead.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false }, resources: DEFAULT_PRESETS[0]?.profile, skipProbation: true, skipReason: "a test employee" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return (await eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (x) => x.sandbox.state === "READY")).id;
  };

  before(async () => {
    h = await startHarness({ fake, overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    b = h.owner as Browser;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    sandbox.cli.on(program("claude"), { spawn: scriptedEmployee(async () => undefined) });
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Draft Co" })).status, 200);
    hr = ((await b.send("POST", "/api/office/departments", { name: "Nhân sự" })).body as Department).id;
    const ceo = await hire("An", null, "Chief executive");
    const lan = await hire("Lan", hr, "Trưởng phòng nhân sự");
    for (const body of [{ role: "ceo", employeeId: ceo }, { role: "manager", departmentId: hr, employeeId: lan }]) assert.equal((await b.send("POST", "/api/office/appointments", { ...body, reason: "leadership" })).status, 201);
  });

  after(async () => {
    await h?.close();
  });

  test("the CEO drafts the profile from the job's description, told the role, its department and its people -- kept for the form, nobody hired", async () => {
    const before = await people();
    answer = (p) => (p.includes("<profile-") ? block(DRAFT) : "Noted.");
    const k = key();
    const sent = await b.send("POST", "/api/executive/drafts", { description: "Người tuyển dụng cho các phòng, nói tiếng Việt.", title: "Chuyên viên tuyển dụng", departmentId: hr }, k);
    assert.equal(sent.status, 202, JSON.stringify(sent.body));
    const accepted = sent.body as ProfileDraftAccepted;
    assert.equal(accepted.turn.kind, "profile");
    const again = await b.send("POST", "/api/executive/drafts", { description: "Người tuyển dụng cho các phòng, nói tiếng Việt.", title: "Chuyên viên tuyển dụng", departmentId: hr }, k);
    assert.equal((again.body as ProfileDraftAccepted).draftId, accepted.draftId, "one key is one draft");
    const d = await ended(accepted.draftId);
    assert.deepEqual([d.state, d.draft], ["ready", DRAFT]);
    assert.equal(await people(), before, "a draft hires nobody");
    const prompt = ceoPrompts().at(-1) ?? "";
    assert.match(prompt, /<profile-[0-9a-f]{16}>[\s\S]*The role: Chuyên viên tuyển dụng, in the department Nhân sự[\s\S]*manager Lan; its people: Lan \(Trưởng phòng nhân sự\)[\s\S]*<\/profile-[0-9a-f]{16}>/);
    assert.ok(!prompt.includes("<hiring-"));
    const conv = (await b.get(`/api/executive/conversations/${accepted.conversationId}`)).body as ExecutiveConversationDetail;
    assert.equal(conv.conversation.title, "Profile: Chuyên viên tuyển dụng");
    assert.ok(!(conv.messages.at(-1)?.text ?? "").includes("orbit-profile"), "the block is never shown as text");
    const retried = await b.send("POST", `/api/executive/conversations/${accepted.conversationId}/turns/${accepted.turn.id}/retry`, {});
    assert.equal(retried.status, 409);
  });

  test("a draft that is not a profile -- a field no profile has -- fails, saying why", async () => {
    answer = (p) => (p.includes("<profile-") ? block({ ...DRAFT, model: "opus" }) : "Noted.");
    const sent = await b.send("POST", "/api/executive/drafts", { description: "An analyst.", title: "", departmentId: null }, key());
    const d = await ended((sent.body as ProfileDraftAccepted).draftId);
    assert.equal(d.state, "failed");
    assert.match(d.problems.join(" "), /model is not a field Orbit takes from a draft/);
    assert.match(ceoPrompts().at(-1) ?? "", /The role: no title yet \(name one\), in no department yet/);
  });

  test("a profile written in an ordinary answer is ignored, and says so", async () => {
    answer = () => block(DRAFT);
    const sent = await b.send("POST", "/api/executive/conversations", { text: "Draft me a recruiter." }, key());
    const id = (sent.body as ExecutiveSent).conversationId;
    const d = await eventually(async () => (await b.get(`/api/executive/conversations/${id}`)).body as ExecutiveConversationDetail, (x) => x.turns.every((t) => !["queued", "waiting", "running"].includes(t.state)), 30_000);
    assert.match(d.messages.at(-1)?.proposalNote ?? "", /Orbit fills a form only when a draft is asked for, so it was not kept/);
    assert.equal(Number((await h.sql("SELECT count(*) AS n FROM executive.profile_drafts WHERE conversation_id = $1", [id]))[0]?.n), 0);
  });

  test("refused before the CEO spends anything: an empty description, a department that is not the company's, a field no request has; another account sees nothing", async () => {
    assert.equal((await b.send("POST", "/api/executive/drafts", { description: "", title: "", departmentId: null }, key())).status, 400);
    assert.equal((await b.send("POST", "/api/executive/drafts", { description: "x", title: "", departmentId: "d1000000-0000-4000-8000-00000000dead" }, key())).status, 404);
    assert.equal((await b.send("POST", "/api/executive/drafts", { description: "x", title: "", departmentId: null, model: "opus" }, key())).status, 400);
    const [mine] = await h.sql("SELECT id FROM executive.profile_drafts WHERE account_id = $1 LIMIT 1", [h.accountId as string]);
    const other = await h.as("drafts-other");
    const r = await other.get(`/api/executive/drafts/${String(mine?.id)}`);
    assert.ok([404, 409].includes(r.status), JSON.stringify(r.body));
    assert.notEqual(code(r), undefined);
  });
});
