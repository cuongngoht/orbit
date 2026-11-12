// What a session's CHECKS came to, read off its working-set lines (0.6.0, P1, P5): the last check it ran, and the run of
// the same check failing with nothing changed between -- the facts src/routing/facts.mjs derives `check.failed` and
// `check.repeats` from. A check is a command of a CHECKS class (collect.mjs: test, lint, build), and the same check is
// the same class AND the same bare executable. Pure, a fold of its own beside fold.mjs, which carries its answer.
//
//   last      { class, exe, ok, afterEdit } of the newest check that ended (a background launch never has: the host
//             reports it the moment it starts), `afterEdit` when the session changed something before it
//   repeats   { class, exe, n } while the same check has failed n times in a row with no edit line between; an edit,
//             or that check passing, ends the run. Another command between two failures does not: it changed nothing
//
// It never reads why a check failed -- an exit code is a fact, its output is not this engine's to classify here.
import { CHECKS } from "./collect.mjs";

const START = () => ({ last: null, repeats: null, edited: false });

const sameCheck = (a, b) => Boolean(a && b) && a.class === b.class && a.exe === b.exe;

const isCheck = (line) => line.ev !== "pre-tool" && Boolean(line.cmd) && CHECKS.includes(line.cmd.class) && !line.bg && typeof line.cmd.ok === "boolean";

const runAfter = (repeats, cmd) => (cmd.ok ? null : { class: cmd.class, exe: cmd.exe, n: sameCheck(repeats, cmd) ? repeats.n + 1 : 1 });

const checked = (s, cmd) => ({ ...s, last: { class: cmd.class, exe: cmd.exe, ok: cmd.ok, afterEdit: s.edited }, repeats: runAfter(s.repeats, cmd) });

const edited = (s) => ({ ...s, repeats: null, edited: true });

const step = (s, line) => (line.tool === "edit" ? edited(s) : isCheck(line) ? checked(s, line.cmd) : s);

export function checksOf(lines) {
  const s = (lines ?? []).reduce(step, START());
  return { last: s.last, repeats: s.repeats };
}
