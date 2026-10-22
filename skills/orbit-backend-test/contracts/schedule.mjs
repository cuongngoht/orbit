// A schedule POLICY, READ (doc §4.3, §5.3): an accepted schedule contract -- dialect, expression, timezone, revision,
// its DST, misfire and overlap policies and its execution deadline -- held to the pack's own schedule engine
// (./../schedule/expect.mjs) and pinned as the binding a scheduler test rests on, with the one expectation the contract
// itself implies once a person names the instant the loop evaluates through: WHICH occurrence is due then, by its id.
// It decides nothing: what a project's loop calls a decision is the project's word, never filled in here, and with no
// instant named no occurrence is assumed.
//
//   scheduleExpects(doc, { at? })
//     -> { ok: true, source, schedule, expects, notes } | { ok: false, findings }
import { canonicalJson, sha } from "../../../src/hash.mjs";
import { check, due } from "../schedule/expect.mjs";
import { dialectOf } from "../schedule/index.mjs";
import { zoneOf } from "../schedule/zone.mjs";

const READ = [
  { id: "NOT_SCHEDULE", when: (x) => typeof x.doc?.dialect !== "string" || typeof x.doc?.expression !== "string", say: () => "this is not a schedule policy (it names no dialect and expression)" },
  { id: "DIALECT", when: (x) => Boolean(dialectOf(x.doc.dialect).gap), say: (x) => `no schedule dialect "${String(x.doc.dialect).slice(0, 30)}" is registered — what is: the pack's dialects` },
  { id: "EXPRESSION", when: (x) => !dialectOf(x.doc.dialect).parse(x.doc.expression).ok, say: (x) => `${String(x.doc.expression).slice(0, 60)}: ${dialectOf(x.doc.dialect).parse(x.doc.expression).error}` },
  { id: "TIMEZONE", when: (x) => typeof x.doc.timezone !== "string" || Boolean(zoneOf(x.doc.timezone).error), say: (x) => `${String(x.doc.timezone ?? "no timezone").slice(0, 60)}: a schedule is read in the zone it names, and this one names none this machine knows` },
  { id: "POLICY", when: (x) => check(x.doc).problems.length > 0, say: (x) => check(x.doc).problems.join("; ") },
  { id: "INSTANT", when: (x) => x.ask.at !== undefined && !Number.isFinite(Date.parse(x.ask.at)), say: (x) => `${String(x.ask.at).slice(0, 40)} is not an instant — ISO 8601 with its offset` },
];

export function scheduleExpects(doc, ask = {}) {
  const x = { doc, ask };
  const stop = READ.find((r) => r.when(x));
  if (stop) return { ok: false, findings: [{ rule: stop.id, say: stop.say(x) }] };
  return { ok: true, source: { kind: "schedule-policy", ref: doc.id ?? null, revision: doc.revision ?? null, digest: sha(canonicalJson(doc)) }, schedule: pinned(doc), ...dueAt(doc, ask.at) };
}

const pinned = (doc) => ({ id: doc.id ?? null, revision: doc.revision ?? null, dialect: doc.dialect, expression: doc.expression, timezone: doc.timezone, dst: doc.dst ?? null, misfire: doc.misfire ?? null, overlap: doc.overlap ?? null, deadlineMs: doc.deadlineMs ?? null, unknowns: check(doc).unknowns });

// The occurrence due at the instant named: the latest one in the day before it, as the pack's own engine computes it.
function dueAt(doc, at) {
  if (at === undefined) return { expects: [], notes: ["name the instant the loop evaluates through (--at=<ISO 8601 with its offset>), and the occurrence due then is computed — none is assumed"] };
  const found = due(doc, Date.parse(at), { scheduleId: doc.id }).occurrences.filter((o) => o.state !== "undecided").at(-1);
  return found ? { expects: [{ id: "E1", property: "occurrence.id", op: "eq", value: found.occurrenceId, because: `${doc.id ?? "schedule"} ${doc.revision ?? ""}: at ${at} the occurrence due is ${found.scheduledFor} (${doc.expression} in ${doc.timezone})`.slice(0, 300) }], notes: found.state === "overdue" ? [`${found.occurrenceId} is already past its execution deadline at ${at}`] : [] } : { expects: [], notes: [`nothing is due in the day before ${at}`] };
}
