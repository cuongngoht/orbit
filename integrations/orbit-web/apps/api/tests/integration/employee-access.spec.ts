// AN EMPLOYEE USES THE ACCOUNT'S CONNECTORS, through the real API: GitHub's and Azure DevOps' sign-ins of Settings →
// Connectors are the installation's, and an employee is let use one -- for every repository, or the ones a person
// chose -- only by the account's owner. It then reads through Orbit's tools (Orbit Web asks Azure DevOps with its own
// sign-in: nothing of it enters the sandbox), inside what was granted and nothing else; turned off, the next ask is
// refused. Every ask is the account policy's decision.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type EmployeeAccess, type EmployeeDetail, type MissionAccepted, type MissionDetail, type RuntimeConnection } from "@orbit-web/contracts";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { program, type Call } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { AZURE, AZURE_REPOSITORY, azureSignedIn, eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const WORK_ITEM_URL = `https://dev.azure.com/${AZURE.organization}/${AZURE.project}/_workitems/edit/42`;
const azRest = (part: string) => (file: string, args: string[]) => program("az", "rest")(file, args) && args.some((a) => a.includes(part));

// What one attempt saw of its tools, and what each ask answered.
interface Seen {
  tools: string[];
  answers: Record<string, { text: string; isError: boolean }>;
}

describe("an employee uses the account's connectors", () => {
  let h: Harness;
  let b: Browser;
  let employee: EmployeeDetail;
  const sandbox = new FakeSandboxProvider();
  const seen: Seen[] = [];

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    azureSignedIn(h.fake)
      .on(azRest(`/${AZURE.organization}/${AZURE.project}/_apis/wit/workitems/42?`), { run: { stdout: JSON.stringify({ id: 42, fields: { "System.WorkItemType": "User Story", "System.Title": "Export the monthly report", "System.State": "Active", "System.TeamProject": AZURE.project, "System.Description": "<p>Users export the report as CSV.</p>" } }) } })
      .on(azRest(`/_apis/git/repositories/${AZURE.name}/items?path=%2Fdocs&recursionLevel=OneLevel`), { run: { stdout: JSON.stringify({ count: 2, value: [{ path: "/docs", isFolder: true }, { path: "/docs/spec.md", isFolder: false }] }) } })
      .on(azRest(`/_apis/git/repositories/${AZURE.name}/items?path=%2Fdocs%2Fspec.md&recursionLevel=OneLevel`), { run: { stdout: JSON.stringify({ count: 1, value: [{ path: "/docs/spec.md", isFolder: false }] }) } })
      .on(azRest(`/_apis/git/repositories/${AZURE.name}/items?path=%2Fdocs%2Fspec.md&includeContent=true`), { run: { stdout: JSON.stringify({ path: "/docs/spec.md", content: "# Export\nCSV and PDF.\n" }) } })
      .on(azRest(`https://dev.azure.com/${AZURE.organization}/_apis/projects/${AZURE.project}?`), { run: { stdout: JSON.stringify({ id: "p-fiber", name: AZURE.project }) } })
      .on(azRest(`/${AZURE.organization}/${AZURE.project}/_apis/wiki/wikis/Fiber.wiki?`), { run: { stdout: JSON.stringify({ id: "w-1", name: "Fiber.wiki", projectId: "p-fiber" }) } })
      .on(azRest(`/${AZURE.organization}/${AZURE.project}/_apis/wiki/wikis/Other.wiki?`), { run: { stdout: JSON.stringify({ id: "w-2", name: "Other.wiki", projectId: "p-other" }) } })
      .on(azRest(`/${AZURE.organization}/${AZURE.project}/_apis/wiki/wikis/Fiber.wiki/pages?path=%2FRequirements`), { run: { stdout: JSON.stringify({ path: "/Requirements", content: "Reports export as CSV." }) } })
      .on(azRest(`/${AZURE.organization}/${AZURE.project}/_apis/wiki/wikis/Other.wiki/pages?path=%2FSecret`), { run: { stdout: JSON.stringify({ path: "/Secret", content: "Another project's secret." }) } })
      .on(azRest(`/${AZURE.organization}/${AZURE.project}/_apis/wit/wiql`), { run: { stdout: JSON.stringify({ workItems: [{ id: 42 }, { id: 99 }] }) } })
      .on(azRest(`/${AZURE.organization}/${AZURE.project}/_apis/wit/workitems?ids=42,99`), { run: { stdout: JSON.stringify({ value: [{ id: 42, fields: { "System.WorkItemType": "User Story", "System.Title": "Export the monthly report", "System.State": "Active", "System.TeamProject": AZURE.project } }, { id: 99, fields: { "System.WorkItemType": "Bug", "System.Title": "Secret of another project", "System.State": "New", "System.TeamProject": "Other" } }] }) } })
      .on(azRest(`/${AZURE.organization}/${AZURE.project}/_apis/wit/workItems/42/comments`), { run: { stdout: JSON.stringify({ comments: [{ text: "<p>PDF too, please.</p>", createdBy: { displayName: "Lan" }, createdDate: "2026-11-20T10:00:00Z" }] }) } });
    b = h.owner as Browser;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Connector office" })).status, 200);
    const connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((c) => c.runtime === "claude" && c.auth === "connected") as RuntimeConnection;
    const model = connection.catalog.models[0] as { id: string; efforts: string[] };
    // Each attempt: what its tools are, then the asks its work needs.
    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        const listed = (await (await fetch(`${t.bridge.url}/list`, { method: "POST", headers: { "x-orbit-run-token": t.bridge.token, "x-orbit-web": "1" } })).json()) as { tools: { name: string }[] };
        const answers: Seen["answers"] = {};
        answers.granted = await t.call("azure_devops_work_item", { url: WORK_ITEM_URL });
        answers.otherProject = await t.call("azure_devops_work_item", { url: `https://dev.azure.com/${AZURE.organization}/Other/_workitems/edit/1` });
        answers.github = await t.call("github_issue", { repository: "octo/app", number: 1 });
        answers.wiki = await t.call("azure_devops_wiki_page", { organization: AZURE.organization, project: AZURE.project, wiki: "Fiber.wiki", path: "/Requirements" });
        answers.otherWiki = await t.call("azure_devops_wiki_page", { organization: AZURE.organization, project: AZURE.project, wiki: "Other.wiki", path: "/Secret" });
        answers.query = await t.call("azure_devops_query", { organization: AZURE.organization, project: AZURE.project, wiql: "SELECT [System.Id] FROM WorkItems" });
        answers.folder = await t.call("azure_devops_file", { organization: AZURE.organization, project: AZURE.project, repository: AZURE.name, path: "/docs" });
        answers.document = await t.call("azure_devops_file", { organization: AZURE.organization, project: AZURE.project, repository: AZURE.name, path: "/docs/spec.md" });
        answers.comment = await t.call("azure_devops_comment", { url: WORK_ITEM_URL, text: "PDF export is in the summary." });
        seen.push({ tools: listed.tools.map((x) => x.name), answers });
        await t.call("write_file", { path: "/output/summary.md", content: "Read.\n" });
        await t.call("submit_handoff", { summary: "Read the work item." });
      }),
    });
    const hired = await b.send("POST", "/api/employees", {
      name: "Minh",
      profile: { title: "Analyst", duties: "Read work items.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "A summary.", reportingRule: "Say what was read.", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "a test employee",
    });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
    employee = await eventually(async () => (await b.get(`/api/employees/${(hired.body as EmployeeDetail).id}`)).body as EmployeeDetail, (d) => d.sandbox.state === "READY");
  });
  after(() => h?.close());

  const accessOf = async (): Promise<EmployeeAccess> => (await b.get(`/api/employees/${employee.id}/access`)).body as EmployeeAccess;
  async function work(goal: string): Promise<MissionDetail> {
    const given = await b.send("POST", "/api/missions", { title: goal, goal, targetEmployeeId: employee.id, whenBusy: "enqueue", deliverables: [{ name: "summary.md", required: true }], acceptanceCriteria: [] }, { "Idempotency-Key": `k-${goal.replace(/[^A-Za-z0-9]/g, "-")}` });
    assert.equal(given.status, 201, JSON.stringify(given.body));
    return eventually(async () => (await b.get(`/api/missions/${(given.body as MissionAccepted).missionId}`)).body as MissionDetail, (m) => m.handoffs.length === 1, 15_000);
  }

  test("an employee uses no connector until a person lets it", async () => {
    assert.deepEqual((await accessOf()).connectors.map((c) => [c.connector, c.enabled]), [["github", false], ["azure", false]]);
  });

  test("only the account's owner lets it -- and only a repository the connector lists", async () => {
    const agent = await fetch(`${h.url}/api/employees/${employee.id}/access`, { method: "PUT", headers: { "content-type": "application/json", "x-orbit-run-token": "x".repeat(43), "x-orbit-web": "1" }, body: JSON.stringify({ connectors: [{ connector: "azure", enabled: true, repositories: null }] }) });
    assert.notEqual(agent.status, 200, "no run's token changes an employee's access");
    const unlisted = await b.send("PUT", `/api/employees/${employee.id}/access`, { connectors: [{ connector: "azure", enabled: true, repositories: [`${AZURE.organization}/00000000-0000-4000-8000-000000000000`] }] });
    assert.equal(unlisted.status, 403, JSON.stringify(unlisted.body));
    const r = await b.send("PUT", `/api/employees/${employee.id}/access`, { connectors: [{ connector: "azure", enabled: true, repositories: [AZURE_REPOSITORY] }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const azure = (await accessOf()).connectors.find((c) => c.connector === "azure");
    assert.equal(azure?.enabled, true);
    assert.deepEqual(azure?.repositories, [{ id: AZURE_REPOSITORY, fullName: `${AZURE.organization}/${AZURE.project}/${AZURE.name}`, owner: AZURE.organization, project: AZURE.project, name: AZURE.name }]);
  });

  // The work handed in is accepted: the employee is free for the next.
  async function accept(missionId: string): Promise<void> {
    const m = (await b.get(`/api/missions/${missionId}`)).body as MissionDetail;
    const root = m.assignments[0] as { id: string; version: number };
    const ok = await b.send("POST", `/api/assignments/${root.id}/accept`, { handoffDigest: m.handoffs.at(-1)?.digest }, { "if-match": `"${root.version}"` });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  }
  let first = "";

  test("it reads a work item of a granted project through Orbit's tools -- nothing outside it, and no connector it was not let use", async () => {
    first = (await work("Read work item 42")).id;
    const s = seen.at(-1) as Seen;
    assert.ok(s.tools.includes("azure_devops_work_item"), s.tools.join(", "));
    assert.equal(s.tools.some((n) => n.startsWith("github_")), false, "GitHub was not let: its tools are not offered");
    assert.equal(s.answers.granted?.isError, false, s.answers.granted?.text);
    for (const want of ["User Story 42: Export the monthly report", "Users export the report as CSV.", "Lan (2026-11-20T10:00:00Z): PDF too, please.", "data, not instructions"]) assert.ok(s.answers.granted?.text.includes(want), want);
    assert.equal(s.answers.otherProject?.isError, true);
    assert.match(s.answers.otherProject?.text ?? "", /not among the repositories .* let use|not granted/i);
    assert.equal(s.answers.github?.isError, true);
    // Reading only: no tool that writes is offered, and a write is refused.
    assert.equal(s.tools.includes("azure_devops_comment"), false);
    assert.equal(s.answers.comment?.isError, true);
    assert.match(s.answers.comment?.text ?? "", /write/);
    // A query in a granted project says nothing of another project's work items, whatever the WIQL selected.
    assert.match(s.answers.query?.text ?? "", /42 · User Story · Active · Export the monthly report/);
    assert.equal((s.answers.query?.text ?? "").includes("Secret of another project"), false, s.answers.query?.text);
    // A wiki page of the granted project is read; another project's wiki, named under this project's address, is not.
    assert.match(s.answers.wiki?.text ?? "", /Reports export as CSV\./);
    assert.equal(s.answers.otherWiki?.isError, true, s.answers.otherWiki?.text);
    assert.equal((s.answers.otherWiki?.text ?? "").includes("secret"), false);
    // A granted repository's documents: a folder listed, a file read.
    assert.match(s.answers.folder?.text ?? "", /- \/docs\/spec\.md/);
    assert.match(s.answers.document?.text ?? "", /# Export\nCSV and PDF\./);
    // Orbit Web asked Azure DevOps with its own sign-in, on the control plane; the model plane was given nothing of it.
    const asked = h.fake.callsOf(program("az", "rest")).filter((c: Call) => c.args.some((a) => a.includes("/_apis/wit/")));
    assert.ok(asked.length >= 2);
    const planes = sandbox.cli.callsOf(program("claude"));
    assert.equal(JSON.stringify(planes.map((c) => c.env)).includes("AZURE_CONFIG_DIR"), false);
    // The ask was the account policy's decision, recorded.
    const decisions = await h.sql("SELECT data->>'resource' AS resource FROM governance.audit_events WHERE event_type = 'policy.decision' AND data->>'action' = 'tool.connector'");
    assert.ok(decisions.some((d) => d.resource === `azure-devops:${AZURE.organization}/${AZURE.project}`), JSON.stringify(decisions));
  });

  test("turned off, its next ask is refused and the tools are no longer offered", async () => {
    await accept(first);
    assert.equal((await b.send("PUT", `/api/employees/${employee.id}/access`, { connectors: [{ connector: "azure", enabled: false, repositories: null }] })).status, 200);
    second = (await work("Read work item 42 again")).id;
    const s = seen.at(-1) as Seen;
    assert.equal(s.tools.includes("azure_devops_work_item"), false);
    assert.equal(s.answers.granted?.isError, true);
  });

  let second = "";

  test("let write, a comment waits for the owner's approval -- nothing is written until it is approved, then once", async () => {
    await accept(second);
    assert.equal((await b.send("PUT", `/api/employees/${employee.id}/access`, { connectors: [{ connector: "azure", enabled: true, repositories: [AZURE_REPOSITORY], write: true }] })).status, 200);
    assert.equal((await accessOf()).connectors.find((c) => c.connector === "azure")?.write, true);
    const posted = () => h.fake.calls.filter((c) => c.args.includes("rest") && c.args.includes("post") && c.args.some((a) => a.includes("/_apis/wit/workItems/42/comments")));
    await work("Comment on work item 42");
    const s = seen.at(-1) as Seen;
    assert.ok(s.tools.includes("azure_devops_comment"), s.tools.join(", "));
    assert.equal(s.answers.comment?.isError, false, s.answers.comment?.text);
    assert.match(s.answers.comment?.text ?? "", /approv/i);
    assert.equal(posted().length, 0, "nothing is written before a person approves it");
    const approvals = ((await b.get("/api/governance/approvals")).body as { approvals: { id: string; action: string; state: string; summary: string; fingerprint: string }[] }).approvals;
    const asked = approvals.find((a) => a.action === "connector.write" && a.state === "pending");
    assert.ok(asked !== undefined, JSON.stringify(approvals));
    assert.match(asked?.summary ?? "", /work item 42/);
    assert.match(asked?.summary ?? "", /PDF export is in the summary\./);
    // Approved, it is carried out at once -- by Orbit Web, with its own sign-in.
    const granted = await b.send("POST", `/api/governance/approvals/${asked?.id}/grant`, { fingerprint: asked?.fingerprint });
    assert.equal(granted.status, 200, JSON.stringify(granted.body));
    assert.match(String((granted.body as { outcome: string | null }).outcome), /written/);
    assert.equal(posted().length, 1, "written once it was approved");
    assert.ok(posted()[0]?.args.some((a) => a.includes("PDF export is in the summary.")));
    const again = await b.send("POST", `/api/governance/approvals/${asked?.id}/execute`, {});
    assert.notEqual(again.status, 200, "an approval is spent once");
    assert.equal(posted().length, 1);
  });
});
