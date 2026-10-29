// Orbit's machine-local RESOURCE STATE and the runtimes it installed -- kept in
// the machine store and NEVER in the plugin, so replacing the plugin directory
// on an upgrade cannot take any of it along. Plugin code is replaceable; this
// is durable. It is not MEMORY either: memory is what Orbit knows about a
// project (lessons, architecture, engineering, runs); this is what Orbit owns
// and runs on this machine.
//
//   <storeBase>/control/resources/mcp/     managed · external · checks · policies ·
//                                          approvals (schema 2) and receipts/<k>.json;
//                                          1.5.4's desired · custom · observed (schema 1)
//                                          are read, never written again
//   <storeBase>/control/resources/tools/   desired.json  observed.json  receipts/<k>.json
//   <storeBase>/control/activity/          <room>-<host>.jsonl, what a managed resource did
//   <storeBase>/control/activity/trace/    <YYYY-MM-DD>-<host>.jsonl, the SESSION TRAIL:
//                                          what sessions did through Orbit, as events
//                                          (src/trace/) -- metadata, never content
//   <storeBase>/runtimes/mcp/<id>/<version>-<platform>-<arch>/     a managed MCP runtime
//   <storeBase>/runtimes/tools/<id>/<version>-<platform>-<arch>/   a managed CLI tool
//   <storeBase>/control-runtime/           Control's private Node (1.5.2, unchanged)
//   <storeBase>/control/automation/        settings.json: how autonomous a person lets Orbit be on this machine
//                                          (src/automation/settings.mjs), written only through Orbit Control
//   <storeBase>/state/checkouts/<id>.json  which project each checkout is bound to (src/project/repository.mjs)
//   <storeBase>/state/projects/<key>.json  what is kept ABOUT a project on this machine: its name, and per
//                                          checkout when it was last seen and a one-line summary (1.7.6,
//                                          src/store/registry.mjs). Read together with the bindings above:
//                                          a checkout is KNOWN because it was bound, never because a
//                                          directory was scanned
//
// CONFIGURATION (control/) and INSTALLATIONS (runtimes/) are separate rooms on
// purpose: removing a resource from Orbit is a change to the first, deleting its
// files is a second, explicit act on the other.
//
// `storeBase` is src/project/repository.mjs's -- ORBIT_STORE_DIR or the home
// default, refused inside a repository -- the same base the Control backups and
// runtime already use, so ONE variable relocates all of it.
//
// State is read only at its declared schema. Unsupported or corrupt files stay unchanged.
// Writes use atomic replacement after validating the existing file.
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";
import { writeAtomic } from "./atomic.mjs";

export const STATE_SCHEMA = 1;

export function stateRooms(storeBase) {
  const at = (...parts) => contained(storeBase, join(storeBase, ...parts));
  const toolReceipts = at("control", "resources", "tools", "receipts");
  const toolRuntimes = at("runtimes", "tools");
  return { checkouts: at("state", "checkouts"), projects: at("state", "projects"), hosts: at("control", "hosts"), externalObservations: at("control", "resources", "mcp", "observations"), connections: at("control", "connections"), authSessions: at("control", "auth"), mcp: at("control", "resources", "mcp"), mcpReceipts: at("control", "resources", "mcp", "receipts"), mcpRuntimes: at("runtimes", "mcp"), tools: at("control", "resources", "tools"), toolReceipts, toolRuntimes, controlRuntime: at("control-runtime"), live: at("control", "live"), automation: at("control", "automation"), activity: at("control", "activity"), trace: at("control", "activity", "trace") };
}

export function readState(io, file, fallback, schema = STATE_SCHEMA) {
  const text = io.read(file);
  if (text === null || text === undefined) return { ...fallback, schema };
  const doc = parsed(text);
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || doc.schema !== schema) throw new Refused(`${file}: ${reasonOf(doc, schema)} Orbit state; expected schema ${schema}; file unchanged`);
  return doc;
}

function parsed(text) {
  try { return JSON.parse(text); }
  catch { return undefined; }
}

const reasonOf = (doc, schema) => (doc === undefined ? "corrupt" : typeof doc?.schema === "number" && doc.schema > schema ? "newer" : "unsupported");

export function writeState(io, file, doc, schema = STATE_SCHEMA) {
  readState(io, file, {}, schema);
  return writeAtomic(file, `${JSON.stringify({ ...doc, schema, unreadable: undefined }, null, 2)}\n`, io, false);
}
