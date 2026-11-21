// THE INSTALLATION'S OWN TERMINAL for identity and governance: what a person who runs the control plane's container can
// do when no page can -- print the ONE-TIME CODE that sets up the first administrator (or another account, or a user's
// new password), end browser sessions, see what the database holds (the accounts, their users and sessions, each audit
// chain) and check the audit chains (each account's, and the deployment's own -- the system account's -- which no page
// shows). Every change is written as an audit record of the principal `system:installation-terminal`.
//
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js status
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js verify-audit [--account=<id> | --deployment]
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js owner setup-code [--purpose=first_admin|new_account] [--minutes=30]
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js owner reset-password --username=<name> [--minutes=30]
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js owner revoke-sessions [--username=<name>]
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js revoke-sessions --account=<id> | --all
//
// A code is printed ONCE and kept only as its hash; it expires (30 minutes by default) and is used once. It reads
// ORBIT_WEB_DATABASE_URL like the API, refuses a database that is not at this build's schema, and changes no schema
// itself. It is a door for whoever can already run commands in the control plane's container -- the same person who can
// read its environment. In the governed deployment the agent's container has neither the variable nor a route to the
// database: run there, it reaches nothing.
//
// Exit codes: 0 done, 1 a usage error or refused (said why), 2 the database or configuration cannot be used (or an audit
// chain does not hold), 3 no such account or user.
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { verifyChain, type AuditEventType } from "@orbit-web/governance-core";
import { normalizeUsername, type SetupCodePurpose } from "@orbit-web/contracts";
import { ConfigError, loadConfig } from "../config/config.js";
import { SEARCH_PATH } from "../core/core.module.js";
import { AccountStore, BrowserSessionStore, SetupCodeStore, SYSTEM_ACCOUNT_ID, UserStore, type EndedSession } from "../infra/accounts/stores.js";
import { Db } from "../infra/db/db.js";
import { verifySchema } from "../infra/db/migrate.js";
import { AuditStore, sha256 } from "../infra/governance/stores.js";
import { newSetupCode } from "../modules/auth/setup-codes.js";

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
  users: UserStore;
  codes: SetupCodeStore;
  sessions: BrowserSessionStore;
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
  return { db, audit: new AuditStore(db), accounts: new AccountStore(db), users: new UserStore(db), codes: new SetupCodeStore(db), sessions: new BrowserSessionStore(db) };
}

// `accountId` null: the deployment's own chain (the system account's).
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
  const accounts = await s.accounts.customers();
  say(accounts.length === 0 ? "accounts: none yet -- set up the first administrator: governance.js owner setup-code" : `accounts: ${accounts.length}`);
  for (const a of accounts) {
    const users = await s.users.ofAccount(a.id);
    const open = await s.sessions.openOfAccount(a.id, new Date().toISOString());
    const who = users.map((u) => `${u.username} (${u.fullName}${u.disabledAt !== null ? ", disabled" : ""}${u.trialWaiver ? ", trial password" : ""})`).join(", ");
    say(`account ${a.id} "${a.displayName}": ${who || "no user"}; ${open.length} open browser session(s)`);
  }
  let broken = false;
  for (const accountId of await s.audit.chains()) {
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

// Sessions ended from here: recorded on each account's chain, once per account.
async function ended(s: Opened, list: EndedSession[], reason: string): Promise<void> {
  const byAccount = new Map<string, number>();
  for (const e of list) byAccount.set(e.accountId, (byAccount.get(e.accountId) ?? 0) + 1);
  for (const [accountId, n] of byAccount) await record(s, accountId, "auth.sessions.revoked", "revoked", { sessions: n, reason });
}

async function revokeSessions(s: Opened): Promise<number> {
  const account = opt("account");
  const at = new Date().toISOString();
  if (account !== null) {
    if (!UUID.test(account) || account === SYSTEM_ACCOUNT_ID) throw new Refusal("--account must be an account's id", 1);
    if ((await s.accounts.get(account)) === null) throw new Refusal(`no account ${account}`, 3);
    const n = await s.db.tx(async () => {
      const list = await s.sessions.revokeAccount(account, at, "revoked_by_terminal");
      await ended(s, list, "revoked_by_terminal");
      return list.length;
    });
    say(`governance: ${n} browser session(s) of account ${account} ended; its users sign in again.`);
    return 0;
  }
  if (!flag("all")) throw new Refusal("revoke-sessions needs --account=<id> or --all", 1);
  const n = await s.db.tx(async () => {
    const list = await s.sessions.revokeAll(at, "revoked_by_terminal");
    await ended(s, list, "revoked_by_terminal");
    return list.length;
  });
  say(`governance: ${n} browser session(s) ended; every user signs in again.`);
  return 0;
}

// ---- owner: the setup code, a password reset, sessions by user ------------------------------------------------------

function minutesOf(): number {
  const raw = opt("minutes");
  if (raw === null) return 30;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 24 * 60) throw new Refusal("--minutes must be a whole number of minutes from 1 to 1440", 1);
  return n;
}

async function issue(s: Opened, purpose: SetupCodePurpose, minutes: number, user: { id: string; accountId: string } | null): Promise<{ code: string; expiresAt: string }> {
  const { code, hash } = newSetupCode();
  const at = new Date();
  const expiresAt = new Date(at.getTime() + minutes * 60_000).toISOString();
  await s.db.tx(async () => {
    await s.codes.insert({ id: randomUUID(), accountId: user?.accountId ?? SYSTEM_ACCOUNT_ID, purpose, userId: user?.id ?? null, codeHash: hash, createdAt: at.toISOString(), expiresAt });
    await record(s, user?.accountId ?? null, "settings.privileged.changed", "issued", { setting: `identity.setup_code.${purpose}`, value: `issued, valid until ${expiresAt}` });
  });
  return { code, expiresAt };
}

async function setupCode(s: Opened): Promise<number> {
  const purpose = (opt("purpose") ?? "first_admin") as SetupCodePurpose;
  if (purpose !== "first_admin" && purpose !== "new_account") throw new Refusal("--purpose must be first_admin or new_account (a password reset is `owner reset-password --username=<name>`)", 1);
  const minutes = minutesOf();
  if (purpose === "first_admin" && (await s.accounts.anyCustomer())) {
    throw new Refusal("an administrator is set up already: sign in -- or print a code for another account (--purpose=new_account), or a password reset (owner reset-password --username=<name>)", 1);
  }
  const { code, expiresAt } = await issue(s, purpose, minutes, null);
  say(purpose === "first_admin" ? "One-time code to set up Orbit Web's first administrator:" : "One-time code to set up a new account (its first user):");
  say("");
  say(`    ${code}`);
  say("");
  say(`Open Orbit Web, choose "Set up", and enter it with the username (admin by default) and a password. It works once, until ${expiresAt} (${minutes} minutes). It is not shown again.`);
  return 0;
}

async function resetPassword(s: Opened): Promise<number> {
  const username = normalizeUsername(opt("username"));
  if (username === null) throw new Refusal("owner reset-password needs --username=<the user's username>", 1);
  const user = await s.users.byUsername(username);
  if (user === null) throw new Refusal(`no user ${username}`, 3);
  const minutes = minutesOf();
  const { code, expiresAt } = await issue(s, "reset_password", minutes, user);
  say(`One-time code to set a new password for ${username}:`);
  say("");
  say(`    ${code}`);
  say("");
  say(`Open Orbit Web, choose "Set up", and enter it with the username ${username} and the new password. It works once, until ${expiresAt} (${minutes} minutes); using it ends every session of ${username}.`);
  return 0;
}

async function revokeUserSessions(s: Opened): Promise<number> {
  const at = new Date().toISOString();
  const raw = opt("username");
  if (raw === null) {
    const n = await s.db.tx(async () => {
      const list = await s.sessions.revokeAll(at, "revoked_by_terminal");
      await ended(s, list, "revoked_by_terminal");
      return list.length;
    });
    say(`governance: ${n} browser session(s) ended; every user signs in again.`);
    return 0;
  }
  const username = normalizeUsername(raw);
  const user = username === null ? null : await s.users.byUsername(username);
  if (user === null) throw new Refusal(`no user ${raw}`, 3);
  const n = await s.db.tx(async () => {
    const list = await s.sessions.revokeUser(user.id, at, "revoked_by_terminal");
    await ended(s, list, "revoked_by_terminal");
    return list.length;
  });
  say(`governance: ${n} browser session(s) of ${user.username} ended; ${user.username} signs in again.`);
  return 0;
}

const OWNER: Record<string, (s: Opened) => Promise<number>> = { "setup-code": setupCode, "reset-password": resetPassword, "revoke-sessions": revokeUserSessions };

async function owner(s: Opened): Promise<number> {
  const command = OWNER[process.argv[3] ?? ""];
  if (command === undefined) throw new Refusal(`usage: governance.js owner ${Object.keys(OWNER).join(" | ")}`, 1);
  return command(s);
}

const COMMANDS: Record<string, (s: Opened) => Promise<number>> = { status, "verify-audit": verifyAudit, "revoke-sessions": revokeSessions, owner };

async function main(): Promise<number> {
  const command = COMMANDS[process.argv[2] ?? ""];
  if (command === undefined) throw new Refusal(`usage: governance.js ${Object.keys(COMMANDS).join(" | ")}`, 1);
  if (command === owner && OWNER[process.argv[3] ?? ""] === undefined) throw new Refusal(`usage: governance.js owner ${Object.keys(OWNER).join(" | ")}`, 1);
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
