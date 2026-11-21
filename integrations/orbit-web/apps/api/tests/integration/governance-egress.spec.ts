// AN EMPLOYEE'S WAY OUT, against a real PostgreSQL: a connection of an assignment's run is decided as one -- by its
// account's employee network access, under the policy in effect at THAT connection -- and kept in the run's network log
// (workforce.run_connections) as the egress proxy decides it; an address the proxy refuses after the policy allowed the
// host is recorded on the account's chain. A chat's connections are decided by the rules, exactly as before, and are not
// in that log.
//
// The services are made here from their stores (no browser, no sign-in): what is tested is the decision, the log and the
// record, and the proxy between them.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { connect, createServer, type AddressInfo, type Server as NetServer, type Socket } from "node:net";
import { after, before, describe, test } from "node:test";
import { canonicalJson, defaultAccountPolicy, type Constitution, type EmployeeNetwork } from "@orbit-web/governance-core";
import type { AppConfig } from "../../src/config/config.js";
import { EventBus } from "../../src/core/events/event-bus.js";
import { Db } from "../../src/infra/db/db.js";
import { migrate } from "../../src/infra/db/migrate.js";
import { RunConnectionLog } from "../../src/infra/egress/connection-log.js";
import { startEgressProxy } from "../../src/infra/egress/proxy.js";
import { AuditStore, OverrideStore, RevisionStore, RunBindingStore, sha256, type RevisionRecord } from "../../src/infra/governance/stores.js";
import type { ProcessPort } from "../../src/infra/process/process.port.js";
import { EventStore } from "../../src/infra/storage/stores.js";
import { AuditService } from "../../src/modules/governance/audit.service.js";
import { EgressService } from "../../src/modules/governance/egress.service.js";
import type { IsolationService } from "../../src/modules/governance/isolation.service.js";
import { PolicyService } from "../../src/modules/governance/policy.service.js";
import { createTestDatabase, type TestDatabase } from "../../src/testing/database.js";

const SEARCH_PATH = ["app", "research", "governance", "workforce", "public"];

interface World {
  accountId: string;
  employeeId: string;
  runId: string;
  token: string;
  chatToken: string;
}

describe("an employee's connections, decided, logged and recorded", () => {
  let t: TestDatabase;
  let db: Db;
  let egress: EgressService;
  let audit: AuditStore;
  let log: RunConnectionLog;
  let w: World;
  let other: World;

  // A revision of the account's policy, published in place of the one in effect (what the owner's confirmation does).
  async function publish(accountId: string, document: Constitution): Promise<RevisionRecord> {
    const revisions = new RevisionStore(db);
    return db.tx(async () => {
      await revisions.lockHead(accountId);
      const current = await revisions.effective(accountId);
      const at = new Date().toISOString();
      if (current !== null) await revisions.save({ ...current, state: "SUPERSEDED", supersededAt: at, updatedAt: at }, current);
      const text = canonicalJson(document);
      const record: RevisionRecord = {
        id: `rev-${randomUUID()}`,
        accountId,
        revision: await revisions.nextNumber(accountId),
        state: "PUBLISHED",
        document: text,
        digest: sha256(text),
        name: document.metadata.name,
        risk: null,
        source: "owner",
        basedOn: current?.id ?? null,
        authors: ["test"],
        createdAt: at,
        createdBy: "test",
        updatedAt: at,
        confirmedDigest: null,
        confirmedBase: null,
        confirmedRisk: null,
        confirmedBy: null,
        confirmedAt: null,
        publishedAt: at,
        publishedBy: "test",
        supersededAt: null,
      };
      await revisions.insert(record);
      return record;
    });
  }

  const policyWith = (accountId: string, employeeNetwork: EmployeeNetwork): Constitution => ({ ...defaultAccountPolicy(accountId, "governed"), employeeNetwork });

  // An account with an employee whose assignment has a run bound to it, and a chat with a run of its own.
  async function world(): Promise<World> {
    const accountId = randomUUID();
    const employeeId = randomUUID();
    const missionId = randomUUID();
    const assignmentId = randomUUID();
    const runId = randomUUID();
    const at = new Date().toISOString();
    await db.query("INSERT INTO app.accounts (id, kind, display_name, created_at, updated_at) VALUES ($1, 'customer', 'Octo', $2, $2)", [accountId, at]);
    await db.query("INSERT INTO workforce.employees (id, account_id, name, kind, employment, profile_revision, resource_revision, created_by, created_at, updated_at) VALUES ($1, $2, 'Ada', 'permanent', 'active', 1, 1, 'test', $3, $3)", [employeeId, accountId, at]);
    await db.query("INSERT INTO workforce.missions (id, account_id, title, goal, state, created_by, acceptance_mode, acceptance_criteria, deliverables, source_revision_ids, created_at, updated_at) VALUES ($1, $2, 'Read', 'Read the docs', 'open', 'test', 'owner_review', '[]', '[]', '[]', $3, $3)", [missionId, accountId, at]);
    await db.query("INSERT INTO workforce.assignments (id, account_id, mission_id, employee_id, state, brief, eligible_at, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, 'QUEUED', '{}', $5, 'test', $5, $5)", [assignmentId, accountId, missionId, employeeId, at]);
    await db.query("INSERT INTO workforce.runs (id, account_id, assignment_id, employee_id, attempt_no, state, dispatch_key, fence, requested, created_at, updated_at) VALUES ($1, $2, $3, $4, 1, 'running', $5, 1, '{}', $6, $6)", [runId, accountId, assignmentId, employeeId, `dispatch-${runId}`, at]);
    await db.query("INSERT INTO governance.account_resources (account_id, kind, id, title, created_at) VALUES ($1, 'employee', $2, 'Ada', $3), ($1, 'workspace', $4, 'A chat', $3)", [accountId, employeeId, at, `ws-${accountId}`]);
    const revision = await publish(accountId, policyWith(accountId, { mode: "AUTONOMOUS", allow: [] }));
    const bindings = new RunBindingStore(db);
    const token = `tok-${randomUUID()}`;
    const chatToken = `tok-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    await bindings.insert({ runId, accountId, kind: "assignment", resourceKind: "employee", resourceId: employeeId, researchSessionId: null, agentId: "employee", policyRevision: revision.id, startedBy: "test", workBranch: null, createdAt: at, expiresAt, endedAt: null, tokenHash: sha256(token) });
    await bindings.insert({ runId: `chat-${randomUUID()}`, accountId, kind: "chat", resourceKind: "workspace", resourceId: `ws-${accountId}`, researchSessionId: null, agentId: "claude-code", policyRevision: revision.id, startedBy: "test", workBranch: null, createdAt: at, expiresAt, endedAt: null, tokenHash: sha256(chatToken) });
    return { accountId, employeeId, runId, token, chatToken };
  }

  before(async () => {
    t = await createTestDatabase();
    db = new Db({ url: t.url, poolMax: 8, connectTimeoutMs: 5_000, statementTimeoutMs: 30_000, searchPath: SEARCH_PATH });
    await migrate(db);
    audit = new AuditStore(db);
    const auditService = new AuditService(audit, new EventBus(db, new EventStore(db)));
    const policy = new PolicyService(new RevisionStore(db), new OverrideStore(db), auditService);
    const config = { governance: { deployment: "governed", proxyPort: null, agentNetworks: [], egressPrivateAllow: [] } } as unknown as AppConfig;
    egress = new EgressService(config, {} as ProcessPort, {} as IsolationService, policy, new RunBindingStore(db), auditService, db);
    log = new RunConnectionLog(db);
    w = await world();
    other = await world();
  });
  after(async () => {
    await db.close();
    await t.drop();
  });

  const ask = (host: string, port: number, token: string | null) => egress.decide({ host, port, token, from: "172.31.249.10" });

  test("AUTONOMOUS: an employee's run reaches a public host on 80 and 443 and no other port, decided under its own scope", async () => {
    const reached = await ask("example.com", 443, w.token);
    assert.deepEqual([reached.allow, reached.run], [true, { id: w.runId, accountId: w.accountId, employee: true, limits: null }]);
    assert.equal((await ask("example.com", 80, w.token)).allow, true);
    const port = await ask("example.com", 22, w.token);
    assert.equal(port.allow, false);
    assert.match(port.reason, /EMPLOYEE_NETWORK_PORT/);
    const decisions = (await audit.all(w.accountId)).filter((e) => e.eventType === "policy.decision" && e.runId === w.runId);
    assert.deepEqual(
      decisions.map((e) => [e.outcome, e.data.resource, e.data.scope, e.principalType, e.reasonCodes.join()]),
      [
        ["allow", "example.com:443", "ACCOUNT_EMPLOYEE", "agent", "EMPLOYEE_NETWORK_AUTONOMOUS"],
        ["allow", "example.com:80", "ACCOUNT_EMPLOYEE", "agent", "EMPLOYEE_NETWORK_AUTONOMOUS"],
        ["deny", "example.com:22", "ACCOUNT_EMPLOYEE", "agent", "EMPLOYEE_NETWORK_PORT"],
      ],
    );
    // A chat of the same account is held to the rules as before: the governed default reaches the Claude hosts only.
    const chat = await ask("example.com", 443, w.chatToken);
    assert.deepEqual([chat.allow, chat.run?.employee, chat.run?.limits], [false, false, null]);
    assert.match(chat.reason, /DEFAULT_DECISION/);
    assert.equal((await ask("api.anthropic.com", 443, w.chatToken)).allow, true);
  });

  test("a policy published while the run works applies from its next connection: RESTRICTED, with its limits", async () => {
    await publish(w.accountId, policyWith(w.accountId, { mode: "RESTRICTED", allow: ["api.github.com", "*.pythonhosted.org"], limits: { downloadBytesPerRun: 1000, connectionsPerMinutePerRun: 600 } }));
    const refused = await ask("example.com", 443, w.token);
    assert.equal(refused.allow, false);
    assert.match(refused.reason, /does not allow example\.com:443 \(EMPLOYEE_NETWORK_NOT_LISTED\)/);
    const listed = await ask("files.pythonhosted.org", 443, w.token);
    assert.deepEqual([listed.allow, listed.run?.limits], [true, { downloadBytesPerRun: 1000, connectionsPerMinutePerRun: 600 }]);
    assert.equal((await ask("example.com", 443, other.token)).allow, true, "another account's policy is its own");
    await publish(w.accountId, policyWith(w.accountId, { mode: "AUTONOMOUS", allow: [] }));
    assert.deepEqual([(await ask("example.com", 443, w.token)).allow, (await ask("example.com", 443, w.token)).run?.limits], [true, null]);
  });

  // (A connection with no live run's token is decided as nobody's and recorded on the deployment's own chain -- the
  // system account's in 0.8.0's schema, which the audit store is being moved to by the identity work; until then such a
  // decision cannot be recorded and the proxy refuses the connection. What is tested here is the lookup itself.)
  test("a token is a run's only while the run is live: an ended, an expired or an unknown one is nobody's", async () => {
    const bindings = new RunBindingStore(db);
    assert.equal((await bindings.live(sha256(w.token)))?.runId, w.runId);
    assert.equal(await bindings.live(sha256("not-a-token")), null);
    assert.equal(await bindings.live(sha256(w.token), new Date(Date.now() + 2 * 3_600_000).toISOString()), null, "past its time");
    const ended = await world();
    await bindings.end(ended.runId, new Date().toISOString());
    assert.equal(await bindings.live(sha256(ended.token)), null);
    assert.equal((await bindings.byToken(sha256(ended.token)))?.kind, "assignment", "the record of the run stays");
  });

  describe("through the proxy", () => {
    let proxy: Server;
    let proxyPort: number;
    let upstream: NetServer;
    let upstreamPort: number;
    const names: Record<string, string> = { "api.github.com": "140.82.112.6", "docs.example.com": "93.184.215.14", "intranet.test": "10.0.0.5" };

    before(async () => {
      upstream = createServer((s) => {
        s.on("error", () => undefined);
        s.end(Buffer.alloc(3000, 0x61));
      });
      upstreamPort = await new Promise<number>((r) => upstream.listen(0, "127.0.0.1", () => r((upstream.address() as AddressInfo).port)));
      proxy = await startEgressProxy(
        0,
        {
          decide: (a) => egress.decide(a),
          admit: () => true,
          resolve: async (host) => names[host] ?? "93.184.215.14",
          own: new Set(),
          sink: egress.sink(),
          dial: () => connect({ host: "127.0.0.1", port: upstreamPort }),
        },
        "127.0.0.1",
      );
      proxyPort = (proxy.address() as AddressInfo).port;
      await publish(w.accountId, policyWith(w.accountId, { mode: "RESTRICTED", allow: ["api.github.com", "docs.example.com", "intranet.test"], limits: { downloadBytesPerRun: 4000 } }));
    });
    after(() => {
      proxy.close();
      upstream.close();
    });

    // A CONNECT through the proxy as a run: its status line and everything that came back.
    const through = (target: string, token: string): Promise<{ status: string; body: Buffer }> =>
      new Promise((resolve) => {
        const s: Socket = connect(proxyPort, "127.0.0.1");
        const parts: Buffer[] = [];
        s.on("data", (d: Buffer) => parts.push(d));
        s.on("error", () => undefined);
        s.on("close", () => {
          const all = Buffer.concat(parts);
          const head = all.indexOf("\r\n\r\n");
          resolve({ status: all.subarray(0, all.indexOf("\r\n")).toString(), body: all.subarray(head + 4) });
        });
        s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: Basic ${Buffer.from(`run:${token}`).toString("base64")}\r\n\r\n`);
      });

    async function settled(accountId: string, runId: string, count: number): Promise<void> {
      const end = Date.now() + 5000;
      while (Date.now() < end) {
        const rows = await log.list(accountId, runId);
        if (rows.length >= count && rows.every((r) => r.closedAt !== null)) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("the run's log did not settle");
    }

    test("every connection of the run is in its log as it was decided: allowed with its bytes, refused, limited -- and a refused address is on the account's chain", async () => {
      const first = await through("api.github.com:443", w.token);
      assert.match(first.status, /200/);
      assert.equal(first.body.length, 3000);
      assert.match((await through("example.com:443", w.token)).status, /403/, "not on the allow-list");
      const internal = await through("intranet.test:443", w.token);
      assert.match(internal.status, /403/);
      assert.match(internal.body.toString(), /resolves to 10\.0\.0\.5, which is not on the public internet/);
      const cut = await through("docs.example.com:443", w.token);
      assert.equal(cut.body.length, 1000, "4000 bytes a run: 3000 were spent, 1000 more pass");
      assert.match((await through("api.github.com:443", w.token)).status, /429/, "the run's downloads are spent");
      await settled(w.accountId, w.runId, 5);

      const rows = await log.list(w.accountId, w.runId);
      assert.deepEqual(
        rows.map((r) => [r.host, r.port, r.verdict, r.bytesIn, r.reason?.split(":")[0] ?? null]),
        [
          ["api.github.com", 443, "allowed", 3000, null],
          ["example.com", 443, "refused", 0, "policy"],
          ["intranet.test", 443, "refused", 0, "address"],
          ["docs.example.com", 443, "limited", 1000, "limit"],
          ["api.github.com", 443, "limited", 0, "limit"],
        ],
      );
      assert.match(rows[1]?.reason ?? "", /EMPLOYEE_NETWORK_NOT_LISTED/);
      const violations = (await audit.all(w.accountId)).filter((e) => e.eventType === "boundary.violation");
      assert.deepEqual(
        violations.map((e) => [e.outcome, e.data.kind, e.data.route, e.data.target, e.principalType, e.runId]),
        [["refused", "egress_address", "egress", "intranet.test:443 (10.0.0.5)", "agent", w.runId]],
      );

      const summary = await log.summary(w.accountId, w.runId);
      assert.deepEqual({ ...summary, digest: "-" }, { connections: 5, allowed: 1, refused: 2, limited: 2, hosts: ["api.github.com", "example.com", "intranet.test", "docs.example.com"], bytesIn: 4000, bytesOut: 0, digest: "-" });
      assert.match(summary.digest, /^[0-9a-f]{64}$/);
      assert.equal((await log.summary(w.accountId, w.runId)).digest, summary.digest, "the same log, the same digest");
      assert.equal(await log.downloadedSince(w.accountId, "2000-01-01T00:00:00.000Z"), 4000);
    });

    test("a chat's connections are not in that log, and one account never reads another's", async () => {
      await through("api.anthropic.com:443", w.chatToken);
      assert.deepEqual(await log.list(other.accountId, w.runId), [], "another account's run is not found");
      assert.deepEqual(await log.list(w.accountId, other.runId), []);
      const all = await db.query("SELECT DISTINCT run_id::text AS run FROM workforce.run_connections");
      assert.deepEqual(all.map((r) => r.run), [w.runId], "only the employee's run is logged");
    });
  });
});
