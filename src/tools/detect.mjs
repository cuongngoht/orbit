// Where a CLI tool is on THIS machine, and what version it says it is.
//
// Three sources, asked in a fixed and explicit PRECEDENCE -- the first one that
// has the tool AND can start it wins, and every source's answer is kept, so a
// page can say "project: not found · Orbit managed: not installed · system: 1.10":
//
//   project        <project root>/node_modules/.bin/<command>, when the catalog
//                  row says the tool may come from a project at all
//   orbit-managed   an install Orbit made, located from its RECEIPT -- tool,
//                  version, platform -- under the store, never a cached path
//   system         the first match on PATH
//
// A project's own copy wins because it is the one that project pinned; Orbit's
// private copy beats the machine's because somebody installed it on purpose for
// this. None of it changes what the ENGINE runs: the runner still resolves its
// commands exactly as before, and this is observation only.
//
// A binary is ASKED its version (argv, never a shell); a file with the right
// name proves nothing. Only the version survives -- never the output.
//
// A row whose `detection.strategy` is not `commands` is answered by a detector
// the composition root registered under that name; this file names none.
import { posix, win32 } from "node:path";
import { shimTarget } from "../process/shim.mjs";
import { receiptPath } from "./state.mjs";

export const SOURCES = [
  { source: "project", paths: (entry, ctx) => projectPaths(entry, ctx) },
  { source: "orbit-managed", paths: (entry, ctx) => managedPaths(entry, ctx) },
  { source: "system", paths: (entry, ctx) => systemPaths(entry, ctx) },
];

export function detectTool(entry, ctx) {
  if (entry.detection.strategy === "commands") return finding(entry, SOURCES.map((s) => sourced(s.source, s.paths(entry, ctx), entry, ctx)), ctx);
  const detector = ctx.detectors?.[entry.detection.strategy];
  if (!detector) return finding(entry, [], ctx, `no detector named ${entry.detection.strategy} is registered`);
  return finding(entry, detector(entry, ctx), ctx);
}

export function finding(entry, sources, ctx, reason = null) {
  const winner = sources.find((s) => s.found && s.ok);
  return { id: entry.id, status: statusOf(winner, sources), source: winner?.source ?? null, version: winner?.version ?? null, path: winner?.path ?? null, sources, reason: winner ? null : reason ?? sources.find((s) => s.found)?.reason ?? null, checkedAt: ctx.now() };
}

// `ready` or `missing` -- and a third answer for a tool that was FOUND and then
// did not answer in time: `unknown`. A machine that is slow, or a daemon that is
// starting, has not said the tool is absent, and reporting it as missing would
// send somebody to install what is already there. Everything that reads a status
// already treats anything but `ready` as not ready.
const statusOf = (winner, sources) => (winner ? "ready" : sources.some((s) => s.timedOut) ? "unknown" : "missing");

// Up to this many EXISTING candidates of one source are asked, in order, and
// the first that answers wins. One is not enough: a machine can keep an old
// interpreter under the name asked first (`/usr/bin/python3`, 3.9) and the one
// that works under a versioned name beside it, and asking only the first would
// report the tool missing on a machine that has it.
export const MAX_CANDIDATES = 8;

export function sourced(source, paths, entry, ctx) {
  const existing = paths.filter((p) => ctx.exists(p)).slice(0, MAX_CANDIDATES);
  if (!existing.length) return { source, found: false, ok: false, path: null, version: null };
  return { source, found: true, ...firstAnswering(existing, entry, ctx) };
}

// Stops asking once one answers; when none does, the FIRST one's reason is the
// one worth reading -- it is the candidate a person would have expected to win.
function firstAnswering(paths, entry, ctx) {
  const tried = paths.reduce((found, path) => (found.at(-1)?.ok ? found : [...found, { path, ...asked(path, entry, ctx) }]), []);
  return tried.at(-1).ok ? tried.at(-1) : tried[0];
}

function asked(path, entry, ctx) {
  const call = callOf(path, ctx);
  if (!call) return { ok: false, version: null, reason: "a shim whose target could not be resolved" };
  const r = ctx.run(call.file, [...call.prefix, ...entry.detection.versionArgs]);
  if (r?.error) return unstarted(r.error);
  return judged(r, entry.detection);
}

const unstarted = (error) => (error.code === "ETIMEDOUT" ? { ok: false, version: null, timedOut: true, reason: "found, but it did not answer in time" } : { ok: false, version: null, reason: error.code === "EACCES" ? "found, but not executable" : "found, but it could not be started" });

// Starting is not answering. A Windows Store alias starts, exits 9009 and names
// no version; an interpreter below the row's `minimum` answers perfectly well
// and still cannot do the job. A row with no minimum keeps its old leniency
// about what a version string looks like.
function judged(r, detection) {
  const version = versionIn(`${r?.stdout ?? ""}\n${r?.stderr ?? ""}`, detection.versionPattern);
  if (typeof r?.status === "number" && r.status !== 0) return { ok: false, version, reason: `found, but it exited ${r.status} when asked its version` };
  return floorOf(version, detection.minimum);
}

function floorOf(version, minimum) {
  if (!minimum) return { ok: true, version, reason: null };
  if (!version) return { ok: false, version, reason: "found, but it did not say which version it is" };
  return newer(minimum, version) > 0 ? { ok: false, version, reason: `found ${version}, older than the ${minimum} this needs` } : { ok: true, version, reason: null };
}

// Node cannot spawn a Windows .cmd shim directly: run the script it forwards
// to with this Node instead -- src/process/shim.mjs, which every launch on Windows uses.
function callOf(path, ctx) {
  if (!/\.(cmd|bat)$/i.test(path)) return { file: path, prefix: [] };
  const target = shimTarget(path, ctx.read, pathOf(ctx));
  return target && ctx.exists(target) ? { file: ctx.node, prefix: [target] } : null;
}

export function versionIn(text, pattern) {
  const found = pattern ? new RegExp(pattern).exec(text) : /(\d+\.\d+(?:\.\d+)?)/.exec(text);
  return found ? found[1] : null;
}

const pathOf = (ctx) => (ctx.platform === "win32" ? win32 : posix);

const extsOf = (ctx) => (ctx.platform === "win32" ? String(ctx.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean).map((e) => e.toLowerCase()) : [""]);

const named = (entry, ctx) => entry.detection.commands.flatMap((c) => extsOf(ctx).map((e) => `${c}${e}`));

function projectPaths(entry, ctx) {
  if (!entry.detection.project || !ctx.projectRoot) return [];
  return named(entry, ctx).map((n) => pathOf(ctx).join(ctx.projectRoot, "node_modules", ".bin", n));
}

const managedPaths = (entry, ctx) => (ctx.receipts ?? []).filter((r) => r.tool === entry.id && r.platform === ctx.platform && r.arch === ctx.arch).sort((a, b) => newer(b.version, a.version)).map((r) => receiptPath(ctx.rooms, r));

function systemPaths(entry, ctx) {
  const dirs = String(ctx.env.PATH ?? ctx.env.Path ?? "").split(pathOf(ctx).delimiter).filter(Boolean);
  return dirs.flatMap((d) => named(entry, ctx).map((n) => pathOf(ctx).join(d, n)));
}

// Numeric, part by part: "1.10.0" is newer than "1.9.3". Positive when a > b.
export function newer(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  return [0, 1, 2, 3].reduce((d, i) => d || (pa[i] ?? 0) - (pb[i] ?? 0), 0);
}

const parts = (v) => (String(v ?? "").match(/\d+/g) ?? []).map(Number);
