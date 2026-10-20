// RECONCILIATION for CLI tools: the plugin's catalog + desired state + the last
// observation + the install receipts -> the EFFECTIVE list, one entry per tool.
//
// DESIRED and OBSERVED never mix. `enabled` is what somebody wants (default on:
// a catalog tool is one Orbit may need); `status` is what the last detection
// found -- ready or missing -- or `unknown` when nothing has looked yet or the
// look is older than OBSERVATION_TTL_MS. A tool is `available` only when it is
// both wanted and observed ready.
//
// What an install WOULD do is described, never done: `install` says whether
// Orbit can install it privately here, from what, and at which pinned version;
// `update` says a managed install is older than the catalog pins now -- the one
// thing a plugin upgrade can change about a tool, and only an explicit update
// acts on it. An existing install is never replaced by reconciliation.
import { newer } from "./detect.mjs";

export const OBSERVATION_TTL_MS = 7 * 24 * 3600 * 1000;

export function effectiveTools({ catalog, desired, observed, receipts, now, platform, arch, installers }) {
  return catalog.map((entry) => effective(entry, { desired: desired?.tools?.[entry.id], seen: observed?.tools?.[entry.id], receipts: (receipts ?? []).filter((r) => r.tool === entry.id && r.platform === platform && r.arch === arch), now, platform, arch, installers }));
}

function effective(entry, ctx) {
  const enabled = ctx.desired?.enabled !== false;
  const current = Boolean(ctx.seen?.checkedAt) && ctx.now - Date.parse(ctx.seen.checkedAt) <= OBSERVATION_TTL_MS;
  const status = current ? ctx.seen.status : "unknown";
  const managed = managedOf(ctx.receipts);
  return { id: entry.id, name: entry.name, summary: entry.summary, provides: entry.provides, enabled, status, available: enabled && status === "ready", state: stateOf(enabled, status), source: current ? ctx.seen.source : null, version: current ? ctx.seen.version : null, path: current ? ctx.seen.path : null, sources: current ? ctx.seen.sources ?? [] : [], reason: current ? ctx.seen.reason ?? null : null, checkedAt: ctx.seen?.checkedAt ?? null, stale: Boolean(ctx.seen?.checkedAt) && !current, desired: ctx.desired ?? null, install: installOf(entry, ctx), managed, update: updateOf(entry, managed) };
}

function stateOf(enabled, status) {
  if (!enabled) return "disabled";
  return { ready: "ready", missing: "not-installed" }[status] ?? "unknown";
}

// The newest managed install for this platform, if Orbit has made one.
function managedOf(receipts) {
  const newest = [...receipts].sort((a, b) => newer(b.version, a.version))[0];
  return newest ? { version: newest.version, installedAt: newest.installedAt ?? null, source: newest.source ?? null, checksum: newest.checksum ?? null } : null;
}

function installOf(entry, ctx) {
  const strategy = entry.install.strategy;
  const reason = unsupported(entry, ctx);
  return { strategy, supported: reason === null, reason, version: entry.install.version, source: entry.install.source, instructions: entry.install.instructions };
}

// An installer says for itself whether it can serve this row on this platform.
function unsupported(entry, ctx) {
  const installer = ctx.installers?.[entry.install.strategy];
  if (!installer) return entry.install.instructions ?? "Orbit has no private installer for this tool";
  return installer.supports?.(entry, ctx.platform, ctx.arch) ?? null;
}

const updateOf = (entry, managed) => (managed && entry.install.version && newer(entry.install.version, managed.version) > 0 ? { from: managed.version, to: entry.install.version } : null);
