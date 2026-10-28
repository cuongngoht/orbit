// RECONCILIATION for MCP: the plugin's catalog + Orbit's records (state v2) +
// the install receipts + the disk + the secret port -> the EFFECTIVE list, one
// entry per server and OWNER, which is what the resource registry, the router
// and Orbit Control read.
//
// Three owners, never merged (src/mcp/identity.mjs):
//
//   orbit-managed   what Orbit owns. Its answers are kept APART, because they are
//                  different questions with different answers:
//                    enabled        a person wants it used at all
//                    runtimeReady   it could run here now: its runtime is on the
//                                   disk (a receipt is not proof -- the entrypoint
//                                   is looked for every time), every secret it
//                                   names is set, and no fresh check says it fails
//                    available      enabled AND runtimeReady
//                    eligible       available, its selection is not `disabled`,
//                                   and its policy leaves something it may be used
//                                   for -- what the resolver may consider
//   external       what a host has configured: observed, maybe testable, never
//                  eligible. runtimeReady may well be true -- the HOST can run it --
//                  and `enabled` is false: Orbit was never asked to use it
//   catalog        a server the catalog RECOMMENDS and nobody added: known, so
//                  the router can say it exists and Control can add it -- never
//                  installed, enabled or eligible by being known
//
// Configured is not connected: a check older than CHECK_TTL_MS decides nothing,
// and `status` says `unknown` rather than inventing a connection.
import { capabilityVerdict } from "../policy.mjs";
import { recognised } from "./catalog.mjs";
import { keyOf } from "./identity.mjs";
import { publicDefinition, secretNames } from "./managed.mjs";
import { policyOf } from "./policy.mjs";
import { unsetSecrets } from "../secrets.mjs";
import { entrypointOf } from "./state.mjs";

export const SNAPSHOT_TTL_MS = 24 * 3600 * 1000;
export const CHECK_TTL_MS = 24 * 3600 * 1000;
const FAILING = new Set(["failed", "needs-auth"]);

// input: { catalog, state: { managed, external, checks, policies, approvals },
//          receipts, secrets, now, platform, arch, exists, rooms, installers }
export function effectiveMcp(input) {
  const ctx = contextOf(input);
  const added = new Set(Object.values(ctx.managed).map((m) => m.catalog ?? m.id));
  return [...Object.values(ctx.managed).map((m) => managedEntry(m, ctx)), ...ctx.external.map((s) => externalEntry(s, ctx)), ...ctx.catalog.filter((e) => e.recommended && !added.has(e.id)).map((e) => catalogEntry(e, ctx))];
}

function contextOf(input) {
  const s = input.state ?? {};
  const external = s.external ?? {};
  return { catalog: input.catalog ?? [], managed: s.managed?.servers ?? {}, external: Array.isArray(external.servers) ? external.servers : [], host: external.host ?? null, snapshotStale: stale(external.observedAt, input.now, SNAPSHOT_TTL_MS), checks: s.checks?.checks ?? {}, policies: s.policies ?? {}, grants: s.approvals?.grants ?? {}, receipts: input.receipts ?? [], secrets: input.secrets ?? { has: () => false }, now: input.now, platform: input.platform, arch: input.arch, exists: input.exists ?? (() => false), rooms: input.rooms, installers: input.installers ?? {} };
}

const stale = (at, now, ttl) => !at || now - Date.parse(at) > ttl;

// ---- orbit-managed -------------------------------------------------------------

function managedEntry(m, ctx) {
  const key = keyOf("orbit-managed", m.id);
  const entry = ctx.catalog.find((e) => e.id === m.catalog) ?? null;
  const facts = factsOf(m, key, ctx);
  const policy = policyOf(ctx.policies, key);
  return { ...identityOf(m, key, entry), ...routingOf(m, entry), protected: protectedTools(m, entry, ctx), ...checkOf(ctx.checks[key], ctx.now), ...answersOf(m, facts, policy), policy, approval: grantOf(ctx.grants[key], ctx.now), install: installOf(m, entry, ctx), runtime: runtimeView(facts.runtime), definition: publicDefinition(m.definition, ctx.secrets.has) };
}

// A catalog server's words come from the catalog this plugin ships when the
// row is still there; a custom server's are the person's own.
const wordsOf = (m, entry, field) => (m.origin === "catalog" && entry?.[field]) || m[field] || entry?.[field] || "";

const identityOf = (m, key, entry) => ({ key, id: m.id, name: wordsOf(m, entry, "name") || m.id, description: wordsOf(m, entry, "description"), ownership: "orbit-managed", origin: m.origin, catalog: m.catalog ?? null, transport: m.definition.transport, createdAt: m.createdAt ?? null, updatedAt: m.updatedAt ?? null });

// Routing data is PRODUCT knowledge: the catalog this plugin ships describes a
// catalog server better than the copy kept when it was added, so a newer
// catalog's words win -- and when the row is gone, the kept copy still works.
const routingOf = (m, entry) => ({ provides: entry?.provides?.length ? entry.provides : m.provides ?? [], signals: entry?.signals?.length ? entry.signals : m.signals ?? [], requiresSignal: entry ? entry.requiresSignal === true : m.requiresSignal === true });

// Which of its tools ARE a protected action (src/protected/mcp.mjs, 0.2.0): what the catalog row it was added from --
// or the row that recognises it, for a server a person added by hand -- declares. Read on every look, so this plugin's
// newer knowledge of a server's tools applies to one added before it.
const protectedTools = (m, entry, ctx) => (entry ?? recognised(ctx.catalog, { id: m.id, url: m.definition?.url, command: m.definition?.command, args: m.definition?.args }))?.protected ?? {};

function factsOf(m, key, ctx) {
  const check = freshCheck(ctx.checks[key], ctx.now);
  const runtime = RUNTIMES[runtimeKind(m.definition)](m, ctx);
  const missing = unsetSecrets(secretNames(m.definition), ctx.secrets);
  return { check, runtime, missing, failing: FAILING.has(check?.status), ready: runtime.present && !missing.length && !FAILING.has(check?.status) };
}

export const runtimeKind = (def) => (def.transport === "http" ? "remote" : def.commandRef ? "managed" : "machine");

// remote   a URL, connected to on demand -- nothing is installed, nothing to find
// machine  a command this machine already has, found on PATH when it starts
// managed  a runtime Orbit installed: located from its RECEIPT under the store's
//          rooms, then looked for on the disk
const RUNTIMES = {
  remote: () => ({ kind: "remote", present: true, receipt: null }),
  machine: () => ({ kind: "machine", present: true, receipt: null }),
  managed: (m, ctx) => managedRuntime(newestReceipt(m.id, ctx), ctx),
};

function managedRuntime(receipt, ctx) {
  if (!receipt) return { kind: "managed", present: false, receipt: null };
  return { kind: "managed", present: Boolean(ctx.rooms) && ctx.exists(entrypointOf(ctx.rooms, receipt)), receipt };
}

// The one Orbit installed last for this platform.
const newestReceipt = (id, ctx) => ctx.receipts.filter((r) => r.mcp === id && r.platform === ctx.platform && r.arch === ctx.arch).sort((a, b) => String(b.installedAt ?? "").localeCompare(String(a.installedAt ?? "")))[0] ?? null;

// Why a managed server is or is not ready, in order; the last row always matches.
const STATE_RULES = [
  { state: "disabled", when: (_f, m) => m.enabled === false, why: () => "disabled in Orbit" },
  { state: "not-installed", when: (f) => !f.runtime.present, why: (f) => (f.runtime.receipt ? "its receipt names a runtime that is no longer in the machine store -- install it again" : "its runtime is not installed in the machine store yet") },
  { state: "needs-attention", when: (f) => f.missing.length > 0, why: (f) => `${f.missing.join(", ")} ${f.missing.length > 1 ? "are" : "is"} not set in this environment` },
  { state: "needs-attention", when: (f) => f.failing, why: (f) => `its last check said ${f.check.status}${f.check.reason ? ` -- ${f.check.reason}` : ""}` },
  { state: "ready", when: () => true, why: () => null },
];

function answersOf(m, facts, policy) {
  const rule = STATE_RULES.find((r) => r.when(facts, m));
  const available = m.enabled !== false && facts.ready;
  const selection = m.selection ?? "automatic";
  return { enabled: m.enabled !== false, selection, priority: m.priority ?? 0, runtimeReady: facts.ready, available, eligible: available && selection !== "disabled" && usableFor(policy, m), state: rule.state, why: rule.why(facts, m), secrets: { missing: facts.missing } };
}

// Something it provides is not denied -- workflows aside, which are exceptions.
const usableFor = (policy, m) => (m.provides?.length ? m.provides : [null]).some((c) => capabilityVerdict(policy, c) !== "deny");

const grantOf = (grant, now) => (grant?.until && Date.parse(grant.until) > now ? { until: grant.until } : null);

// What an install WOULD do, described and never done.
function installOf(m, entry, ctx) {
  const kind = runtimeKind(m.definition);
  if (kind !== "managed") return { strategy: kind === "remote" ? "remote-http" : "manual", supported: kind === "remote", reason: kind === "remote" ? null : "it runs a command this machine already has", version: null, source: null };
  const installer = ctx.installers[entry?.install?.strategy];
  const reason = !entry ? "the catalog row it was installed from is no longer in this plugin" : installer ? installer.supports?.(entry, ctx.platform, ctx.arch) ?? null : entry.install.instructions ?? `Orbit has no installer named ${entry.install.strategy}`;
  return { strategy: entry?.install?.strategy ?? "manual", supported: reason === null, reason, version: entry?.install?.version ?? null, source: entry?.install?.source ?? null };
}

// A receipt as a page may see it: never a path, absolute or otherwise.
const runtimeView = (r) => ({ kind: r.kind, present: r.present, receipt: r.receipt ? { version: r.receipt.version, platform: r.receipt.platform, arch: r.receipt.arch, installedAt: r.receipt.installedAt ?? null, source: r.receipt.source ?? null, checksum: r.receipt.checksum ?? null, verified: r.present } : null });

// ---- checks -----------------------------------------------------------------------

const freshCheck = (check, now) => (check?.checkedAt && now - Date.parse(check.checkedAt) <= CHECK_TTL_MS ? check : null);

// What the last check found, whether or not it is still fresh enough to decide
// the status: a page may show "8 tools, checked 3 days ago" honestly.
const checkOf = (check, now) => ({ status: freshCheck(check, now)?.status ?? "unknown", checkedAt: check?.checkedAt ?? null, lastStatus: check?.status ?? null, reason: check?.reason ?? null, tools: check?.tools ?? null, toolCount: check?.tools?.length ?? null, checkFresh: Boolean(freshCheck(check, now)) });

// ---- external -----------------------------------------------------------------------

function externalEntry(server, ctx) {
  const key = keyOf("external", server.id);
  const entry = recognised(ctx.catalog, server);
  const check = checkOf(ctx.checks[key], ctx.now);
  const status = server.status === "pending-approval" ? "pending-approval" : check.status;
  return { ...server, ...check, key, host: server.host ?? ctx.host, ownership: "external", description: entry?.description ?? "", catalog: entry?.id ?? null, provides: entry?.provides ?? [], signals: entry?.signals ?? [], requiresSignal: entry?.requiresSignal === true, observed: true, status, enabled: false, selection: "disabled", runtimeReady: server.hostEnabled !== false && status !== "pending-approval" && !FAILING.has(status), available: false, eligible: false, state: "external", why: `observed in ${server.host ?? ctx.host ?? "the host"}'s own configuration -- Orbit does not route to it`, stale: server.observedAt ? stale(server.observedAt, ctx.now, SNAPSHOT_TTL_MS) : ctx.snapshotStale };
}

// ---- catalog --------------------------------------------------------------------------

const catalogEntry = (e, ctx) => ({ ...checkOf(null, ctx.now), key: keyOf("catalog", e.id), id: e.id, name: e.name, description: e.description, ownership: "catalog", catalog: e.id, transport: e.definition?.transport ?? null, provides: e.provides, signals: e.signals, requiresSignal: e.requiresSignal, enabled: false, selection: "disabled", runtimeReady: false, available: false, eligible: false, state: "not-added", why: "in Orbit's catalog but not added to Orbit -- Orbit Control adds it" });
