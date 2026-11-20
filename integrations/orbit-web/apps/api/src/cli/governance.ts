// THE INSTALLATION'S OWN TERMINAL for governance: what a person who runs the control plane's container can do when no
// page can -- the first owner without the log's code, an owner's password when every owner is locked out, and a check
// of the audit chain. It works on governance's database directly (the API may be running or not), writes every change
// as an audit record of the principal `system:installation-terminal`, and reads a password from standard input only
// (never an argument, which a process list would show).
//
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js status
//   docker compose exec -T orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js init-owner --username=<u> --organization=<name> < password.txt
//   docker compose exec -T orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js reset-password --username=<u> [--owner] < password.txt
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js verify-audit
//
// It is a door for whoever can already run commands in the control plane's container -- the same person who can read
// its log and its database. In the governed deployment the agent's container has no governance database at all: run
// there, every command finds nothing to change.
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyChain, type AuditEventType } from "@orbit-web/governance-core";
import { GOVERNANCE_LIMITS, isUsername } from "@orbit-web/contracts";
import { loadConfig } from "../config/config.js";
import { GovernanceDatabase } from "../infra/governance/governance-db.js";
import { AuditStore, OperatorStore, sha256 } from "../infra/governance/stores.js";
import { hashPassword } from "../modules/governance/passwords.js";

const TERMINAL = "installation-terminal";

const opt = (name: string): string | null => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(line: string, code = 1): never {
  process.stderr.write(`governance: ${line}\n`);
  process.exit(code);
}

function open(): { database: GovernanceDatabase; operators: OperatorStore; audit: AuditStore } {
  const config = loadConfig(process.env);
  const file = join(config.data.governance, "governance.db");
  if (!existsSync(config.data.governance)) fail(`no governance directory at ${config.data.governance}: this is not Orbit Web's control plane`, 2);
  const database = new GovernanceDatabase(file);
  return { database, operators: new OperatorStore(database), audit: new AuditStore(database) };
}

function record(s: { operators: OperatorStore; audit: AuditStore }, type: AuditEventType, outcome: string, data: Record<string, unknown>): void {
  s.audit.append({
    eventId: `evt-${randomUUID()}`,
    eventType: type,
    occurredAt: new Date().toISOString(),
    organizationId: s.operators.organization()?.id ?? "uninitialized",
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

function passwordFromStdin(): string {
  const text = readFileSync(0, "utf8").replace(/\r?\n$/, "");
  if (text.length < GOVERNANCE_LIMITS.passwordMin || text.length > GOVERNANCE_LIMITS.passwordMax) fail(`the password on standard input must be ${GOVERNANCE_LIMITS.passwordMin}-${GOVERNANCE_LIMITS.passwordMax} characters`);
  return text;
}

function status(): void {
  const s = open();
  const org = s.operators.organization();
  say(org === null ? "governance: no owner yet (start Orbit Web and read its log for the first owner's code, or use init-owner)" : `organization: ${org.name} (${org.id})`);
  for (const o of s.operators.list()) say(`operator ${o.username}: ${o.status}, roles ${o.roles.join(", ") || "none"}`);
  const check = verifyChain(s.audit.all(), sha256);
  say(check.ok ? `audit: ${check.count} record(s), the chain holds, head ${check.head ?? "none"}` : `audit: the chain does NOT hold at record ${check.brokenAt} (${check.problem})`);
  s.database.close();
}

async function initOwner(): Promise<void> {
  const username = opt("username") ?? "";
  const organization = opt("organization") ?? "";
  if (!isUsername(username)) fail("--username must be 2-64 lower-case letters, digits, dots, dashes or underscores");
  if (organization.trim().length === 0 || organization.length > GOVERNANCE_LIMITS.organizationNameLength) fail("--organization must name the organization");
  const hash = await hashPassword(passwordFromStdin());
  const s = open();
  s.database.transaction(() => {
    if (s.operators.organization() !== null) fail("governance already has an owner: use reset-password", 3);
    const at = new Date().toISOString();
    const id = `op-${randomUUID()}`;
    s.operators.createOrganization({ id: `org-${randomBytes(6).toString("hex")}`, name: organization.trim(), createdAt: at });
    s.operators.create({ id, username, displayName: opt("display-name") ?? username, passwordHash: hash, status: "active", createdAt: at, createdBy: TERMINAL, passwordChangedAt: at });
    s.operators.grant(id, "organization_owner", TERMINAL, at);
    record(s, "governance.initialized", "initialized", { organizationName: organization.trim() });
    record(s, "operator.created", "created", { operatorId: id, username, roles: "organization_owner" });
    record(s, "operator.role.granted", "granted", { operatorId: id, role: "organization_owner" });
  });
  s.database.close();
  say(`governance: ${username} is the owner of ${organization.trim()}. Restart Orbit Web if it is running, so that its first-owner code is withdrawn.`);
}

async function resetPassword(): Promise<void> {
  const username = opt("username") ?? "";
  const hash = await hashPassword(passwordFromStdin());
  const s = open();
  s.database.transaction(() => {
    const o = s.operators.byUsername(username);
    if (o === null) fail(`no operator is named ${username}`, 3);
    const at = new Date().toISOString();
    record(s, "operator.recovery.issued", "issued", { operatorId: o.id });
    s.operators.setPassword(o.id, hash, at);
    record(s, "operator.password.changed", "changed", { operatorId: o.id });
    const ended = s.operators.revokeSessions(o.id, at, "recovered");
    if (ended > 0) record(s, "operator.session.revoked", "revoked", { operatorId: o.id, sessions: ended });
    if (o.status !== "active") {
      s.operators.setStatus(o.id, "active");
      record(s, "operator.reinstated", "reinstated", { operatorId: o.id });
    }
    s.operators.clearFailures(username);
    if (flag("owner") && s.operators.grant(o.id, "organization_owner", TERMINAL, at)) record(s, "operator.role.granted", "granted", { operatorId: o.id, role: "organization_owner" });
  });
  s.database.close();
  say(`governance: ${username}'s password was reset and every session of theirs ended${flag("owner") ? "; they own the organization" : ""}.`);
}

function verifyAudit(): void {
  const s = open();
  const check = verifyChain(s.audit.all(), sha256);
  s.database.close();
  if (!check.ok) fail(`the chain does NOT hold at record ${check.brokenAt} (${check.problem}, ${check.eventId})`, 2);
  say(`audit: ${check.count} record(s), the chain holds, head ${check.head ?? "none"}`);
}

const COMMANDS: Record<string, () => void | Promise<void>> = { status, "init-owner": initOwner, "reset-password": resetPassword, "verify-audit": verifyAudit };

const command = COMMANDS[process.argv[2] ?? ""];
if (command === undefined) fail(`usage: governance.js ${Object.keys(COMMANDS).join(" | ")}`);
else await command();
