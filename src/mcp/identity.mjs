// WHO an MCP server belongs to, and the identity that follows from it.
//
//   orbit-managed   Orbit owns it: its definition, its switch, its policy and any
//                  runtime it needs live in the machine store, and the resolver
//                  may choose it
//   external       a host (Claude Code) has it configured. Orbit OBSERVES it --
//                  lists it, may test it -- and never routes to it
//   catalog        KNOWN, and nothing more: a server Orbit's catalog recommends
//                  and nobody has added. Listed so a person can be told it
//                  exists; never installed, enabled or eligible by being known
//
// The same server name can exist under two owners at once -- a `github` the
// host has and a `github` somebody added to Orbit are two different things with
// two different trust boundaries -- so the identity is compound: `managed:github`
// and `external:github`. A page may show both as "GitHub"; nothing that decides
// may collapse them.
export const OWNERSHIP = { managed: "orbit-managed", external: "external", catalog: "catalog" };

const PREFIX = { "orbit-managed": "managed", external: "external", catalog: "catalog" };

export const keyOf = (ownership, id) => `${PREFIX[ownership]}:${id}`;

// `managed:github` -> { ownership: "orbit-managed", id: "github" }, or null.
export function parseKey(key) {
  const at = String(key ?? "").indexOf(":");
  const ownership = OWNERSHIP[String(key).slice(0, at)];
  return at > 0 && ownership ? { ownership, id: String(key).slice(at + 1) } : null;
}
