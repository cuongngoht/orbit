// The accepted schedule contract (contracts/schedule.json), read once, and the identities derived
// from it: an occurrence is `<schedule>:<scheduledFor in ISO 8601 with the zone's offset>`, a
// business key is `<tenant>|<invoice>|<occurrence>`, and a message id is derived from the business
// key, so a retry or a redelivery of one logical reminder always carries the same three.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isoAt, isOccurrence, nextAfter, occurrencesBetween, parseCron } from "./cron.mjs";

export function loadSchedule(file) {
  const c = JSON.parse(readFileSync(file, "utf8"));
  if (c.dialect !== "cron5") throw new Error(`schedule ${c.id}: dialect ${c.dialect} is not one this scheduler evaluates`);
  if (c.misfire !== "fire-once") throw new Error(`schedule ${c.id}: misfire ${c.misfire} is not implemented here`);
  return { id: c.id, revision: c.revision, zone: c.timezone, deadlineMs: Number(c.deadlineMs), overlap: c.overlap, spec: parseCron(c.expression) };
}

export const occurrenceIdOf = (schedule, ms) => `${schedule.id}:${isoAt(ms, schedule.zone)}`;

export const between = (schedule, fromMs, toMs, limit) => occurrencesBetween(schedule.spec, schedule.zone, fromMs, toMs, limit);

export const nextOccurrence = (schedule, afterMs) => nextAfter(schedule.spec, schedule.zone, afterMs);

// An occurrence id given by a caller, read back to its instant -- only if it is canonical (the
// zone's own rendering of that instant) and the schedule really fires then.
export function occurrenceFromId(schedule, id) {
  const prefix = `${schedule.id}:`;
  if (typeof id !== "string" || !id.startsWith(prefix)) return { error: "not-an-occurrence" };
  const ms = Date.parse(id.slice(prefix.length));
  if (!Number.isFinite(ms) || occurrenceIdOf(schedule, ms) !== id || !isOccurrence(schedule.spec, schedule.zone, ms)) return { error: "not-an-occurrence" };
  return { ms };
}

export const businessKeyOf = (tenantId, invoiceId, occurrenceId) => `${tenantId}|${invoiceId}|${occurrenceId}`;

export const messageIdOf = (businessKey) => `msg-${createHash("sha256").update(businessKey).digest("hex").slice(0, 32)}`;

export const isoIn = (schedule, ms) => isoAt(ms, schedule.zone);
