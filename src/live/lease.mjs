// THE VIEWER LEASE: the one full-screen viewer Orbit opened BY ITSELF for a session in a checkout, on this machine
// (ADR 0020). `/orbit-help` asks for a viewer every time a person invokes it, and without a record of the one already
// open each ask would be another pane. So the viewer a launcher starts holds a lease -- one small file per host ·
// session · checkout -- and says on it that it is READY, that it is still THERE (a heartbeat), which task it SHOWS,
// whether a person PICKED that task, and that it LEFT (q, Ctrl+C, its pane closed). A launcher reads it to decide:
// reuse, tell it to show a task, wait for one being opened, or open another.
//
// It is a viewer's own record, never a fact about a task: no journal line, no revision, no orchestrator reads it.
// What it may write is only this file, under the lease room's lock, and only while its OWNER token is the one on
// the record -- a viewer a newer launch replaced can never overwrite the record of its successor. A process id is
// one fact among three: a pid can be reused, so it counts only with the time that process started, and a viewer
// that has not beaten for SILENT_MS has left whatever its pid says. Nothing here signals a process.
//
//   leaseKey({ host, session, checkout }) -> "<16 hex>" | null    null without a session mark: nothing tells two
//                                                                  people's sessions apart, so nothing is reused
//   leaseWhere(liveRoom, machine, key) -> { dir, file, key }
//   readLease(io, where) -> record | null
//   updateLease(io, where, fn) -> record | null                     fn(current) -> next | null (unchanged), locked
//   livenessOf(record, { nowMs, alive(pid), startedAtOf(pid) }) -> { state, why }
//     state: none · starting · attached · detached · gone
//   launching · selecting · failing · noting                        a launcher's records, written through updateLease
//   viewerReady / viewerBeat / viewerLeft (io, where, me, facts)    a viewer's three writes; `me` = { owner }
import { join } from "node:path";
import { short } from "../hash.mjs";
import { readState, writeState } from "../store/control.mjs";
import { withLock } from "../store/lock.mjs";

export const LEASE_SCHEMA = 1;

// A launch may take this long to say it is ready before it counts as failed; a viewer beats this often; a viewer
// silent for SILENT_MS has left.
export const STARTING_MS = 30_000;
export const HEARTBEAT_MS = 5_000;
export const SILENT_MS = 20_000;

export const TOKEN = /^[a-f0-9]{16}$/;
const TASK_ID = /^tsk-[a-f0-9]{12}$/;

const BUSY = "another viewer or launcher is updating this session's viewer lease — try again in a moment";

export const leaseKey = ({ host, session, checkout }) => (session && checkout ? short(`${host ?? ""}\u0000${session}\u0000${checkout}`, 16) : null);

export const leaseWhere = (liveRoom, machine, key) => ((dir) => ({ dir, file: join(dir, `${key}.json`), key }))(join(liveRoom, "viewers", machine));

export const readLease = (io, where) => ((doc) => (doc.unreadable || !TOKEN.test(String(doc.owner ?? "")) ? null : doc))(readState(io, where.file, {}, LEASE_SCHEMA));

// Read, change and write in one step under the room's lock, so two launchers asked at once open one viewer.
export function updateLease(io, where, fn) {
  io.ensureDir(where.dir);
  return withLock(where.dir, () => replaced(io, where, fn), io, BUSY);
}

function replaced(io, where, fn) {
  const current = readLease(io, where);
  const next = fn(current);
  if (next) writeState(io, where.file, next, LEASE_SCHEMA);
  return next ?? current;
}

// ---- is the viewer there? -----------------------------------------------------------------------------------

const ms = (iso) => (typeof iso === "string" ? Date.parse(iso) : NaN);

const lastHeard = (l) => ms(l.heartbeatAt ?? l.readyAt ?? l.requestedAt);

// The time a pid started differs from the one the viewer recorded: the OS gave that number to another process.
const reused = (l, f) => Boolean(l.pid && l.pidStartedAt) && ((s) => s !== null && s !== undefined && s !== l.pidStartedAt)(f.startedAtOf(l.pid));

export const LIVENESS = Object.freeze([
  { state: "none", when: (l) => !l, why: () => "no viewer was opened for this session here" },
  { state: "gone", when: (l) => l.state === "failed", why: (l) => `the last launch failed (${l.detachedWhy ?? "the opener said no"})` },
  { state: "detached", when: (l) => l.state === "detached", why: (l) => `the viewer was closed (${l.detachedWhy ?? "detached"})` },
  { state: "starting", when: (l, f) => l.state === "starting" && f.nowMs - ms(l.requestedAt) <= STARTING_MS, why: () => "a viewer was asked to open and has not said it is ready yet" },
  { state: "gone", when: (l) => l.state === "starting", why: () => "a viewer was asked to open and never said it was ready" },
  { state: "gone", when: (l, f) => Boolean(l.pid) && f.alive(l.pid) === false, why: () => "the viewer's process is not running" },
  { state: "gone", when: reused, why: () => "the viewer's process id now belongs to another process" },
  { state: "gone", when: (l, f) => !(f.nowMs - lastHeard(l) <= SILENT_MS), why: () => "the viewer has not said it is there for a while" },
  { state: "attached", when: () => true, why: () => "the viewer is open" },
]);

export function livenessOf(lease, facts) {
  const row = LIVENESS.find((r) => r.when(lease, facts));
  return { state: row.state, why: row.why(lease) };
}

// ---- a launcher's records ------------------------------------------------------------------------------------

// A new launch: a new owner and generation, everything the last viewer said about itself forgotten.
export const launching = (current, req) => ({ key: req.key, host: req.host ?? null, session: req.session, checkout: req.checkout, project: req.project ?? null, machine: req.machine, owner: req.owner, generation: (current?.generation ?? 0) + 1, state: "starting", opener: req.opener ?? null, requestedAt: req.at, readyAt: null, heartbeatAt: null, pid: null, pidStartedAt: null, shows: null, picked: false, selection: TASK_ID.test(String(req.task ?? "")) ? { task: req.task, at: req.at, entry: req.entry } : null, detachedAt: null, detachedWhy: null, last: current?.last ?? null });

export const selecting = (current, req) => ({ ...current, selection: { task: req.task, at: req.at, entry: req.entry } });

// The launch this owner made never became a viewer: a later ask may open one again.
export const failing = (current, owner, f) => (current?.owner === owner && current.state === "starting" ? { ...current, state: "failed", detachedAt: f.at, detachedWhy: f.why } : null);

export const noting = (current, last) => (current ? { ...current, last } : null);

// ---- a viewer's records ----------------------------------------------------------------------------------------

const mine = (l, me) => Boolean(l) && l.owner === me.owner;

export const viewerReady = (io, where, me, f) => updateLease(io, where, (l) => (mine(l, me) ? { ...l, state: "ready", readyAt: f.at, heartbeatAt: f.at, pid: f.pid ?? null, pidStartedAt: f.pidStartedAt ?? null, shows: f.shows ?? null, picked: Boolean(f.picked) } : null));

// A beat answers whether this viewer still holds the lease, and the selection a launcher wrote since.
export function viewerBeat(io, where, me, f) {
  const after = updateLease(io, where, (l) => (mine(l, me) && l.state === "ready" ? { ...l, heartbeatAt: f.at, shows: f.shows ?? null, picked: Boolean(f.picked) } : null));
  return { held: mine(after, me) && after.state === "ready", selection: mine(after, me) ? after.selection ?? null : null };
}

export const viewerLeft = (io, where, me, f) => updateLease(io, where, (l) => (mine(l, me) ? { ...l, state: "detached", detachedAt: f.at, detachedWhy: f.why ?? "detached", heartbeatAt: f.at } : null));
