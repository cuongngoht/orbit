// The STATE reference adapter's one operation (ADR 0035; doc §5.4, §5.5): what a workload left
// BELOW its interface -- the rows one table holds for a key, or for a few columns' values -- read
// back, and answered as how many there are and the first few, as text.
//
// The statement is built HERE, from the table and key column the BINDING names (a declaration the
// system graph holds, never a case's words), each identifier validated and quoted, and every value
// a parameter: a request names values and never a query, so nothing a case or a model writes ever
// becomes SQL. Both statements run in one REPEATABLE READ, READ ONLY transaction the server itself
// enforces, so the count and the rows are one snapshot, and a write is refused by the database.
import { PgError } from "./errors.mjs";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const MAX_ROWS = 50;
const DEFAULT_ROWS = 20;
const MAX_MATCH = 4;
const VALUE_TEXT = 200;
const MARGIN_MS = 250;

const OPS = { read: (asked, deps) => read(asked, deps) };

export const OPERATIONS = Object.keys(OPS);

export async function run(asked, deps) {
  const op = OPS[asked?.op];
  if (!op) return refusal(`this adapter answers ${OPERATIONS.join(", ")} — not ${String(asked?.op).slice(0, 40)}`);
  return op({ ...asked, request: asked.request ?? {}, bound: asked.bound ?? {}, startedAt: deps.now() }, deps).catch((e) => failed(e));
}

const refusal = (message) => ({ failure: { class: "refused", message } });

const failed = (e) => ({ failure: { class: e instanceof PgError ? e.kind : "protocol", message: String(e?.message ?? e).slice(0, 300) } });

async function read(asked, deps) {
  const bound = asked.bound.stateRef ?? {};
  const plan = planOf(bound, asked.request);
  if (plan.refused) return refusal(plan.refused);
  const [counted, sampled] = await deps.readRows(connectionOf(bound, asked, deps), plan.statements, deps);
  return { value: { count: Number(counted.rows[0]?.[0] ?? 0), rows: sampled.rows.map((values) => rowOf(sampled.columns, values)), columns: sampled.columns } };
}

// ── what is read ───────────────────────────────────────────────────────────

const quoted = (ident) => `"${ident}"`;

// A table is `table` or `schema.table`, each part an identifier; anything else is not one this adapter quotes.
function tableOf(name) {
  const parts = String(name ?? "").split(".");
  return parts.length <= 2 && parts.every((p) => IDENT.test(p)) ? parts.map(quoted).join(".") : null;
}

export function planOf(bound, request) {
  const table = tableOf(bound.table);
  const where = whereOf(bound, request);
  if (!table) return { refused: "the bound state names no table this adapter can quote — `table` or `schema.table`, of letters, digits and _" };
  if (where.refused) return where;
  return { statements: [{ sql: `SELECT count(*) FROM ${table} WHERE ${where.sql}`, params: where.params }, { sql: `SELECT * FROM ${table} WHERE ${where.sql} LIMIT ${limitOf(request)}`, params: where.params }] };
}

// The binding's key column equal to `request.key`, and each of `request.match`'s columns equal to its value -- at
// least one, at most a few, never a whole table.
function whereOf(bound, request) {
  const pairs = [...(request.key !== undefined ? [[bound.key, request.key]] : []), ...Object.entries(request.match ?? {})];
  const bad = pairs.find(([column, value]) => !IDENT.test(String(column ?? "")) || !isScalar(value));
  if (!pairs.length || pairs.length > MAX_MATCH) return { refused: `a read below the interface names what it reads: request.key (the bound key column's value) or request.match, ${MAX_MATCH} columns at most — never a whole table` };
  if (bad) return { refused: `${String(bad[0]).slice(0, 63)} is not a column this adapter can quote, or its value is not one text, number or boolean` };
  return { sql: pairs.map(([column], i) => `${quoted(column)} = $${i + 1}`).join(" AND "), params: pairs.map(([, value]) => String(value)) };
}

const isScalar = (v) => ["string", "number", "boolean"].includes(typeof v) && String(v).length <= VALUE_TEXT;

const limitOf = (request) => (Number.isInteger(request.limit) && request.limit >= 1 ? Math.min(request.limit, MAX_ROWS) : DEFAULT_ROWS);

const rowOf = (columns, values) => Object.fromEntries(columns.map((c, i) => [c, values[i] === null ? null : String(values[i]).slice(0, VALUE_TEXT)]));

// ── where, and as whom ─────────────────────────────────────────────────────

// The node the binder resolved, the database its declaration names (the user's own by default), the user and the
// password from the environment under the names the binding gave -- never in the request, never in an answer.
function connectionOf(bound, asked, deps) {
  const user = bound.credential?.userEnv ? deps.env?.[bound.credential.userEnv] : undefined;
  if (!bound.endpoint?.host || !Number.isInteger(bound.endpoint?.port)) throw new PgError("refused", "the bound state names no endpoint to read it at");
  if (!user) throw new PgError("refused", "the bound state names no user to read it as — the database's credential, as its service declares it");
  return { host: bound.endpoint.host, port: bound.endpoint.port, user, password: bound.credential?.passwordEnv ? deps.env?.[bound.credential.passwordEnv] : undefined, database: typeof bound.database === "string" && IDENT.test(bound.database) ? bound.database : undefined, timeoutMs: Math.max(1, (asked.deadlineMs ?? 30_000) - MARGIN_MS) };
}
