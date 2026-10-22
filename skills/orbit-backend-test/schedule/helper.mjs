#!/usr/bin/env node
// The helper behind orbit.schedule.expect: one orbit.helper/v1 request in, one answer line out
// (ADR 0035, 0036). PURE -- it asks no scheduler and reads no clock: the accepted schedule
// contract arrives as the value the run bound `scheduleRef` to, and every instant arrives in the
// request. What it computes is schedule/expect.mjs; `answered` is exported so the suite asks it
// without starting a process.
//
//   request  { ask: "occurrences", from, to, limit? }
//            { ask: "due", evaluatedThrough, since?, limit? }
//            { ask: "missed", lastRun, now, limit? }
//   instants are ISO 8601 with an offset, or milliseconds since the epoch
import { fileURLToPath } from "node:url";
import { answerLine, failureLine, parsedRequest, readAll } from "../../../src/capability/helper-protocol.mjs";
import { due, missed, occurrences } from "./expect.mjs";

const ASKS = {
  occurrences: { needs: ["from", "to"], answer: (c, t, r) => occurrences(c, { fromMs: t.from, toMs: t.to, limit: r.limit }, c.id) },
  due: { needs: ["evaluatedThrough"], answer: (c, t, r) => due(c, t.evaluatedThrough, { sinceMs: t.since, limit: r.limit, scheduleId: c.id }) },
  missed: { needs: ["lastRun", "now"], answer: (c, t, r) => missed(c, t.lastRun, t.now, { limit: r.limit, scheduleId: c.id }) },
};

const INSTANTS = ["from", "to", "evaluatedThrough", "since", "lastRun", "now"];

export function answered(asked) {
  const contract = asked.bound?.scheduleRef;
  const row = ASKS[asked.request?.ask];
  if (asked.op !== "expect" || !row) return refusal(`expect answers ${Object.keys(ASKS).join(", ")} — request.ask says which`);
  if (!contract || typeof contract !== "object") return refusal("no schedule contract is bound: scheduleRef names the accepted schedule this run pinned");
  return computed(row, contract, asked.request);
}

function computed(row, contract, request) {
  const instants = instantsOf(request);
  const missing = row.needs.filter((k) => !Number.isFinite(instants[k]));
  if (missing.length) return refusal(`${request.ask} needs ${missing.join(", ")} as an ISO 8601 instant with an offset, or epoch milliseconds`);
  const out = row.answer(contract, instants, request);
  return out.gap || out.error ? { failure: failureOf(out) } : { value: out };
}

// An instant without an offset is refused, never read in this machine's zone.
const instantsOf = (r) => Object.fromEntries(INSTANTS.filter((k) => r[k] !== undefined).map((k) => [k, instantOf(r[k])]));

const instantOf = (v) => (typeof v === "number" ? v : /(?:Z|[+-]\d{2}:\d{2})$/.test(String(v)) ? Date.parse(String(v)) : NaN);

const refusal = (message) => ({ failure: { class: "refused", message } });

// A dialect nobody registered is a capability gap; any other error is the contract's own.
const failureOf = (out) => (out.gap ? { class: "incomplete", message: out.error ?? "no such dialect", gap: { capability: "orbit.schedule.expect", why: out.error ?? "the contract's dialect is not one this pack evaluates" } } : { class: "refused", message: out.error });

async function main() {
  const parsed = parsedRequest(await readAll(process.stdin));
  const r = parsed.ok ? answered(parsed.request) : refusal(parsed.why);
  process.stdout.write(r.failure ? failureLine(r.failure.class, r.failure.message, r.failure.gap ? { gap: r.failure.gap } : {}) : answerLine(r.value));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => process.stdout.write(failureLine("protocol", `the schedule helper failed — ${e?.message ?? e}`)));
