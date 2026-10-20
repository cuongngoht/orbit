// What a HOST-shaped MCP server definition may say, and what of it may ever
// be shown. This is the shape a host keeps (Claude Code's `.claude.json`) and
// the RESOLVED shape a probe connects with -- values present, for this moment
// only:
//
//   http    name · url · headers [{ name, value }]
//   stdio   name · command · args [..] · env [{ name, value }]
//   both    scope (user · local · project) · provides [..]
//
// A Orbit-MANAGED definition is a different, stricter thing that never holds a
// value at all (src/mcp/managed.mjs). Here, header and environment VALUES are
// secrets until proven otherwise -- an Authorization header, an API key -- so
// nothing in this file returns one: `publicView` names a header or a variable
// and says whether it has a value, and a URL loses its userinfo and its query
// values, which is where a token hides in a URL. That is how an EXTERNAL
// server is shown, and why showing one never leaks the host's secrets.
import { scrub, SECRET_NAME } from "../scrub.mjs";

export const TRANSPORTS = ["http", "stdio"];
export const SCOPES = ["user", "local", "project"];
export const SERVER_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/;
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
export const LIMIT = 4096;

const RULES = [
  { says: "a name is letters, digits, and . _ - (up to 64), starting with a letter or digit", fails: (d) => !SERVER_ID.test(String(d.name ?? "")) },
  { says: `transport is one of ${TRANSPORTS.join(", ")}`, fails: (d) => !TRANSPORTS.includes(d.transport) },
  { says: `scope is one of ${SCOPES.join(", ")}`, fails: (d) => d.scope !== undefined && !SCOPES.includes(d.scope) },
  { says: "an http server needs an http:// or https:// url", fails: (d) => d.transport === "http" && !isHttpUrl(d.url) },
  { says: "a stdio server needs a command", fails: (d) => d.transport === "stdio" && !(typeof d.command === "string" && d.command.trim() && d.command.length <= LIMIT) },
  { says: "args is a list of strings", fails: (d) => d.args !== undefined && !(Array.isArray(d.args) && d.args.every((a) => typeof a === "string" && a.length <= LIMIT)) },
  { says: "each header is { name, value? } with a valid header name", fails: (d) => !pairsOk(d.headers, HEADER_NAME) },
  { says: "each environment variable is { name, value? } with a valid variable name", fails: (d) => !pairsOk(d.env, ENV_NAME) },
  { says: "provides is a list of short words", fails: (d) => d.provides !== undefined && !(Array.isArray(d.provides) && d.provides.every((p) => typeof p === "string" && p.length <= 64)) },
];

export const definitionProblems = (d) => (d && typeof d === "object" && !Array.isArray(d) ? RULES.filter((r) => r.fails(d)).map((r) => r.says) : ["the definition is an object"]);

export function isHttpUrl(url) {
  try { return ["http:", "https:"].includes(new URL(String(url)).protocol); }
  catch { return false; }
}

const pairsOk = (pairs, re) => pairs === undefined || (Array.isArray(pairs) && pairs.every((p) => re.test(String(p?.name ?? "")) && (p.value === undefined || (typeof p.value === "string" && p.value.length <= LIMIT))));

// What of a URL may be shown: scheme, host, path. Userinfo goes; a query keeps
// its keys and loses its values.
export function redactUrl(url) {
  try { return shown(new URL(String(url))); }
  catch { return url ? "(not a valid URL)" : null; }
}

function shown(u) {
  const query = [...u.searchParams.keys()].map((k) => `${k}=…`).join("&");
  return `${u.protocol}//${u.host}${u.pathname}${query ? `?${query}` : ""}`;
}

// A header or variable, as a page may see it: its name, and whether a value is set.
export const namesOf = (pairs) => (Array.isArray(pairs) ? pairs.map((p) => ({ name: String(p.name), configured: typeof p.value === "string" && p.value.length > 0 })) : []);

// An argument can carry a token too: `--token=…` is masked by SHAPE, the way
// the ledger is, and the value after a flag CALLED a secret (`--api-key sk-…`)
// is masked because of the flag -- two strings the shape alone cannot join.
export const shownArgs = (args) => (Array.isArray(args) ? args.map((a, at) => (afterSecretFlag(args[at - 1]) ? "[redacted]" : scrub(String(a)))) : []);

export const afterSecretFlag = (flag) => typeof flag === "string" && flag.startsWith("-") && !flag.includes("=") && SECRET_NAME.test(flag);

export function publicView(d) {
  const common = { name: d.name, transport: d.transport, scope: d.scope ?? "user", provides: d.provides ?? [] };
  if (d.transport === "http") return { ...common, url: redactUrl(d.url), headers: namesOf(d.headers) };
  return { ...common, command: d.command, args: shownArgs(d.args), env: namesOf(d.env) };
}
