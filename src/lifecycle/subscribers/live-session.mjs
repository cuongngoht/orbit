// Orbit LIVE's two facts a session start has and nothing later does (ADR 0016):
//
//   1. the SESSION MARK -- a host that offers a session environment file gets an export of the mark its own
//      hooks already compute (src/memory/session.mjs hostSession), so every shell command of the session -- a
//      task created among them -- carries it, and the task's journal can say which session made it. Without
//      it a viewer can only match a task by checkout or by a person's pin;
//   2. where the host loaded this plugin from, kept as a host observation, for a status line command that no
//      plugin variable reaches.
//
// Both through a port the composition root binds (`world.liveSession`), which is null when the host offers
// neither or Live is switched off. Never records, never speaks: a session start is never answered by this.
export const liveSession = {
  name: "live-session",
  on: ["session-start"],
  records: false,
  run: (event, world) => noted(event, world.liveSession?.()),
};

function noted(event, port) {
  if (!port || !event.session) return null;
  port.exportSession(event.session);
  port.observeRoot();
  return null;
}
