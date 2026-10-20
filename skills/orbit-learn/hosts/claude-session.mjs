// Claude Code's SESSION ENVIRONMENT: a SessionStart hook is handed CLAUDE_ENV_FILE, and `export` lines appended
// there reach every later Bash command of the session. Orbit appends one: the session mark its own hooks compute
// (`claude:<16 hex>`, src/memory/session.mjs hostSession), so a task a session creates names its session
// (src/task/ops.mjs `created.session`) and a status line can show this session's task and no other's.
//
// Host knowledge, so it lives here, next to the frozen adapter (claude.mjs) rather than in it. Nothing else of the
// session is written: no transcript, no prompt, no path -- one variable, whose value is a hash.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const MARK = /^claude:[0-9a-f]{16}$/;

export const envFileOf = (env) => (typeof env?.CLAUDE_ENV_FILE === "string" && env.CLAUDE_ENV_FILE.length > 0 ? env.CLAUDE_ENV_FILE : null);

export const exportLine = (mark) => (MARK.test(String(mark)) ? `export ORBIT_SESSION='${mark}'` : null);

// Appended once per file: a resumed or compacted session starts again with the same file, and the line is
// already there. An unwritable file costs this session its mark, never the hook.
export function exportedSession(file, mark, fs = { exists: existsSync, read: readFileSync, append: appendFileSync }) {
  const line = exportLine(mark);
  if (!file || !line) return false;
  if (fs.exists(file) && fs.read(file, "utf8").split(/\r?\n/).includes(line)) return true;
  fs.append(file, `${line}\n`);
  return true;
}
