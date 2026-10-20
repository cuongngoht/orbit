// Orbit-managed MCP state. Reads never create files; writes hold the room lock.
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { relativeInside } from "../project/boundary.mjs";
import { readState, writeState } from "../store/control.mjs";
import { withLock } from "../store/lock.mjs";
import { managedProblems } from "./managed.mjs";

export const MCP_STATE_SCHEMA = 3;
export const DOCS = ["managed", "external", "checks", "policies", "approvals"];
const EMPTY = { managed: { servers: {} }, external: { host: null, observedAt: null, servers: [] }, checks: { checks: {} }, policies: { resources: {}, workflows: {} }, approvals: { grants: {} } };

export function createMcpState(rooms, io) {
  const room = roomOf(rooms, io);
  return { read: room.read, change: (name, fn) => locked(room.dir, io, () => room.write(name, fn(room.read(name)))), all: () => Object.fromEntries(DOCS.map((n) => [n, room.read(n)])), ...receiptsOf(rooms, io) };
}

function roomOf(rooms, io) {
  const file = (name) => documentFile(rooms.mcp, name);
  const read = (name) => validDocument(name, readState(io, file(name), EMPTY[name], MCP_STATE_SCHEMA));
  return { dir: rooms.mcp, read, write: (name, doc) => writeState(io, file(name), validDocument(name, { ...doc, schema: MCP_STATE_SCHEMA }), MCP_STATE_SCHEMA) };
}

function documentFile(dir, name) {
  if (!DOCS.includes(name)) throw new Refused(`unknown MCP document: ${name}`);
  return join(dir, `${name}.json`);
}

function validDocument(name, doc) {
  const keys = ["schema", ...Object.keys(EMPTY[name])];
  if (doc.unreadable || Object.keys(doc).some((k) => !keys.includes(k))) throw new Refused(`MCP ${name}: unsupported or corrupt state; file unchanged`);
  if (Object.entries(EMPTY[name]).some(([k, v]) => !sameShape(doc[k], v))) throw new Refused(`MCP ${name}: invalid document shape; file unchanged`);
  if (name === "managed") validateServers(doc.servers);
  return doc;
}

const sameShape = (value, sample) => sample === null ? value === null || typeof value === "string" : Array.isArray(sample) ? Array.isArray(value) : value !== null && typeof value === "object" && !Array.isArray(value);

function locked(dir, io, fn) {
  io.ensureDir(dir);
  return withLock(dir, fn, io);
}

// ---- receipts ---------------------------------------------------------------

const RECEIPT = /^[a-z0-9][a-z0-9._-]*\.json$/;

// The rooms a managed MCP runtime may live in -- a receipt's `home` names one.
export const MCP_HOMES = ["mcpRuntimes"];

export const receiptName = (r) => `${r.mcp}-${r.version}-${r.platform}-${r.arch}.json`.replace(/[^a-z0-9._-]/gi, "_").toLowerCase();

const receiptsOf = (rooms, io) => ({ receipts: () => receiptsIn(rooms.mcpReceipts, io), saveReceipt: (r) => locked(rooms.mcpReceipts, io, () => writeState(io, join(rooms.mcpReceipts, receiptName(r)), r, MCP_STATE_SCHEMA)), dropReceipts: (id) => locked(rooms.mcpReceipts, io, () => dropped(rooms.mcpReceipts, io, id)) });

function receiptsIn(dir, io) {
  const docs = io.list(dir).filter((f) => RECEIPT.test(f)).map((f) => readState(io, join(dir, f), {}, MCP_STATE_SCHEMA));
  return docs.filter(isReceipt);
}

function dropped(dir, io, id) {
  const mine = io.list(dir).filter((f) => RECEIPT.test(f)).filter((f) => readState(io, join(dir, f), {}, MCP_STATE_SCHEMA).mcp === id);
  for (const f of mine) io.removeFile(join(dir, f));
  return mine.length;
}

// A receipt is believed only as far as it can be checked: a known room, and a
// directory and entrypoint that stay inside it. It is still not proof that the
// runtime is THERE -- src/mcp/effective.mjs asks the disk every time.
const isReceipt = (r) => !r.unreadable && typeof r.mcp === "string" && typeof r.version === "string" && MCP_HOMES.includes(r.home) && relativeInside(r.dir) && relativeInside(r.entrypoint);

// Where a receipt's runtime IS, derived from the store's rooms each time.
export const runtimeDir = (rooms, r) => join(rooms[r.home], r.dir);
export const entrypointOf = (rooms, r) => join(runtimeDir(rooms, r), r.entrypoint);

// ---- document helpers ---------------------------------------------------------

export const withServer = (doc, id, value) => ({ ...doc, servers: { ...(doc.servers ?? {}), [id]: value } });

export function withoutServer(doc, id) {
  const { [id]: _gone, ...rest } = doc.servers ?? {};
  return { ...doc, servers: rest };
}

// A fresh read of the host's configuration replaces the snapshot, whole.
export const observedAs = (doc, host, servers, at) => ({ ...doc, host, observedAt: at, servers });

export const checkedAs = (doc, key, check) => ({ ...doc, checks: { ...(doc.checks ?? {}), [key]: check } });

export function uncheckedAs(doc, key) {
  const { [key]: _gone, ...rest } = doc.checks ?? {};
  return { ...doc, checks: rest };
}

const RECORD_FIELDS = ["id", "name", "description", "origin", "catalog", "enabled", "selection", "priority", "provides", "signals", "requiresSignal", "definition", "createdAt", "updatedAt"];
const DEFINITION_FIELDS = ["transport", "url", "requiredHeaders", "command", "commandRef", "args", "requiredEnv"];

function validateServers(servers) {
  const wrong = Object.entries(servers).flatMap(([id, record]) => serverProblems(id, record));
  if (wrong.length) throw new Refused(`MCP managed: invalid server record (${wrong.join("; ")}); file unchanged`);
}

function serverProblems(id, record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return ["server must be an object"];
  const keys = Object.keys(record).filter((k) => !RECORD_FIELDS.includes(k));
  const definition = Object.keys(record.definition ?? {}).filter((k) => !DEFINITION_FIELDS.includes(k));
  const input = Object.fromEntries(Object.entries(record).filter(([k]) => !["origin", "catalog", "definition", "createdAt", "updatedAt"].includes(k)));
  return [...keys, ...definition, ...(record.id !== id || !["custom", "catalog"].includes(record.origin) ? ["invalid server identity"] : []), ...managedProblems({ ...input, ...record.definition })];
}
