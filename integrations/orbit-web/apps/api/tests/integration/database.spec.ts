// THE DATABASE LAYER against a real PostgreSQL with pgvector: an empty database is brought to the schema, a second start
// changes nothing, a transaction is all or nothing (a nested one rolls back alone), what runs after commit runs only
// after a commit, concurrent writers never share a number, and a database that cannot be reached is an error -- never a
// fallback.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Db, DatabaseUnavailable, jsonParam } from "../../src/infra/db/db.js";
import { migrate, schemaState, SchemaError, verifySchema } from "../../src/infra/db/migrate.js";
import { MIGRATIONS } from "../../src/infra/db/migrations.js";
import { resetSchemas } from "../../src/infra/db/reset.js";
import { createTestDatabase, type TestDatabase } from "../../src/testing/database.js";

const SEARCH_PATH = ["app", "research", "governance", "workforce", "public"];
// The deployment's own records belong to this reserved account (it never signs in).
const SYSTEM_ACCOUNT = "00000000-0000-4000-8000-000000000001";
const open = (url: string): Db => new Db({ url, poolMax: 8, connectTimeoutMs: 5_000, statementTimeoutMs: 30_000, searchPath: SEARCH_PATH });

describe("an empty PostgreSQL database becomes Orbit Web's", () => {
  let t: TestDatabase;
  let db: Db;
  before(async () => {
    t = await createTestDatabase();
    db = open(t.url);
  });
  after(async () => {
    await db.close();
    await t.drop();
  });

  test("the migrations apply to an empty database, pgvector is enabled, and the schema is verified", async () => {
    const state = await migrate(db);
    assert.equal(state.version, MIGRATIONS.at(-1)?.version);
    assert.equal(state.latest, state.version);
    assert.match(state.vector ?? "", /^\d+\.\d+/);
    const tables = await db.query("SELECT table_schema || '.' || table_name AS t FROM information_schema.tables WHERE table_schema IN ('app', 'research', 'governance', 'workforce') ORDER BY 1");
    for (const name of ["app.accounts", "app.users", "app.account_sessions", "app.ai_connections", "app.sessions", "app.events", "research.research_chunks", "governance.audit_events", "governance.policy_revisions", "workforce.employees", "workforce.assignments", "workforce.reservations", "workforce.runs", "workforce.events"]) {
      assert.ok(tables.some((r) => r.t === name), name);
    }
    // Gone with 0.8.0: the account per Claude identity, and the one identity the CLI held for the whole deployment.
    for (const name of ["app.account_identities", "app.runtime_identity", "app.settings"]) assert.equal(tables.some((r) => r.t === name), false, name);
    assert.equal((await verifySchema(db)).version, state.version);
  });

  test("every table belongs to an Orbit account: account_id uuid NOT NULL, tied by a foreign key toward app.accounts", async () => {
    const tables = await db.query("SELECT table_schema AS s, table_name AS t FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema IN ('app', 'research', 'governance', 'workforce') ORDER BY 1, 2");
    // The two named exceptions: app.accounts (its id IS the OrbitId) and orbit.schema_migrations (not in these schemas).
    const problems: string[] = [];
    for (const { s: schema, t: table } of tables) {
      const name = `${String(schema)}.${String(table)}`;
      if (name === "app.accounts") continue;
      const col = await db.one("SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = 'account_id'", [String(schema), String(table)]);
      if (col === null) {
        problems.push(`${name} has no account_id`);
        continue;
      }
      if (col.data_type !== "uuid" || col.is_nullable !== "NO") problems.push(`${name}.account_id is ${String(col.data_type)} ${col.is_nullable === "NO" ? "NOT NULL" : "nullable"}`);
      const fks = await db.query(
        `SELECT c.confrelid::regclass::text AS target,
                (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS first
         FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid = $1::regclass`,
        [name],
      );
      if (!fks.some((f) => f.first === "account_id")) problems.push(`${name} has no foreign key that starts with account_id`);
    }
    assert.deepEqual(problems, []);
  });

  test("the deployment's own records belong to the reserved system account, which never signs in", async () => {
    const row = await db.one("SELECT kind, status FROM app.accounts WHERE id = $1", [SYSTEM_ACCOUNT]);
    assert.equal(row?.kind, "system");
    const users = await db.one("SELECT count(*) AS n FROM app.users WHERE account_id = $1", [SYSTEM_ACCOUNT]);
    assert.equal(Number(users?.n), 0);
  });

  test("running the migrations again changes nothing", async () => {
    const before = await db.query("SELECT version, checksum, applied_at FROM orbit.schema_migrations ORDER BY version");
    await migrate(db);
    await migrate(db);
    assert.deepEqual(await db.query("SELECT version, checksum, applied_at FROM orbit.schema_migrations ORDER BY version"), before);
  });

  test("a database a development build of 0.8.0 made is refused, with the fresh start to run -- and so is one a newer build migrated", async () => {
    const changed = MIGRATIONS.map((m) => ({ ...m, sql: `${m.sql}\n-- edited` }));
    await assert.rejects(migrate(db, changed), (err: unknown) => err instanceof SchemaError && /development build/.test(err.message) && /db\.js reset --confirm=/.test(err.message));
    await assert.rejects(migrate(db, []), (err: unknown) => err instanceof SchemaError || err instanceof RangeError || err instanceof Error);
  });

  test("pgvector answers: the vector type and cosine distance", async () => {
    const row = await db.one("SELECT '[1,0,0]'::vector <=> '[0,1,0]'::vector AS orthogonal, '[1,2,3]'::vector <=> '[2,4,6]'::vector AS same");
    assert.equal(row?.orthogonal, 1);
    assert.ok(Math.abs(Number(row?.same)) < 1e-9);
  });

  test("a transaction is all or nothing, and a nested one rolls back alone", async () => {
    await db.exec("CREATE TABLE app.tx_probe (k text PRIMARY KEY)");
    await assert.rejects(
      db.tx(async () => {
        await db.query("INSERT INTO tx_probe (k) VALUES ('a')");
        throw new Error("stop");
      }),
      /stop/,
    );
    assert.equal((await db.query("SELECT k FROM tx_probe")).length, 0, "the whole transaction was rolled back");
    await db.tx(async () => {
      await db.query("INSERT INTO tx_probe (k) VALUES ('outer')");
      await assert.rejects(
        db.tx(async () => {
          await db.query("INSERT INTO tx_probe (k) VALUES ('inner')");
          await db.query("INSERT INTO tx_probe (k) VALUES ('inner')");
        }),
      );
      await db.query("INSERT INTO tx_probe (k) VALUES ('after')");
    });
    assert.deepEqual((await db.query("SELECT k FROM tx_probe ORDER BY k")).map((r) => r.k), ["after", "outer"]);
  });

  test("what runs after commit runs only after the commit, and never for work rolled back", async () => {
    const said: string[] = [];
    await db.tx(async () => {
      db.afterCommit(() => said.push("committed"));
      await db.tx(async () => db.afterCommit(() => said.push("inner committed")));
      await assert.rejects(
        db.tx(async () => {
          db.afterCommit(() => said.push("never"));
          throw new Error("inner fails");
        }),
      );
      assert.deepEqual(said, [], "nothing is said before the commit");
    });
    assert.deepEqual(said, ["committed", "inner committed"]);
    await assert.rejects(db.tx(async () => (db.afterCommit(() => said.push("rolled back")), Promise.reject(new Error("no")))));
    assert.equal(said.includes("rolled back"), false);
    // A callback that throws after the commit changes nothing that was committed.
    await db.tx(async () => {
      await db.query("INSERT INTO tx_probe (k) VALUES ('kept')");
      db.afterCommit(() => {
        throw new Error("a subscriber failed");
      });
    });
    assert.equal((await db.query("SELECT k FROM tx_probe WHERE k = 'kept'")).length, 1);
  });

  test("concurrent transactions each hold their own client: no statement goes to another's", async () => {
    await db.exec("CREATE TABLE app.counter_probe (id text PRIMARY KEY, n bigint NOT NULL)");
    await db.query("INSERT INTO counter_probe (id, n) VALUES ('c', 0)");
    const taken = await Promise.all(
      Array.from({ length: 40 }, () =>
        db.tx(async () => {
          const row = await db.one("UPDATE counter_probe SET n = n + 1 WHERE id = 'c' RETURNING n");
          await new Promise((r) => setTimeout(r, Math.random() * 5));
          return Number(row?.n);
        }),
      ),
    );
    assert.deepEqual([...taken].sort((a, b) => a - b), Array.from({ length: 40 }, (_, i) => i + 1), "every number handed out once");
  });

  test("a snapshot read sees one state of the database, whatever commits while it reads, and writes nothing", async () => {
    await db.exec("CREATE TABLE app.snapshot_probe (k text PRIMARY KEY)");
    const other = open(t.url);
    try {
      const seen = await db.snapshot(async () => {
        const before = Number((await db.one("SELECT count(*) AS n FROM app.snapshot_probe"))?.n);
        await other.query("INSERT INTO app.snapshot_probe (k) VALUES ('committed meanwhile')");
        const after = Number((await db.one("SELECT count(*) AS n FROM app.snapshot_probe"))?.n);
        return { before, after };
      });
      assert.deepEqual(seen, { before: 0, after: 0 });
      assert.equal(Number((await db.one("SELECT count(*) AS n FROM app.snapshot_probe"))?.n), 1);
      await assert.rejects(db.snapshot(() => db.query("INSERT INTO app.snapshot_probe (k) VALUES ('x')")), /read-only/);
    } finally {
      await other.close();
    }
  });

  test("a NUL character in a value is stored as U+FFFD, never refused", async () => {
    await db.exec("CREATE TABLE app.nul_probe (t text, j jsonb)");
    await db.query("INSERT INTO nul_probe (t, j) VALUES ($1, $2::jsonb)", ["a\u0000b", jsonParam({ s: "c\u0000d" })]);
    const row = await db.one("SELECT t, j FROM nul_probe");
    assert.equal(row?.t, "a�b");
    assert.deepEqual(row?.j, { s: "c�d" });
  });

  test("times come back as ISO strings and bigints as numbers", async () => {
    const at = "2026-11-21T03:35:00.288Z";
    const row = await db.one("SELECT $1::timestamptz AS at, 9007199254740::bigint AS big", [at]);
    assert.equal(row?.at, at);
    assert.equal(row?.big, 9007199254740);
  });
});

describe("a database that cannot be used is said, never replaced", () => {
  test("a server that does not answer is DatabaseUnavailable", async () => {
    const db = new Db({ url: "postgres://nobody:nothing@127.0.0.1:9/none", poolMax: 1, connectTimeoutMs: 1_000, statementTimeoutMs: 1_000, searchPath: SEARCH_PATH });
    await assert.rejects(db.query("SELECT 1"), (err: unknown) => err instanceof DatabaseUnavailable);
    await assert.rejects(db.tx(async () => undefined), (err: unknown) => err instanceof DatabaseUnavailable);
    await db.close();
  });

  test("an empty database that was never migrated is refused by the schema check", async () => {
    const t = await createTestDatabase();
    const db = open(t.url);
    try {
      assert.equal((await schemaState(db)).version, 0);
      await assert.rejects(verifySchema(db), SchemaError);
    } finally {
      await db.close();
      await t.drop();
    }
  });
});

describe("a fresh start: 0.8.0 is the initial schema, and a database is reset only when it is named", () => {
  test("reset refuses unless --confirm names this very database; named, every Orbit Web table goes and the schema is made again", async () => {
    const t = await createTestDatabase();
    const db = open(t.url);
    try {
      await migrate(db);
      await db.query("INSERT INTO app.accounts (id, kind, display_name, company_name, contact_email, timezone, locale, status, created_at, updated_at) VALUES (gen_random_uuid(), 'customer', 'Probe', '', NULL, 'UTC', 'en', 'active', now(), now())");
      await assert.rejects(resetSchemas(db, null), (err: unknown) => err instanceof SchemaError && err.message.includes(`--confirm=${t.name}`));
      await assert.rejects(resetSchemas(db, "another-database"), SchemaError);
      assert.equal(Number((await db.one("SELECT count(*) AS n FROM app.accounts WHERE kind = 'customer'"))?.n), 1, "a refusal changes nothing");
      assert.deepEqual(await resetSchemas(db, t.name), { database: t.name });
      assert.equal((await schemaState(db)).version, 0);
      const s = await migrate(db);
      assert.equal(s.version, MIGRATIONS.at(-1)?.version);
      assert.equal(Number((await db.one("SELECT count(*) AS n FROM app.accounts WHERE kind = 'customer'"))?.n), 0, "nothing of before is left");
      assert.equal((await db.one("SELECT kind FROM app.accounts WHERE id = $1", [SYSTEM_ACCOUNT]))?.kind, "system");
    } finally {
      await db.close();
      await t.drop();
    }
  });
});
