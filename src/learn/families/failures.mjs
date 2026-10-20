// Which failures keep coming back, and under what conditions.
//
// Grouped on the step the ledger actually records -- `{i, do, on}` -- because
// that is all it records. There is no message. A lesson from this family can say
// WHERE a run stopped and how often and on which machines; it can never say why,
// and every lesson it writes carries that in "Not known" so a reader does not
// assume the tool knew and chose not to mention it.
//
// BLOCKED is grouped apart from FAIL and never becomes "the product is broken".
// A laptop off the VPN is not a defect, and a store that learned otherwise would
// teach the next session to distrust a working product.
import { notesAbout } from "../evidence.mjs";
import { LEDGER_CANNOT } from "../evidence.mjs";
import { byTime, finding, groupBy, plural, runRow, tally } from "./shared.mjs";

const BAD = new Set(["FAIL", "BLOCKED", "INCONCLUSIVE", "REFUSED"]);
const PASSED = new Set(["PASS", "SKIP"]);

export function failures(evidence) {
  const bad = evidence.runs.filter((r) => BAD.has(r.status));
  const groups = groupBy(bad, keyOf);
  return [...groups].map(([key, runs]) => one(key, runs, evidence));
}

const keyOf = (r) => `${r.case}|${r.failedStep ? stepOf(r.failedStep) : `status ${r.status}`}`;

const stepOf = (s) => `step ${s.i} ${s.do}${s.on ? ` ${s.on}` : ""}`;

function one(key, runs, evidence) {
  const [caseId, what] = key.split("|");
  const counted = tally(runs);
  const against = laterPasses(evidence, caseId, counted);
  return shaped({ caseId, what, runs, counted, against, notes: about(evidence, runs) });
}

// A contradiction is not "it passed once" -- it is a session that did the
// opposite AFTER the last one that agreed. Before, and it is simply older news.
function laterPasses(evidence, caseId, counted) {
  const later = evidence.runs.filter((r) => r.case === caseId && PASSED.has(r.status) && String(r.at) > String(counted.confirmed));
  return tally(later);
}

const about = (evidence, runs) => notesAbout(evidence.notes, controlOf(runs));

const controlOf = (runs) => [...runs].sort(byTime).at(-1)?.failedStep?.on ?? null;

function shaped(f) {
  const blocked = f.runs.every((r) => r.status === "BLOCKED");
  return finding({
    family: "failures",
    topic: "orbit-ui-failures",
    about: `case:${f.caseId}`,
    key: f.what,
    scope: { hosts: f.counted.hostNames, control: controlOf(f.runs) },
    statement: sentence(f, blocked),
    applies: [`case ${f.caseId}`, ...commitLine(f.counted), `machines ${f.counted.hostNames.join(", ")}`],
    notWhen: f.against.for ? [`${plural(f.against.for, "later session")} of this case passed on ${f.against.hostNames.join(", ")}`] : [],
    for: f.counted.for,
    against: f.against.for,
    hosts: f.counted.hosts,
    runs: f.counted.runs,
    notes: f.notes.length,
    sessions: f.counted.sessions,
    firstSeen: f.counted.firstSeen,
    confirmed: f.counted.confirmed,
    fe_commit: f.counted.fe_commit,
    evidenceRuns: f.runs.map(runRow),
    evidenceNotes: f.notes.map((n) => n.file ?? n.slug),
    missing: [...LEDGER_CANNOT, ...(blocked ? [BLOCKED_IS] : [])],
  });
}

const BLOCKED_IS = "why it was BLOCKED — that is a precondition nobody could establish, not a product defect, and the reason is in the run log";

const sentence = (f, blocked) => (blocked ? `${f.caseId} keeps being BLOCKED on ${f.counted.hostNames.join(" and ")} — something this machine needs is not there.` : `${f.caseId} stops at ${f.what}, on ${f.counted.hostNames.join(" and ")}.`);

const commitLine = (counted) => (counted.fe_commit ? [`frontend ${counted.fe_commit}`] : []);
