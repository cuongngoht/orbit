// What people wrote down, read across sessions rather than one at a time.
//
// `query notes` already prints the notes. Mirroring each one into a lesson would
// be noise with a second copy of the same words in it, so this family only
// produces a finding when reading the notes TOGETHER says something no single
// note does:
//
//   two machines independently wrote about the same thing -- which is the
//     strongest signal a store of remarks can produce, because nobody copied it;
//   a note and the failures agree -- a trap filed against home/Add beside runs
//     that stop at home/Add is the two halves of one fact meeting;
//   a note has gone stale -- the build moved past the commit it was true at.
//
// These findings are `saw`, not `said`: the note is what a person said, and the
// inference OVER several notes is the tool's. A lesson a person dictates comes
// from `learn remember` and stays `said` for good.
import { isStale } from "../../memory/note.mjs";
import { finding, groupBy, plural, runRow } from "./shared.mjs";

const NOTE_MATCHING = "whether a note and a run are really about the same thing — the match is on the `about` key as it was spelled, not on meaning";

export function notes(evidence) {
  const byAbout = groupBy(evidence.notes, (n) => n.about);
  const agreed = [...byAbout].flatMap(([about, group]) => shared(about, group, evidence));
  return [...agreed, ...stale(evidence)];
}

function shared(about, group, evidence) {
  const hosts = [...new Set(group.map((n) => n.host).filter(Boolean))];
  const hits = evidence.runs.filter((r) => r.failedStep?.on === about && r.status === "FAIL");
  if (hosts.length < 2 && !hits.length) return [];
  return [corroborated(about, group, hosts, hits)];
}

function corroborated(about, group, hosts, hits) {
  const machines = hosts.length;
  return finding({
    family: "notes",
    topic: "orbit-ui-feedback",
    about,
    key: "written down and seen in the runs",
    scope: { hosts },
    statement: sentence(about, machines, hits),
    applies: [`anything touching ${about}`],
    notWhen: [],
    for: Math.max(machines, hits.length ? 2 : 1),
    hosts: machines,
    runs: hits.length,
    notes: group.length,
    sessions: hosts.map((h) => `${h}@notes`),
    firstSeen: group.map((n) => n.at).filter(Boolean).sort()[0] ?? null,
    confirmed: group.map((n) => n.at).filter(Boolean).sort().at(-1) ?? null,
    fe_commit: group.at(-1)?.fe_commit ?? null,
    evidenceRuns: hits.map(runRow),
    evidenceNotes: group.map((n) => n.file ?? n.slug),
    missing: [NOTE_MATCHING],
  });
}

const sentence = (about, machines, hits) => (hits.length ? `What was written down about ${about} matches what the runs do: ${plural(hits.length, "run")} stopped there.` : `${plural(machines, "machine")} independently wrote something down about ${about}.`);

// Stale is its own finding because it is the opposite claim: not "this is true"
// but "nobody has checked whether this is still true".
function stale(evidence) {
  const old = evidence.notes.filter((n) => isStale(n, evidence.head));
  return old.map((n) => aged(n, evidence.head));
}

function aged(note, head) {
  return finding({
    family: "notes",
    topic: "orbit-ui-drift",
    about: note.about,
    key: `written at ${note.fe_commit}`,
    scope: {},
    statement: `The note "${note.title}" about ${note.about} was true at frontend ${note.fe_commit}; the frontend is now ${head} and nothing has rechecked it.`,
    applies: [`anything touching ${note.about}`, `frontend ${note.fe_commit}`],
    notWhen: [`frontend ${head}, where it has not been confirmed`],
    for: 2,
    hosts: 1,
    runs: 0,
    notes: 1,
    sessions: [`${note.host}@${String(note.at ?? "").slice(0, 10)}`],
    firstSeen: note.at ?? null,
    confirmed: note.at ?? null,
    fe_commit: note.fe_commit ?? null,
    evidenceNotes: [note.file ?? note.slug],
    missing: ["whether it is still true — only rechecking it can say; being unconfirmed is not the same as being wrong"],
  });
}
