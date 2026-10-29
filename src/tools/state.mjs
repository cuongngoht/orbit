// Orbit's own records about CLI tools, in the machine store:
//
//   desired.json        what a person wants, per tool: { enabled, installStrategy }
//   observed.json       the last detection per tool: status, version, the source
//                       it was found in, its path AS CACHED -- a cache, re-derived
//                       and re-verified on every observation, never trusted as truth
//   receipts/<k>.json   one per Orbit-managed install: tool, version, platform,
//                       arch, where it went (a room and a RELATIVE directory, never
//                       an absolute path), the checksum it was verified against
//
// A receipt is not proof a runtime is there: detection asks the binary itself.
// It is what lets a managed install be FOUND again after the plugin directory
// was replaced -- the identity tool/version/platform, derived into a path under
// the store every time.
import { join } from "node:path";
import { withLock, withLockAsync } from "../store/lock.mjs";
import { readState, writeState } from "../store/control.mjs";
import { relativeInside } from "./catalog.mjs";
import { pathOf } from "./launch.mjs";

const EMPTY = { desired: { tools: {} }, observed: { observedAt: null, tools: {} } };
const RECEIPT = /^[a-z0-9][a-z0-9._-]*\.json$/;

export function createToolState(rooms, io) {
  const file = (name) => join(rooms.tools, `${name}.json`);
  const read = (name) => readState(io, file(name), EMPTY[name]);
  const change = (name, fn) => locked(rooms.tools, io, () => writeState(io, file(name), fn(read(name))));
  return { read, change, receipts: () => receiptsIn(rooms.toolReceipts, io), saveReceipt: (r) => locked(rooms.toolReceipts, io, () => writeState(io, join(rooms.toolReceipts, receiptName(r)), r)), installing: (id, fn) => installing(rooms, io, id, fn) };
}

// How long an install may hold its lock before another process may call it
// abandoned: a runtime is tens of megabytes on a slow link.
export const INSTALL_STALE_MS = 30 * 60 * 1000;

// ONE install of a tool at a time on this machine: two Control tabs, or Control
// and a CLI, must not stage, verify and promote the same runtime directory at
// once. The loser waits a little and is then told why, and the winner's receipt
// is still written last.
function installing(rooms, io, id, fn) {
  const room = join(rooms.toolRuntimes, id);
  io.ensureDir(room);
  return withLockAsync(room, fn, { ...io, staleMs: INSTALL_STALE_MS }, `another install of ${id} is running on this machine — try again when it has finished`);
}

function locked(room, io, fn) {
  io.ensureDir(room);
  return withLock(room, fn, io);
}

export const receiptName = (r) => `${r.tool}-${r.version}-${r.platform}-${r.arch}.json`.replace(/[^a-z0-9._-]/gi, "_").toLowerCase();

function receiptsIn(dir, io) {
  const docs = io.list(dir).filter((f) => RECEIPT.test(f)).map((f) => readState(io, join(dir, f), {}));
  return docs.filter(isReceipt);
}

// The rooms a managed tool runtime may live in -- a receipt's `home` names a
// room of src/store/control.mjs stateRooms. "runtimes" is 1.5.4's name for
// runtimes/tools/, kept as an alias there so every receipt written then still
// resolves; Control's own Node kept its 1.5.2 home, found without moving it.
export const HOMES = ["toolRuntimes", "controlRuntime"];

const isReceipt = (r) => !r.unreadable && typeof r.tool === "string" && typeof r.version === "string" && HOMES.includes(r.home) && relativeInside(r.dir) && relativeInside(r.bin);

// Where a receipt's runtime IS, derived from the store's rooms each time -- with the path rules of the platform the
// receipt is for, so a Windows store is never joined with a POSIX separator.
export const receiptPath = (rooms, r, platform = process.platform) => pathOf(platform).join(rooms[r.home], r.dir, r.bin);

export const withTool = (doc, id, value) => ({ ...doc, tools: { ...(doc.tools ?? {}), [id]: value } });
