// THE DATABASE FROM A TERMINAL: what the control plane's database is, and bringing it to this build's schema without
// starting Orbit Web (Orbit Web also migrates by itself at every start). It reads the same ORBIT_WEB_DATABASE_URL (or
// ORBIT_WEB_DATABASE_URL_FILE) as Orbit Web and never prints it.
//
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/db.js status    # schema version, pgvector
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/db.js migrate   # apply what is missing
//   docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/db.js verify    # exit 1 unless it is ready
//
// Exit codes: 0 done / ready, 1 not ready or refused (said why), 2 a usage or configuration error.
import { readFileSync } from "node:fs";
import { SEARCH_PATH } from "../core/core.module.js";
import { ConfigError } from "../config/config.js";
import { Db } from "../infra/db/db.js";
import { migrate, schemaState, verifySchema } from "../infra/db/migrate.js";

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

// The URL Orbit Web reads: ORBIT_WEB_DATABASE_URL, or the file ORBIT_WEB_DATABASE_URL_FILE names.
function url(): string {
  const file = process.env.ORBIT_WEB_DATABASE_URL_FILE;
  const direct = file !== undefined && file !== "" ? readFileSync(file, "utf8").trim() : (process.env.ORBIT_WEB_DATABASE_URL ?? "");
  if (direct === "") throw new ConfigError("ORBIT_WEB_DATABASE_URL is not set");
  return direct;
}

async function main(): Promise<number> {
  const command = process.argv[2] ?? "status";
  if (!["status", "migrate", "verify"].includes(command)) {
    say("usage: db.js status | migrate | verify");
    return 2;
  }
  const db = new Db({ url: url(), poolMax: 2, connectTimeoutMs: 10_000, statementTimeoutMs: 300_000, searchPath: SEARCH_PATH, applicationName: "orbit-web-cli" });
  try {
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
