// A tracked work's world on a real disk, on a clock a test moves: the work room, the working sets of any number of sessions, the
// views of the tasks a work links, and a context shaped like the one every composition root builds (cli/track.mjs, cli/live.mjs,
// Orbit Control). Nothing here is a host: a "session" is a file a test writes the lines of, in the shape the hooks keep them, and no
// hook ran -- so a test built on it proves what the ENGINE does with such lines, never that a real host sends them.
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKS } from "../src/engineering/working-set/collect.mjs";
import { sessionActivityOf, sessionLinesOf } from "../src/live/session.mjs";
import { taskSessionMark } from "../src/memory/session.mjs";
import { realIo } from "../src/store/io.mjs";
import { createWorks } from "../src/work/store.mjs";
import { readView, observeOf } from "../src/work/track/read.mjs";
import { workingSetOf } from "../src/work/track/tail.mjs";

export const CHECKOUT = "c".repeat(64);
export const OTHER_CHECKOUT = "d".repeat(64);
export const START = "2026-10-17T09:00:00.000Z";
export const TASK_A = "tsk-aaaaaaaaaaaa";
export const TASK_B = "tsk-bbbbbbbbbbbb";

export function trackWorld(t, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-track-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wsDir = join(dir, "working-set");
  mkdirSync(wsDir, { recursive: true });
  const clock = { at: Date.parse(opts.start ?? START) };
  const now = () => new Date(clock.at).toISOString();
  const works = createWorks(join(dir, "store"), realIo({ host: "laptop-a", now }));
  const tasks = {};
  const world = { dir, wsDir, works, clock, now, tasks };
  world.tick = (seconds = 1) => { clock.at += seconds * 1000; };
  world.ctx = (session = "sess-a", over = {}) => ctxOf(world, session, over);
  world.line = (session, line) => appendFileSync(join(wsDir, `${taskSessionMark(session)}.jsonl`), `${JSON.stringify({ t: now(), ...line })}\n`);
  world.edit = (session, ...paths) => world.line(session, { ev: "post-tool", tool: "edit", paths, call: `e${clock.at}${paths[0]}` });
  world.read = (session, path) => world.line(session, { ev: "post-tool", tool: "read", paths: [path], call: `r${clock.at}${path}` });
  world.run = (session, cls, exe, ok = true) => world.line(session, { ev: ok ? "post-tool" : "post-tool-failure", tool: "command", paths: [], cmd: { class: cls, exe, ok }, call: `c${clock.at}${exe}` });
  world.endSession = (session) => world.line(session, { ev: "session-end" });
  world.task = (id, over = {}) => { tasks[id] = { lifecycle: "EXECUTING", terminal: false, stage: "TESTING", ended: null, ...over }; };
  world.view = (id, session = "sess-a", over = {}) => readView(world.ctx(session, over), id);
  return world;
}

// A context is a moment: ask for a new one after the clock moved.
function ctxOf(world, session, over) {
  const base = { works: world.works, now: world.now, nowMs: world.clock.at, session: session === null ? null : taskSessionMark(session), checkout: CHECKOUT, host: "claude", idleAfterMs: 120_000, workingSet: workingSetOf(realIo(), world.wsDir, "ok"), activity: { linesOf: sessionLinesOf, activityOf: sessionActivityOf, checks: CHECKS }, taskView: (id) => world.tasks[id] ?? null, ...over };
  return { ...base, observe: (id) => observeOf(base, id) };
}
