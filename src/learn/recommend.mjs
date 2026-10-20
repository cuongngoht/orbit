// What to actually do about a lesson -- with what it would cost, how to check it
// worked, and how to put it back.
//
// A recipe per family, keyed by family and never by verb: `failures` reads
// `failedStep.do` as a value, the way the rest of the engine reads a verb column
// rather than listing verb names.
//
// The ranking is a TUPLE, printed. Confidence, then independent sessions, then
// machines, then effort, then the id to break ties stably. No score, no
// percentage, no decimal -- "0.72" would imply a measurement nobody took, and the
// point of ranking is that a reader can check the order themselves.
//
// A rejected recommendation comes back only on STRICTLY MORE independent sessions
// than it had when it was rejected, and says so when it does. Anything looser and
// "no" means "ask again next week".
import { refuseForbidden } from "./forbidden.mjs";

const STATE_RANK = { validated: 0, stale: 1, candidate: 2 };
const EFFORT_RANK = { "one field in one case file": 0, "one map record": 0, "a case file": 1, "a conversation": 1, unknown: 2 };

const RECIPES = {
  failures: (l) => [
    {
      change: `narrow what step ${stepOf(l)} waits for to the control that actually appears, instead of the one the case names`,
      where: `ui-tests/screens/<screen>/cases/${caseOf(l)}.json, ${stepOf(l)}`,
      expect: `${caseOf(l)} stops failing at the same place on ${machines(l)}`,
      risk: "low — it narrows what the step waits for, so a renamed control fails loudly instead of passing early",
      effort: "one field in one case file",
      verify: `node <engine>/cli/run-case.mjs ${caseOf(l)} — PASS on ${machines(l)}`,
      rollback: "restore the previous wait expression; the ledger keeps both runs either way",
    },
  ],
  drift: (l) => [
    {
      change: `re-observe ${l.about} against the current build and update the map record`,
      where: "ui-tests/graph/",
      expect: "the map says what the UI says again, and cases built on it stop failing for the wrong reason",
      risk: "low — recording what is there cannot break what is there",
      effort: "one map record",
      verify: "node <engine>/cli/query.mjs verify — the record is no longer reported as drifted",
      rollback: "the previous record is in git history",
    },
  ],
  timing: (l) => [
    {
      change: `tell whoever owns ${caseOf(l)} that it got slower, and let them decide whether that is the product or the machine`,
      where: "nobody's code — this is a report, not a change",
      expect: "a person looks at it",
      risk: "none",
      effort: "a conversation",
      verify: "there is nothing to verify; this recommendation changes nothing",
      rollback: "nothing to roll back",
    },
  ],
  recovery: (l) => [
    {
      change: `make ${caseOf(l)} deterministic — find what it is racing, and wait for that instead`,
      where: `ui-tests/screens/<screen>/cases/${caseOf(l)}.json`,
      expect: "the case either passes every time or fails every time, so its verdict means something",
      risk: "medium — until it is found, the case keeps flapping and its PASS should not be trusted",
      effort: "a case file",
      verify: `run ${caseOf(l)} several times on one build; every run agrees`,
      rollback: "restore the previous wait",
    },
  ],
  notes: (l) => [
    {
      change: `fold what people keep writing about ${l.about} into the map, so nobody has to read the notes to know it`,
      where: "ui-tests/graph/",
      expect: "the trap is in the map where a case author will meet it",
      risk: "low",
      effort: "one map record",
      verify: "node <engine>/cli/query.mjs screen — the control carries the note",
      rollback: "the previous record is in git history",
    },
  ],
};

const caseOf = (l) => String(l.about).replace(/^case:/, "");

const stepOf = (l) => (String(l.key).startsWith("step ") ? String(l.key).split(" ").slice(0, 2).join(" ") : "the failing step");

const machines = (l) => (l.scope?.hosts ?? []).join(", ") || "the machines that hit it";

export function recommendationsFor(lesson) {
  const recipe = RECIPES[lesson.family];
  if (!recipe || lesson.kind === "said") return [];
  return refuseForbidden(recipe(lesson).map((r, i) => shaped(r, lesson, i)));
}

// A lesson a PERSON dictated gets no recommendation. It is an instruction, not
// evidence, and a recommendation that cited it would be claiming support the
// lesson does not have.
function shaped(r, lesson, i) {
  const basis = `${lesson.sessions} independent session(s); ${lesson.because}`;
  return { id: `rec--${lesson.id}${i ? `--${i}` : ""}`, lesson: lesson.id, onlyWhen: lesson.applies ?? [], confidence: lesson.state, basis, state: decided(lesson, i), sessions: lesson.sessions ?? 0, hosts: lesson.counters?.hosts ?? 0, ...r };
}

const decided = (lesson, i) => lastDecision(lesson, `rec--${lesson.id}${i ? `--${i}` : ""}`)?.state ?? "open";

const lastDecision = (lesson, id) => [...(lesson.decisions ?? [])].reverse().find((d) => d.rec === id) ?? null;

export const ORDER = [(r) => STATE_RANK[r.confidence] ?? 3, (r) => -r.sessions, (r) => -r.hosts, (r) => EFFORT_RANK[r.effort] ?? 2, (r) => r.id];

export const ORDER_IS = "ranked by confidence, then independent sessions, then machines, then effort — no score, the keys are the reason";

export function ranked(lessons) {
  const all = lessons.flatMap(recommendationsFor).filter((r) => r.state !== "refused");
  const live = all.filter((r) => !hidden(r, lessons));
  return live.sort(byKeys);
}

export const refused = (lessons) => lessons.flatMap(recommendationsFor).filter((r) => r.state === "refused");

function byKeys(a, b) {
  const first = ORDER.map((k) => compare(k(a), k(b))).find(Boolean);
  return first ?? 0;
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Rejected stays rejected until strictly MORE independent sessions than it had
// when a person said no.
function hidden(rec, lessons) {
  const lesson = lessons.find((l) => l.id === rec.lesson);
  const no = [...(lesson?.decisions ?? [])].reverse().find((d) => d.rec === rec.id && d.state === "rejected");
  return Boolean(no) && rec.sessions <= (no.sessionsAt ?? 0);
}

export const revivedNote = (rec, no) => `re-raised: ${rec.sessions} session(s) now, ${no.sessionsAt} when it was rejected on ${String(no.at).slice(0, 10)}`;
