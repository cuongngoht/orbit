// A clock a test can move. ctx.now is the only clock any wait reads now (see
// src/run/poll.mjs), so a timeout test runs in microseconds with a deterministic
// number of attempts -- and nothing in the suite has to sleep.
export function fakeClock(startMs = 0) {
  let now = startMs;
  return { now: () => now, tick: (ms) => (now += ms) };
}
