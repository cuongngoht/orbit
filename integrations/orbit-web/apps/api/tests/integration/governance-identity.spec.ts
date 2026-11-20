// OPERATOR IDENTITY: the Claude sign-in opens the workspace, never governance. An owner is enrolled once, with the code
// Orbit Web said in its own log; operators sign in with their own credential; roles are read from the store on every
// request; and the switches that hand Claude Code a sign-in are turned on by an operator only -- never by whoever (or
// whatever) reaches the API.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { AuditPage, ChainVerification, GovernanceState, OperatorList, OperatorView, Settings } from "@orbit-web/contracts";
import { OWNER, startHarness, type Harness, type OperatorClient, type Reply } from "../../src/testing/harness.js";

const code = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;

async function auditOf(owner: OperatorClient): Promise<AuditPage["events"]> {
  const r = await owner.get("/api/governance/audit?limit=200");
  assert.equal(r.status, 200);
  return (r.body as AuditPage).events;
}

describe("before an owner exists, and the first owner's enrolment", () => {
  let h: Harness;
  before(async () => (h = await startHarness()));
  after(() => h.close());

  test("governance starts empty, and the first owner's code goes to Orbit Web's own log only", async () => {
    const state = (await h.get("/api/operator/state")).body as GovernanceState;
    assert.deepEqual([state.initialized, state.bootstrapOpen, state.session, state.deployment], [false, true, null, "single"]);
    const announced = h.bootstrapCode();
    assert.match(announced ?? "", /^[0-9a-f]{4}(-[0-9a-f]{4}){7}$/);
    const bare = (announced ?? "").replace(/-/g, "");
    assert.equal(JSON.stringify(state).includes(bare), false, "never in a response");
    for (const call of h.fake.calls) assert.equal(JSON.stringify(call).includes(bare), false, `never given to ${call.file}`);
  });

  test("the Claude sign-in and the workspace are not operator access: governance is refused, and so is a credential switch", async () => {
    assert.equal(code(await h.get("/api/governance/operators")), "operator_required");
    assert.equal(code(await h.get("/api/governance/audit")), "operator_required");
    assert.equal(code(await h.send("POST", "/api/governance/audit/verify")), "operator_required");
    for (const setting of ["githubForClaude", "azureForClaude", "projectPlugins"]) {
      const r = await h.send("PATCH", "/api/settings", { [setting]: true });
      assert.deepEqual([r.status, code(r)], [403, "operator_required"], setting);
    }
    const settings = (await h.get("/api/settings")).body as Settings;
    assert.deepEqual([settings.githubForClaude, settings.azureForClaude, settings.projectPlugins], [false, false, false]);
    // Turning one OFF never needs anybody.
    assert.equal((await h.send("PATCH", "/api/settings", { githubForClaude: false, theme: "dark" })).status, 200);
  });

  test("a wrong code enrols nobody; the right one enrols one owner, once, and is spent", async () => {
    const wrong = await h.send("POST", "/api/operator/bootstrap", { ...OWNER, code: "0000-0000-0000-0000-0000-0000-0000-0000" });
    assert.deepEqual([wrong.status, code(wrong)], [403, "bootstrap_code_invalid"]);
    assert.equal(((await h.get("/api/operator/state")).body as GovernanceState).initialized, false);
    const ok = await h.send("POST", "/api/operator/bootstrap", { ...OWNER, code: h.bootstrapCode() });
    assert.equal(ok.status, 201);
    const cookie = ok.headers.get("set-cookie") ?? "";
    assert.match(cookie, /orbit_web_operator=/);
    for (const attribute of [/HttpOnly/i, /SameSite=Strict/i, /Path=\/api/i]) assert.match(cookie, attribute);
    const state = ok.body as GovernanceState;
    assert.equal(state.initialized, true);
    assert.equal(state.organization?.name, OWNER.organizationName);
    assert.deepEqual(state.session?.operator.roles, ["organization_owner"]);
    assert.ok(state.session?.permissions.includes("constitution.publish"));
    assert.match(state.session?.csrfToken ?? "", /^[0-9a-f]{64}$/);
    // Replayed -- the same code, or any code -- it enrols nobody else.
    const replay = await h.send("POST", "/api/operator/bootstrap", { ...OWNER, username: "mallory", code: h.bootstrapCode() });
    assert.deepEqual([replay.status, code(replay)], [409, "already_initialized"]);
    assert.equal(((await h.get("/api/operator/state")).body as GovernanceState).bootstrapOpen, false);
  });

  test("the enrolment is in the audit record, and neither the code nor a password is anywhere in it or on disk in clear", async () => {
    const owner = await h.signIn(OWNER.username, OWNER.password);
    const events = await auditOf(owner);
    const types = events.map((e) => e.eventType);
    for (const t of ["governance.initialized", "operator.created", "operator.role.granted", "operator.signed_in", "operator.bootstrap.refused", "settings.privileged.refused"]) assert.ok(types.includes(t as never), t);
    const refused = events.filter((e) => e.eventType === "settings.privileged.refused");
    assert.deepEqual(refused.map((e) => [e.principalType, e.data.cause]).sort(), [["anonymous", "operator_required"], ["anonymous", "operator_required"], ["anonymous", "operator_required"]]);
    const bare = (h.bootstrapCode() ?? "").replace(/-/g, "");
    const everything = JSON.stringify(events);
    assert.equal(everything.includes(bare), false);
    assert.equal(everything.includes(OWNER.password), false);
    for (const dir of ["governance", "app"]) {
      for (const file of readdirSync(join(h.dataDir, dir))) {
        const bytes = readFileSync(join(h.dataDir, dir, file)).toString("latin1");
        assert.equal(bytes.includes(OWNER.password), false, `${dir}/${file}`);
        assert.equal(bytes.includes(bare), false, `${dir}/${file}`);
      }
    }
    const verified = (await owner.send("POST", "/api/governance/audit/verify")).body as ChainVerification;
    assert.deepEqual([verified.ok, verified.problem], [true, null]);
  });
});

describe("operators, roles and sessions", () => {
  let h: Harness;
  let owner: OperatorClient;
  let auditor: OperatorClient;
  let editorId: string;
  before(async () => {
    h = await startHarness();
    owner = await h.owner();
    const created = await owner.send("POST", "/api/governance/operators", { username: "audrey", displayName: "Audrey Auditor", password: "a long auditor password", roles: ["auditor"] });
    assert.equal(created.status, 201);
    const editor = await owner.send("POST", "/api/governance/operators", { username: "eddie", password: "a long editor password", roles: ["policy_editor"] });
    editorId = (editor.body as OperatorView).id;
    auditor = await h.signIn("audrey", "a long auditor password");
  });
  after(() => h.close());

  test("a change needs the session's own CSRF token, beside its cookie", async () => {
    const bare = await owner.send("POST", "/api/governance/audit/verify", undefined, { "x-orbit-operator-csrf": "" });
    assert.deepEqual([bare.status, code(bare)], [403, "csrf_invalid"]);
    const wrong = await owner.send("POST", "/api/governance/audit/verify", undefined, { "x-orbit-operator-csrf": "f".repeat(64) });
    assert.deepEqual([wrong.status, code(wrong)], [403, "csrf_invalid"]);
    assert.equal((await owner.send("POST", "/api/governance/audit/verify")).status, 200);
  });

  test("an auditor reads the evidence and changes nothing: no operator, no role, no privileged switch", async () => {
    assert.equal((await auditor.get("/api/governance/audit")).status, 200);
    assert.equal((await auditor.get("/api/governance/operators")).status, 200);
    assert.equal((await auditor.send("POST", "/api/governance/audit/verify")).status, 200);
    const create = await auditor.send("POST", "/api/governance/operators", { username: "sneaky", password: "another long password", roles: ["organization_owner"] });
    assert.deepEqual([create.status, code(create)], [403, "permission_required"]);
    const self = await auditor.send("POST", `/api/governance/operators/${auditor.state.session?.operator.id}/roles`, { grant: ["organization_owner"] });
    assert.deepEqual([self.status, code(self)], [403, "permission_required"]);
    const sw = await auditor.send("PATCH", "/api/settings", { githubForClaude: true });
    assert.deepEqual([sw.status, code(sw)], [403, "permission_required"]);
  });

  test("roles are never taken from a request: a body or a header that claims one changes nothing", async () => {
    const claimed = await h.send("PATCH", "/api/settings", { githubForClaude: true }, { "x-orbit-role": "organization_owner", "x-orbit-operator": "owner" });
    assert.deepEqual([claimed.status, code(claimed)], [403, "operator_required"]);
    const forged = await h.get("/api/governance/operators", { cookie: `orbit_web_operator=${"A".repeat(43)}` });
    assert.equal(code(forged), "operator_required");
    const runToken = await h.get("/api/governance/operators", { "x-orbit-run-token": "a".repeat(43) });
    assert.deepEqual([runToken.status, code(runToken)], [401, "run_token_invalid"]);
    assert.equal(code(await h.send("POST", "/api/governance/operators", { username: "x1", password: "a long password here", roles: [] }, { "x-orbit-operator-csrf": owner.csrf })), "operator_required");
  });

  test("an operator never changes their own roles, nor suspends themselves; the organization keeps its last owner", async () => {
    const id = owner.state.session?.operator.id as string;
    assert.equal(code(await owner.send("POST", `/api/governance/operators/${id}/roles`, { revoke: ["organization_owner"] })), "self_role_change");
    assert.equal(code(await owner.send("POST", `/api/governance/operators/${id}/suspend`)), "self");
    const second = (await owner.send("POST", "/api/governance/operators", { username: "olga", password: "a second owner password", roles: ["organization_owner"] })).body as OperatorView;
    const olga = await h.signIn("olga", "a second owner password");
    assert.equal((await olga.send("POST", `/api/governance/operators/${id}/roles`, { revoke: ["organization_owner"] })).status, 200);
    assert.equal(code(await owner.get("/api/governance/operators")), "permission_required", "the change holds on the very next request");
    assert.equal(code(await olga.send("POST", `/api/governance/operators/${second.id}/suspend`)), "self");
    assert.equal((await olga.send("POST", `/api/governance/operators/${id}/roles`, { grant: ["organization_owner"] })).status, 200);
    assert.equal((await owner.get("/api/governance/operators")).status, 200);
  });

  test("suspending an operator ends their sessions at once; reinstating them does not bring a session back", async () => {
    const editor = await h.signIn("eddie", "a long editor password");
    assert.equal((await editor.get("/api/operator/state")).status, 200);
    assert.equal(((await editor.get("/api/operator/state")).body as GovernanceState).session?.operator.username, "eddie");
    assert.equal((await owner.send("POST", `/api/governance/operators/${editorId}/suspend`)).status, 200);
    assert.equal(((await editor.get("/api/operator/state")).body as GovernanceState).session, null);
    const again = await h.send("POST", "/api/operator/login", { username: "eddie", password: "a long editor password" });
    assert.deepEqual([again.status, code(again)], [403, "operator_suspended"]);
    assert.equal((await owner.send("POST", `/api/governance/operators/${editorId}/reinstate`)).status, 200);
    assert.equal(((await editor.get("/api/operator/state")).body as GovernanceState).session, null);
    const back = await h.signIn("eddie", "a long editor password");
    assert.equal(back.state.session?.operator.status, "active");
    assert.equal((await owner.send("POST", `/api/governance/operators/${editorId}/sessions/revoke`)).status, 200);
    assert.equal(((await back.get("/api/operator/state")).body as GovernanceState).session, null);
  });

  test("five wrong passwords lock the name, even against the right one", async () => {
    await owner.send("POST", "/api/governance/operators", { username: "lockme", password: "the right password!", roles: [] });
    for (let i = 0; i < 5; i += 1) assert.equal(code(await h.send("POST", "/api/operator/login", { username: "lockme", password: `wrong password ${i}` })), "invalid_credentials");
    const locked = await h.send("POST", "/api/operator/login", { username: "lockme", password: "the right password!" });
    assert.deepEqual([locked.status, code(locked)], [429, "sign_in_locked"]);
    const unknown = await h.send("POST", "/api/operator/login", { username: "nobody", password: "whatever password" });
    assert.equal(code(unknown), "invalid_credentials", "an unknown name is told nothing more");
  });

  test("guesses sent all at once count as they arrive: no more than five are ever checked", async () => {
    await owner.send("POST", "/api/governance/operators", { username: "burst", password: "the burst password", roles: [] });
    const replies = await Promise.all(Array.from({ length: 12 }, (_, i) => h.send("POST", "/api/operator/login", { username: "burst", password: `guess number ${i}` })));
    const codes = replies.map(code);
    assert.equal(codes.filter((c) => c === "invalid_credentials").length, 5, codes.join(","));
    assert.equal(codes.filter((c) => c === "sign_in_locked").length, 7, codes.join(","));
    assert.equal(code(await h.send("POST", "/api/operator/login", { username: "burst", password: "the burst password" })), "sign_in_locked");
  });

  test("signing out ends the session; changing a password ends the others", async () => {
    const a = await h.signIn("audrey", "a long auditor password");
    const b = await h.signIn("audrey", "a long auditor password");
    assert.equal((await a.send("POST", "/api/operator/password", { currentPassword: "a long auditor password", newPassword: "a new auditor password" })).status, 204);
    assert.equal(((await b.get("/api/operator/state")).body as GovernanceState).session, null);
    assert.equal(((await a.get("/api/operator/state")).body as GovernanceState).session?.operator.username, "audrey");
    assert.equal((await a.send("POST", "/api/operator/logout")).status, 204);
    assert.equal(((await a.get("/api/operator/state")).body as GovernanceState).session, null);
    assert.equal(code(await a.get("/api/governance/audit")), "operator_required");
  });

  test("an operator with the permission turns a credential switch on -- recorded before it is written -- and anybody turns it off", async () => {
    const on = await owner.send("PATCH", "/api/settings", { githubForClaude: true, projectPlugins: true });
    assert.equal(on.status, 200);
    assert.deepEqual([(on.body as Settings).githubForClaude, (on.body as Settings).projectPlugins], [true, true]);
    assert.equal((await h.send("PATCH", "/api/settings", { githubForClaude: false })).status, 200);
    const events = await auditOf(owner);
    const changes = events.filter((e) => e.eventType === "settings.privileged.changed").map((e) => [e.principalType, e.data.setting, e.data.value, e.outcome]);
    assert.deepEqual(changes, [
      ["anonymous", "githubForClaude", false, "narrowed"],
      ["human", "projectPlugins", true, "authorized"],
      ["human", "githubForClaude", true, "authorized"],
    ]);
    const list = (await owner.get("/api/governance/operators")).body as OperatorList;
    assert.deepEqual(list.operators.map((o) => o.username), ["owner", "audrey", "eddie", "olga", "lockme", "burst"]);
  });
});

describe("the access token opens the workspace, and only the workspace", () => {
  let h: Harness;
  const TOKEN = "a-long-access-token-for-this-test";
  before(async () => (h = await startHarness({ env: { ORBIT_WEB_ACCESS_TOKEN: TOKEN } })));
  after(() => h.close());

  test("with the access token -- as a bearer or a cookie -- governance still asks for an operator", async () => {
    const ways: Record<string, string>[] = [{ authorization: `Bearer ${TOKEN}` }, { cookie: `orbit_web_access=${TOKEN}` }];
    for (const headers of ways) {
      assert.equal((await h.get("/api/settings", headers)).status, 200);
      assert.equal(code(await h.get("/api/governance/operators", headers)), "operator_required");
      assert.equal(code(await h.send("PATCH", "/api/settings", { azureForClaude: true }, headers)), "operator_required");
    }
  });
});

describe("restart", () => {
  test("an owner, their session and the audit chain survive a restart; no new first-owner code is made", async () => {
    const h = await startHarness();
    const owner = await h.owner();
    await h.close(true);
    const again = await startHarness({ dataDir: h.dataDir });
    try {
      assert.equal(again.bootstrapCode(), null, "no code once an owner exists");
      const state = (await again.get("/api/operator/state", { cookie: owner.cookie })).body as GovernanceState;
      assert.equal(state.session?.operator.username, OWNER.username);
      const verified = (await again.send("POST", "/api/governance/audit/verify", undefined, { cookie: owner.cookie, "x-orbit-operator-csrf": owner.csrf })).body as ChainVerification;
      assert.equal(verified.ok, true);
      assert.ok(verified.count >= 4);
    } finally {
      await again.close();
    }
  });
});
