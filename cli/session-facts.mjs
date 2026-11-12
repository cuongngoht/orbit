// WHAT A HOOK KNOWS OF A SESSION'S WORK (0.6.0, P2): the facts src/routing/facts.mjs derives, read for the two hooks
// that use them -- a failed tool call's advice (cli/learn-hook.mjs, src/lifecycle/advice.mjs) and the next prompt's
// decision (cli/router-hook.mjs, `observed`) -- so both derive them from the same reading. Not an entry point: a
// composition helper, loaded by each hook when it needs it and not before.
//
// It reads the session's own working set (one append-only file, src/engineering/working-set/store.mjs) in the checkout
// the machine KNOWS (a host's project root first, then the directory it named), and nothing else: no git, no child
// process, no network, and nothing written. A checkout nobody bound has no working set and no facts.
import { seenOf } from "../src/lifecycle/advice.mjs";
import { sessionOf } from "../src/lifecycle/subscribers/working-set.mjs";
import { createWorkingSet } from "../src/engineering/working-set/store.mjs";
import { loadProject } from "../src/project/index.mjs";
import { knownCheckout } from "../src/project/repository.mjs";
import { workingSetDir } from "../src/project/runtime.mjs";
import { observedOf } from "../src/routing/facts.mjs";
import { realIo } from "../src/store/io.mjs";

function quietly(fn) {
  try { return fn(); }
  catch { return null; }
}

const knownAt = (env, dir) => (dir ? quietly(() => ((p) => (knownCheckout(p) ? p : null))(loadProject(env, dir))) : null);

// The project a session's working set lives with: the host's project root (CLAUDE_PROJECT_DIR) first, as the hook that
// writes it chooses (cli/learn-hook.mjs `sessionWorkingSet`), then the directory the event named.
export const sessionProject = (env, cwd) => knownAt(env, env?.CLAUDE_PROJECT_DIR) ?? knownAt(env, cwd);

// at: { env, cwd, event, io? } -- the session's working-set lines, oldest first, or [] when there is none.
export function sessionLines(at) {
  const io = at.io ?? realIo();
  const project = sessionProject(at.env, at.cwd);
  return project ? createWorkingSet(workingSetDir(project), io).read(sessionOf(at.event, io.host, io.now())) : [];
}

// The facts that hold over a session's lines -- the reading both hooks share.
export const observedIn = (lines) => observedOf(seenOf(lines ?? []));

export const observedHere = (at) => observedIn(sessionLines(at));
