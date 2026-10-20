// One lifecycle event, handed to every subscriber that listens for it.
//
// The Observer pattern, and the reason for it is failure isolation rather than
// elegance: the learning fold, the working set and the engineering observer are
// three independent pieces of supporting intelligence, and one of them throwing
// must not cost the other two -- nor, ever, the host's turn. So each runs inside
// its own guard; a subscriber whose row says `records` has its failure handed
// to `world.failed` (which keeps a finding), and the rest fail silently, which
// is what the hooks promised before this existed: a tool that learns must never
// stop a session.
//
// At most ONE subscriber speaks to the host per event: the first non-null
// payload in table order. Everything else a subscriber does is a side effect
// on the machine store, never output into somebody's transcript.
//
// The table itself is composed by the caller (cli/learn-hook.mjs), which is
// what keeps this file from importing the subsystems it dispatches to.
export function dispatch(event, world, subscribers) {
  if (!event) return null;
  const listening = subscribers.filter((s) => s.on.includes(event.event));
  const payloads = listening.map((s) => isolated(s, event, world));
  return payloads.find((p) => p != null) ?? null;
}

function isolated(subscriber, event, world) {
  try {
    return subscriber.run(event, world) ?? null;
  } catch (e) {
    return failed(subscriber, e, world);
  }
}

function failed(subscriber, error, world) {
  if (subscriber.records) quiet(() => world.failed?.(subscriber.name, error));
  return null;
}

// Reporting a failure must not become a second failure.
function quiet(fn) {
  try {
    fn();
  } catch {
    // nothing left to tell
  }
}
