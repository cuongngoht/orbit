// What a PERSON approved autonomous QA to do in this project: whether it may
// act at all, on which environments, in which modes, as whom, how far, and the
// contracts a finding is held to. One schema-stamped document in the project's
// autonomous-qa room, written by a person -- in Orbit Control, or relayed by a
// session with `--human` -- and never by the agent on its own.
//
// Every write names the REVISION it was made against (a hash of the content),
// and a stale one is refused: a session must not overwrite a change a person
// made a minute ago with a copy it read an hour ago. The same rule the report
// settings keep (src/project-report/settings.mjs), for the same reason.
//
// Nothing here is a second policy engine. A mode listed for an environment IS
// the approval; the gates that read it are an ordered table in
// src/investigation/gates.mjs, and a capability or an MCP call an
// investigation makes still passes its own existing gates.
import { Refused } from "../errors.mjs";
import { readState, writeState } from "../store/control.mjs";
import { STALE_REVISION, checkRevision, revisionFor } from "../store/revisioned.mjs";
import { withLock } from "../store/lock.mjs";
import { tenancyProblems } from "./tenancy.mjs";
import { ENVIRONMENT_KINDS, MODE_IDS, modeOf } from "./vocab.mjs";

export const SETTINGS_SCHEMA = 1;

// Autonomous QA is ON by default (0.2.0): Orbit is autonomous unless a protected boundary is reached. What it may LOOK
// at is still only what a person declared (an environment, an identity), and a task's own sandbox is its own; a person
// switches it off here.
export const DEFAULTS = {
  enabled: true,
  environments: [],
  identities: [],
  // decisions and noProgress bound the loop (src/investigation/loop.mjs):
  // provisional numbers, to be measured against the benchmark before tuning.
  // The rest bound what a GENERATED test may cost (doc §6.4): obligations derived per
  // investigation, designs per obligation and failed ones repaired again, attempts per frozen
  // version, writes one run may make (a grant's uses), and the seconds one run may take.
  limits: { actions: 25, requestsPerAction: 40, minutes: 20, pollSeconds: 30, decisions: 50, noProgress: 4, obligations: 20, designs: 4, repairs: 2, attempts: 3, writes: 10, caseSeconds: 120 },
  network: { details: true, fingerprints: true, correlationHeaders: [], idempotencyHeaders: ["idempotency-key"], ignoreFields: [] },
  duplicates: { polling: [], retries: [], idempotent: [], intentional: [], contracts: [] },
  consistency: {},
  // Whether a checkpoint projects what an investigation verified into the
  // project's knowledge (src/investigation/memory.mjs). A person's switch.
  memory: { project: true },
  tenancy: null,
  reports: { internal: false },
};

const STAMPS = ["revision", "updatedAt", "updatedBy", "schema", "unreadable"];
const KNOWN = new Set([...Object.keys(DEFAULTS), ...STAMPS]);
// The kind of an environment nobody declares: a task's sandbox, projected when it is asked about.
const PROJECTED = "sandbox";
const ENV_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const LIMITS = { actions: [1, 200], requestsPerAction: [1, 500], minutes: [1, 240], pollSeconds: [1, 600], decisions: [1, 500], noProgress: [1, 50], obligations: [1, 500], designs: [1, 50], repairs: [0, 10], attempts: [1, 10], writes: [0, 200], caseSeconds: [10, 1800] };
const DUPLICATE_LISTS = { polling: null, retries: "attempts", idempotent: null, intentional: "count", contracts: "maxPerAction" };

const isList = (v) => Array.isArray(v);
const strings = (v) => isList(v) && v.every((x) => typeof x === "string" && x.length > 0);
const intIn = (v, [lo, hi]) => Number.isInteger(v) && v >= lo && v <= hi;
const httpUrl = (v) => /^https?:\/\/[^/\s]+/.test(String(v ?? ""));

function compiles(source) {
  try { return Boolean(new RegExp(source)); }
  catch { return false; }
}

const envs = (d) => (isList(d.environments) ? d.environments : []);
const productionModes = (e) => (e.modes ?? []).filter((m) => modeOf(m) && !modeOf(m).production);
const badDuplicateRows = (d) => Object.entries(DUPLICATE_LISTS).filter(([k, count]) => (d.duplicates?.[k] ?? []).some((r) => !r || typeof r.match !== "string" || !compiles(r.match) || (count && r[count] !== undefined && !intIn(r[count], [1, 100])))).map(([k]) => k);

// Ordered. A credential-looking key anywhere is refused before the rest is read.
const RULES = [
  { fails: (d) => /"(token|pat|password|secret|credential|cookie)"\s*:/i.test(JSON.stringify(d)), says: () => "a credential is never a setting: identities are signed-in browser profiles, mapped by name" },
  { fails: (d) => typeof d.enabled !== "boolean", says: () => "enabled is true or false" },
  { fails: (d) => envs(d).some((e) => e?.kind === PROJECTED), says: () => "a sandbox environment is projected from a task's sandbox at run time (autonomous-qa plan --sandbox=<env-id>) and is never declared here" },
  { fails: (d) => !isList(d.environments) || envs(d).some((e) => !ENV_ID.test(e?.id ?? "") || !httpUrl(e.origin) || !ENVIRONMENT_KINDS.includes(e.kind) || !strings(e.modes ?? []) || (e.modes ?? []).some((m) => !MODE_IDS.includes(m))), says: () => `environments are [{ id, origin: "https://…", kind: ${ENVIRONMENT_KINDS.filter((k) => k !== PROJECTED).join("|")}, modes: [${MODE_IDS.join("|")}] }]` },
  { fails: (d) => new Set(envs(d).map((e) => e.id)).size !== envs(d).length, says: () => "two environments share an id" },
  { fails: (d) => envs(d).some((e) => e.kind === "production" && productionModes(e).length), says: (d) => `no approval buys ${[...new Set(envs(d).filter((e) => e.kind === "production").flatMap(productionModes))].join(", ")} on a production environment` },
  { fails: (d) => !strings(d.identities) || d.identities.some((i) => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(i)), says: () => "identities lists the identity names (`as`) the agent may drive, e.g. [\"admin\", \"tenantB\"]" },
  { fails: (d) => Object.entries(LIMITS).some(([k, range]) => !intIn(d.limits?.[k], range)), says: () => `limits are whole numbers: ${Object.entries(LIMITS).map(([k, [lo, hi]]) => `${k} ${lo}-${hi}`).join(", ")}` },
  { fails: (d) => typeof d.network?.details !== "boolean" || typeof d.network?.fingerprints !== "boolean" || !["correlationHeaders", "idempotencyHeaders", "ignoreFields"].every((k) => strings(d.network?.[k] ?? [])), says: () => "network is { details, fingerprints: true|false, correlationHeaders, idempotencyHeaders, ignoreFields: [names] }" },
  { fails: (d) => badDuplicateRows(d).length > 0, says: (d) => `duplicates.${badDuplicateRows(d).join(", duplicates.")}: each row is { match: "<regex over the path>", method?, ${Object.values(DUPLICATE_LISTS).filter(Boolean).join("|")}? }` },
  { fails: (d) => Object.entries(d.consistency ?? {}).some(([k, v]) => !/^[a-z][a-z0-9-]*$/.test(k) || !intIn(v, [0, 3600])), says: () => "consistency maps a timing name from graph/meta.json to the seconds its data may take, 0-3600" },
  { fails: (d) => typeof d.memory?.project !== "boolean", says: () => "memory is { project: true|false } — whether a checkpoint projects verified results into the project's knowledge" },
  { fails: (d) => tenancyProblems(d.tenancy).length > 0, says: (d) => tenancyProblems(d.tenancy).join("; ") },
  { fails: (d) => typeof d.reports?.internal !== "boolean", says: () => "reports.internal is true or false: whether an UNREDACTED report may be written at all" },
];

export function settingsProblems(doc) {
  const unknown = Object.keys(doc).filter((k) => !KNOWN.has(k)).map((k) => `unknown setting "${k}"`);
  return [...unknown, ...RULES.filter((r) => r.fails(doc)).map((r) => r.says(doc))];
}

const content = (doc) => Object.fromEntries(Object.entries(doc).filter(([k]) => !STAMPS.includes(k)));
export const revisionOf = (doc) => revisionFor(content(doc));

// Nested defaults filled one level down, so a document that names only
// `limits.actions` still has every other limit.
const filled = (stored) => Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, isPlain(v) && isPlain(stored[k]) ? { ...v, ...stored[k] } : stored[k] ?? v]));
const isPlain = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

export function readSettings(paths, io) {
  const stored = readState(io, paths.settings, {}, SETTINGS_SCHEMA);
  const exists = io.exists(paths.settings) && !stored.unreadable;
  const doc = filled(content(stored));
  return { exists, settings: doc, revision: exists ? revisionOf(doc) : null, unreadable: stored.unreadable ?? null };
}

// { next, revision, by, now } -> the kept document. `by` must be "person".
export function writeSettings(paths, io, w) {
  if (w.by !== "person") throw new Refused("autonomous QA settings are a person's approval — relay them with --human, or change them in Orbit Control");
  io.ensureDir(paths.root);
  return withLock(paths.root, () => kept(paths, io, w), io);
}

function kept(paths, io, w) {
  const current = readSettings(paths, io);
  checkRevision(current, w, "autonomous QA settings");
  const doc = holding(content(w.next));
  writeState(io, paths.settings, { ...doc, revision: revisionOf(doc), updatedAt: w.now, updatedBy: w.by }, SETTINGS_SCHEMA);
  return { ...doc, revision: revisionOf(doc) };
}

export { STALE_REVISION };

// Unknown keys are asked of what the writer SENT, before defaults are filled
// in -- filling first would drop a pasted `token` silently instead of refusing it.
function holding(sent) {
  const doc = filled(sent);
  const wrong = [...new Set([...settingsProblems(sent).filter((p) => p.startsWith("unknown") || p.startsWith("a credential")), ...settingsProblems(doc)])];
  if (wrong.length) throw new Refused(`these autonomous QA settings do not hold: ${wrong.join("; ")}`);
  return doc;
}

// `a.b.c=value` onto a settings object; the value is JSON when it parses.
export function setPath(doc, path, raw) {
  const keys = String(path).split(".");
  if (!keys.every((k) => /^[A-Za-z0-9_-]+$/.test(k))) throw new Refused(`${path} is not a settings path`);
  const next = structuredClone(doc);
  keys.slice(0, -1).reduce((node, k) => (node[k] ??= {}), next)[keys.at(-1)] = valueOf(raw);
  return next;
}

function valueOf(raw) {
  try { return JSON.parse(raw); }
  catch { return raw; }
}

// The environment an investigation runs in: named, or the only one declared.
export function environmentOf(settings, id) {
  const all = settings.environments;
  if (id) return all.find((e) => e.id === id) ?? null;
  return all.length === 1 ? all[0] : null;
}
