// A session's working-set lines → what the session has done, so far.
//
// Pure, and a table: each line kind has one reducer, and a line of a kind
// nobody declared is counted and otherwise ignored. What the fold answers is
// what the rest of the engine asks of a session:
//
//   read / changed / searched / commands   what it touched
//   scopes       the directories that work sits in (depth ≤ 2, the unit
//                src/architecture/analyzers/shape.mjs already calls a module)
//   since        what happened since the observer last looked: which files
//                changed, whether a check passed AFTER the last edit, whether a
//                commit landed -- the facts a milestone is decided from
//   checks       (0.6.0) the last check and the run of one check failing with
//                nothing changed between (checks.mjs)
//   unverified   (0.6.0) the files edited since the last PASSING run that shows the change WORKS (a class of
//                collect.mjs WORKS: a test, never a lint or a build), whoever looked since: what a Stop may still
//                owe (src/lifecycle/subscribers/owed.mjs) -- and `ran`, the commands that passed since the last edit
//                (a class and a bare executable, at most MAX_RAN), so a component's DECLARED verifying check that
//                passed can be told (cli/governed.mjs). `since` resets when the observer looks and is not this
//
// A background launch (`bg`) never counts as a check that passed: the host
// reports it the moment it STARTS, before anything is known.
import { checksOf } from "./checks.mjs";
import { CHECKS, WORKS } from "./collect.mjs";

const fresh = () => ({ changed: [], checked: false, committed: false });

export const EMPTY = () => ({ events: 0, read: [], changed: [], searched: [], commands: [], observes: 0, lastObserve: null, ended: false, truncated: false, since: fresh(), unverified: { changed: [], ran: [] } });

export const MAX_RAN = 16;

const REDUCERS = {
  edit: (s, l) => ({ ...s, changed: [...s.changed, ...l.paths], since: { ...s.since, changed: [...s.since.changed, ...l.paths], checked: false } }),
  read: (s, l) => ({ ...s, read: [...s.read, ...l.paths] }),
  search: (s, l) => ({ ...s, read: [...s.read, ...l.paths], searched: [...s.searched, ...l.tokens] }),
  command: (s, l) => (l.cmd ? { ...s, commands: [...s.commands, l.cmd], since: afterCommand(s.since, l) } : s),
  observe: (s, l) => ({ ...s, observes: s.observes + 1, lastObserve: l.t, since: fresh() }),
  "session-end": (s) => ({ ...s, ended: true }),
  // Orbit Live's moments (collect.mjs): a command STARTING is not a command run, and a turn ending touches nothing.
  "pre-tool": (s) => s,
  "turn-end": (s) => s,
  // 0.2.2: a subagent starting or stopping touches nothing either; what it did arrives on its own lines.
  "agent-start": (s) => s,
  "agent-end": (s) => s,
  truncated: (s) => ({ ...s, truncated: true }),
};

function afterCommand(since, line) {
  const passed = line.cmd.ok && !line.bg;
  const checked = since.checked || (passed && CHECKS.includes(line.cmd.class) && since.changed.length > 0);
  return { ...since, checked, committed: since.committed || (passed && line.cmd.class === "commit") };
}

const kindOf = (line) => (REDUCERS[line.ev] ? line.ev : line.tool);

// What is still unverified: an edit adds its paths and starts `ran` again; a run that PASSED (never a background launch)
// of a class that shows the change works clears them all, and any other that passed is kept in `ran`.
const passedRun = (line) => Boolean(line.cmd?.ok) && !line.bg;

const ranWith = (ran, cmd) => (ran.some((r) => r.class === cmd.class && r.exe === cmd.exe) ? ran : [...ran, { class: cmd.class, exe: cmd.exe ?? "" }].slice(-MAX_RAN));

const afterRun = (u, l) => (WORKS.includes(l.cmd.class) ? { changed: [], ran: [] } : { changed: u.changed, ran: ranWith(u.ran, l.cmd) });

const UNVERIFIED = {
  edit: (u, l) => ({ changed: [...u.changed, ...l.paths], ran: [] }),
  command: (u, l) => (l.cmd && passedRun(l) ? afterRun(u, l) : u),
};

const unverifiedAfter = (acc, l) => (UNVERIFIED[kindOf(l)] ?? ((u) => u))(acc.unverified, l);

export function fold(lines) {
  const s = lines.reduce((acc, l) => ({ ...(REDUCERS[kindOf(l)] ?? ((x) => x))(acc, l), events: acc.events + 1, unverified: unverifiedAfter(acc, l) }), EMPTY());
  return { ...s, read: uniq(s.read), changed: uniq(s.changed), searched: uniq(s.searched), scopes: scopesOf([...s.changed, ...s.read]), since: { ...s.since, changed: uniq(s.since.changed), scopes: scopesOf(s.since.changed) }, unverified: { changed: uniq(s.unverified.changed), ran: s.unverified.ran }, checks: checksOf(lines) };
}

const uniq = (list) => [...new Set(list)];

// The directory each path sits in, at most two levels deep -- the same scopes for a session's edits and for the files
// a finished task changed (src/engineering/observe/task.mjs), so the two can describe one place the same way.
export const scopesOf = (paths) => uniq(paths.map((p) => p.split("/").slice(0, -1).slice(0, 2).join("/")).filter(Boolean));
