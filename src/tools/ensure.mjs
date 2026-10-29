// ENSURE: the ONE way a need for a tool is met when Orbit may fetch that tool for itself.
//
// A caller names the rows that could serve (`ids`, in the order it prefers them) and gets back how to START one:
//
//   1. the first row that is READY, in that order -- a private runtime Orbit installed before, then whatever else the
//      caller listed that is usable on this machine (every candidate passes the same gate: it starts, names a version
//      new enough, and -- where the row says so -- is a program of THIS system)
//   2. otherwise the first row Orbit is ALLOWED to install by itself: `install.autonomous`, a pinned `archive` or
//      `python-lock` (never a package manager, never a machine-wide change), an installer that serves this platform,
//      and an action no protected boundary holds (src/protected/authorize.mjs -- `tool.acquire` is none)
//   3. otherwise BLOCKED, naming every candidate and what it said, and the instructions a person can follow
//
// Looking never installs: `findOne` is the same walk with no second step, for a status that must not change the
// machine. Installing happens only here and only for a row that says it may. What a caller gets is a LAUNCHER
// (src/tools/launch.mjs): the file, its leading arguments and -- for a tool with a profile -- the environment to run
// it under, derived each time and never stored.
import { Blocked } from "../errors.mjs";
import { authorize, isAuto } from "../protected/authorize.mjs";
import { assetFor } from "./catalog.mjs";
import { installTool } from "./install.mjs";
import { launcherOf } from "./launch.mjs";
import { observeSome } from "./observe.mjs";

// What Orbit may fetch on its own initiative: a pinned release archive or a pinned lock.
export const AUTONOMOUS_STRATEGIES = ["archive", "python-lock"];

// Stopped because no usable tool could be established, not because anything is wrong with the product: BLOCKED (3).
// `code`: TOOL_MISSING | TOOL_UNSUPPORTED | TOOL_UNVERIFIED | TOOL_INSTALL_FAILED; `tried`: each candidate's own words.
export class ToolBlocked extends Blocked {
  constructor(code, message, tried = []) {
    super(message);
    this.code = code;
    this.tried = tried;
  }
}

const rowsFor = (ids, ctx, only) => ids.map((id) => ctx.catalog.find((r) => r.id === id)).filter(Boolean).map((r) => (only ? narrowed(r, only) : r));

const narrowed = (row, only) => ({ ...row, detection: { ...row.detection, sources: only } });

// Detection only: what is ready here and why not, and which row Orbit COULD install -- changes nothing.
export function findOne(ids, ctx, only) {
  const rows = rowsFor(ids, ctx, only);
  const seen = ready(rows, ctx);
  return { found: seen.winner ? resolved(seen.winner, ctx, false) : null, tried: seen.tried, acquirable: rows.find((r) => permitted(r, ctx))?.id ?? null };
}

export async function ensureOne(ids, ctx, only) {
  const rows = rowsFor(ids, ctx, only);
  const seen = ready(rows, ctx);
  if (seen.winner) return resolved(seen.winner, ctx, false);
  return (await acquired(rows, seen.tried, ctx)) ?? refuse(rows, seen.tried, ctx);
}

// What an install runs with: the interpreter a `python-lock` install builds from is Orbit's own, found -- or fetched --
// the same way, and only among the installs Orbit made.
export const installContext = (ctx) => ({ ...ctx, ensurePython: (id) => ensureOne([id], ctx, ["orbit-managed"]) });

// One look at one row, with the receipts as they are NOW: an install made a moment ago -- this walk's own, or the
// interpreter a `python-lock` install just fetched -- must be seen by the next look.
const looked = (row, ctx) => observeSome([row], [row.id], { ...ctx, receipts: ctx.state.receipts() })[0];

function ready(rows, ctx) {
  const tried = [];
  for (const row of rows) {
    const found = looked(row, ctx);
    if (found.status === "ready") return { winner: { row, finding: found }, tried };
    tried.push({ id: row.id, name: row.name, status: found.status, reason: found.reason });
  }
  return { winner: null, tried };
}

function permitted(row, ctx) {
  const installer = ctx.installers?.[row.install.strategy];
  if (!row.install.autonomous || !AUTONOMOUS_STRATEGIES.includes(row.install.strategy) || !installer) return false;
  if (installer.supports?.(row, ctx.platform, ctx.arch)) return false;
  return isAuto(authorize({ kind: "tool.acquire", tool: row.id }));
}

async function acquired(rows, tried, ctx) {
  const row = rows.find((r) => permitted(r, ctx));
  if (!row) return null;
  await installed(row, tried, ctx);
  return verified(row, tried, ctx);
}

// An install is believed only when detection, asked afresh, finds it usable.
function verified(row, tried, ctx) {
  const found = looked(row, ctx);
  if (found.status !== "ready") throw new ToolBlocked("TOOL_UNVERIFIED", `${row.name} was installed, but it does not answer here: ${found.reason ?? "no reason given"}`, tried);
  return resolved({ row, finding: found }, ctx, true);
}

async function installed(row, tried, ctx) {
  try { await installTool(row, installContext(ctx)); }
  catch (error) { throw new ToolBlocked("TOOL_INSTALL_FAILED", `${row.name} could not be installed: ${error.message}`, tried); }
}

function resolved({ row, finding }, ctx, acquiredNow) {
  const launch = finding.launch ?? { file: finding.path, args: [] };
  const asset = finding.source === "orbit-managed" ? assetFor(row, ctx.platform, ctx.arch) : null;
  return { id: row.id, entry: row, finding, file: launch.file, args: launch.args, source: finding.source, version: finding.version, acquired: acquiredNow, launcher: (purpose) => launcherOf(row, { ...finding, launch }, ctx, purpose, asset) };
}

function refuse(rows, tried, ctx) {
  const unsupported = rows.some((r) => AUTONOMOUS_STRATEGIES.includes(r.install.strategy) && ctx.installers?.[r.install.strategy]?.supports?.(r, ctx.platform, ctx.arch));
  throw new ToolBlocked(unsupported ? "TOOL_UNSUPPORTED" : "TOOL_MISSING", sentence(rows, tried, ctx), tried);
}

const sentence = (rows, tried, ctx) => `no usable ${rows[0]?.name ?? "tool"} is available: ${rows.map((r) => `${r.name} (${reasonOf(r, tried, ctx)})`).join("; ")}`;

// Why one candidate is not it: what detection said, what the installer says about this platform, and -- for a row Orbit
// does not install itself -- how a person would.
function reasonOf(row, tried, ctx) {
  const seen = tried.find((t) => t.id === row.id);
  const why = ctx.installers?.[row.install.strategy]?.supports?.(row, ctx.platform, ctx.arch);
  return [seen?.reason ?? "not found", why, row.install.autonomous ? null : row.install.instructions].filter(Boolean).join(" · ");
}
