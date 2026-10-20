// The LESSON port: the lessons themselves, and the small amount of state the
// tool needs to keep about them.
//
// The split matters. `memory/` is what a person opens -- lessons and the rollups
// rendered from them. `state/` is bookkeeping: the on/off switch, how far each
// evidence source has been read, what has been forgotten, what was last projected.
// State is NEVER projected into Claude Code's memory directory: a tombstone and a
// watermark are not things anyone wants recalled into a conversation.
//
// Two shapes, two rules about damage, and they are opposites on purpose:
//   a lesson is one merged document a human may have touched -- an unreadable one
//     is kept exactly as it is and reported, never rewritten, never dropped;
//   a tombstone or a finding is an independent machine-written line -- a torn one
//     is dropped and the file survives, which is what src/memory/index.mjs does.
// Same principle both times: lose the smallest thing it is safe to lose. What is
// safe to lose differs because the data differs.
import { join } from "node:path";
import { writeAtomic } from "../store/atomic.mjs";
import { BAK } from "../store/atomic.mjs";
import { formatLesson, parseLesson } from "./lesson.mjs";
import { storePaths } from "./store.mjs";

export function createLessons(root, io, opts = {}) {
  const paths = storePaths(root);
  const ctx = { paths, io, envOff: opts.envOff ?? null };
  return { root, paths, host: io.host, ...lessonApi(ctx), ...switchApi(ctx), ...stateApi(ctx), ...logApi(ctx) };
}

const lessonApi = (c) => ({
  all: () => allLessons(c),
  find: (id) => allLessons(c).find((l) => l.id === id) ?? null,
  save: (lesson) => writeAtomic(lessonFile(c, lesson.id), formatLesson(lesson), c.io),
  remove: (id) => removeLesson(c, id),
});

const lessonFile = (c, id) => join(c.paths.lessons, `${id}.md`);

function allLessons(c) {
  const files = c.io.list(c.paths.lessons).filter((n) => n.endsWith(".md"));
  return files.map((n) => oneLesson(c, n)).filter(Boolean);
}

function oneLesson(c, name) {
  const file = join(c.paths.lessons, name);
  const lesson = parseLesson(c.io.read(file), file);
  if (!lesson) c.io.note({ kind: "unreadable-lesson", say: `${name} is not in the shape this tool writes — it is left exactly as it is, and will not be updated` });
  return lesson;
}

// The one write that keeps no backup. A .bak holding the text of a lesson
// somebody asked to forget would defeat the whole point of forgetting it.
function removeLesson(c, id) {
  const file = lessonFile(c, id);
  if (!c.io.exists(file)) return false;
  c.io.removeFile(file);
  c.io.removeFile(`${file}${BAK}`);
  return true;
}

const switchApi = (c) => ({
  auto: () => autoState(c),
  setAuto: (on, why) => writeJson(c, c.paths.switchFile, { v: 1, on, why, at: c.io.now(), by: c.io.host }),
});

// The environment wins over the file, so a CI job can turn learning off for one
// run without editing a machine's state -- and it SAYS which switch was the one
// that stopped it, because "nothing happened" with no reason is the least useful
// thing a tool can print.
function autoState(c) {
  if (c.envOff) return { on: false, why: c.envOff };
  const saved = readJson(c, c.paths.switchFile, null);
  if (saved?.on === false) return { on: false, why: `turned off with \`learn auto off\` on ${saved.at}` };
  return { on: true, why: "auto-learning is on" };
}

const stateApi = (c) => ({
  watermark: () => readJson(c, hostFile(c.paths.watermarks, c.io.host, "json"), null),
  setWatermark: (w) => writeJson(c, hostFile(c.paths.watermarks, c.io.host, "json"), w),
  projection: () => readJson(c, c.paths.projected, null),
  setProjection: (p) => writeJson(c, c.paths.projected, p),
  nativeCache: () => readJson(c, c.paths.native, null),
  setNativeCache: (r) => writeJson(c, c.paths.native, r),
});

const logApi = (c) => ({
  tombstones: () => readLines(c, c.paths.tombstones),
  addTombstone: (t) => addLine(c, c.paths.tombstones, t),
  findings: () => readLines(c, c.paths.findings),
  addFinding: (f) => addLine(c, c.paths.findings, f),
});

const hostFile = (dir, host, ext) => join(dir, `${host}.${ext}`);

const readJson = (c, file, fallback) => jsonOr(c.io.read(file), fallback);

const writeJson = (c, file, value) => writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`, c.io);

const addLine = (c, dir, record) => c.io.append(hostFile(dir, c.io.host, "jsonl"), `${JSON.stringify({ at: c.io.now(), host: c.io.host, ...record })}\n`);

function readLines(c, dir) {
  const files = c.io.list(dir).filter((n) => n.endsWith(".jsonl"));
  return files.flatMap((n) => parsedLines(c.io.read(join(dir, n))));
}

const parsedLines = (text) => String(text ?? "").split("\n").filter(Boolean).map((l) => jsonOr(l, null)).filter(Boolean);

function jsonOr(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}
