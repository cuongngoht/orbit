// Whether a PERSON is at the session a command runs in, as each host says it -- asked before anything is opened on
// a screen (`live open` when a workflow starts). One row per host whose mark is verified; a host with no verified
// mark is UNATTENDED, so nothing opens by itself there: a headless run (`claude -p`, `codex exec`, CI) never gets a
// window it did not ask for.
//
//   attendedOf(env, declared = []) -> boolean
// A host with no verified mark (Codex and Antigravity: Codex's shell carries the same variables in an interactive
// session and under `exec`, checked 2026-10-17) is attended only on a PERSON's word: `declared` is the host ids
// they listed in the live settings (`attendedHosts`), matched against the ORBIT_HOST every Orbit command is bound
// to. A verified host is never decided by that list, and no environment variable stands in for it.
// Verified on Claude Code 2.1.296: an interactive session's shell carries CLAUDE_CODE_SESSION_ATTENDED=1, a
// `claude -p` run's carries 0. A host started FROM such a shell (Codex run by a Claude session) inherits the mark,
// and is then taken as attended: the person is at the outer session (seen in the 1.8.3 acceptance pass).
export const ATTENDED = Object.freeze([
  { host: "claude", when: (env) => env.CLAUDECODE === "1", attended: (env) => env.CLAUDE_CODE_SESSION_ATTENDED === "1" },
]);

const declaredBy = (env, declared) => typeof env.ORBIT_HOST === "string" && declared.includes(env.ORBIT_HOST);

export const attendedOf = (env, declared = []) => ATTENDED.find((r) => r.when(env))?.attended(env) ?? declaredBy(env, declared);
