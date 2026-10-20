// The ONE LINE a checkout is shown by when nobody has asked for more: whether its
// runtime is understood, and what state it is in -- kept in the project registry
// (src/store/registry.mjs) so a list of every project on the machine costs a
// directory listing, never a probe.
//
// A summary is a statement about a moment, and says when it was made. It is written
// by the commands that change something (discover, adopt, validate, start, stop,
// configure), never by one that only looks, and Orbit Control shows it as "as of"
// rather than as the truth. The truth about a checkout is its own facts and its own
// sessions, which the Runtime page reads on its own.
//
// The runtime word:
//   RUNNING         everything that can be started is running
//   PARTIAL         something is running and something is not, or the plan itself is partial
//   STOPPED         nothing is running, and it could be started
//   BLOCKED · UNRESOLVED · UNKNOWN · EMPTY   the plan's own word, when nothing is running
//   NOT_DISCOVERED  nothing has read this checkout yet
export function runtimeWord({ understanding, plan, sessions }) {
  if (understanding === "NOT_DISCOVERED") return "NOT_DISCOVERED";
  const running = sessions.filter((s) => s.state === "RUNNING" && s.ownership === "ORBIT_OWNED").length;
  const startable = plan.components.filter((c) => c.state !== "not-startable").length;
  if (running) return running >= startable ? "RUNNING" : "PARTIAL";
  return plan.overall === "READY" ? "STOPPED" : plan.overall;
}

export const summaryOf = (input) => ({ understanding: input.understanding, runtime: runtimeWord(input), branch: input.branch ?? null });

// Fail-open: a registry that cannot be written is a warning and never a failed
export function noted(ctx, input) {
  try {
    ctx.registry.note(ctx.project.storeKey, ctx.checkout, { name: ctx.name, host: ctx.host, at: ctx.now(), summary: summaryOf(input) });
  } catch {
    return false;
  }
  return true;
}
