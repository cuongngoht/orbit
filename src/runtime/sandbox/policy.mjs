// What a PERSON decided about the sandboxes of this checkout on this machine, and what the engine will
// not let them decide.
//
// It is one block of the per-host runtime settings (src/runtime/settings.mjs), written only by a person
// -- in Orbit Control, with the revision they read -- so a task can never loosen it for itself. Trust is
// kept in it too: a restore plan and a dev container definition are trusted BY FINGERPRINT of exactly what
// would run, so editing a lock file or a definition voids the trust, and a list of fingerprints is the
// whole of the permission.
//
// The effective policy is the engine's hard rules, then the person's, then the defaults: a person cannot
// switch a hard rule off, because each is a thing a sandbox is for (the application listens on this
// machine only; a developer's running application is never reused; the checkout itself is never restored;
// only what a task owns is stopped).
import { scrub } from "../../scrub.mjs";
import { isLoopback } from "../../probe/index.mjs";

// A trust is held by the WHOLE SHA-256 of what would run, never a prefix of it: a shorter one is a smaller thing
// for a hostile change to collide with, and what is trusted is exactly what a lock file or a definition says.
export const FINGERPRINT = /^[a-f0-9]{64}$/;

export const MAX_TRUSTED = 50;

// Which ports a sandbox may lease, and how many: 1024..65535 is every port that is not a system one, and a
// span of at most 2000 keeps "which port is a sandbox's" answerable by eye.
export const PORT_FLOOR = 1024;
export const PORT_CEILING = 65535;
export const MAX_SPAN = 2000;
export const ACTIVE_MOST = 10;

export const RESTORE_MODES = ["manual", "approved"];
export const PORT_MODES = ["lease", "fixed"];
export const BROWSERS = ["isolated"];
export const PLACEMENTS = ["auto", "native", "devcontainer"];

export const SANDBOX_DEFAULTS = Object.freeze({
  enabled: true,
  strategy: "auto",
  limits: { active: 3 },
  restore: { mode: "approved", trusted: [] },
  ports: { mode: "lease", from: 42000, to: 42999 },
  trustedDefinitions: [],
  qa: { modes: [], entry: null, browser: "isolated" },
  network: { denyProductionWrites: true },
});

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const unknownOf = (o, allowed) => Object.keys(o).filter((k) => !allowed.includes(k));

const portOk = (n) => Number.isInteger(n) && n >= PORT_FLOOR && n <= PORT_CEILING;

const fingerprintsOk = (list) => Array.isArray(list) && list.length <= MAX_TRUSTED && list.every((f) => FINGERPRINT.test(f)) && new Set(list).size === list.length;

// A component key, as discovery spells it: `<ecosystem>:<directory>`.
const KEY = /^[a-z][a-z0-9-]*:[^\u0000-\u001f]{1,200}$/;

const MODE_WORD = /^[a-z][a-z-]{1,31}$/;

// Ordered: the first reason the block does not hold, said with the field it is about.
const SANDBOX_RULES = [
  { fails: (s) => !isObject(s), says: () => "sandbox is an object" },
  { fails: (s) => unknownOf(s, Object.keys(SANDBOX_DEFAULTS)).length > 0, says: (s) => `sandbox: unknown setting ${unknownOf(s, Object.keys(SANDBOX_DEFAULTS)).join(", ")}` },
  { fails: (s) => typeof s.enabled !== "boolean", says: () => "sandbox.enabled is true or false" },
  { fails: (s) => !PLACEMENTS.includes(s.strategy), says: () => `sandbox.strategy is ${PLACEMENTS.join(", ")}` },
  { fails: (s) => !isObject(s.limits) || unknownOf(s.limits, ["active"]).length > 0 || !Number.isInteger(s.limits.active) || s.limits.active < 1 || s.limits.active > ACTIVE_MOST, says: () => `sandbox.limits is { active: 1 to ${ACTIVE_MOST} }` },
  { fails: (s) => !isObject(s.restore) || unknownOf(s.restore, ["mode", "trusted"]).length > 0 || !RESTORE_MODES.includes(s.restore.mode), says: () => `sandbox.restore is { mode: ${RESTORE_MODES.join("|")}, trusted: [fingerprint…] }` },
  { fails: (s) => !fingerprintsOk(s.restore.trusted), says: () => `sandbox.restore.trusted lists up to ${MAX_TRUSTED} distinct 64-character fingerprints` },
  { fails: (s) => !isObject(s.ports) || unknownOf(s.ports, ["mode", "from", "to"]).length > 0 || !PORT_MODES.includes(s.ports.mode), says: () => `sandbox.ports is { mode: ${PORT_MODES.join("|")}, from, to }` },
  { fails: (s) => !portOk(s.ports.from) || !portOk(s.ports.to) || s.ports.from > s.ports.to, says: () => `sandbox.ports.from and to are ports ${PORT_FLOOR} to ${PORT_CEILING}, from not above to` },
  { fails: (s) => s.ports.to - s.ports.from + 1 > MAX_SPAN, says: () => `sandbox.ports spans at most ${MAX_SPAN} ports` },
  { fails: (s) => !fingerprintsOk(s.trustedDefinitions), says: () => `sandbox.trustedDefinitions lists up to ${MAX_TRUSTED} distinct 64-character fingerprints` },
  { fails: (s) => !isObject(s.qa) || unknownOf(s.qa, ["modes", "entry", "browser"]).length > 0, says: () => "sandbox.qa is { modes, entry, browser }" },
  { fails: (s) => !Array.isArray(s.qa.modes) || s.qa.modes.length > 8 || s.qa.modes.some((m) => !MODE_WORD.test(m)), says: () => "sandbox.qa.modes lists up to 8 investigation modes by name" },
  { fails: (s) => s.qa.entry !== null && !KEY.test(String(s.qa.entry)), says: () => "sandbox.qa.entry is null, or the component the browser opens (<ecosystem>:<directory>)" },
  { fails: (s) => !BROWSERS.includes(s.qa.browser), says: () => `sandbox.qa.browser is ${BROWSERS.join(" or ")} in this release: a signed-in profile copy is not offered yet` },
  { fails: (s) => !isObject(s.network) || unknownOf(s.network, ["denyProductionWrites"]).length > 0 || typeof s.network.denyProductionWrites !== "boolean", says: () => "sandbox.network is { denyProductionWrites: true|false }" },
];

export const sandboxProblems = (block) => SANDBOX_RULES.filter((r) => safely(r, block)).map((r) => r.says(block));

// A rule that throws on a shape it did not expect has found a problem, and a later rule would throw on it too:
// the first message is the one that is said.
function safely(rule, block) {
  try { return rule.fails(block); }
  catch { return true; }
}

export const sandboxProblem = (block) => sandboxProblems(block)[0] ?? null;

// The defaults filled in, a level at a time, so a block written before this existed reads as one with the
// defaults and one that names only `restore.mode` keeps the other restore defaults. What is not the shape
// it should be is passed through, so the rule that refuses it can say what it is.
export function sandboxFilled(block) {
  if (block === undefined) return structuredClone(SANDBOX_DEFAULTS);
  if (!isObject(block)) return block;
  return Object.fromEntries([...Object.entries(SANDBOX_DEFAULTS).map(([k, d]) => [k, levelFilled(d, block[k])]), ...Object.entries(block).filter(([k]) => !(k in SANDBOX_DEFAULTS))]);
}

const levelFilled = (defaults, given) => (isObject(defaults) && isObject(given) ? { ...structuredClone(defaults), ...given } : given === undefined ? structuredClone(defaults) : given);

// ---- a component's port override ---------------------------------------------------------------

const OVERRIDE_KINDS = ["env", "argv"];
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const FLAG = /^--?[A-Za-z][A-Za-z0-9-]{0,40}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

// `{port}` once, and where it is a URL its host is this machine: a lease is a port on loopback.
const formatOk = (f) => typeof f === "string" && f.length <= 120 && !CONTROL.test(f) && scrub(f) === f && f.split("{port}").length === 2 && urlHostOk(f);

function urlHostOk(format) {
  const url = /^[a-z][a-z0-9+.-]*:\/\/([^/:{]+)/i.exec(format);
  return !url || isLoopback(url[1]);
}

const OVERRIDE_RULES = [
  { fails: (o) => !isObject(o) || unknownOf(o, ["kind", "name", "flag", "format", "after"]).length > 0, says: "an override is { kind, name | flag, format, after? }" },
  { fails: (o) => !OVERRIDE_KINDS.includes(o.kind), says: `an override's kind is ${OVERRIDE_KINDS.join(" or ")}` },
  { fails: (o) => o.kind === "env" && (!NAME.test(String(o.name)) || o.flag !== undefined), says: "an env override names the variable (name) and no flag" },
  { fails: (o) => o.kind === "argv" && (!FLAG.test(String(o.flag)) || o.name !== undefined), says: "an argv override names the flag (flag) and no variable" },
  { fails: (o) => o.after !== undefined && (o.kind !== "argv" || o.after !== "--"), says: "`after` is only `--`, and only for an argv override" },
  { fails: (o) => !formatOk(o.format), says: "an override's format holds {port} once, no credential, and on this machine's loopback when it is a URL" },
];

// A component's `port` setting: `{ override: { kind, name|flag, format } }`, or nothing.
export function portProblem(port) {
  if (!isObject(port) || unknownOf(port, ["override"]).length > 0) return "port is { override: { kind, name | flag, format } }";
  return OVERRIDE_RULES.find((r) => r.fails(port.override))?.says ?? null;
}

// ---- what a person cannot turn off --------------------------------------------------------------

// Ordered engine rows that survive any person's block: a sandbox listens on this machine only, never
// reuses an application it did not start, never restores the checkout itself, and stops only what a task
// owns. Each is a fact `effectivePolicy` states and a test holds the code to.
export const HARD = Object.freeze({ listen: "127.0.0.1", reuseExternal: false, restoreCheckout: false, stopOnlyOwned: true });

// -> { policy, revision }: the person's block over the defaults, with the hard rules over both.
export const effectivePolicy = (settings) => ({ policy: { ...sandboxFilled(settings?.sandbox), hard: { ...HARD } }, revision: settings?.revision ?? null });

// A fingerprint a person trusted, by kind. The kinds are rows: a new thing a person may trust is a row.
export const TRUST_KINDS = [
  { kind: "restore", say: "a dependency restore plan", read: (policy) => policy.restore.trusted, write: (policy, list) => ({ ...policy, restore: { ...policy.restore, trusted: list } }) },
  { kind: "definition", say: "a dev container definition", read: (policy) => policy.trustedDefinitions, write: (policy, list) => ({ ...policy, trustedDefinitions: list }) },
];

export const trustKind = (kind) => TRUST_KINDS.find((k) => k.kind === kind) ?? null;

export const isTrusted = (policy, kind, fingerprint) => Boolean(trustKind(kind)?.read(policy).includes(fingerprint));
