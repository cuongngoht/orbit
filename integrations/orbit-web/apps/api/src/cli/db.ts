// THE DATABASE FROM A TERMINAL: what the control plane's database is, bringing it to this build's schema without
// starting Orbit Web (Orbit Web also migrates by itself at every start), and starting it over. It reads the same
// ORBIT_WEB_DATABASE_URL (or ORBIT_WEB_DATABASE_URL_FILE) as Orbit Web and never prints it.
//
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/db.js status    # schema version, pgvector
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/db.js migrate   # apply what is missing
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/db.js verify    # exit 1 unless it is ready
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/db.js reset --confirm=<database name> [--with-data]
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/db.js recover-codex-transcripts [--apply] [--account=<id>] [--session=<id>] [--json]
//
// RESET drops every schema of Orbit Web's (each one its migrations create, and the migrator's own, orbit) -- every
// account, user, chat, research record, AI connection and audit record -- and migrates again: an empty database at this
// build's schema. It refuses unless --confirm names the database's own name. --with-data also empties Orbit Web's own
// rooms on disk (images and run logs, sessions, workspaces, repositories' copies, research objects, the AI connections'
// homes and keys, the office's desks, workspaces and artifacts). Stop Orbit Web first. With Docker, `docker compose down -v` is the same, and more.
//
// Exit codes: 0 done / ready, 1 not ready or refused (said why), 2 a usage or configuration error.
import { readFileSync } from "node:fs";
import { SEARCH_PATH } from "../core/core.module.js";
import { ConfigError, loadConfig } from "../config/config.js";
import { Db } from "../infra/db/db.js";
import { migrate, schemaState, SchemaError, verifySchema } from "../infra/db/migrate.js";
import { emptyRooms, resetSchemas } from "../infra/db/reset.js";
import { assessAndRecoverCodexTranscripts } from "../modules/claude-runner/codex-recovery.js";

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

const opt = (name: string): string | null => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

// The URL Orbit Web reads: ORBIT_WEB_DATABASE_URL, or the file ORBIT_WEB_DATABASE_URL_FILE names.
function url(): string {
  const file = process.env.ORBIT_WEB_DATABASE_URL_FILE;
  const direct = file !== undefined && file !== "" ? readFileSync(file, "utf8").trim() : (process.env.ORBIT_WEB_DATABASE_URL ?? "");
  if (direct === "") throw new ConfigError("ORBIT_WEB_DATABASE_URL is not set");
  return direct;
}

async function reset(db: Db): Promise<number> {
  let name: string;
  try {
    name = (await resetSchemas(db, opt("confirm"))).database;
  } catch (err) {
    if (!(err instanceof SchemaError)) throw err;
    const own = String((await db.one("SELECT current_database() AS name"))?.name ?? "");
    say(`reset refused: it drops every account, user, chat, research record, AI connection, office record and audit record of the database "${own}". Run it again with --confirm=${own} (Orbit Web stopped first).`);
    return 1;
  }
  const s = await migrate(db);
  say(`reset: the database "${name}" was emptied and migrated again: schema version ${s.version}, pgvector ${s.vector ?? "missing"}.`);
  if (process.argv.includes("--with-data")) {
    const emptied = emptyRooms(loadConfig(process.env).data);
    say(`reset: ${emptied.removed} item(s) removed from Orbit Web's rooms on disk (${emptied.rooms.join(", ")}).`);
  }
  return 0;
}

async function recoverCodex(db: Db): Promise<number> {
  const apply = process.argv.includes("--apply");
  const report = await assessAndRecoverCodexTranscripts(db, { apply, accountId: opt("account"), sessionId: opt("session") });
  if (process.argv.includes("--json")) {
    say(JSON.stringify(report, null, 2));
  } else {
    say(`codex-recovery (${apply ? "apply" : "dry-run"}): inspected ${report.inspected} session(s) · clean ${report.clean} · recoverable ${report.recoverable} · recovered ${report.recovered} · manual_review ${report.manualReview} · gaps ${report.totalGaps}`);
    for (const s of report.sessions) {
      if (s.status !== "clean" || s.gaps.length > 0) {
        say(`  ${s.sessionId} [${s.status}] messages ${s.storedMessagesBefore} -> ${s.storedMessagesAfter}, eventsScoped=${s.eventsScoped}, gaps=${s.gaps.length}${s.hasShareSnapshot ? " (has share snapshot)" : ""}`);
        for (const g of s.gaps) say(`    gap [${g.kind}] ${g.detail}`);
      }
    }
  }
  return report.manualReview > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  const command = process.argv[2] ?? "status";
  if (!["status", "migrate", "verify", "reset", "recover-codex-transcripts"].includes(command)) {
    say("usage: db.js status | migrate | verify | reset --confirm=<database name> [--with-data] | recover-codex-transcripts [--apply] [--account=<id>] [--session=<id>] [--json]");
    return 2;
  }
  const db = new Db({ url: url(), poolMax: 2, connectTimeoutMs: 10_000, statementTimeoutMs: 300_000, searchPath: SEARCH_PATH, applicationName: "orbit-web-cli" });
  try {
    if (command === "reset") return await reset(db);
    if (command === "recover-codex-transcripts") return await recoverCodex(db);
    if (command === "migrate") {
      const s = await migrate(db);
      say(`migrated: schema version ${s.version} of ${s.latest}, pgvector ${s.vector ?? "missing"}, PostgreSQL ${s.server}`);
      return 0;
    }
    if (command === "verify") {
      const s = await verifySchema(db);
      say(`ready: schema version ${s.version}, pgvector ${s.vector ?? "missing"}, PostgreSQL ${s.server}`);
      return 0;
    }
    const s = await schemaState(db);
    say(`PostgreSQL ${s.server}`);
    say(`schema version ${s.version} (this build: ${s.latest})${s.version === s.latest ? "" : " -- run: db.js migrate"}`);
    say(`pgvector ${s.vector ?? "NOT enabled -- as a superuser of the database: CREATE EXTENSION vector;"}`);
    return s.version === s.latest && s.vector !== null ? 0 : 1;
  } finally {
    await db.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`db: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(err instanceof ConfigError ? 2 : 1);
  },
);
