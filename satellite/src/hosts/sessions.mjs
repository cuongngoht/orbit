// WHICH MISSION a host session runs, and which of its agent runs are open: <storeRoot>/satellite/registry/sessions/
// <mark>.json, where <mark> is Orbit's own hashed session mark (src/memory/session.mjs taskSessionMark). A viewer asks it
// to show this session's mission; an observation hook asks it which run a tool call belongs to. It is a convenience
// index of what the journals already say -- rebuilt by every write, never read to decide anything about a mission.
import { join } from "node:path";
import { writeAtomic } from "../../../src/store/atomic.mjs";
import { withLock } from "../../../src/store/lock.mjs";
import { isObject, list, quietly } from "../store/text.mjs";

export const SESSIONS_SCHEMA = 1;

const MARK = /^[a-f0-9]{16}$/;

export const sessionsFile = (rooms, mark) => join(rooms.sessions, `${mark}.json`);

export const readSessions = (io, rooms, mark) => (MARK.test(String(mark ?? "")) ? quietly(() => ((d) => (isObject(d) && d.schema === SESSIONS_SCHEMA ? d : null))(JSON.parse(io.read(sessionsFile(rooms, mark)) ?? "null"))) : null);

const merged = (doc, patch) => ({ schema: SESSIONS_SCHEMA, session: patch.session, missions: [...new Set([...list(doc?.missions), ...(patch.mission ? [patch.mission] : [])])].slice(-20), runs: [...list(doc?.runs).filter((r) => !list(patch.runs).some((p) => p.mission === r.mission && p.agentRunId === r.agentRunId)), ...list(patch.runs)].slice(-200), updatedAt: patch.at });

// A best-effort index: a session with no mark is not indexed, and a failure to write it never fails the mission.
export function noteSession(io, rooms, patch) {
  if (!MARK.test(String(patch.session ?? ""))) return null;
  io.ensureDir(rooms.sessions);
  return quietly(() => withLock(rooms.sessions, () => writeAtomic(sessionsFile(rooms, patch.session), `${JSON.stringify(merged(readSessions(io, rooms, patch.session), patch), null, 2)}\n`, io, false), io));
}
