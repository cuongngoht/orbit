// The scheduler: a decision loop over ONE business clock. With CLOCK_INJECTION=live that clock is
// clock_state.now_ms, moved only by the clock hook, and the loop evaluates every instant up to it;
// otherwise it is this machine's time. Each evaluation covers (evaluated_through, now] and is ONE
// transaction: its decisions, the jobs it dispatches and the new evaluated_through commit
// together, so the clock hook's barrier opens only once all of them can be read.
//
// What it decides, per the accepted contract (fire-once misfire, an execution deadline):
//   due                 an occurrence in the window, dispatched now
//   missed              coalesced into a later one, or past its deadline when first evaluated
//   not-due             nothing in the window: names the next occurrence and when it was asked
//   triggered           a manual dispatch (the trigger hook)
//   duplicate-dispatch  an occurrence already dispatched; nothing runs twice
// An execution is one transaction, so two executions of this schedule never overlap and the
// contract's overlap rule never has to skip one.
import { config, log } from "./config.mjs";
import { raw, sql } from "./db.mjs";
import { runJob } from "./job.mjs";
import { heartbeat, markReady } from "./role.mjs";
import { between, loadSchedule, nextOccurrence, occurrenceFromId, occurrenceIdOf } from "./schedule.mjs";

const DAY = 86400000;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const at = (ms) => (ms === null || ms === undefined ? null : raw(`to_timestamp(${ms / 1000})`));

const decisionRow = (schedule, d, evaluatedMs, clock) => sql`INSERT INTO schedule_decisions (schedule, revision, occurrence_id, scheduled_for, decision, reason, execution_ref, evaluated_at, clock)
  VALUES (${schedule.id}, ${schedule.revision}, ${d.occurrenceId ?? null}, ${at(d.ms)}, ${d.decision}, ${d.reason ?? null}, ${d.executionRef ?? null}, ${at(evaluatedMs)}, ${clock});`;

// fire-once: of the occurrences still within their deadline, the latest runs and the earlier
// ones are coalesced into it; an occurrence past its deadline is missed whatever the policy.
export function classify(schedule, instants, nowMs) {
  const late = (t) => nowMs > t + schedule.deadlineMs;
  const fire = instants.filter((t) => !late(t)).at(-1);
  return instants.map((t) => ({ ms: t, occurrenceId: occurrenceIdOf(schedule, t), ...(late(t) ? { decision: "missed", reason: "deadline" } : t === fire ? { fire: true } : { decision: "missed", reason: "coalesced" }) }));
}

async function dispatched(q, schedule, d, trigger) {
  const job = await runJob(q, schedule, { occurrenceId: d.occurrenceId, scheduledForMs: d.ms, trigger });
  const decision = job.duplicate ? "duplicate-dispatch" : trigger === "manual" ? "triggered" : "due";
  return { ...d, decision, executionRef: job.executionRef, reason: job.duplicate ? "already-dispatched" : d.reason };
}

function createLoop(db, schedule) {
  const injected = config.clockInjection === "live";
  const clock = injected ? "injected" : "real";
  const st = { lastNotDue: -Infinity };

  const nowOf = (row) => (injected ? Number(row.now_ms) : Math.floor(Date.now() / 1000) * 1000);

  const wantsNotDue = (registration, realNow) => injected || registration || realNow - st.lastNotDue >= config.notDueEveryMs;

  async function evaluate(registration = false) {
    return db.tx(async (q) => {
      const row = (await q("SELECT now_ms, evaluated_through_ms FROM clock_state WHERE id = 1 FOR UPDATE")).rows[0];
      const now = nowOf(row);
      const through = row.evaluated_through_ms === null ? now : Number(row.evaluated_through_ms);
      if (now < through || (now === through && !registration)) return;
      const decided = classify(schedule, between(schedule, Math.max(through, now - 31 * DAY), now), now);
      const rows = [];
      for (const d of decided) rows.push(d.fire ? await dispatched(q, schedule, d, "schedule") : d);
      if (!rows.length && wantsNotDue(registration, Date.now())) {
        const next = nextOccurrence(schedule, now);
        rows.push({ ms: next, occurrenceId: next === null ? null : occurrenceIdOf(schedule, next), decision: "not-due" });
        st.lastNotDue = Date.now();
      }
      if (rows.length) await q(rows.map((d) => decisionRow(schedule, d, now, clock)).join("\n"));
      await q(sql`UPDATE clock_state SET evaluated_through_ms = ${now}, updated_at = now() WHERE id = 1`);
      for (const d of rows.filter((r) => r.decision !== "not-due")) log("scheduler", `${d.decision} ${d.occurrenceId}${d.executionRef ? ` as ${d.executionRef}` : ""}`);
    });
  }

  // A manual dispatch, asked through trigger_requests by the trigger hook. Without an occurrence
  // id it is the occurrence of the business clock's current second.
  async function trigger(t) {
    return db.tx(async (q) => {
      const row = (await q("SELECT now_ms FROM clock_state WHERE id = 1")).rows[0];
      const now = injected ? Number(row.now_ms) : Date.now();
      const resolved = t.occurrence_id ? occurrenceFromId(schedule, t.occurrence_id) : { ms: Math.floor(now / 1000) * 1000 };
      if (resolved.error) return q(sql`UPDATE trigger_requests SET status = 'failed', error = ${resolved.error}, done_at = clock_timestamp() WHERE id = ${t.id}`);
      const d = await dispatched(q, schedule, { ms: resolved.ms, occurrenceId: occurrenceIdOf(schedule, resolved.ms) }, "manual");
      await q(decisionRow(schedule, d, now, clock));
      log("scheduler", `${d.decision} ${d.occurrenceId} as ${d.executionRef}`);
      return q(sql`UPDATE trigger_requests SET status = 'done', decision = ${d.decision}, execution_ref = ${d.executionRef}, resolved_occurrence_id = ${d.occurrenceId}, scheduled_for_ms = ${d.ms}, done_at = clock_timestamp() WHERE id = ${t.id}`);
    });
  }

  async function triggers() {
    const pending = (await db.query("SELECT id, schedule, occurrence_id FROM trigger_requests WHERE status = 'pending' ORDER BY id LIMIT 10")).rows;
    for (const t of pending) {
      if (t.schedule !== schedule.id) await db.query(sql`UPDATE trigger_requests SET status = 'failed', error = 'unknown-schedule', done_at = clock_timestamp() WHERE id = ${t.id}`);
      else await trigger(t);
    }
  }

  return { evaluate, triggers, tickMs: injected ? 100 : 1000 };
}

export async function runScheduler(db) {
  const schedule = loadSchedule(config.scheduleFile);
  const loop = createLoop(db, schedule);
  await loop.evaluate(true);
  await markReady(db, "scheduler");
  heartbeat(db, "scheduler");
  for (;;) {
    try {
      await loop.triggers();
      await loop.evaluate();
    } catch (e) {
      log("scheduler", `evaluation failed, retrying: ${e.message}`);
    }
    await pause(loop.tickMs);
  }
}
