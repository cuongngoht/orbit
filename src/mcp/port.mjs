// The MCP HOST PORT: what Orbit may ask of whichever host runs its OWN MCP
// servers for a session (Claude Code, another assistant). OBSERVATION ONLY.
//
//   name              which host this adapter speaks for
//   listServers()     every server the host has configured, NORMALISED and with
//                     no secret in it (src/mcp/definition.mjs)
//   getServer(id)     one of them, or null
//   testServer(id)    one bounded handshake with a server as the HOST configured
//                     it -> a probe verdict; asked only by an explicit test
//
// What a host has is EXTERNAL to Orbit: listed, maybe tested, never routed to,
// and never written. A server Orbit is to use is added to Orbit -- managed in the
// machine store (src/mcp/state.mjs) -- not to the host, so nothing here adds,
// edits or removes anything in a host's configuration.
//
// The Claude Code adapter is skills/orbit-learn/hosts/claude-mcp.mjs, beside
// the lifecycle adapter for the same host; another host is another adapter and
// changes nothing that reads this port -- the router least of all, which never
// sees it: it reads the snapshot this port's `listServers()` was saved into.
export const MCP_HOST_METHODS = ["listServers", "getServer", "testServer"];

export function mcpHost(adapter) {
  const lacking = MCP_HOST_METHODS.filter((m) => typeof adapter?.[m] !== "function");
  if (lacking.length || typeof adapter?.name !== "string") throw new TypeError(`an MCP host adapter needs a name and ${lacking.join(", ") || "nothing else"}`);
  return adapter;
}
