// The reminder worker. For each delivery, in this order:
//
//   validate        the payload against contracts/asyncapi.json ReminderRequested
//   tenant          the invoice it names belongs to the tenant it names
//   [before-effect]
//   effect          ONE statement: claim the business key in the inbox, and write the reminder
//                   only if this claim was the first -- the dedupe record and the business data
//                   share one consistency boundary
//   [after-commit-before-ack]
//   notify          the sink, with the business key as its Idempotency-Key (on a duplicate too:
//                   a crash after the commit must still end in one notification)
//   [after-sink-before-ack]
//   ack
//
// A delivery that fails is redelivered after a backoff; the MAX_DELIVERIES-th failed delivery is
// dead-lettered with its reason (schema-invalid, tenant-mismatch, dependency-failure). Each
// delivery leaves one row in `attempts`. A [fault point] a test armed fires once, exactly there.
//
// The delivery attempt is the worker's OWN count of how often this logical message (its message
// id; the body's digest when it has none) has reached it, kept in `deliveries`: a broker's
// redelivery marker may be a flag, and a requeue may not be counted at all.
import { createHash } from "node:crypto";
import { config, log } from "./config.mjs";
import { sql } from "./db.mjs";
import { heartbeat, markReady, point } from "./role.mjs";

const keyOf = (d) => d.messageId ?? `body-${createHash("sha256").update(d.body ?? "").digest("hex").slice(0, 32)}`;

async function counted(db, d) {
  const got = await db.query(sql`INSERT INTO deliveries (message_key) VALUES (${keyOf(d)})
    ON CONFLICT (message_key) DO UPDATE SET deliveries = deliveries.deliveries + 1, last_at = clock_timestamp() RETURNING deliveries`);
  return got.rows[0].deliveries;
}

const PAYLOAD_KEYS = ["messageId", "invoiceId", "tenantId", "occurrenceId", "businessKey"];
const MESSAGE_ID = /^msg-[0-9a-f]{16,64}$/;

export function validated(body, scheduleId) {
  let m;
  try {
    m = JSON.parse(Buffer.isBuffer(body) ? body.toString("utf8") : String(body));
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  if (Object.keys(m).some((k) => !PAYLOAD_KEYS.includes(k)) || PAYLOAD_KEYS.some((k) => typeof m[k] !== "string" || !m[k])) return null;
  if (!MESSAGE_ID.test(m.messageId) || !m.occurrenceId.startsWith(`${scheduleId}:`)) return null;
  return m.businessKey === `${m.tenantId}|${m.invoiceId}|${m.occurrenceId}` ? m : null;
}

async function tenantOwns(db, m) {
  const found = await db.query(sql`SELECT 1 AS ok FROM invoices WHERE id = ${m.invoiceId} AND tenant_id = ${m.tenantId}`);
  return found.rows.length > 0;
}

// -> "processed" when this delivery wrote the reminder, "duplicate" when one already existed.
async function effect(db, m) {
  if (config.variant === "no-db-write") return "processed";
  if (config.variant === "no-dedupe") {
    await db.query(sql`INSERT INTO reminders (business_key, tenant_id, invoice_id, occurrence_id, message_id) VALUES (${m.businessKey}, ${m.tenantId}, ${m.invoiceId}, ${m.occurrenceId}, ${m.messageId})`);
    return "processed";
  }
  const made = await db.query(sql`WITH claimed AS (
      INSERT INTO inbox (business_key, message_id) VALUES (${m.businessKey}, ${m.messageId}) ON CONFLICT (business_key) DO NOTHING RETURNING business_key
    )
    INSERT INTO reminders (business_key, tenant_id, invoice_id, occurrence_id, message_id)
    SELECT business_key, ${m.tenantId}, ${m.invoiceId}, ${m.occurrenceId}, ${m.messageId} FROM claimed RETURNING id`);
  return made.rows.length ? "processed" : "duplicate";
}

async function notify(m) {
  try {
    const r = await fetch(`${config.sinkUrl}/notifications`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": m.businessKey, authorization: `Bearer ${config.sinkToken}` },
      body: JSON.stringify({ tenantId: m.tenantId, invoiceId: m.invoiceId, occurrenceId: m.occurrenceId, businessKey: m.businessKey, messageId: m.messageId }),
      signal: AbortSignal.timeout(5000),
    });
    return r.status === 200 || r.status === 201;
  } catch {
    return false;
  }
}

const TERMINAL = new Set(["dead-lettered", "dropped"]);

async function recorded(db, info, outcome, reason) {
  await db.query(sql`INSERT INTO attempts (workload, message_id, business_key, delivery_attempt, outcome, execution_ref, reason)
    VALUES ('worker', ${info.messageId}, ${info.businessKey}, ${info.deliveryAttempt}, ${outcome}, COALESCE(${info.executionRef}, (SELECT execution_ref FROM reminder_requests WHERE business_key = ${info.businessKey})), ${reason})`);
  if (TERMINAL.has(outcome) || outcome === "retry") log("worker", `${outcome} ${info.messageId ?? "(no id)"} attempt ${info.deliveryAttempt}${reason ? `: ${reason}` : ""}`);
}

async function failed(db, d, info, reason, st) {
  if (st.acked) return recorded(db, info, "dropped", reason);
  if (info.deliveryAttempt >= config.maxDeliveries) {
    await d.deadLetter({ reason });
    return recorded(db, info, "dead-lettered", reason);
  }
  await d.retry({ delayMs: config.retryBackoffMs * info.deliveryAttempt });
  return recorded(db, info, "retry", reason);
}

async function handle(db, schedule, d) {
  const st = { acked: false };
  const info = { messageId: d.messageId ?? null, businessKey: null, deliveryAttempt: await counted(db, d), executionRef: d.causationId ?? null };
  if (config.variant === "early-ack") {
    await d.ack();
    st.acked = true;
    await point(db, "worker", "after-ack-before-effect", info);
  }
  const m = validated(d.body, schedule.id);
  if (!m) return failed(db, d, info, "schema-invalid", st);
  info.messageId = m.messageId;
  info.businessKey = m.businessKey;
  if (config.variant !== "no-tenant-check" && !(await tenantOwns(db, m))) return failed(db, d, info, "tenant-mismatch", st);
  await point(db, "worker", "before-effect", info);
  const outcome = await effect(db, m);
  if (!st.acked) await point(db, "worker", "after-commit-before-ack", info);
  if (!(await notify(m))) return failed(db, d, info, "dependency-failure", st);
  if (!st.acked) {
    await point(db, "worker", "after-sink-before-ack", info);
    await d.ack();
  }
  return recorded(db, info, outcome, null);
}

// Something this worker did not expect (its database went away mid-delivery): the delivery is
// handed back for redelivery rather than held unsettled.
async function unexpected(d, e) {
  log("worker", `handling ${d.messageId ?? "a delivery"} failed: ${e.message}`);
  if (!d.settled()) await d.retry({ delayMs: 1000 }).catch(() => {});
}

export async function runWorker(db, transport, schedule) {
  const consumer = await transport.consume((d) => handle(db, schedule, d).catch((e) => unexpected(d, e)));
  await markReady(db, "worker");
  heartbeat(db, "worker");
  return consumer;
}
