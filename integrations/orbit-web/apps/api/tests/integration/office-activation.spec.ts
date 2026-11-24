// ACTIVATING THE COMPANY, through HTTP as a browser does it, on PostgreSQL (ADR 0061 §8): a person signs in, reaches
// Settings and AI Connections first, and activates an EMPTY company only once one AI connection of the account can be
// used for a function Orbit Web supports. What a connection can be used for is three answers kept apart -- authenticated,
// which interactive use, whether it runs an employee -- and the activation is idempotent across a refresh, a retry and two
// tabs. An older client's example departments are refused, never made; a company once active stays active, whatever
// happens to its connections. No real AI account: the Claude Code CLI is the harness's fake.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { AiConnectionsView, Office, Roster, RuntimeConnection } from "@orbit-web/contracts";
import { startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const code = (r: { body: unknown }): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
const details = (r: { body: unknown }): Record<string, unknown> => ((r.body as { error?: { details?: Record<string, unknown> } } | null)?.error?.details ?? {}) as Record<string, unknown>;

describe("activating a company: empty, after a usable AI connection, once", () => {
  let h: Harness;
  let b: Browser;
  let accountId: string;

  before(async () => {
    h = await startHarness({ account: { connect: false } });
    b = h.owner as Browser;
    accountId = (h.user as { accountId: string }).accountId;
  });

  after(async () => {
    await h?.close();
  });

  test("with no AI connection, Settings and AI Connections work and the company waits: 409 connection_required, saying where", async () => {
    const view = (await b.get("/api/connections")).body as AiConnectionsView;
    assert.equal(view.connections.length, 0);
    assert.deepEqual(view.activation.uses, { chat: false, research: false, employee: false });
    assert.equal(view.activation.ready, false);
    assert.equal(view.activation.where, "#/settings/ai-connections");
    assert.match(view.activation.reason ?? "", /AI Connections/);
    const refused = await b.send("POST", "/api/office/setup", { name: "Acme" });
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(code(refused), "connection_required");
    assert.equal(details(refused).where, "#/settings/ai-connections");
    assert.equal(((await b.get("/api/office/roster")).body as Roster).office, null, "nothing was made");
    assert.equal((await b.get("/api/settings")).status, 200, "Settings answers before any company exists");
  });

  test("an older client's example departments are refused by name -- never made -- and an empty list is no request for any", async () => {
    const examples = await b.send("POST", "/api/office/setup", { name: "Acme", departments: ["Accounting", "Legal", "Sales"] });
    assert.equal(examples.status, 422, JSON.stringify(examples.body));
    assert.equal(code(examples), "departments_not_accepted");
    assert.deepEqual(details(examples).departments, ["Accounting", "Legal", "Sales"]);
    const none = await b.send("POST", "/api/office/setup", { name: "Acme", departments: [] });
    assert.equal(code(none), "connection_required", "[] asks for no department: it is refused only for the missing connection");
    assert.equal(Number((await h.sql("SELECT count(*) AS n FROM workforce.departments WHERE account_id = $1", [accountId]))[0]?.n), 0);
  });

  test("a company needs a name: typed, or the account's company name", async () => {
    const before = String((await h.sql("SELECT company_name FROM app.accounts WHERE id = $1", [accountId]))[0]?.company_name);
    await h.sql("UPDATE app.accounts SET company_name = '' WHERE id = $1", [accountId]);
    try {
      const unnamed = await b.send("POST", "/api/office/setup", {});
      assert.equal(unnamed.status, 422, JSON.stringify(unnamed.body));
      assert.equal(code(unnamed), "company_name_required");
    } finally {
      await h.sql("UPDATE app.accounts SET company_name = $2 WHERE id = $1", [accountId, before]);
    }
  });

  test("a connected Claude Code connection is authenticated, usable for chat and research, and runs employees -- the office hears it changed", async () => {
    const connection: RuntimeConnection = await h.connect(b);
    assert.equal(connection.auth, "connected");
    assert.deepEqual(connection.uses.chat, { ready: true, reason: null, reasonCode: null });
    assert.deepEqual(connection.uses.research, { ready: true, reason: null, reasonCode: null }, "it is the account's default Claude Code connection");
    assert.deepEqual(connection.uses.employee, connection.employeeReady);
    const view = (await b.get("/api/connections")).body as AiConnectionsView;
    assert.equal(view.activation.ready, true);
    assert.equal(view.activation.reason, null);
    const changed = await h.sql("SELECT payload FROM workforce.events WHERE account_id = $1 AND type = 'ConnectionChanged' AND aggregate_id = $2 ORDER BY aggregate_version", [accountId, connection.id]);
    assert.ok(changed.length >= 1, "its check wrote ConnectionChanged for the office's scheduler");
    assert.equal((changed.at(-1)?.payload as { auth?: string }).auth, "connected");
  });

  test("two tabs activate at once: one company, one OfficeSetUp, EMPTY -- named after the account's company -- with its budget", async () => {
    const account = (await b.get("/api/account")).body as { version: number };
    const named = await b.send("PATCH", "/api/account", { companyName: "Octo & Co" }, { "if-match": `"${account.version}"` });
    assert.equal(named.status, 200, `the account's company name, set in Settings → Account: ${JSON.stringify(named.body)}`);
    const [one, two] = await Promise.all([b.send("POST", "/api/office/setup", {}), b.send("POST", "/api/office/setup", {})]);
    assert.equal(one.status, 200, JSON.stringify(one.body));
    assert.equal(two.status, 200, JSON.stringify(two.body));
    assert.equal((one.body as Office).id, (two.body as Office).id);
    assert.equal((one.body as Office).name, "Octo & Co");
    assert.equal(Number((await h.sql("SELECT count(*) AS n FROM workforce.events WHERE account_id = $1 AND type = 'OfficeSetUp'", [accountId]))[0]?.n), 1);
    const roster = (await b.get("/api/office/roster")).body as Roster;
    assert.equal(roster.office?.id, (one.body as Office).id);
    assert.deepEqual([roster.departments.length, roster.employees.length], [0, 0], "no department, no employee");
    assert.equal(Number((await h.sql("SELECT count(*) AS n FROM workforce.missions WHERE account_id = $1", [accountId]))[0]?.n), 0, "no mission");
    assert.equal((await h.sql("SELECT account_id FROM workforce.budgets WHERE account_id = $1", [accountId])).length, 1, "the budget is made with the company");
    const policy = await h.sql("SELECT count(*) AS n FROM governance.policy_revisions WHERE account_id = $1 AND state = 'PUBLISHED'", [accountId]);
    assert.equal(Number(policy[0]?.n), 1, "the policy provisioned with the account is the one in effect -- not a second one");
  });

  test("a company once active stays active: a disconnected provider changes readiness, and a retry answers the same company", async () => {
    const [connection] = ((await b.get("/api/connections")).body as AiConnectionsView).connections;
    assert.ok(connection !== undefined);
    const disconnected = await b.send("POST", `/api/connections/${connection.id}/disconnect`, {});
    assert.equal(disconnected.status, 200, JSON.stringify(disconnected.body));
    const view = (await b.get("/api/connections")).body as AiConnectionsView;
    assert.equal(view.activation.ready, false, "nothing could activate a company now");
    const again = await b.send("POST", "/api/office/setup", { name: "Another name" });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.notEqual((again.body as Office).name, "Another name", "the active company is answered as it is");
    assert.equal(((await b.get("/api/office/roster")).body as Roster).office?.id, (again.body as Office).id, "the owner still reaches the company to administer it");
    const departments = await b.send("POST", "/api/office/departments", { name: "Research" });
    assert.equal(departments.status, 201, JSON.stringify(departments.body));
  });
});
