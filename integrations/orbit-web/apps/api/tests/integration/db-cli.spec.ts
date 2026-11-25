// THE DATABASE FROM A TERMINAL (src/cli/db.ts reset): the control plane's database started over -- every schema Orbit
// Web owns dropped and migrated again -- only when --confirm names the database's own name; with --with-data, Orbit
// Web's own rooms on disk are emptied too, and nothing else there.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import type { AuthStatus } from "@orbit-web/contracts";
import { SEARCH_PATH } from "../../src/core/core.module.js";
import { Db } from "../../src/infra/db/db.js";
import { ownedSchemas } from "../../src/infra/db/migrate.js";
import { MIGRATIONS } from "../../src/infra/db/migrations.js";
import type { TestDatabase } from "../../src/testing/database.js";
import { startHarness, type Harness } from "../../src/testing/harness.js";

const CLI = fileURLToPath(new URL("../../src/cli/db.js", import.meta.url));
const LATEST = MIGRATIONS.at(-1)?.version ?? 0;

describe("the schemas a reset drops", () => {
  test("are every one the migrations create, and the migrator's own -- never public", () => {
    const owned = ownedSchemas();
    for (const schema of SEARCH_PATH.filter((s) => s !== "public")) assert.ok(owned.includes(schema), schema);
    assert.ok(owned.includes("orbit"));
    assert.equal(owned.includes("public"), false);
    const later = ownedSchemas([...MIGRATIONS, { version: LATEST + 1, name: "later", sql: "\nCREATE SCHEMA ledger;\nCREATE TABLE ledger.entries (id int);" }]);
    assert.ok(later.includes("ledger"), "a schema a later migration adds is dropped too, with no second list to keep");
  });
});

describe("db.js reset", () => {
  let dataDir: string;
  let database: TestDatabase;
  let db: Db;
  let restarted: Harness | null = null;
  const run = (...args: string[]) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", CLI, "reset", ...args], { env: { PATH: process.env.PATH, ORBIT_WEB_DATA_DIR: dataDir, ORBIT_WEB_DATABASE_URL: database.url }, encoding: "utf8" });
  const count = async (sql: string): Promise<number> => Number((await db.one(sql))?.n ?? -1);

  before(async () => {
    // An account, its user and a connected Claude Code connection -- then Orbit Web stopped, as the reset asks.
    const h = await startHarness();
    dataDir = h.dataDir;
    database = h.database;
    await h.close(true);
    db = new Db({ url: database.url, poolMax: 1, connectTimeoutMs: 10_000, statementTimeoutMs: 60_000, searchPath: SEARCH_PATH, applicationName: "orbit-web-test" });
  });
  after(async () => {
    await db.close();
    if (restarted !== null) return restarted.close();
    rmSync(dataDir, { recursive: true, force: true });
    await database.drop();
  });

  test("refuses unless --confirm names the database's own name, and drops nothing", async () => {
    for (const args of [[], ["--confirm=orbit"], [`--confirm=${database.name}x`], ["--confirm="]]) {
      const r = run(...args);
      assert.equal(r.status, 1, `${args.join(" ")}: ${r.stderr}`);
      assert.match(r.stdout, new RegExp(`^reset refused: .*"${database.name}"\\. Run it again with --confirm=${database.name} `, "m"));
    }
    assert.equal(await count("SELECT count(*)::int AS n FROM users"), 1);
    assert.equal(await count("SELECT count(*)::int AS n FROM ai_connections WHERE removed_at IS NULL"), 1);
  });

  test("with the name: every account, user, connection and audit record gone, migrated again -- and nothing on disk touched", async () => {
    const kept = join(dataDir, "connections", "left-without-with-data");
    writeFileSync(kept, "x");
    const r = run(`--confirm=${database.name}`);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, new RegExp(`^reset: the database "${database.name}" was emptied and migrated again: schema version ${LATEST}, pgvector `, "m"));
    assert.deepEqual(await db.query("SELECT kind FROM accounts"), [{ kind: "system" }], "the deployment's own account, as a fresh install has it");
    for (const table of ["users", "account_sessions", "setup_codes", "ai_connections", "governance.audit_events", "governance.policy_revisions"]) assert.equal(await count(`SELECT count(*)::int AS n FROM ${table}`), 0, table);
    assert.equal(await count("SELECT max(version)::int AS n FROM orbit.schema_migrations"), LATEST);
    assert.ok(existsSync(kept), "without --with-data nothing on disk is touched");
  });

  test("--with-data also empties Orbit Web's own rooms (keeping the rooms), and no other directory", async () => {
    const rooms = ["app", "sessions", "workspaces", "repos", "research", "connections", join("control", "credentials")];
    for (const room of rooms) {
      mkdirSync(join(dataDir, room, "something"), { recursive: true });
      writeFileSync(join(dataDir, room, "something", "file"), "x");
    }
    for (const other of ["github", "azure", "orbit", "home"]) writeFileSync(join(dataDir, other, "kept"), "x");
    const r = run(`--confirm=${database.name}`, "--with-data");
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /^reset: \d+ item\(s\) removed from Orbit Web's rooms on disk/m);
    for (const room of rooms) assert.deepEqual(readdirSync(join(dataDir, room)), [], `${room} emptied, and still there`);
    for (const other of ["github", "azure", "orbit", "home"]) assert.ok(existsSync(join(dataDir, other, "kept")), `${other} is not Orbit Web's to empty`);
  });

  test("Orbit Web starts on the database it left, and asks for its first administrator", async () => {
    restarted = await startHarness({ signIn: false, dataDir, database });
    assert.equal(((await restarted.anonymous.get("/api/auth/status")).body as AuthStatus).state, "setup_required");
  });
});
