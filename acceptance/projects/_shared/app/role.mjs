// What every running role shares: saying it is ready, a heartbeat, and the fault points a test may
// arm. A point fires ONCE -- it is disarmed in the same statement that finds it armed -- records
// itself, and then the process exits hard, exactly as a crash at that moment would leave things.
import { FAULT_EXIT, log } from "./config.mjs";
import { sql } from "./db.mjs";

export async function markReady(db, workload) {
  await db.query(sql`UPDATE controls SET actual = 'running', ready_at = clock_timestamp(), heartbeat_at = clock_timestamp(), reason = NULL, updated_at = now() WHERE workload = ${workload}`);
  log(workload, "ready");
}

// A beat also completes a start the supervisor recorded after this role was already ready.
export function heartbeat(db, workload, everyMs = 2000) {
  const beat = () => db.query(sql`UPDATE controls SET heartbeat_at = clock_timestamp(), actual = CASE WHEN actual = 'starting' THEN 'running' ELSE actual END WHERE workload = ${workload}`).catch(() => {});
  return setInterval(beat, everyMs).unref();
}

// `info`: { messageId, businessKey, deliveryAttempt, executionRef } of the delivery being handled.
export async function point(db, workload, name, info = {}) {
  const fired = await db.query(sql`UPDATE faults SET armed = false, fired_at = clock_timestamp() WHERE workload = ${workload} AND point = ${name} AND armed RETURNING point`);
  if (!fired.rows.length) return;
  await db.query(sql`INSERT INTO fault_events (workload, point, message_id, delivery_attempt) VALUES (${workload}, ${name}, ${info.messageId ?? null}, ${info.deliveryAttempt ?? null});
    INSERT INTO attempts (workload, message_id, business_key, delivery_attempt, outcome, execution_ref, reason)
    VALUES (${workload}, ${info.messageId ?? null}, ${info.businessKey ?? null}, ${info.deliveryAttempt ?? 1}, 'fault', ${info.executionRef ?? null}, ${`fault:${name}`});`);
  log(workload, `fault point ${name} fired; exiting`);
  process.exit(FAULT_EXIT);
}

// What to undo on SIGTERM, newest first (a consumer before its connection, both before the
// database), all of it bounded so a stop never hangs.
const cleanups = [];
let stopping = false;

async function stopNow() {
  if (stopping) return;
  stopping = true;
  const undo = (async () => {
    for (const fn of cleanups.reverse()) await fn().catch(() => {});
  })();
  await Promise.race([undo, new Promise((r) => setTimeout(r, 4000))]);
  process.exit(0);
}

export function onStop(fn) {
  if (!cleanups.length) {
    process.on("SIGTERM", stopNow);
    process.on("SIGINT", stopNow);
  }
  cleanups.push(async () => fn());
}
