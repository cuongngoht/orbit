// The billing job. It runs inside the scheduler's transaction (`q` is that transaction's query),
// so its dispatch record, every reminder request and every outbox message commit together or
// not at all: an outbox row exists exactly when its request does.
import { sql } from "./db.mjs";
import { businessKeyOf, messageIdOf } from "./schedule.mjs";

export const CHANNEL = "billing.reminder.requested";

function requestOf(inv, occurrenceId, executionRef) {
  const businessKey = businessKeyOf(inv.tenant_id, inv.id, occurrenceId);
  const messageId = messageIdOf(businessKey);
  const payload = { messageId, invoiceId: inv.id, tenantId: inv.tenant_id, occurrenceId, businessKey };
  return sql`INSERT INTO reminder_requests (business_key, tenant_id, invoice_id, occurrence_id, execution_ref, message_id)
    VALUES (${businessKey}, ${inv.tenant_id}, ${inv.id}, ${occurrenceId}, ${executionRef}, ${messageId}) ON CONFLICT (business_key) DO NOTHING;
  INSERT INTO outbox (message_id, channel, payload, business_key, execution_ref)
    VALUES (${messageId}, ${CHANNEL}, ${payload}, ${businessKey}, ${executionRef}) ON CONFLICT (message_id) DO NOTHING;`;
}

// -> { duplicate, executionRef }. An occurrence is dispatched once: asking again answers the
// execution that already ran it.
export async function runJob(q, schedule, { occurrenceId, scheduledForMs, trigger }) {
  const prior = await q(sql`SELECT execution_ref FROM billing_jobs WHERE occurrence_id = ${occurrenceId}`);
  if (prior.rows.length) return { duplicate: true, executionRef: prior.rows[0].execution_ref };
  const id = (await q("SELECT nextval('billing_jobs_seq') AS id")).rows[0].id;
  const executionRef = `job-${id}`;
  await q(sql`INSERT INTO billing_jobs (id, schedule, revision, occurrence_id, scheduled_for, trigger, execution_ref, started_at)
    VALUES (${id}, ${schedule.id}, ${schedule.revision}, ${occurrenceId}, to_timestamp(${scheduledForMs / 1000}), ${trigger}, ${executionRef}, clock_timestamp())`);
  const invoices = (await q("SELECT id, tenant_id FROM invoices WHERE remind AND status = 'open' ORDER BY id")).rows;
  if (invoices.length) await q(invoices.map((inv) => requestOf(inv, occurrenceId, executionRef)).join("\n"));
  await q(sql`UPDATE billing_jobs SET completed_at = clock_timestamp(), requested = ${invoices.length} WHERE id = ${id}`);
  return { duplicate: false, executionRef };
}
