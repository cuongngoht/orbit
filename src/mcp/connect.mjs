// A Orbit-managed MCP record -> what the broker connects with, resolved at the
// moment of connecting and never kept:
//
//   secrets   each header or variable the definition NAMES is read from the
//             secret port (src/secrets.mjs) now; one that is not set stops
//             here, before anything is started or reached
//   command   `commandRef: "managed-runtime"` becomes the entrypoint of the
//             runtime Orbit installed, derived from its RECEIPT and the store's
//             rooms and then looked for on the disk -- a receipt is not proof
//   env       a managed stdio server gets the variables it declared and the few
//             any process needs to start (BASE_ENV) -- never the rest of this
//             process's environment, which is where every OTHER secret lives
//
// The result is in the host's resolved shape ({ name, value } pairs), the one
// src/mcp/probe.mjs and the invocation gate both take.
import { stopped } from "./runtime/stop.mjs";
import { unsetSecrets } from "../secrets.mjs";
import { secretNames } from "./managed.mjs";
import { entrypointOf } from "./state.mjs";


// ctx: { secrets, rooms, receipts, catalog, exists, platform, arch, node }
export function resolvedDefinition(record, ctx) {
  const def = record.definition;
  const missing = unsetSecrets(secretNames(def), ctx.secrets);
  if (missing.length) throw stopped("needs-auth", `${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not set in this environment, so ${record.id} was not connected to`);
  return def.transport === "http" ? { transport: "http", url: def.url, headers: def.requiredHeaders.map((h) => ({ name: h.name, value: ctx.secrets.value(h.env) })) } : { transport: "stdio", ...commandOf(record, ctx), env: def.requiredEnv.map((name) => ({ name, value: ctx.secrets.value(name) })) };
}

function commandOf(record, ctx) {
  if (!record.definition.commandRef) return { command: record.definition.command, args: record.definition.args };
  const entry = runtimeOf(record, ctx);
  const launch = ctx.catalog.find((e) => e.id === record.catalog)?.install?.launch ?? "direct";
  return launch === "node" ? { command: ctx.node, args: [entry, ...record.definition.args] } : { command: entry, args: record.definition.args };
}

function runtimeOf(record, ctx) {
  const receipt = ctx.receipts.filter((r) => r.mcp === record.id && r.platform === ctx.platform && r.arch === ctx.arch).sort((a, b) => String(b.installedAt ?? "").localeCompare(String(a.installedAt ?? "")))[0];
  if (!receipt) throw stopped("unreachable", `${record.id}'s runtime is not installed in the machine store -- install it in Orbit Control`);
  const entry = entrypointOf(ctx.rooms, receipt);
  if (!ctx.exists(entry)) throw stopped("unreachable", `${record.id}'s receipt names a runtime that is no longer in the machine store -- install it again`);
  return entry;
}

// Test Connection for a managed server: resolve it -- a secret that is not set
// or a runtime that is not there answers at once, and nothing is started or
// reached -- then one probe (src/mcp/probe.mjs) bound to BASE_ENV.
export async function probeManaged(record, ctx, probe) {
  const resolved = attempted(() => resolvedDefinition(record, ctx));
  if (resolved.error) return { status: resolved.error.kind === "needs-auth" ? "needs-auth" : "failed", checkedAt: ctx.now(), reason: resolved.error.message, tools: null };
  return probe(resolved.value);
}

function attempted(fn) {
  try { return { value: fn() }; }
  catch (e) { return { error: e }; }
}
