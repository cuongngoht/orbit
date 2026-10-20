// A Process port that runs nothing. Every invocation is recorded so a test can
// assert WHAT would have been spawned -- which is the interesting half, because
// the thing most worth proving about generated QC code is that a value reached
// the child as one argv element and not as a second command.
//
// `answers[file]` is the answer for that command: an object, or a function of
// (args, opts) for a test that must answer by what was asked. runAsync() gives
// the same answers as run(), as a promise, the way the real port does.
//
// 1.7.6 adds the half that outlives its caller. `launch` hands out pids from
// `world.firstPid`, remembers when each started and keeps it alive until it is
// signalled; `alive`, `signal` and `startedAtOf` answer from that table, and
// `state.alive` is the table a test edits to describe what a real machine does
// that a port cannot be told: a pid REUSED by another process (`reuse`), one
// that was there before Orbit (`adopt`), one that ignores SIGTERM (`stubborn`).
//
// 1.8.5 adds `runObserved`: run()'s answer, with the output handed to `opts.observe(stream, bytes)` first, chunk by
// chunk -- as the answer's own `chunks` say ([[stream, text], …], which a test uses to split a line, a character or a
// secret across two chunks), else its `out` and `err` as one chunk each. An observer that throws is let go and the
// answer says `observerFailed`, as the real port's does.
export function fakeProcess(answers = {}, world = {}) {
  const calls = [];
  const run = (file, args = [], opts = {}) => {
    calls.push({ file, args, opts });
    return answerOf(answers[file], args, opts);
  };
  return { calls, run, runAsync: async (file, args = [], opts = {}) => run(file, args, opts), runObserved: async (file, args = [], opts = {}) => observedRun(run(file, args, opts), opts), ...outliving(world) };
}

const answerOf = (answer, args, opts) => (typeof answer === "function" ? answer(args, opts) : answer ?? { ok: true, out: "", err: "", status: 0 });

const chunksOf = (answer) => answer.chunks ?? [["out", answer.out ?? ""], ["err", answer.err ?? ""]].filter(([, text]) => text);

function observedRun(answer, opts) {
  const failed = chunksOf(answer).some(([stream, text]) => !handed(opts.observe, stream, text));
  const { chunks, ...rest } = answer;
  return failed ? { ...rest, observerFailed: true } : rest;
}

function handed(observe, stream, text) {
  try { return observe?.(stream, Buffer.isBuffer(text) ? text : Buffer.from(String(text))) ?? true, true; }
  catch { return false; }
}

function outliving(world) {
  const state = { next: world.firstPid ?? 5000, alive: new Map(), stubborn: new Set(), clock: world.now ?? (() => "2026-10-03T10:00:00.000Z") };
  const launches = [];
  const signals = [];
  return { launches, signals, state, ...methods(state, launches, signals, world), ...scenes(state) };
}

const methods = (state, launches, signals, world) => ({
  launch: (file, args = [], opts = {}) => launched(state, launches, world, file, args, opts),
  alive: (pid) => state.alive.has(pid),
  signal: (pid, sig, opts = {}) => signalled(state, signals, pid, sig, opts),
  startedAtOf: (pid) => state.alive.get(pid)?.startedAt ?? null,
  ancestry: (pid) => world.ancestry?.(pid) ?? [pid],
});

function launched(state, launches, world, file, args, opts) {
  if (world.launchFails) throw new Error(world.launchFails);
  const pid = state.next++;
  const startedAt = state.clock();
  launches.push({ file, args, opts, pid });
  state.alive.set(pid, { startedAt });
  return { pid, startedAt };
}

function signalled(state, signals, pid, sig, opts) {
  signals.push({ pid, sig, tree: Boolean(opts.tree) });
  if (!state.alive.has(pid)) return { ok: false, error: "no such process" };
  if (!(sig === "SIGTERM" && state.stubborn.has(pid))) state.alive.delete(pid);
  return { ok: true };
}

const scenes = (state) => ({
  adopt: (pid, startedAt) => state.alive.set(pid, { startedAt }),
  reuse: (pid, startedAt) => state.alive.set(pid, { startedAt }),
  stubborn: (pid) => state.stubborn.add(pid),
  die: (pid) => state.alive.delete(pid),
});
