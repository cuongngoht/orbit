// SANDBOX: the task's own sandbox's output, read ONLY through the runtime's door (`sandbox-logs`, after the
// journal's claim is witnessed by the checkout -- src/live/logs.mjs), which masks the whole log before any
// piece of it is shown. Here it is lines and a title: whose session, which stream, how much of the log has been
// read of its size, whether the list follows or is held. It is never a shell: nothing typed reaches it.
import { bytesOf } from "../bars.mjs";
import { dim, joined, row, seg } from "./parts.mjs";

const STATE_TONES = { RUNNING: "success" };

function titleRow(ctx) {
  const c = ctx.state.console;
  const s = c.streams[c.stream];
  const session = c.sessions.find((x) => x.session === c.session);
  const held = ctx.state.viewer.hold.sandbox !== null;
  return row(joined([seg(c.session ?? "no session", "brand"), session?.component && seg(session.component), session && seg(session.state ?? "?", STATE_TONES[session.state] ?? "subtle"), seg(c.stream === "out" ? "stdout" : "stderr", "label"), s.size !== null ? dim(`${bytesOf(s.next)} read of ${bytesOf(s.size)}`) : null, seg(held ? "HELD" : "FOLLOW", held ? "warning" : "info"), s.truncated ? dim("▸ more") : null, s.held ? seg("a line is held back", "warning") : null, s.reset ? dim(`log begun again ×${s.reset}`) : null, dim("masked, read-only")]));
}

// The lines of the stream shown, as many as the list is held at when it is held.
export function consoleLines(state) {
  const s = state.console.streams[state.console.stream];
  const hold = state.viewer.hold.sandbox;
  return hold === null ? s.lines : s.lines.slice(0, Math.max(0, hold - s.dropped));
}

const message = (c) => [row([seg(c.message, c.state === "stopped" ? "warning" : "subtle")])];

export function sandboxSection(ctx) {
  const c = ctx.state.console;
  if (!c.open) return null;
  const lines = c.message ? message(c) : consoleLines(ctx.state).map((line) => row([seg(line)]));
  return { name: "sandbox", head: titleRow(ctx), rows: lines.length ? lines : [row([dim(c.session ? "nothing written yet" : "finding the sandbox…")])], scroll: "sandbox" };
}
