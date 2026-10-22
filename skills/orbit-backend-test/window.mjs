// The WINDOW an observer watches (doc §5.9): the one its request asked, unless the call's own deadline ends first.
// A window cut short is not the window a verdict rules on -- the evaluator takes only a COMPLETE observation as proof of
// an absence or of a miss (src/run/evaluator.mjs) -- so an answer whose wait the deadline ended before what it waited
// for was met says it is partial, and why. One definition for every observer in this pack: the workload hooks, the
// AMQP queue and the JetStream consumer each wait the same way.

// -> { endsAt, cut, asked, allowed }: `asked` the window the request named (null: none, so it waits until the deadline
// and nothing is cut), `allowed` what the call's deadline leaves.
export function windowOf(waitMs, allowedMs, nowMs) {
  const asked = Number.isInteger(waitMs) && waitMs >= 0 ? waitMs : null;
  const allowed = Math.max(0, allowedMs);
  return { endsAt: nowMs + Math.min(asked ?? Infinity, allowed), cut: asked !== null && allowed < asked, asked, allowed };
}

// The gap a cut window leaves, when what the wait was for was not met before it ended.
export const cutGaps = (window, met) => (window?.cut && !met ? [`the window was cut to ${Math.round(window.allowed)} ms by the call's own deadline, short of the ${window.asked} ms asked — what it did not watch is not claimed`] : []);
