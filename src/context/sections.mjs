// PROJECT CONTEXT -- the engine's built-in provider of `project.context` -- as
// a table of what it is composed of, and nothing that runs.
//
//   architecture   `architecture ensure --for=<task>`: memory first. CURRENT
//                  costs a few git calls; a scope the task touches that moved is
//                  a BOUNDED refresh; a capability nobody asked about is a bounded
//                  scan; a stale fact about something unrelated is left alone
//   technology     `intelligence ensure --for=<task>`: which technologies, and what
//                  each is used for -- the same memory-first decision
//   engineering    `engineering recall --for=<task>`: the few facts that bear on
//                  the task, each with how far it may steer the work
//   knowledge      `knowledge claims --for=<task>`: what this project's concepts
//                  have to do with one another IN THE CONTEXT asked, settled per
//                  subject and relation, each with its authority and its
//                  conflicts -- plus what the host's memory hinted (never as
//                  truth) and how many capability opportunities are open. It
//                  QUERIES and never dumps, and it writes nothing
//   work           `work recall --for=<task>`: the work already in progress that the
//                  task is about -- which requirement snapshot it rests on, and the
//                  frontier, so a session told to continue starts where the last one
//                  stopped. It reads the journal and asks no provider
//   working set    what the latest session read, changed and ran (read here)
//   resources      what the resolver chose for the task (src/routing/)
//
// Each section is its own command's own view, clipped to SECTION_LINES, so the
// whole stays bounded however much a project knows; a section whose command
// could not answer says UNKNOWN with its first line, never a guess. There is no
// full-repository scan in any of it: that is what `ensure` exists to avoid.
export const SECTION_LINES = 24;
export const TASK_LIMIT = 500;

export const SECTIONS = [
  { id: "architecture", title: "ARCHITECTURE", argv: (task) => ["cli/architecture.mjs", "ensure", `--for=${task}`] },
  { id: "technology", title: "TECHNOLOGY", argv: (task) => ["cli/intelligence.mjs", "ensure", `--for=${task}`] },
  { id: "engineering", title: "ENGINEERING", argv: (task) => ["cli/engineering.mjs", "recall", `--for=${task}`] },
  { id: "knowledge", title: "KNOWLEDGE", argv: (task) => ["cli/knowledge.mjs", "claims", `--for=${task}`] },
  { id: "work", title: "WORK", argv: (task) => ["cli/work.mjs", "recall", `--for=${task}`] },
];

// A command's answer -> the lines its section shows. `answer` is the Process
// port's: { ok, out, error, status }. A command that exited BLOCKED (3) could not
// answer on this machine at all, which is not the same as having nothing to say,
// and the section says so (`blocked`, read by src/context/status.mjs).
export function sectionOf(section, answer) {
  if (!answer.ok) return { id: section.id, title: section.title, known: false, ...(answer.status === 3 ? { blocked: true } : {}), lines: [`UNKNOWN -- ${String(answer.error ?? "it did not answer").split("\n")[0].slice(0, 200)}`] };
  return { id: section.id, title: section.title, known: true, lines: clipped(String(answer.out ?? "").split("\n").map((l) => l.trimEnd()).filter((l, at, all) => l || all[at - 1])) };
}

function clipped(lines) {
  if (lines.length <= SECTION_LINES) return lines;
  return [...lines.slice(0, SECTION_LINES), `… ${lines.length - SECTION_LINES} more line(s) -- run the command itself for the rest`];
}

export const taskOf = (text) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, TASK_LIMIT);

// The working set, as one section: counted, never listed file by file.
export function workingSetSection(latest, sessions) {
  if (!sessions) return { id: "working-set", title: "WORKING SET", known: false, lines: ["UNKNOWN -- no hook has recorded what a session read or changed in this checkout yet"] };
  return { id: "working-set", title: "WORKING SET", known: true, lines: [`${sessions} session(s) kept here -- the latest read ${latest.read.length} · changed ${latest.changed.length} · ran ${latest.commands.length} command(s)`, ...(latest.scopes.length ? [`scopes it touched: ${latest.scopes.slice(0, 12).join(", ")}`] : [])] };
}
