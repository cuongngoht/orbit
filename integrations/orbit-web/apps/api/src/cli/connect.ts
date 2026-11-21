// SIGNING A SUBSCRIPTION CONNECTION IN, in a terminal of the server -- the one way Orbit Web connects a provider's
// subscription: the provider's OWN, unmodified sign-in (`claude auth login --claudeai`, `codex login --device-auth`), run
// in the operator's own terminal (its URL and its code are the CLI's and the person's: they never pass through Orbit's
// pages), with that one connection's config home and nothing else of any account's. Then the CLI is asked, now, whom it
// is signed in as, and the connection's status is written and printed -- `connected` only when the CLI's own status
// names the identity, held to "one identity, one account" (modules/connections/probe.ts).
//
//   docker compose run --rm orbit-connect <connectionId>       (the command Settings → AI Connections shows)
//   node /opt/orbit-web/apps/api/dist/cli/connect.js <connectionId>
//
// Exit codes: 0 connected, 1 not connected (said why) or refused, 2 a usage or configuration error, 3 no such connection.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { AUTH_STATE_TEXT } from "@orbit-web/contracts";
import { ConfigError, loadConfig } from "../config/config.js";
import { ensureDataDirs } from "../config/data-dirs.js";
import { SEARCH_PATH } from "../core/core.module.js";
import { CredentialStore } from "../infra/connections/credentials.js";
import { ConnectionStore, InstallationStore } from "../infra/connections/stores.js";
import { Db } from "../infra/db/db.js";
import { verifySchema } from "../infra/db/migrate.js";
import { AuditStore } from "../infra/governance/stores.js";
import { NodeProcessPort } from "../infra/process/node-process.js";
import { ConnectionProbe } from "../modules/connections/probe.js";
import { RUNTIME_SPECS } from "../modules/connections/runtimes.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class Refusal extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<number> {
  const id = process.argv[2] ?? "";
  if (!UUID.test(id)) throw new Refusal("usage: connect.js <connectionId> -- the connection's id, as Settings → AI Connections shows it in its command", 2);
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    throw new Refusal(err instanceof ConfigError ? err.message : String(err), 2);
  }
  ensureDataDirs(config.data);
  const db = new Db({ url: config.database.url, poolMax: 2, connectTimeoutMs: config.database.connectTimeoutMs, statementTimeoutMs: config.database.statementTimeoutMs, searchPath: SEARCH_PATH, applicationName: "orbit-web-connect" });
  try {
    await verifySchema(db).catch((err: unknown) => {
      throw new Refusal(`the database cannot be used: ${err instanceof Error ? err.message : String(err)}`, 2);
    });
    const connections = new ConnectionStore(db);
    const probe = new ConnectionProbe({ config, process: new NodeProcessPort(), connections, installations: new InstallationStore(db), credentials: new CredentialStore(join(config.data.control, "credentials")) });
    const c = await connections.byId(id);
    if (c === null) throw new Refusal(`no connection ${id}`, 3);
    const spec = RUNTIME_SPECS[c.runtime];
    if (c.method !== "subscription" || spec.login === null) throw new Refusal(`the connection "${c.label}" signs in with ${c.method === "api_key" ? "an API key" : "a cloud provider's credentials"}: it is set up in Settings → AI Connections, not here.`, 1);
    const installation = await probe.installation(c.runtime);
    if (installation.state !== "installed") throw new Refusal(installation.detail ?? `${spec.label} is not installed here.`, 2);
    say(`Signing in ${spec.label} ${installation.version ?? ""} for the connection "${c.label}" -- with ${spec.label}'s own sign-in. Follow what it asks.`);
    say("");
    // The operator's own terminal: the CLI reads and writes it directly, and Orbit Web sees none of it.
    const login = spawnSync(probe.binaryOf(c.runtime), spec.login, { cwd: config.data.home, env: probe.envOf(c), stdio: "inherit" });
    say("");
    if (login.error !== undefined) say(`${spec.label}'s sign-in could not be started: ${login.error.message}`);
    const after = await probe.check(c);
    const audit = new AuditStore(db);
    await audit.append({
      eventId: `evt-${randomUUID()}`,
      eventType: "settings.privileged.changed",
      occurredAt: new Date().toISOString(),
      accountId: c.accountId,
      principalId: "installation-terminal",
      principalType: "system",
      agentId: null,
      workspaceId: null,
      runId: null,
      correlationId: randomUUID(),
      causationId: null,
      policyRevision: null,
      decisionId: null,
      outcome: after.authState,
      reasonCodes: after.reasonCode !== null ? [after.reasonCode] : [],
      evidenceRefs: [],
      data: { setting: `ai_connection.${c.runtime}.subscription.signed_in_from_terminal`, value: `${id}:${after.authState}` },
    });
    if (after.authState === "connected") {
      say(`Connected: ${spec.label} says it is signed in as ${after.identity ?? "(an identity)"}. The page shows it at its next look (Re-check).`);
      return 0;
    }
    say(`Not connected (${AUTH_STATE_TEXT[after.authState]}): ${after.reason ?? `${spec.label} does not say it is signed in.`}`);
    return 1;
  } finally {
    await db.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`connect: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(err instanceof Refusal ? err.code : 1);
  },
);
