// The MCP HOST PORT (src/mcp/port.mjs) in memory: a host whose configuration
// is a Map, and which keeps SECRETS the way a real host does -- inside it,
// never on anything `listServers` answers. A test can read `raw` to prove a
// secret stayed in the host, and scan every answer to prove it went no further.
//
// Observation only, like the port: Orbit never writes a host's configuration.
// `verdicts` says what a test answers, per server id or per url / command, so
// no test reaches a network or starts a process.
import { namesOf, redactUrl, shownArgs } from "../../src/mcp/definition.mjs";

const CONNECTED = { status: "connected", checkedAt: "2026-09-23T10:00:00.000Z", reason: null, tools: [{ name: "search", description: "Search the docs" }, { name: "fetch", description: "Fetch one page" }] };

export function fakeMcpHost({ seed = [], verdicts = {} } = {}) {
  const raw = new Map(seed.map((s) => [s.name, { scope: "user", hostEnabled: true, ...s }]));
  const calls = [];
  // A real host dates its check when it makes it, and a check older than
  // CHECK_TTL_MS decides nothing -- so the default verdict is dated NOW, as
  // control-server/test/fixture.mjs's managed probe already is. A fixed date
  // here read as "unknown" a day after it was written. A verdict a test passes
  // keeps its own date.
  const verdictOf = (def) => verdicts[def?.name] ?? verdicts[def?.url] ?? verdicts[def?.command] ?? { ...CONNECTED, checkedAt: new Date().toISOString() };
  return {
    name: "fake",
    raw,
    calls,
    listServers: () => [...raw.values()].map(normalised),
    getServer: (id) => (raw.has(id) ? normalised(raw.get(id)) : null),
    testServer: async (id) => {
      calls.push(["test", id]);
      if (!raw.has(id)) throw new Error(`the host has no MCP server named ${id}`);
      return verdictOf(raw.get(id));
    },
  };
}

const normalised = (s) => ({ id: s.name, name: s.name, host: "fake", scope: s.scope, transport: s.transport, url: redactUrl(s.url), command: s.command ?? null, args: shownArgs(s.args), headers: namesOf(s.headers), env: namesOf(s.env), hostEnabled: s.hostEnabled !== false, status: s.status ?? "unknown", readOnly: s.scope === "plugin" });
