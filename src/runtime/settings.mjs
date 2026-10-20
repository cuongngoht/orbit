// What a PERSON set for how a checkout runs on a machine: how to choose a provider,
// which declared command starts a component, which environment variable NAMES to
// hand it, and how to tell it is ready.
//
// One schema-stamped document per checkout in the machine store -- never in the
// repository, because a preference like "run this natively" or "ready when this
// port answers" is true of a person on a machine and is nobody else's to inherit
// -- and written only by a person: with `--human` on the command line, or in Orbit
// Control. Inside it, every machine keeps its OWN block (`hosts`), so a store that
// two laptops share does not hand one laptop's preferences to the other.
//
// A write names the revision it was made against and a stale one is refused
// (src/store/revisioned.mjs): a session must not overwrite a change somebody made
// a minute ago with a copy it read an hour ago.
//
// What a setting can NOT be is as important as what it can. It is never a command
// -- a start command is chosen BY NAME among the ones a file declared. It is never
// a secret: an environment variable is named and read from the environment at the
// moment of starting. It is never a way to make something compatible: there is no
// `force` and no `weight`, because a preference chooses among ways that work.
//
// It may name the servers a checkout needs that are NOT its own -- a database behind
// a VPN, an internal API -- as connectivity TARGETS: a host and a port, which
// components require it, and where to ask from (this machine, the dev container,
// both). A target is never a URL with a credential, a connection string, a command
// or a header: whether a port answers is a question of the network, and a login is
// a test's. Asking is a command of its own (src/runtime/connectivity/), and how hard
// to try -- attempts, the wait between them, the deadline of each -- is a bounded
// retry policy a person sets here, for every target or for one.
import { Refused } from "../errors.mjs";
import { scrub } from "../scrub.mjs";
import { isLoopback } from "../probe/index.mjs";
import { readState, writeState } from "../store/control.mjs";
import { withLock } from "../store/lock.mjs";
import { STAMPS, checkRevision, contentOf, revisionFor } from "../store/revisioned.mjs";
import { safeName } from "./discover/commands.mjs";
import { SANDBOX_DEFAULTS, portProblem, sandboxFilled, sandboxProblems } from "./sandbox/policy.mjs";

export const SETTINGS_SCHEMA = 1;

export const STRATEGIES = ["auto", "native", "devcontainer"];

// Where a connectivity check is asked FROM: the ways a component can run, each its own network.
export const LOCATIONS = STRATEGIES.slice(1);

export const DEFAULT_RETRY = { attempts: 3, intervalMs: 1000, timeoutMs: 3000 };

export const BLOCK_DEFAULTS = { strategy: "auto", reuseExternal: false, components: {}, connectivity: { retry: DEFAULT_RETRY, targets: {} }, sandbox: SANDBOX_DEFAULTS };

export const MAX_TARGETS = 50;

// What a target says when it does not say: checked by TCP, required by nothing yet, asked from
// everywhere a component can run, and never a gate on a start until a person makes it one.
const TARGET_DEFAULTS = { protocol: "tcp", requiredBy: [], beforeStart: false, classification: "unknown" };

// What a person says a target IS, for the one question a sandbox's data raises: whose data is it. Reported next
// to a sandbox, never enforced by runtime (a QA step reads it); the worst one a sandbox's components need wins.
export const CLASSIFICATIONS = ["task-isolated", "shared-development", "external-readonly", "production", "unknown"];

// `<ecosystem>:<directory>`, and the directory is whatever the checkout calls it: a space and a
// non-ASCII letter are fine -- discovery produces such keys -- and a control character is not.
const COMPONENT_KEY = /^[a-z][a-z0-9-]*:[^\u0000-\u001f]{1,200}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const PROBE_KINDS = ["http", "tcp"];

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function readinessProblem(r) {
  if (!isObject(r) || !PROBE_KINDS.includes(r.kind)) return `readiness is { kind: ${PROBE_KINDS.join("|")}, target, expect? }`;
  const asked = String(r.target ?? "");
  if (scrub(asked) !== asked || /@/.test(asked)) return "a readiness target must not carry a credential";
  return PROBES[r.kind](r);
}

// What each kind of readiness target must be. A probe only ever looks at THIS
// machine, so an http target is loopback or it is refused here, where the person
// can fix it, and not later where a probe would.
const PROBES = {
  http: (r) => (urlOk(r.target) ? expectProblem(r) : "an http readiness target is a URL on this machine: http://localhost:<port>/<path>"),
  tcp: (r) => (Number.isInteger(r.target) && r.target >= 1 && r.target <= 65535 ? null : "a tcp readiness target is a port number"),
};

const urlOk = (target) => {
  try {
    const url = new URL(target);
    return ["http:", "https:"].includes(url.protocol) && isLoopback(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
};

const expectProblem = (r) => (r.expect === undefined || (Number.isInteger(r.expect) && r.expect >= 100 && r.expect <= 599) ? null : "expect is an HTTP status, 100 to 599");

function componentProblem(key, c) {
  if (!COMPONENT_KEY.test(key)) return `${JSON.stringify(key)} is not a component key (<ecosystem>:<directory>)`;
  if (!isObject(c)) return `${key}: a component's settings are an object`;
  const unknown = Object.keys(c).filter((k) => !["provider", "command", "env", "readiness", "port"].includes(k));
  return unknown.length ? `${key}: unknown setting ${unknown.join(", ")}` : COMPONENT_RULES.map((r) => r(key, c)).find(Boolean) ?? null;
}

const COMPONENT_RULES = [
  (key, c) => (c.provider !== undefined && !STRATEGIES.slice(1).includes(c.provider) ? `${key}: provider is ${STRATEGIES.slice(1).join(" or ")}` : null),
  (key, c) => (c.command !== undefined && !safeName(c.command) ? `${key}: command names one of the commands a file declared, by name` : null),
  (key, c) => (c.env !== undefined && (!Array.isArray(c.env) || c.env.length > 20 || c.env.some((n) => !ENV_NAME.test(n))) ? `${key}: env lists variable NAMES, up to 20` : null),
  (key, c) => (c.readiness !== undefined && readinessProblem(c.readiness) ? `${key}: ${readinessProblem(c.readiness)}` : null),
  (key, c) => (c.port !== undefined && portProblem(c.port) ? `${key}: ${portProblem(c.port)}` : null),
];

// ---- connectivity: targets and the retry policy ---------------------------------------------

// How hard a check may try, bounded on every side: no retry forever, no busy loop, no attempt
// without a deadline. [least, most, unit]
const RETRY_LIMITS = { attempts: [1, 10, ""], intervalMs: [250, 30000, " (milliseconds)"], timeoutMs: [250, 30000, " (milliseconds)"] };

// A policy, or a target's own override of some of it: every key it names within bounds.
function retryProblem(r, where) {
  if (!isObject(r)) return `${where} is { attempts, intervalMs, timeoutMs }`;
  const unknown = Object.keys(r).filter((k) => !Object.hasOwn(RETRY_LIMITS, k));
  if (unknown.length) return `${where}: unknown setting ${unknown.join(", ")}`;
  return Object.keys(r).map((k) => limitProblem(r[k], k, where)).find(Boolean) ?? null;
}

function limitProblem(value, key, where) {
  const [least, most, unit] = RETRY_LIMITS[key];
  return Number.isInteger(value) && value >= least && value <= most ? null : `${where}.${key} is ${least} to ${most}${unit}`;
}

const TARGET_ID = /^[a-z][a-z0-9-]{0,39}$/;
const TARGET_KEYS = ["label", "host", "port", "protocol", "requiredBy", "checkFrom", "beforeStart", "retry", "note", "classification"];
const PROTOCOLS = ["tcp"];
const CONTROL = /[\u0000-\u001f\u007f]/;
// A DNS name, with an underscore allowed inside a label: a compose service (`my_db`) is one a
// container's resolver answers for, whatever the hostname RFCs say.
const HOSTNAME = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9])?)*$/;
const DOTTED = /^[\d.]+$/;

const ipv4 = (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && host.split(".").every((n) => Number(n) <= 255);

// Bracketless, hex groups only: one `::` at most, eight groups without it.
function ipv6(host) {
  if (!/^[0-9A-Fa-f:]+$/.test(host) || !host.includes(":") || host.includes(":::") || host.split("::").length > 2) return false;
  const groups = host.split(":").filter(Boolean);
  return groups.every((g) => g.length <= 4) && (host.includes("::") ? groups.length < 8 : groups.length === 8);
}

// A host is a name or an address and nothing a probe could be pointed at through it: no scheme, no
// credential, no path, no port (the port is its own setting).
const HOST_RULES = [
  { fails: (h) => typeof h !== "string" || h.length < 1 || h.length > 253, says: "host is a host name or an address, up to 253 characters" },
  { fails: (h) => /[\s/\\@]|:\/\//.test(h), says: "host carries no scheme, no credential and no path: a name or an address only" },
  { fails: (h) => scrub(h) !== h, says: "host must not carry a credential" },
  { fails: (h) => DOTTED.test(h) && !ipv4(h), says: "host is not an IPv4 address" },
  { fails: (h) => !DOTTED.test(h) && !HOSTNAME.test(h) && !ipv6(h), says: "host is a host name (letters, digits, dashes, underscores and dots) or an IPv4 or IPv6 address — no brackets and no port: the port is its own setting" },
];

const hostProblem = (host) => HOST_RULES.find((r) => r.fails(host))?.says ?? null;

const textOk = (v, least, most) => typeof v === "string" && v.length >= least && v.length <= most && !CONTROL.test(v) && scrub(v) === v;

const checkFromOk = (c) => Array.isArray(c) && c.length > 0 && new Set(c).size === c.length && c.every((p) => LOCATIONS.includes(p));

const unknownOf = (t) => Object.keys(t).filter((k) => !TARGET_KEYS.includes(k));

// Ordered: the first reason one target does not hold, said with its id.
const TARGET_RULES = [
  (id, t) => (unknownOf(t).length ? `${id}: unknown setting ${unknownOf(t).join(", ")}` : null),
  (id, t) => (textOk(t.label, 1, 80) ? null : `${id}: label is up to 80 characters, and never a credential`),
  (id, t) => (hostProblem(t.host) ? `${id}: ${hostProblem(t.host)}` : null),
  (id, t) => (Number.isInteger(t.port) && t.port >= 1 && t.port <= 65535 ? null : `${id}: port is 1 to 65535`),
  (id, t) => (PROTOCOLS.includes(t.protocol) ? null : `${id}: protocol is ${PROTOCOLS.join(" or ")}`),
  (id, t) => (Array.isArray(t.requiredBy) && t.requiredBy.length <= 50 && t.requiredBy.every((k) => typeof k === "string" && COMPONENT_KEY.test(k)) ? null : `${id}: requiredBy lists component keys (<ecosystem>:<directory>)`),
  (id, t) => (checkFromOk(t.checkFrom) ? null : `${id}: checkFrom lists where to ask from: ${LOCATIONS.join(", ")}`),
  (id, t) => (typeof t.beforeStart === "boolean" ? null : `${id}: beforeStart is true or false`),
  (id, t) => (t.retry === undefined ? null : retryProblem(t.retry, `${id}: retry`)),
  (id, t) => (t.note === undefined || textOk(t.note, 0, 200) ? null : `${id}: note is up to 200 characters, and never a credential`),
  (id, t) => (CLASSIFICATIONS.includes(t.classification) ? null : `${id}: classification is ${CLASSIFICATIONS.join(", ")}`),
];

function targetProblem(id, t) {
  if (!TARGET_ID.test(id)) return `${JSON.stringify(id)} is not a target id (lowercase letters, digits and dashes, up to 40, starting with a letter)`;
  if (!isObject(t)) return `${id}: a target is an object`;
  return TARGET_RULES.map((rule) => rule(id, t)).find(Boolean) ?? null;
}

function targetsProblem(targets) {
  if (!isObject(targets)) return "connectivity.targets maps a target id to its settings";
  if (Object.keys(targets).length > MAX_TARGETS) return `connectivity lists up to ${MAX_TARGETS} targets`;
  return Object.entries(targets).map(([id, t]) => targetProblem(id, t)).find(Boolean) ?? null;
}

function connectivityProblem(c) {
  if (!isObject(c)) return "connectivity is { retry, targets }";
  const unknown = Object.keys(c).filter((k) => !["retry", "targets"].includes(k));
  if (unknown.length) return `connectivity: unknown setting ${unknown.join(", ")}`;
  return retryProblem(c.retry, "retry") ?? targetsProblem(c.targets);
}

// Ordered; the first reason a block does not hold.
const RULES = [
  { fails: (b) => !isObject(b), says: () => "a machine's settings are an object" },
  { fails: (b) => Object.keys(b).some((k) => !Object.keys(BLOCK_DEFAULTS).includes(k)), says: (b) => `unknown setting ${Object.keys(b).filter((k) => !(k in BLOCK_DEFAULTS)).join(", ")}` },
  { fails: (b) => !STRATEGIES.includes(b.strategy), says: () => `strategy is ${STRATEGIES.join(", ")}` },
  { fails: (b) => typeof b.reuseExternal !== "boolean", says: () => "reuseExternal is true or false" },
  { fails: (b) => !isObject(b.components), says: () => "components maps a component key to its settings" },
  { fails: (b) => Object.entries(b.components).some(([k, c]) => componentProblem(k, c)), says: (b) => Object.entries(b.components).map(([k, c]) => componentProblem(k, c)).find(Boolean) },
  { fails: (b) => Boolean(connectivityProblem(b.connectivity)), says: (b) => connectivityProblem(b.connectivity) },
  { fails: (b) => sandboxProblems(b.sandbox).length > 0, says: (b) => sandboxProblems(b.sandbox)[0] },
];

export const settingsProblems = (block) => RULES.filter((r) => r.fails(block)).map((r) => r.says(block));

// The defaults filled in, deeply enough that a document written before connectivity existed reads as
// one with none, and a target that names only a host and a port reads with every other default. What
// is not the shape it should be is passed through, so the rule that refuses it can say what it is.
function filled(block) {
  const b = isObject(block) ? block : {};
  return { ...BLOCK_DEFAULTS, ...b, connectivity: connectivityFilled(b.connectivity), sandbox: sandboxFilled(b.sandbox) };
}

function connectivityFilled(c) {
  if (c === undefined) return { retry: { ...DEFAULT_RETRY }, targets: {} };
  if (!isObject(c)) return c;
  return { ...c, retry: isObject(c.retry) ? { ...DEFAULT_RETRY, ...c.retry } : (c.retry ?? { ...DEFAULT_RETRY }), targets: isObject(c.targets) ? Object.fromEntries(Object.entries(c.targets).map(([id, t]) => [id, targetFilled(id, t)])) : (c.targets ?? {}) };
}

const targetFilled = (id, t) => (isObject(t) ? { label: id, ...TARGET_DEFAULTS, checkFrom: [...LOCATIONS], ...t } : t);

// -> { exists, settings (this machine's block, defaults filled), others (other machines that set any), revision, unreadable }
export function readSettings(file, io, host) {
  const stored = readState(io, file, {}, SETTINGS_SCHEMA);
  const exists = io.exists(file) && !stored.unreadable;
  const hosts = isObject(stored.hosts) ? stored.hosts : {};
  return { exists, settings: filled(hosts[host]), others: Object.keys(hosts).filter((h) => h !== host).sort(), revision: exists ? revisionFor(contentOf(stored, STAMPS)) : null, unreadable: stored.unreadable ?? null };
}

// { host, next, revision, by, now } -> the kept block. `by` must be "person".
export function writeSettings(file, io, w) {
  if (w.by !== "person") throw new Refused("runtime settings are a person's choice — relay them with --human, or change them in Orbit Control");
  const wrong = settingsProblems(filled(w.next));
  if (wrong.length) throw new Refused(`these runtime settings do not hold: ${wrong.join("; ")}`);
  io.ensureDir(dirOf(file));
  return withLock(dirOf(file), () => kept(file, io, w), io, "the runtime settings are being written by another session");
}

const dirOf = (file) => file.slice(0, Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")));

function kept(file, io, w) {
  checkRevision(readSettings(file, io, w.host), w, "runtime settings");
  const doc = withHost(readState(io, file, {}, SETTINGS_SCHEMA), w);
  writeState(io, file, { ...doc, revision: revisionFor(doc), updatedAt: w.now, updatedBy: w.by }, SETTINGS_SCHEMA);
  return readSettings(file, io, w.host);
}

// This machine's block replaced, every other machine's left exactly as it was.
const withHost = (stored, w) => ({ hosts: { ...(isObject(stored.hosts) ? stored.hosts : {}), [w.host]: filled(w.next) } });
