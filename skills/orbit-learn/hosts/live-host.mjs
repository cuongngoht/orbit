// Orbit Live for a host with NO status line and NO pane API of its own -- Codex CLI, the Antigravity CLI (1.8.6, ADR 0022):
// what `live pane|statusline|doctor --host=<name>` loads, so a drawer, a person's terminal or the docs get the same
// view model Claude Code's pane draws, for this host's session. Host knowledge, so it lives here and never in src/.
//
//   liveHost({ name, hint }) -> { name, sessionOf, room, enabled, PANE_HINTS, doctor }
//
// The session a task of this host carries is the mark of ORBIT_SESSION, which the host's SessionStart binding tells
// the model to set on every Orbit command (hosts/binding.mjs); a drawer may hand a `session_id` instead. Nothing of
// either is stored.
import { effectiveSettings } from "../../../src/host/config.mjs";
import { hostStore } from "../../../src/host/store.mjs";
import { hostSession, taskSessionMark } from "../../../src/memory/session.mjs";
import { stateRooms } from "../../../src/store/control.mjs";
import { surfaceRows } from "./live-surfaces.mjs";

const str = (v) => (typeof v === "string" && v.length > 0 ? v : null);

const sessionMark = (name, json, env) => taskSessionMark(str(env.ORBIT_SESSION) ?? hostSession(name, str(json?.session_id)));

const cwdOf = (json, env) => str(json?.cwd) ?? str(json?.workspacePaths?.[0]) ?? str(env.PWD);

export function liveHost({ name, hint }) {
  const enabled = (env, io, base) => effectiveSettings(env, hostStore(stateRooms(base), io, name).read().settings ?? {}).live !== false;
  const sessionOf = (json, env = {}) => ({ sessionId: str(json?.session_id), cwd: cwdOf(json, env), columns: Number(env.COLUMNS) || null, mark: sessionMark(name, json, env) });
  const doctor = ({ env, io, base, opener }) => [{ name: "live", says: enabled(env, io, base) ? `on for ${name}` : "switched off (host setting `live`, or ORBIT_LIVE)" }, { name: "session", says: str(env.ORBIT_SESSION) ? "bound: this command carries the session's ORBIT_SESSION" : "not bound: run Orbit commands with the ORBIT_SESSION the session start named, or a viewer cannot tell this session's task" }, ...surfaceRows(name, opener)];
  return { name, sessionOf, room: (columns) => Math.max(20, columns ?? 100), enabled, PANE_HINTS: Object.freeze({ inline: hint }), doctor };
}
