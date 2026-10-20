// What a managed MCP server DID, one JSON line per event, appended to
// <storeBase>/control/activity/mcp-<host>.jsonl -- one file per machine, the
// ledger's trick, so two machines sharing a store never write the same line.
//
//   mcp-started    a session was opened (resource, how long it took)
//   mcp-invoked    a tool answered (resource, tool, capability, outcome, ms)
//   mcp-failed     it could not be started, reached or asked
//   mcp-blocked    a gate stopped the call before anything was reached
//
// An ALLOW-LIST of fields, for the reason a report masks by allow-list: a field
// added to an event later must not land here because nobody remembered to
// leave it out. Never an argument, never a result, never a prompt -- the tool's
// NAME is the most a line says about what was asked -- and every string is
// scrubbed by shape besides. FAIL OPEN: a store that cannot be written costs
// the line, never the call it describes. The router writes nothing here; it
// plans, and planning is not an event.
import { join } from "node:path";
import { scrubbed } from "../scrub.mjs";

export const EVENTS = ["mcp-started", "mcp-invoked", "mcp-failed", "mcp-blocked"];
const FIELDS = ["at", "kind", "resource", "tool", "capability", "workflow", "operation", "ms", "outcome", "reason"];

export function activityLog(rooms, io) {
  const file = join(rooms.activity, `mcp-${String(io.host ?? "host").replace(/[^A-Za-z0-9._-]/g, "_")}.jsonl`);
  return { file, record: (event) => appended(io, file, event) };
}

function appended(io, file, event) {
  try { io.append(file, `${JSON.stringify(scrubbed(allowed({ at: io.now(), ...event })))}\n`); }
  catch { /* fail open: the call this line describes has already been decided */ }
}

const allowed = (event) => Object.fromEntries(FIELDS.filter((k) => event[k] !== undefined && event[k] !== null).map((k) => [k, event[k]]));

// The newest lines, newest first, for a page -- read-only, bounded.
export function recentActivity(io, rooms, limit = 50) {
  const lines = io.list(rooms.activity).filter((f) => /^mcp-.*\.jsonl$/.test(f)).flatMap((f) => String(io.read(join(rooms.activity, f)) ?? "").split("\n"));
  return lines.map(parsed).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
}

function parsed(line) {
  try { return line.trim() ? allowed(JSON.parse(line)) : null; }
  catch { return null; }
}
