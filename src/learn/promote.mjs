// Findings in, lessons out -- and a clear account of everything that did NOT
// become one.
//
// Three gates, in order, and each of them exists because of a specific way a
// store like this rots:
//
//   a tombstone     -- you forgot it, so deriving it again from the same history
//                      tomorrow would make "forget" a button that does nothing;
//   one session     -- an observation is not a lesson, and a store that writes
//                      down every failure is a store nobody reads;
//   an existing id  -- the same subject UPDATES, it never appends a twin. This is
//                      the whole no-duplicates guarantee, and it rests on the id
//                      being the subject rather than the wording.
//
// `firstSeen` is carried over from the lesson already on disk. Re-deriving it
// from the window being analysed would reset the date every time somebody ran
// `analyse --since=`, and a lesson that claims to be new every week is a lesson
// nobody can weigh.
import { gradeOf, worthKeeping } from "./confidence.mjs";
import { lessonId } from "./fingerprint.mjs";
import { priorFrom, suppressed } from "./forget.mjs";
import { makeLesson } from "./lesson.mjs";

export function promote(store, findings, opts = {}) {
  const prior = new Map(store.all().map((l) => [l.id, l]));
  const tombs = store.tombstones();
  const decided = findings.filter((f) => !f.failed).map((f) => decide(f, prior, tombs, opts));
  return opts.dry ? counted(decided, []) : counted(decided, write(store, decided, opts));
}

function decide(f, prior, tombs, opts) {
  const id = lessonId(f);
  const was = prior.get(id) ?? null;
  const tomb = suppressed({ ...f, id }, tombs);
  const graded = gradeOf(f, priorFrom(tombs, id) ?? carried(was), opts.head);
  return { finding: f, id, was, tomb, ...graded, keep: !tomb.yes && worthKeeping(f, graded.state) };
}

const carried = (was) => (was ? { supersededBy: was.supersededBy ?? null } : null);

const write = (store, decided, opts) => decided.filter((d) => d.keep).map((d) => saved(store, d, opts));

function saved(store, d, opts) {
  const lesson = makeLesson(built(d, opts), { now: opts.now, host: store.host });
  store.save(lesson);
  return lesson;
}

function built(d, opts) {
  const f = d.finding;
  const evidence = { sessions: f.sessions ?? [], runs: f.evidenceRuns ?? [], notes: f.evidenceNotes ?? [], missing: f.missing ?? [] };
  const counters = { for: f.for ?? 0, against: f.against ?? 0, hosts: f.hosts ?? 0, runs: f.runs ?? 0, notes: f.notes ?? 0 };
  return { ...f, id: d.id, state: d.state, because: d.because, sessions: f.for ?? 0, counters, evidence, firstSeen: d.was?.firstSeen ?? f.firstSeen, at: opts.now?.() };
}

// What `analyse` prints. A demotion is called out separately because it is the
// one outcome a reader must not miss: something they were told was reliable is
// not any more.
function counted(decided, written) {
  const kept = decided.filter((d) => d.keep);
  return {
    written,
    lessons: kept.length,
    fresh: kept.filter((d) => !d.was).length,
    updated: kept.filter((d) => d.was).length,
    demoted: kept.filter((d) => d.was && d.was.state !== d.state).map(change),
    observations: decided.filter((d) => !d.keep && !d.tomb.yes).map((d) => ({ id: d.id, why: d.because })),
    suppressed: decided.filter((d) => d.tomb.yes).map((d) => ({ id: d.id, why: d.tomb.why })),
    revived: decided.filter((d) => d.tomb.revived).map((d) => ({ id: d.id, why: d.tomb.why })),
  };
}

const change = (d) => ({ id: d.id, from: d.was.state, to: d.state, why: d.because });
