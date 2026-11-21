// THE DATABASE FROM A TERMINAL: what the control plane's database is, bringing it to this build's schema without
// starting Orbit Web (Orbit Web also migrates by itself at every start), and starting it over. It reads the same
// ORBIT_WEB_DATABASE_URL (or ORBIT_WEB_DATABASE_URL_FILE) as Orbit Web and never prints it.
//
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/db.js status    # schema version, pgvector
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/db.js migrate   # apply what is missing
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/db.js verify    # exit 1 unless it is ready
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/db.js reset --confirm=<database name> [--with-data]
//
// RESET drops every schema of Orbit Web's (app, research, governance, workforce and the migrator's own, orbit) -- every
// account, user, chat, research record, AI connection and audit record -- and migrates again: an empty database at this
// build's schema. It refuses unless --confirm names the database's own name. --with-data also empties Orbit Web's own
// rooms on disk (images and run logs, sessions, workspaces, repositories' copies, research objects, the AI connections'
// homes and keys). Stop Orbit Web first. With Docker, `docker compose down -v` is the same, and more.
//
// Exit codes: 0 done / ready, 1 not ready or refused (said why), 2 a usage or configuration error.
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SEARCH_PATH } from "../core/core.module.js";
import { ConfigError, loadConfig, type DataDirs } from "../config/config.js";
import { Db } from "../infra/db/db.js";
import { migrate, schemaState, verifySchema } from "../infra/db/migrate.js";

// What a reset drops: Orbit Web's schemas (pgvector's `public` stays: the extension is the database's).
export const RESET_SCHEMAS = ["app", "research", "governance", "workforce", "orbit"] as const;

// The rooms on disk that hold what Orbit Web made (never the CLIs' own sign-ins of GitHub and Azure, nor Orbit's store).
export const RESET_ROOMS: readonly (keyof DataDirs)[] = ["app", "sessions", "workspaces", "repos", "research", "connections"];

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

// Empties a room, keeping the room itself (its mode stays the image's).
function empty(dir: string): number {
  let removed = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    rmSync(join(dir, name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

async function reset(db: Db): Promise<number> {
  const name = String((await db.one("SELECT current_database() AS name"))?.name ?? "");
  const confirm = opt("confirm");
  if (confirm !== name) {
    say(`reset refused: it drops every account, user, chat, research record, AI connection and audit record of the database "${name}". Run it again with --confirm=${name} (Orbit Web stopped first).`);
    return 1;
  }
  await db.tx(async () => {
    for (const schema of RESET_SCHEMAS) await db.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  });
  const s = await migrate(db);
  say(`reset: the database "${name}" was emptied and migrated again: schema version ${s.version}, pgvector ${s.vector ?? "missing"}.`);
  if (process.argv.includes("--with-data")) {
    const data = loadConfig(process.env).data;
    const rooms = [...RESET_ROOMS.map((k) => data[k]), join(data.control, "credentials")];
    const removed = rooms.reduce((n, dir) => n + empty(dir), 0);
    say(`reset: ${removed} item(s) removed from Orbit Web's rooms on disk (${rooms.join(", ")}).`);
  }
  return 0;
}

async function main(): Promise<number> {
  const command = process.argv[2] ?? "status";
  if (!["status", "migrate", "verify", "reset"].includes(command)) {
    say("usage: db.js status | migrate | verify | reset --confirm=<database name> [--with-data]");
    return 2;
  }
  const db = new Db({ url: url(), poolMax: 2, connectTimeoutMs: 10_000, statementTimeoutMs: 300_000, searchPath: SEARCH_PATH, applicationName: "orbit-web-cli" });
  try {
    if (command === "reset") return await reset(db);
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
