// THE DATABASE LAYER against a real PostgreSQL with pgvector: an empty database is brought to the schema, a second start
// changes nothing, a transaction is all or nothing (a nested one rolls back alone), what runs after commit runs only
// after a commit, concurrent writers never share a number, and a database that cannot be reached is an error -- never a
// fallback.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Db, DatabaseUnavailable, jsonParam } from "../../src/infra/db/db.js";
import { migrate, schemaState, SchemaError, verifySchema } from "../../src/infra/db/migrate.js";
import { MIGRATIONS } from "../../src/infra/db/migrations.js";
import { createTestDatabase, type TestDatabase } from "../../src/testing/database.js";

const SEARCH_PATH = ["app", "research", "governance", "public"];
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
    const tables = await db.query("SELECT table_schema || '.' || table_name AS t FROM information_schema.tables WHERE table_schema IN ('app', 'research', 'governance') ORDER BY 1");
    for (const name of ["app.accounts", "app.account_identities", "app.account_sessions", "app.sessions", "app.events", "research.research_chunks", "governance.audit_events", "governance.policy_revisions"]) {
      assert.ok(tables.some((r) => r.t === name), name);
    }
    assert.equal((await verifySchema(db)).version, state.version);
  });

  test("running the migrations again changes nothing", async () => {
    const before = await db.query("SELECT version, checksum, applied_at FROM orbit.schema_migrations ORDER BY version");
    await migrate(db);
    await migrate(db);
    assert.deepEqual(await db.query("SELECT version, checksum, applied_at FROM orbit.schema_migrations ORDER BY version"), before);
  });

  test("a migration whose text changed after it was applied is refused, and so is a database a newer build migrated", async () => {
    const changed = MIGRATIONS.map((m) => ({ ...m, sql: `${m.sql}\n-- edited` }));
    await assert.rejects(migrate(db, changed), (err: unknown) => err instanceof SchemaError && /text changed/.test(err.message));
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
