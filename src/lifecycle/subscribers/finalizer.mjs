// A protocol-2 host's checkpoint (Codex, Antigravity): at the end of a turn or a session, the session's working set is
// queued for the engineering observer, and -- since 1.8.9 -- drained right away by a process of its own
// (`world.drainLater`, bound by cli/learn-hook.mjs), because the host's hook budget is too short to observe inside it
// and a queue left for later was a session nobody learned from. Claude's own hooks observe inline and never queue.
export const finalizer = { name: 'finalizer', on: ['turn-end', 'session-end'], records: true, run: checkpoint };
function checkpoint(event, world) {
  if (event.protocol !== 2 || !event.session || !world.observing?.()) return null;
  const ws = world.workingSet?.();
  if (ws) world.finalizer?.()?.enqueue(event.session, ws.read(event.session));
  if (ws) world.drainLater?.();
  return null;
}
