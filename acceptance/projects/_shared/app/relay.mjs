// The outbox relay: publishes each committed outbox row through the transport, and marks it
// published only after the broker CONFIRMED it. A confirm that never came leaves the row
// unpublished, so it is published again with the same message id -- at-least-once, which is
// what the consumer's dedupe is for. Every publication carries its logical message id, the
// business key as its correlation id, and the execution that caused it.
import { log } from "./config.mjs";
import { sql } from "./db.mjs";
import { heartbeat, markReady, point } from "./role.mjs";

const POLL_MS = 200;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function publishOne(db, transport, row) {
  const info = { messageId: row.message_id, businessKey: row.business_key, executionRef: row.execution_ref, deliveryAttempt: row.publish_attempts + 1 };
  const sent = await transport.publish({ channel: row.channel, messageId: row.message_id, correlationId: row.business_key, causationId: row.execution_ref, payload: row.payload }).catch((e) => ({ outcome: "unconfirmed", detail: e.message }));
  if (sent.outcome !== "confirmed") {
    await db.query(sql`UPDATE outbox SET publish_attempts = publish_attempts + 1, last_error = ${`${sent.outcome}${sent.detail ? `: ${sent.detail}` : ""}`.slice(0, 300)} WHERE id = ${row.id};
      INSERT INTO attempts (workload, message_id, business_key, delivery_attempt, outcome, execution_ref, reason) VALUES ('relay', ${row.message_id}, ${row.business_key}, ${info.deliveryAttempt}, 'publish-failed', ${row.execution_ref}, ${sent.outcome});`);
    return false;
  }
  await point(db, "relay", "after-confirm-before-mark", info);
  await db.query(sql`UPDATE outbox SET published_at = clock_timestamp(), publish_attempts = publish_attempts + 1, last_error = NULL WHERE id = ${row.id};
    INSERT INTO attempts (workload, message_id, business_key, delivery_attempt, outcome, execution_ref, reason) VALUES ('relay', ${row.message_id}, ${row.business_key}, ${info.deliveryAttempt}, 'published', ${row.execution_ref}, ${sent.duplicate ? "duplicate-publication" : null});`);
  return true;
}

export async function runRelay(db, transport) {
  await markReady(db, "relay");
  heartbeat(db, "relay");
  for (;;) {
    const rows = (await db.query("SELECT id, message_id, channel, payload, business_key, execution_ref, publish_attempts FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT 50")).rows;
    let failed = false;
    for (const row of rows) {
      if (!(await publishOne(db, transport, row))) {
        failed = true;
        break;
      }
    }
    if (failed) log("relay", "a publication was not confirmed; it stays in the outbox");
    await pause(failed ? 1000 : POLL_MS);
  }
}
