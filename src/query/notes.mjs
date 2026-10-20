// Recall, read the way the map is read: only the slice asked for. Loading the
// whole store into context is the thing a store of notes exists to prevent.
import { isStale, relevant } from "../memory/note.mjs";
import { out } from "./format.mjs";

export function notes(ctx, [about]) {
  const hits = relevant(ctx.memory.notes(), about);
  if (!hits.length) return out(about ? `nothing remembered about ${about}` : "nothing remembered for this project yet");
  out(`\n${hits.length} note(s)${about ? ` about ${about}` : ""}:`);
  for (const n of hits) show(n, ctx.frontend.commit());
}

// The host is printed because the notes are shared: "this machine needs Edge"
// is advice only to the machine it was written on.
function show(n, head) {
  out(`\n  ${n.title}   [${n.type ?? "finding"} · about ${n.about} · from ${n.host ?? "?"}${staleness(n, head)}]`);
  for (const line of n.body.split("\n")) out(`    ${line}`);
}

// Said out loud rather than hidden, and never deleted for us: a note written
// against an older build may still be the truest thing anyone knows.
const staleness = (n, head) => (isStale(n, head) ? ` · STALE, written at ${n.fe_commit}, frontend is ${head}` : "");
