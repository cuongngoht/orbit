// The LEDGER, the NOTES and the EVIDENCE: this subsystem's rooms in the machine
// store (src/project/repository.mjs decides where that store is).
//
// Declared here rather than folded into src/learn/store.mjs, which already owns
// a directory called `memory/` and says why: what rooms the store has is each
// subsystem's own business. Two subsystems writing one directory is how a layout
// stops having an owner, and the first symptom is a lock nobody can explain.
//
// The rooms follow the SHAPE of the writes, not the topic:
//
//   runs/<host>.jsonl   appended, never rewritten, one file per machine -- so two
//                       sessions never touch one line and no lock is needed, and
//                       a read merges every machine's file (index.mjs readRuns).
//   notes/<slug>.md     one file per note, rewritten whole. Markdown, because a
//                       note is the one thing here a person opens.
//   evidence/<id>/      BLOBS: screenshots, network dumps, the run log. The one
//                       room that is disposable -- the report embeds every
//                       picture it shows, so a run's directory stops being the
//                       only copy the moment its report is written. Hence keep().
import { join } from "node:path";
import { contained } from "../project/boundary.mjs";

export const memoryPaths = (root) => ({
  root,
  runs: contained(root, join(root, "runs")),
  notes: contained(root, join(root, "notes")),
  evidence: contained(root, join(root, "evidence")),
});

// WHICH evidence directories to keep, as a pure decision over their names.
//
// A memory that only ever grows is one people delete wholesale, and evidence is
// the room that grows: a directory of screenshots and network dumps per attempt,
// forever. It was survivable while this was `runs/` and everybody read it as
// build output; inside the memory root nobody will clear it.
//
// It is safe to prune because the REPORT is self-contained -- every picture it
// shows is embedded in it, and the case it ran is in it too. So an evidence
// directory stops being the only copy of anything the moment its report exists,
// which is why the pruning happens after the report is written and never during
// a run: deleting what a run is still writing to is how evidence disappears
// mid-investigation.
//
// THREE rules, all of them here, and all of them over data the caller hands
// in -- not predicates threaded through the port. A retention rule is a rule,
// and a port that holds half of one is a port nobody can test the rule in.
//
//   keep the last `n` per CASE       -- counted per case, so a busy case cannot
//                                      evict a quiet one's only run
//   keep the newest UNRESOLVED run   -- "keep the last N" alone throws away the
//                                      one failing run underneath ten green
//                                      re-runs, which is the one being looked at
//   prune only what is RENDERED      -- an evidence directory no report has been
//                                      built from is the ONLY copy of that run.
//                                      Disposable and un-rendered are not the
//                                      same word, and the earlier version
//                                      applied this AFTER deciding, so `keep`
//                                      and what actually survived disagreed.
export function keep(dirs, { n, unresolved = new Set(), rendered = new Set() } = {}) {
  if (!n) return { keep: [...dirs], prune: [] };
  const held = new Set([...perCase(dirs, n), ...newestIn(dirs, unresolved)]);
  const gone = new Set(dirs.filter((d) => !held.has(d) && rendered.has(d)));
  return { keep: dirs.filter((d) => !gone.has(d)), prune: [...gone] };
}

// `<case>-<stamp>`, and the stamp is fixed width, so the case is everything
// before the last six dash-separated numbers.
const STAMP = /-(\d{4}(?:-\d{2}){5})$/;

export const caseOf = (name) => name.replace(STAMP, "");
const stampOf = (name) => STAMP.exec(name)?.[1] ?? "";

const byTime = (a, b) => stampOf(a).localeCompare(stampOf(b));

function perCase(dirs, n) {
  const grouped = new Map();
  for (const d of dirs) grouped.set(caseOf(d), [...(grouped.get(caseOf(d)) ?? []), d]);
  return [...grouped.values()].flatMap((g) => g.sort(byTime).slice(-n));
}

const newestIn = (dirs, names) => dirs.filter((d) => names.has(d)).sort(byTime).slice(-1);
