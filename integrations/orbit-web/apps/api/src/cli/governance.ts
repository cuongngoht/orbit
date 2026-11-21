// THE INSTALLATION'S OWN TERMINAL for governance: what a person who runs the control plane's container can do when no
// page can -- see what the database holds (the accounts, their browser sessions, each audit chain), check the audit
// chains (each account's, and the deployment's own, which no page shows), and end browser sessions. There is no owner to
// enrol and no password to reset: an account is made by a Claude sign-in, and nothing here makes one or opens a session.
// Every change is written as an audit record of the principal `system:installation-terminal`, on the account's chain.
//
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js status
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js verify-audit [--account=<id> | --deployment]
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js revoke-sessions --account=<id> | --all
//
// It reads ORBIT_WEB_DATABASE_URL like the API, refuses a database that is not at this build's schema, and changes no
// schema itself. It is a door for whoever can already run commands in the control plane's container -- the same person
// who can read its environment. In the governed deployment the agent's container has neither the variable nor a route to
// the database: run there, it reaches nothing.
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { verifyChain, type AuditEventType } from "@orbit-web/governance-core";
import { ConfigError, loadConfig } from "../config/config.js";
import { SEARCH_PATH } from "../core/core.module.js";
import { AccountStore, BrowserSessionStore, RuntimeIdentityStore } from "../infra/accounts/stores.js";
import { Db } from "../infra/db/db.js";
import { verifySchema } from "../infra/db/migrate.js";
import { AuditStore, sha256 } from "../infra/governance/stores.js";

const TERMINAL = "installation-terminal";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const opt = (name: string): string | null => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

class Refusal extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

const chainName = (accountId: string | null): string => (accountId === null ? "deployment" : `account ${accountId}`);

interface Opened {
  db: Db;
  audit: AuditStore;
  accounts: AccountStore;
  sessions: BrowserSessionStore;
  runtime: RuntimeIdentityStore;
}

async function open(): Promise<Opened> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    throw new Refusal(err instanceof ConfigError ? err.message : String(err), 2);
  }
  const db = new Db({ url: config.database.url, poolMax: 2, connectTimeoutMs: config.database.connectTimeoutMs, statementTimeoutMs: config.database.statementTimeoutMs, searchPath: SEARCH_PATH, applicationName: "orbit-web-terminal" });
  try {
    await verifySchema(db);
  } catch (err) {
    await db.close();
    throw new Refusal(`the database cannot be used: ${err instanceof Error ? err.message : String(err)}`, 2);
  }
  return { db, audit: new AuditStore(db), accounts: new AccountStore(db), sessions: new BrowserSessionStore(db), runtime: new RuntimeIdentityStore(db) };
}

async function record(s: Opened, accountId: string | null, type: AuditEventType, outcome: string, data: Record<string, unknown>): Promise<void> {
  if (accountId !== null && (await s.audit.head(accountId)) === null) await s.audit.openChain(accountId);
  await s.audit.append({
    eventId: `evt-${randomUUID()}`,
    eventType: type,
    occurredAt: new Date().toISOString(),
    accountId,
    principalId: TERMINAL,
    principalType: "system",
    agentId: null,
    workspaceId: null,
    runId: null,
    correlationId: randomUUID(),
    causationId: null,
    policyRevision: null,
    decisionId: null,
    outcome,
    reasonCodes: [],
    evidenceRefs: [],
    data: data as never,
  });
}

async function checkChain(s: Opened, accountId: string | null): Promise<{ ok: boolean; line: string }> {
  const check = verifyChain(await s.audit.all(accountId), sha256);
  if (check.ok) return { ok: true, line: `audit, ${chainName(accountId)}: ${check.count} record(s), the chain holds, head ${check.head ?? "none"}` };
  return { ok: false, line: `audit, ${chainName(accountId)}: the chain does NOT hold at record ${check.brokenAt} (${check.problem}, ${check.eventId})` };
}

async function status(s: Opened): Promise<number> {
  const runtime = await s.runtime.get();
  say(runtime.accountId === null ? "runtime: no account signed in through a browser" : `runtime: serving account ${runtime.accountId}`);
  let broken = false;
  for (const accountId of await s.audit.chains()) {
    if (accountId !== null) {
      const identity = await s.accounts.identityOfAccount(accountId);
      const open = await s.sessions.open(accountId);
      say(`account ${accountId}: ${identity?.email ?? "(no identity)"}, ${open.length} open browser session(s)`);
    }
    const c = await checkChain(s, accountId);
    broken ||= !c.ok;
    say(c.line);
  }
  return broken ? 2 : 0;
}

async function verifyAudit(s: Opened): Promise<number> {
  const account = opt("account");
  if (account !== null && !UUID.test(account)) throw new Refusal("--account must be an account's id", 1);
  const chains = account !== null ? [account] : flag("deployment") ? [null] : await s.audit.chains();
  let broken = false;
  for (const accountId of chains) {
    const c = await checkChain(s, accountId);
    if (c.ok) say(c.line);
    else process.stderr.write(`governance: ${c.line}\n`);
    broken ||= !c.ok;
  }
  return broken ? 2 : 0;
}

async function revokeSessions(s: Opened): Promise<number> {
  const account = opt("account");
  const at = new Date().toISOString();
  if (account !== null) {
    if (!UUID.test(account)) throw new Refusal("--account must be an account's id", 1);
    if ((await s.accounts.get(account)) === null) throw new Refusal(`no account ${account}`, 3);
    const ended = await s.db.tx(async () => {
      const ids = await s.sessions.revokeAccount(account, at, "revoked_by_terminal");
      await record(s, account, "auth.sessions.revoked", "revoked", { sessions: ids.length, reason: "revoked_by_terminal" });
      return ids.length;
    });
    say(`governance: ${ended} browser session(s) of account ${account} ended; its owner signs in again with Claude.`);
    return 0;
  }
  if (!flag("all")) throw new Refusal("revoke-sessions needs --account=<id> or --all", 1);
  const ended = await s.db.tx(async () => {
    const all = await s.sessions.revokeAll(at, "revoked_by_terminal");
    const byAccount = new Map<string, number>();
    for (const e of all) byAccount.set(e.accountId, (byAccount.get(e.accountId) ?? 0) + 1);
    for (const [accountId, n] of byAccount) await record(s, accountId, "auth.sessions.revoked", "revoked", { sessions: n, reason: "revoked_by_terminal" });
    return all.length;
  });
  say(`governance: ${ended} browser session(s) ended; every owner signs in again with Claude.`);
  return 0;
}

const COMMANDS: Record<string, (s: Opened) => Promise<number>> = { status, "verify-audit": verifyAudit, "revoke-sessions": revokeSessions };

async function main(): Promise<number> {
  const command = COMMANDS[process.argv[2] ?? ""];
  if (command === undefined) throw new Refusal(`usage: governance.js ${Object.keys(COMMANDS).join(" | ")}`, 1);
  const s = await open();
  try {
    return await command(s);
  } finally {
    await s.db.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`governance: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(err instanceof Refusal ? err.code : 1);
  },
);
