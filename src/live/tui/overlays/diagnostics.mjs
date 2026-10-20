// DIAGNOSTICS (`d`): how THIS VIEWER's reads are going -- never the task's state. Each followed task's viewer
// state (src/live/presentation.mjs), how many reads and failures, the cursor it holds, how much of the journal
// its window kept; the console's offsets; the terminal; the follower leases held.
import { PRESENTATION_WORDS } from "../../words.mjs";
import { ABSENT, dim, row, seg } from "../sections/parts.mjs";

const line = (label, value, tone) => row([dim(`  ${label.padEnd(16)}`), seg(value ?? ABSENT.unknown, tone)]);

function slotRows(d, slot) {
  const pic = [d.root, d.child].find((p) => p?.view?.task?.id === slot.id) ?? null;
  const p = pic?.presentation?.state;
  return [row([seg(slot.id, "brand"), dim(`  ${slot.role}`)]), line("viewer state", p ? `${p} — ${PRESENTATION_WORDS[p].say}` : slot.status, p ? PRESENTATION_WORDS[p].tone : undefined), line("reads", `${slot.read.reads} read(s), ${slot.read.failures} failed in a row`), line("cursor", slot.cursor), line("window", `${slot.events.length} line(s) kept, ${slot.dropped} let go`), line("feed", slot.end === "terminal" ? "the task ended; the journal was read to its end" : slot.status), ...(slot.error ? [line("last error", slot.error, "danger")] : [])];
}

function consoleRows(c) {
  const s = (k) => c.streams[k];
  return [row([seg("sandbox console", "label")]), line("open", c.open ? "yes" : "no"), line("task", c.task), line("environment", c.env), line("session", c.session), line("stdout", `${s("out").lines.length} line(s) kept · next byte ${s("out").next}`), line("stderr", `${s("err").lines.length} line(s) kept · next byte ${s("err").next}`), line("state", c.message ? `${c.state}: ${c.message}` : c.state)];
}

const viewerRows = (state, tier) => [row([seg("viewer", "label")]), line("association", `${state.association.how}${state.association.ids?.length ? ` → ${state.association.ids.join(", ")}` : ""}`), line("terminal", `${state.viewer.size.columns}×${state.viewer.size.rows} · ${tier}`), line("drawing", `${state.viewer.colour ? "colour" : "no colour"} · ${state.viewer.ascii ? "ASCII" : "Unicode"}`), line("follower leases", String(state.viewer.followers)), line("writes", "nothing: a viewer reads the journals and the runtime's logs")];

export function diagnosticsOverlay(state, d, tier) {
  const slots = Object.values(state.tasks).flatMap((s) => slotRows(d, s));
  return { title: "DIAGNOSTICS", lead: [row([dim("this viewer's own reads, never the task's state")])], rows: [...viewerRows(state, tier), ...slots, ...consoleRows(state.console)], selectable: false };
}
