// What a Orbit-MANAGED MCP definition may say -- the one a person adds from the
// catalog or types into "Add custom", and the one Orbit itself connects with.
//
//   http    url · requiredHeaders [{ name, env }]
//   stdio   command · args        a command the machine already has, found at launch
//           commandRef "managed-runtime" · args
//                                 a runtime Orbit installed into the machine store;
//                                 WHERE it is comes from its receipt, every time,
//                                 never from a path written here
//   both    requiredEnv [names] · provides [capabilities] · signals · selection
//
// It holds NO secret. A header's value, an API key, a token: each is named, with
// the environment variable that supplies it at the moment of connecting
// (src/secrets.mjs), and a definition that carries a value is refused -- the
// machine store is durable, which is exactly why a secret must not be in it. So
// is a URL with a user name, a password or a secret-named query key in it, and
// an argument that looks like one.
import { scrub, SECRET_NAME } from "../scrub.mjs";
import { afterSecretFlag, ENV_NAME, HEADER_NAME, isHttpUrl, LIMIT, SERVER_ID, shownArgs, TRANSPORTS } from "./definition.mjs";

export const SELECTIONS = ["automatic", "approval", "disabled"];
export const COMMAND_REFS = ["managed-runtime"];
const WORD = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;
const TEXT_LIMIT = 300;

const INPUT_FIELDS = ["id", "name", "description", "transport", "url", "requiredHeaders", "command", "commandRef", "args", "requiredEnv", "provides", "signals", "requiresSignal", "enabled", "selection", "priority"];

const RULES = [
  { problems: (d) => Object.keys(d).filter((k) => !INPUT_FIELDS.includes(k)).map((k) => `unknown managed definition field: ${k}`) },
  { says: "an id is letters, digits, and . _ - (up to 64), starting with a letter or digit", fails: (d) => !SERVER_ID.test(String(d.id ?? "")) },
  { says: `transport is one of ${TRANSPORTS.join(", ")}`, fails: (d) => !TRANSPORTS.includes(d.transport) },
  { says: "an http server needs an http:// or https:// url with no user name, password or secret query value in it", fails: (d) => d.transport === "http" && !safeUrl(d.url) },
  { says: `a stdio server needs a command, or commandRef "${COMMAND_REFS[0]}" for a runtime Orbit installed -- one of them`, fails: (d) => d.transport === "stdio" && !oneCommand(d) },
  { says: "args is a list of strings, and none may be a secret -- pass one through requiredEnv instead", fails: (d) => d.args !== undefined && !argsOk(d.args) },
  { problems: (d) => envListProblems(d.requiredEnv) },
  { problems: (d) => headerProblems(d.requiredHeaders) },
  { says: "a managed definition never holds a secret value -- name the environment variable that supplies it", fails: (d) => holdsValue(d) },
  { says: "provides and signals are lists of short words", fails: (d) => [d.provides, d.signals].some((w) => w !== undefined && !(Array.isArray(w) && w.every((x) => WORD.test(String(x)) || isPhrase(x)))) },
  { says: `selection is one of ${SELECTIONS.join(", ")}`, fails: (d) => d.selection !== undefined && !SELECTIONS.includes(d.selection) },
  { says: "priority is a whole number from -100 to 100", fails: (d) => d.priority !== undefined && !(Number.isInteger(d.priority) && Math.abs(d.priority) <= 100) },
  { says: `name and description are text of at most ${TEXT_LIMIT} characters`, fails: (d) => [d.name, d.description].some((t) => t !== undefined && !(typeof t === "string" && t.length <= TEXT_LIMIT)) },
];

// A rule says one sentence when it fails, or -- for a list a person fills row by
// row -- one sentence per row that is wrong, naming the row.
export const managedProblems = (d) => (d && typeof d === "object" && !Array.isArray(d) ? RULES.flatMap((r) => (r.problems ? r.problems(d) : r.fails(d) ? [r.says] : [])) : ["the definition is an object"]);

function safeUrl(url) {
  if (!isHttpUrl(url)) return false;
  const u = new URL(String(url));
  return !u.username && !u.password && ![...u.searchParams.keys()].some((k) => SECRET_NAME.test(k));
}

const oneCommand = (d) => (typeof d.command === "string" && d.command.trim().length > 0 && d.command.length <= LIMIT) !== COMMAND_REFS.includes(d.commandRef);

const argsOk = (args) => Array.isArray(args) && args.every((a, at) => typeof a === "string" && a.length <= LIMIT && scrub(a) === a && !afterSecretFlag(args[at - 1]));

// What sits where a variable's NAME belongs is never repeated back: when it is
// wrong, it is quite often the secret itself, pasted into the wrong box.
const NOT_A_NAME = "is not an environment variable NAME (letters, digits and _, not starting with a digit). If you pasted the secret itself: Orbit never stores a value -- put it in an environment variable and give that variable's name here";

function headerProblems(headers) {
  if (headers === undefined) return [];
  if (!Array.isArray(headers)) return ["requiredHeaders is a list of { name, env }: a header, and the environment variable that supplies its value"];
  return headers.flatMap((h, at) => headerRow(h, at));
}

function headerRow(h, at) {
  const named = HEADER_NAME.test(String(h?.name ?? ""));
  const label = named ? `header ${h.name}` : `header ${at + 1}`;
  return [...(named ? [] : [`${label}: a header name is letters, digits and !#$%&'*+.^_\`|~- -- no quotes, spaces or colon, e.g. Authorization`]), ...nameProblems(h?.env, `${label}'s variable`)];
}

function envListProblems(names) {
  if (names === undefined) return [];
  if (!Array.isArray(names)) return ["requiredEnv is a list of environment variable names"];
  return names.flatMap((n, at) => nameProblems(n, `variable ${at + 1}`));
}

function nameProblems(name, label) {
  if (typeof name !== "string" || !name.trim()) return [`${label}: name the environment variable that holds the value, e.g. MY_SERVICE_TOKEN`];
  return ENV_NAME.test(name) ? [] : [`${label} ${NOT_A_NAME}`];
}

const holdsValue = (d) => [d.headers, d.env, d.requiredHeaders, d.requiredEnv].flat().some((p) => p !== null && typeof p === "object" && "value" in p);

const isPhrase = (x) => typeof x === "string" && x.trim().length > 0 && x.length <= 64;

// The record kept in managed.json: the definition normalised, the person's
// choices beside it, and nothing that came in unasked.
export function managedRecord(input, meta) {
  const at = meta.at;
  return { id: input.id, name: text(input.name) || input.id, description: text(input.description), origin: meta.origin, catalog: meta.catalog ?? null, enabled: input.enabled !== false, selection: input.selection ?? "automatic", priority: input.priority ?? 0, provides: words(input.provides), signals: words(input.signals), requiresSignal: input.requiresSignal === true, definition: definitionOf(input), createdAt: meta.createdAt ?? at, updatedAt: at };
}

export function definitionOf(d) {
  if (d.transport === "http") return { transport: "http", url: String(d.url), requiredHeaders: (d.requiredHeaders ?? []).map((h) => ({ name: String(h.name), env: String(h.env) })) };
  const command = COMMAND_REFS.includes(d.commandRef) ? { commandRef: d.commandRef } : { command: String(d.command) };
  return { transport: "stdio", ...command, args: (d.args ?? []).map(String), requiredEnv: (d.requiredEnv ?? []).map(String) };
}

// Which secrets a definition needs, by the NAME of the variable that holds each.
export const secretNames = (def) => [...(def.requiredHeaders ?? []).map((h) => h.env), ...(def.requiredEnv ?? [])];

// What of a definition a page may see: the same fields, with `set` saying
// whether the variable a secret comes from is present -- never its value. The
// URL is shown whole: a managed URL was refused if it held a user name, a
// password or a secret-named query key, and a page that edits it must get back
// exactly what it saves.
export function publicDefinition(def, isSet = () => false) {
  if (def.transport === "http") return { transport: "http", url: String(def.url), requiredHeaders: (def.requiredHeaders ?? []).map((h) => ({ name: h.name, env: h.env, set: isSet(h.env) })) };
  return { transport: "stdio", command: def.command ?? null, commandRef: def.commandRef ?? null, args: shownArgs(def.args), requiredEnv: (def.requiredEnv ?? []).map((name) => ({ name, set: isSet(name) })) };
}

const text = (t) => (typeof t === "string" ? t.trim().slice(0, TEXT_LIMIT) : "");

const words = (list) => (Array.isArray(list) ? [...new Set(list.filter((w) => typeof w === "string" && w.trim()).map((w) => w.trim().toLowerCase()))] : []);
