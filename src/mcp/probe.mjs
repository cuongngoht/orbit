// Is an MCP server actually answering? One bounded handshake through the
// broker (src/mcp/runtime/session.mjs) -- initialize, initialized, tools/list,
// close -- and nothing kept of what it said beyond its tool NAMES and one-line
// descriptions.
//
// A definition here is RESOLVED, in the host's shape: header and variable
// pairs carry their VALUES ({ name, value }) because this is the moment they
// are needed. A host adapter hands in the host's own; src/mcp/connect.mjs
// resolves a managed server's from the secret port. Neither ever reaches a
// verdict.
//
// It is only ever reached from an explicit "Test Connection": a stdio probe
// RUNS the command, so it is never done on a GET, and never by the router.
//
// The answer is `connected`, `needs-auth` (the server said 401/403), `failed`
// or `unknown` (a transport nothing here speaks), with a reason written in
// Orbit's words: a server's own error text is not repeated, and a response body
// is never stored.
import { scrub } from "../scrub.mjs";
import { openSession } from "./runtime/session.mjs";
import { McpStop } from "./runtime/stop.mjs";

export { PROTOCOL_VERSION } from "./runtime/session.mjs";
export const PROBE_TIMEOUT_MS = 15000;
const DESCRIPTION_LIMIT = 200;

// deps: { fetch, start (the Process port's), env, timeoutMs?, now? }
export function createProbe(deps) {
  const bound = { timeoutMs: PROBE_TIMEOUT_MS, env: {}, now: () => new Date(), ...deps };
  return (definition) => probed(definition, bound);
}

async function probed(definition, deps) {
  if (!["http", "stdio"].includes(definition?.transport)) return verdict(deps, "unknown", `a ${definition?.transport ?? "?"} server cannot be tested from here`);
  try { return await handshake(specOf(definition), deps); }
  catch (e) { return verdict(deps, e?.kind === "needs-auth" ? "needs-auth" : "failed", e instanceof McpStop ? e.message : `the check could not complete (${scrub(e?.name ?? "error")})`); }
}

async function handshake(spec, deps) {
  const session = await openSession(spec, deps);
  try { return verdict(deps, "connected", null, (await session.tools()).map(toolOf)); }
  finally { session.close(); }
}

const verdict = (deps, status, reason, tools) => ({ status, checkedAt: deps.now().toISOString(), reason: reason ?? null, tools: tools ?? null });

const toolOf = (t) => ({ name: String(t?.name ?? "?").slice(0, 128), description: String(t?.description ?? "").split("\n")[0].slice(0, DESCRIPTION_LIMIT) });

export const specOf = (d) => ({ transport: d.transport, url: d.url, headers: pairs(d.headers), command: d.command, args: d.args ?? [], env: pairs(d.env) });

// `[{ name, value }]` -> `{ name: value }`, values only where one was given.
const pairs = (list) => Object.fromEntries((list ?? []).filter((p) => typeof p?.value === "string").map((p) => [p.name, p.value]));
