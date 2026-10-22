// The synthetic notification sink: it stands for an external system the worker notifies. It is
// idempotent by the Idempotency-Key header in EVERY variant -- an external system's contract is
// not the application's to break -- and it can be read back, so a test can tell "the notification
// was stored and the answer was lost" from "it never arrived".
//
// Both POST and GET /notifications carry `authorization: Bearer <ORBIT_SINK_TOKEN>` or are 401;
// without that secret (or with one shorter than 16 characters) the sink refuses to start. A read
// names the tenant it is about (`?tenant=`), and nothing ever lists across tenants.
import { MIN_SECRET, config, log, secretOk } from "./config.mjs";
import { sql } from "./db.mjs";
import { HttpError, jsonBody, secretGuard, serve } from "./http.mjs";
import { heartbeat, markReady } from "./role.mjs";

const KEY = /^[\x20-\x7e]{1,300}$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

const shown = (r) => ({ key: r.idempotency_key, tenantId: r.tenant_id, invoiceId: r.invoice_id, occurrenceId: r.occurrence_id, receivedAt: r.received_at, lastReceivedAt: r.last_received_at, deliveries: r.deliveries });

const COLUMNS = `idempotency_key, tenant_id, invoice_id, occurrence_id, deliveries,
  to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS received_at,
  to_char(last_received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_received_at`;

async function receive(db, { req }) {
  const key = String(req.headers["idempotency-key"] ?? "");
  if (!KEY.test(key)) throw new HttpError(400, "invalid");
  const body = await jsonBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body) || !NAME.test(String(body.tenantId ?? ""))) throw new HttpError(400, "invalid");
  const text = (v) => (typeof v === "string" ? v : null);
  const stored = await db.query(sql`INSERT INTO sink.notifications (idempotency_key, tenant_id, invoice_id, occurrence_id, body)
    VALUES (${key}, ${body.tenantId}, ${text(body.invoiceId)}, ${text(body.occurrenceId)}, ${body})
    ON CONFLICT (idempotency_key) DO UPDATE SET deliveries = sink.notifications.deliveries + 1, last_received_at = clock_timestamp()
    RETURNING deliveries, (xmax = 0) AS inserted`);
  const row = stored.rows[0];
  return { status: row.inserted ? 201 : 200, body: { key, deliveries: row.deliveries, replayed: !row.inserted } };
}

async function list(db, { url }) {
  const tenant = url.searchParams.get("tenant");
  if (!NAME.test(String(tenant ?? ""))) throw new HttpError(400, "invalid", { why: "a read names its tenant: ?tenant=<id>" });
  const filters = [["key", "idempotency_key"], ["occurrence", "occurrence_id"], ["invoice", "invoice_id"]]
    .filter(([p]) => url.searchParams.has(p))
    .map(([p, col]) => `${col} = ${sql`${url.searchParams.get(p)}`}`);
  const where = [sql`tenant_id = ${tenant}`, ...filters].join(" AND ");
  const found = await db.query(`SELECT ${COLUMNS} FROM sink.notifications WHERE ${where} ORDER BY received_at, idempotency_key LIMIT 500`);
  return { body: { notifications: found.rows.map(shown) } };
}

export const sinkRefusal = () => (secretOk(config.sinkToken) ? null : `the sink refuses to start: ORBIT_SINK_TOKEN is unset or shorter than ${MIN_SECRET} characters`);

export async function runSink(db) {
  const refused = sinkRefusal();
  if (refused) throw new Error(refused);
  const routes = [
    { method: "GET", path: /^\/health$/, open: true, handler: async () => (await db.query("SELECT 1"), { body: { ok: true } }) },
    { method: "POST", path: /^\/notifications$/, handler: (c) => receive(db, c) },
    { method: "GET", path: /^\/notifications$/, handler: (c) => list(db, c) },
  ];
  await serve({ port: config.ports.sink, routes, name: "sink", log, guard: secretGuard(config.sinkToken) });
  await markReady(db, "sink");
  heartbeat(db, "sink");
}
