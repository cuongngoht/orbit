// A RETRY, bounded and saying what it did: attempts 1 to N, stopped at once on an answer that settles
// it, with a wait only BETWEEN attempts.
//
//   REACHABLE   settles it: the question was answered, and asking again adds nothing
//   BLOCKED     settles it: the location cannot be asked right now (a container that is not up), and
//               asking again before a person acts would learn nothing -- not N meaningless attempts
//   anything else is tried again while attempts remain
//
// There is no "retry forever", no loop without a deadline (every attempt carries the policy's
// `timeoutMs`), and nothing in the background: a retry is something a person or a start asks for, it
// runs, and it is over. The clock and the sleep are handed in, so a test never waits.
export const SETTLES = ["REACHABLE", "BLOCKED"];

// `once(number)` -> { state, resolution, transport, because }. `policy` is { attempts, intervalMs }.
// `deps` is { sleep(ms), now() -> ms }.
// -> { state, resolution, transport, because, attemptsUsed, configuredAttempts, attempts: [{ number, state, because }], checkedAt }
export async function retried(once, policy, deps) {
  const attempts = [];
  while (attempts.length < Math.max(1, policy.attempts) && !SETTLES.includes(attempts.at(-1)?.state)) attempts.push(await attempted(once, attempts.length + 1, policy, deps));
  return summed(attempts, policy, deps);
}

async function attempted(once, number, policy, deps) {
  if (number > 1) await deps.sleep(policy.intervalMs);
  const got = await once(number);
  return { number, state: got.state, resolution: got.resolution, transport: got.transport, because: got.because };
}

function summed(attempts, policy, deps) {
  const last = attempts.at(-1);
  return { state: last.state, resolution: last.resolution, transport: last.transport, because: last.because, attemptsUsed: attempts.length, configuredAttempts: policy.attempts, attempts: attempts.map(({ number, state, because }) => ({ number, state, because })), checkedAt: new Date(deps.now()).toISOString() };
}
