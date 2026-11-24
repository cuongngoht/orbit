// Bringing a database to the schema this build was written for (migrations.ts), and saying what it is.
//
// One start at a time migrates (a transaction-scoped advisory lock), and what is missing is applied in ONE transaction,
// each migration a savepoint of it: a database is moved to the new schema whole, or not at all. pgvector must be there
// before anything else: it is created when the database role may create it (a superuser, a local database), and
// otherwise named as the step a person takes once -- Orbit Web's own role never needs to be a superuser.
import { createHash } from "node:crypto";
import { Db } from "./db.js";
import { MIGRATIONS, type Migration } from "./migrations.js";

export class SchemaError extends Error {}

const LOCK_KEY = 0x0b17;

const checksum = (m: Migration): string => createHash("sha256").update(m.sql).digest("hex");

// The migrator's own schema (its record of what was applied).
export const MIGRATOR_SCHEMA = "orbit";

// The schemas Orbit Web owns: every one a migration of this build creates, and the migrator's own -- read from the
// migrations themselves, so a schema a later migration adds is one too, with no second list to keep. (pgvector's
// `public` is the database's, never Orbit Web's.)
export function ownedSchemas(migrations: readonly Migration[] = MIGRATIONS): string[] {
  const created = migrations.flatMap((m) => [...m.sql.matchAll(/^\s*CREATE SCHEMA (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)\s*;/gim)].map((x) => (x[1] as string).toLowerCase()));
  return [...new Set([...created, MIGRATOR_SCHEMA])];
}

export interface SchemaState {
  // The highest migration applied, and the highest this build knows.
  version: number;
  latest: number;
  // pgvector's version, or null when it is not enabled.
  vector: string | null;
  server: string;
}

async function vectorVersion(db: Db): Promise<string | null> {
  const row = await db.one("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
  return row === null ? null : String(row.extversion);
}

// pgvector, enabled or explained.
export async function ensureVector(db: Db): Promise<string> {
  const present = await vectorVersion(db);
  if (present !== null) return present;
  try {
    await db.exec("CREATE EXTENSION IF NOT EXISTS vector");
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new SchemaError(`pgvector is not enabled in this database, and Orbit Web's database role may not enable it (${why}). Run once, as a superuser of the database: CREATE EXTENSION vector;`);
  }
  const created = await vectorVersion(db);
  if (created === null) throw new SchemaError("pgvector could not be enabled in this database.");
  return created;
}

async function applied(db: Db): Promise<Map<number, string>> {
  await db.exec(`CREATE SCHEMA IF NOT EXISTS ${MIGRATOR_SCHEMA}; CREATE TABLE IF NOT EXISTS ${MIGRATOR_SCHEMA}.schema_migrations (version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL)`);
  const rows = await db.query("SELECT version, checksum FROM orbit.schema_migrations ORDER BY version");
  return new Map(rows.map((r) => [Number(r.version), String(r.checksum)]));
}

function refuseDrift(done: Map<number, string>, migrations: readonly Migration[]): void {
  const known = new Map(migrations.map((m) => [m.version, m]));
  for (const [version, sum] of done) {
    const m = known.get(version);
    if (m === undefined) throw new SchemaError(`The database was migrated to version ${version}, which this build of Orbit Web does not know: it was written by a newer build. Run that build, or a database of this one.`);
    if (checksum(m) !== sum && version === 1) throw new SchemaError(`This database was created by a development build or release candidate of Orbit Web 0.8.0 (0.8.0-rcNN), whose initial schema differs from this build's. 0.8.0 starts from an empty database and migrates nothing: run \`node dist/cli/db.js reset --confirm=<database name> --with-data\` (Orbit Web stopped), or remove the volumes (docker compose down -v).`);
    if (checksum(m) !== sum) throw new SchemaError(`Migration ${version} (${m.name}) applied to this database is not the one this build carries: its text changed after it was applied.`);
  }
}

async function withLock<T>(db: Db, work: () => Promise<T>): Promise<T> {
  return db.tx(async () => {
    await db.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
    return work();
  });
}

// Applies every migration not yet applied, in order. Returns what the database is now.
export async function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): Promise<SchemaState> {
  const vector = await ensureVector(db);
  await withLock(db, async () => {
    const done = await applied(db);
    refuseDrift(done, migrations);
    for (const m of migrations.filter((x) => !done.has(x.version)).sort((a, b) => a.version - b.version)) {
      await db.tx(async () => {
        await db.exec(m.sql);
        await db.query("INSERT INTO orbit.schema_migrations (version, name, checksum, applied_at) VALUES ($1, $2, $3, $4)", [m.version, m.name, checksum(m), new Date().toISOString()]);
      });
    }
  });
  return { ...(await schemaState(db, migrations)), vector };
}

// What the database is, without changing it.
export async function schemaState(db: Db, migrations: readonly Migration[] = MIGRATIONS): Promise<SchemaState> {
  const latest = Math.max(...migrations.map((m) => m.version));
  const exists = await db.one("SELECT to_regclass('orbit.schema_migrations') AS t");
  const version = exists?.t === null || exists === null ? 0 : Number((await db.one("SELECT COALESCE(MAX(version), 0) AS v FROM orbit.schema_migrations"))?.v ?? 0);
  const server = String((await db.one("SHOW server_version"))?.server_version ?? "unknown");
  return { version, latest, vector: await vectorVersion(db), server };
}

// Refuses to serve a database that is not exactly at this build's schema with pgvector enabled.
export async function verifySchema(db: Db, migrations: readonly Migration[] = MIGRATIONS): Promise<SchemaState> {
  const state = await schemaState(db, migrations);
  if (state.vector === null) throw new SchemaError("pgvector is not enabled in this database. Run once, as a superuser: CREATE EXTENSION vector;");
  if (state.version !== state.latest) throw new SchemaError(`The database schema is at version ${state.version}; this build needs ${state.latest}. Run the migration first.`);
  refuseDrift(await applied(db), migrations);
  return state;
}
