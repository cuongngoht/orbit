// The lesson port, in memory. Same names as src/learn/lessons.mjs, nothing on
// disk -- a test that wrote a lesson into a real machine's store would be a test
// that pollutes the machine it runs on, which is the bug test/home.mjs exists to
// prevent.
export function fakeLessons({ lessons = [], tombstones = [], auto = true } = {}) {
  const kept = new Map(lessons.map((l) => [l.id, l]));
  const buried = [...tombstones];
  const state = { auto, projection: null, native: null, watermark: null, findings: [] };
  return { root: "<fake>", host: "laptop-a", paths: { lessons: "<fake>/lessons" }, ...api(kept, buried, state) };
}

const api = (kept, buried, state) => ({
  all: () => [...kept.values()],
  find: (id) => kept.get(id) ?? null,
  save: (l) => saved(kept, l),
  remove: (id) => kept.delete(id),
  tombstones: () => buried,
  addTombstone: (t) => buried.push({ at: "2026-09-20T00:00:00.000Z", ...t }),
  ...control(state),
});

function saved(kept, lesson) {
  kept.set(lesson.id, lesson);
  return `<fake>/lessons/${lesson.id}.md`;
}

const control = (state) => ({
  auto: () => ({ on: state.auto, why: state.auto ? "auto-learning is on" : "turned off in the fake" }),
  setAuto: (on) => (state.auto = on),
  projection: () => state.projection,
  setProjection: (p) => (state.projection = p),
  nativeCache: () => state.native,
  setNativeCache: (r) => (state.native = r),
  watermark: () => state.watermark,
  setWatermark: (w) => (state.watermark = w),
  findings: () => state.findings,
  addFinding: (f) => state.findings.push(f),
});
