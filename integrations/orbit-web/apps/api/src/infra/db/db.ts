// THE DATABASE: one PostgreSQL database behind a bounded pool, reached only through this class. Orbit Web keeps every
// record it manages here (chats, research, accounts, governance); there is no other store and no fallback -- a database
// that cannot be reached is an error said out loud, never a quiet switch to something else.
//
// A TRANSACTION holds ONE client from the pool for its whole life, and every query made while it runs -- however deep
// in the call stack, across any number of awaits -- goes to that client: the transaction travels with the async
// context (AsyncLocalStorage), never in a variable shared by concurrent requests. A transaction begun inside another
// is a SAVEPOINT of it: it rolls back alone, and what it asked to run after commit runs only if everything around it
// commits too.
//
// AFTER COMMIT: a notification that something changed (an event delivered to a stream, an app-stream notice) is said
// only once what it says is committed, and never for work that was rolled back. A callback that fails afterwards is
// logged and changes nothing: the transaction it follows is already committed and is never "rolled back" again.
import { Logger } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";

export type Row = Record<string, unknown>;

// What a query may be given: scalars, a Date, or an array (a PostgreSQL array, for `= ANY($n)`). A JSON value is passed
// as its text (jsonParam) and cast in the statement (`$n::jsonb`).
export type Param = string | number | boolean | null | Date | readonly (string | number | null)[];

export interface DbOptions {
  url: string;
  poolMax: number;
  // How long a caller waits for a free connection, and how long one statement may run.
  connectTimeoutMs: number;
  statementTimeoutMs: number;
  // The schemas unqualified names are looked up in, in order.
  searchPath: readonly string[];
  applicationName?: string;
}

interface Scope {
  client: pg.PoolClient;
  // Callbacks to run once the outermost transaction commits.
  after: (() => unknown)[];
  depth: number;
  // Set when this scope's transaction ended: a query made later from a callback that still carries the context (a
  // timer started inside the transaction) goes to the pool, never to a client that was given back.
  done: boolean;
}

const { types } = pg;
const TIMESTAMPTZ = 1184;
const INT8 = 20;
const NUMERIC = 1700;
const baseTimestamp = types.getTypeParser(TIMESTAMPTZ);

// The shapes the rest of Orbit Web reads: a time as an ISO string (what the contracts carry), a bigint and a numeric as
// a number (sequence numbers and costs stay far below 2^53).
const PARSERS = new Map<number, (value: string) => unknown>([
  [TIMESTAMPTZ, (v) => (baseTimestamp(v) as Date).toISOString()],
  [INT8, (v) => Number(v)],
  [NUMERIC, (v) => Number(v)],
]);

const typeParser = {
  getTypeParser: (oid: number, format?: "text" | "binary") => PARSERS.get(oid) ?? (types.getTypeParser as (o: number, f?: string) => (v: string) => unknown)(oid, format),
};

// PostgreSQL text holds no NUL character: one in a value (a tool's output, a page's text) is replaced, never fatal.
// eslint-disable-next-line no-control-regex -- finding the NUL character is the point
const NUL = /\u0000/g;
const cleanText = (s: string): string => (s.includes("\u0000") ? s.replace(NUL, "�") : s);

function cleanParam(p: Param): unknown {
  if (typeof p === "string") return cleanText(p);
  if (Array.isArray(p)) return p.map((v) => (typeof v === "string" ? cleanText(v) : v));
  return p;
}

// A JSON value as the text of a jsonb parameter, with every string cleaned the same way.
export const jsonParam = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) => (typeof v === "string" ? cleanText(v) : v));

export class DatabaseUnavailable extends Error {}

export class Db {
  private readonly logger = new Logger("Database");
  private readonly pool: pg.Pool;
  private readonly scopes = new AsyncLocalStorage<Scope>();
  private closed = false;

  constructor(readonly options: DbOptions) {
    const settings = [`-c search_path=${options.searchPath.join(",")}`, `-c statement_timeout=${options.statementTimeoutMs}`, "-c idle_in_transaction_session_timeout=60000", "-c timezone=UTC"];
    this.pool = new pg.Pool({
      connectionString: options.url,
      max: options.poolMax,
      connectionTimeoutMillis: options.connectTimeoutMs,
      idleTimeoutMillis: 30_000,
      application_name: options.applicationName ?? "orbit-web",
      options: settings.join(" "),
      types: typeParser,
    });
    // An idle client that dies (the server restarted) is dropped by the pool; the next query gets a new one.
    this.pool.on("error", (err) => this.logger.warn(`an idle database connection ended: ${err.message}`));
  }

  // The rows a statement returns.
  async query(sql: string, params: readonly Param[] = []): Promise<Row[]> {
    return (await this.raw(sql, params)).rows as Row[];
  }

  // The first row, or null.
  async one(sql: string, params: readonly Param[] = []): Promise<Row | null> {
    return ((await this.raw(sql, params)).rows[0] as Row | undefined) ?? null;
  }

  // How many rows a statement changed.
  async run(sql: string, params: readonly Param[] = []): Promise<number> {
    return (await this.raw(sql, params)).rowCount ?? 0;
  }

  // Several statements of one text with no parameter (a migration).
  async exec(sql: string): Promise<void> {
    await this.raw(sql, []);
  }

  inTransaction(): boolean {
    const s = this.scopes.getStore();
    return s !== undefined && !s.done;
  }

  // Runs `work` in a transaction: committed when it resolves, rolled back when it throws. Inside another transaction it
  // is a savepoint of that one.
  async tx<T>(work: () => Promise<T>): Promise<T> {
    const outer = this.scopes.getStore();
    if (outer !== undefined && !outer.done) return this.savepoint(outer, work);
    return this.transaction("BEGIN", work);
  }

  // A read of several statements that must agree with one another (a page made of a record and its parts): ONE snapshot
  // of the database, read-only. Inside a transaction, that transaction's.
  async snapshot<T>(work: () => Promise<T>): Promise<T> {
    const outer = this.scopes.getStore();
    if (outer !== undefined && !outer.done) return work();
    return this.transaction("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", work);
  }

  private async transaction<T>(begin: string, work: () => Promise<T>): Promise<T> {
    if (this.closed) throw new DatabaseUnavailable("the database is closed");
    const client = await this.connect();
    const scope: Scope = { client, after: [], depth: 0, done: false };
    let result: T;
    try {
      await client.query(begin);
      result = await this.scopes.run(scope, work);
      await client.query("COMMIT");
    } catch (err) {
      scope.done = true;
      const rolledBack = await client.query("ROLLBACK").then(
        () => true,
        () => false,
      );
      client.release(rolledBack ? undefined : true);
      throw err;
    }
    scope.done = true;
    client.release();
    this.flush(scope.after);
    return result;
  }

  // `work` runs once the transaction this call is made in commits -- at once outside one; never if it rolls back.
  afterCommit(work: () => unknown): void {
    const scope = this.scopes.getStore();
    if (scope === undefined || scope.done) return this.flush([work]);
    scope.after.push(work);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }

  isClosed(): boolean {
    return this.closed;
  }

  private async savepoint<T>(outer: Scope, work: () => Promise<T>): Promise<T> {
    const name = `sp_${outer.depth + 1}`;
    const inner: Scope = { client: outer.client, after: [], depth: outer.depth + 1, done: false };
    await outer.client.query(`SAVEPOINT ${name}`);
    try {
      const result = await this.scopes.run(inner, work);
      await outer.client.query(`RELEASE SAVEPOINT ${name}`);
      inner.done = true;
      outer.after.push(...inner.after);
      return result;
    } catch (err) {
      inner.done = true;
      await outer.client.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => undefined);
      throw err;
    }
  }

  private async raw(sql: string, params: readonly Param[]): Promise<pg.QueryResult> {
    const scope = this.scopes.getStore();
    const values = params.map(cleanParam);
    if (scope !== undefined && !scope.done) return scope.client.query(sql, values);
    if (this.closed) throw new DatabaseUnavailable("the database is closed");
    try {
      return await this.pool.query(sql, values);
    } catch (err) {
      throw unavailable(err);
    }
  }

  private async connect(): Promise<pg.PoolClient> {
    try {
      return await this.pool.connect();
    } catch (err) {
      throw unavailable(err);
    }
  }

  private flush(after: readonly (() => unknown)[]): void {
    // Outside the transaction's context: what a callback does is never part of it.
    this.scopes.exit(() => {
      for (const work of after) {
        try {
          const r = work();
          if (r instanceof Promise) r.catch((err: unknown) => this.logger.error(`after commit: ${message(err)}`));
        } catch (err) {
          this.logger.error(`after commit: ${message(err)}`);
        }
      }
    });
  }
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// A connection-level failure (refused, timed out, authentication) is the database being unavailable; a statement the
// server refused (a constraint, a trigger) is that statement's error and passes through as it is.
function unavailable(err: unknown): unknown {
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && /^(08|28|3D|57P0)/.test(code)) return new DatabaseUnavailable(`the database refused the connection (${code}): ${message(err)}`);
  if (typeof code === "string" && /^(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET)$/.test(code)) return new DatabaseUnavailable(`the database could not be reached (${code})`);
  if (err instanceof Error && /timeout exceeded when trying to connect|Connection terminated/i.test(err.message)) return new DatabaseUnavailable(`the database could not be reached: ${err.message}`);
  return err;
}

// PostgreSQL's code for a unique violation, and for a check or trigger that refused a row.
export const UNIQUE_VIOLATION = "23505";
export const RAISED = "P0001";

export const pgCode = (err: unknown): string | null => {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
};
