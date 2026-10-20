// Orbit automation settings: current schema only, narrowed by machine and project.
// A person writes through Control, with a revision; reads never modify a file.
import { dirname } from "node:path";
import { Refused } from "../errors.mjs";
import { readState, writeState } from "../store/control.mjs";
import { withLock } from "../store/lock.mjs";
import { checkRevision, contentOf, revisionFor } from "../store/revisioned.mjs";

export const AUTOMATION_SCHEMA = 3;


export const AUTOMATION_SETTINGS_INVALID = "AUTOMATION_SETTINGS_INVALID";
export const AUTOMATION_DOOR = "AUTOMATION_PERSON_UNPROVEN";

// An enum's values are listed MOST RESTRICTIVE FIRST: `order` narrowing keeps the earliest.
export const SKILL_SCOPES = ["task", "project"];
export const ENVIRONMENTS = ["sandbox", "auto"];
export const DISPLAYS = ["off", "compact", "full", "auto"];

const RETRY_KINDS = ["requirement", "context", "runtime", "engineering", "qa", "regression", "review", "playbook"];

// One row per step kind, read by kind (`retries[kind]`), so its reader names the table rather than each kind.
const retryRow = (kind) => ({ token: "retries", path: ["execution", "retries", kind], type: "integer", min: 0, max: 3, default: ["context", "runtime", "engineering", "qa"].includes(kind) ? 1 : 0, narrow: "min", say: `times a failed ${kind} step is planned again`, readBy: "src/automation/plan.mjs" });

// One row per field: where it sits, what it is, its default, how two documents meet, and who reads it. A
// each field is optional and defaults only as declared below.
export const FIELDS = [
  { path: ["trigger", "arbitraryPrompt"], type: "boolean", default: true, narrow: "and", say: "the prompt router may SAY a coordinated workflow would fit; it never starts one", readBy: "src/lifecycle/subscribers/router.mjs" },
  { path: ["skillFactory", "reuseFirst"], type: "boolean", default: true, narrow: "and", say: "an active playbook that provides the capability is used before anything is generated", readBy: "src/skill-factory/policy.mjs" },
  { path: ["skillFactory", "scope"], type: "enum", values: SKILL_SCOPES, default: "project", narrow: "order", say: "the widest scope a generated playbook may have", readBy: "src/skill-factory/policy.mjs" },
  { path: ["skillFactory", "maxSkillsPerTask"], type: "integer", min: 0, max: 10, default: 2, narrow: "min", say: "playbooks one task may generate", readBy: "src/skill-factory/policy.mjs" },
  { path: ["skillFactory", "maxGenerationAttempts"], type: "integer", min: 1, max: 10, default: 3, narrow: "min", say: "times one playbook may be held to the contract before the task stops trying", readBy: "src/skill-factory/policy.mjs" },
  { path: ["skillFactory", "maxActiveVersions"], type: "integer", min: 1, max: 20, default: 5, narrow: "min", say: "registered versions of one playbook kept beside it (older ones are archived, never deleted)", readBy: "src/skill-factory/lifecycle.mjs" },
  { path: ["execution", "environment"], type: "enum", values: ENVIRONMENTS, default: "auto", narrow: "order", say: "sandbox (a child task must run its change in its own sandbox) · auto (runtime discovery decides)", readBy: "src/automation/dispatch.mjs" },
  { path: ["execution", "maxAttempts"], type: "integer", min: 1, max: 20, default: 4, narrow: "min", say: "attempts a coordinated task may make: the first, and one per plan revision after a failure", readBy: "src/automation/settings.mjs narrowedBudget" },
  { path: ["execution", "maxPlanSteps"], type: "integer", min: 1, max: 12, default: 12, narrow: "min", say: "steps one plan may hold: a plan, or a revision of one, that would need more is refused before anything runs", readBy: "src/automation/plan.mjs" },
  { path: ["execution", "maxReplans"], type: "integer", min: 0, max: 10, default: 3, narrow: "min", say: "times a workflow's plan may be revised on new evidence — a playbook's draft inserted, a verification added, a changed requirement taken again; retries after a failure are counted by retries and maxAttempts", readBy: "src/automation/replan.mjs" },
  { path: ["execution", "maxActions"], type: "integer", min: 1, max: 500, default: 100, narrow: "min", say: "actions a coordinated task may start", readBy: "src/automation/settings.mjs narrowedBudget" },
  { path: ["execution", "maxMinutes"], type: "integer", min: 1, max: 1440, default: null, narrow: "min", say: "minutes a coordinated task may run (unset: no limit)", readBy: "src/automation/settings.mjs narrowedBudget" },
  ...RETRY_KINDS.map(retryRow),
  { path: ["live", "autoAttach"], type: "boolean", default: true, narrow: "and", say: "the coordinator says how to watch the task (`context.watch`)", readBy: "src/automation/loop.mjs" },
  { path: ["live", "open"], type: "boolean", default: true, narrow: "and", token: "live.open", say: "when a person invokes /orbit or /orbit-help, open this session's full-screen viewer beside it (a tmux pane, a Windows Terminal pane or a macOS Terminal window) and reuse it after -- only while a person is at the session, never headless; it grants nothing, and a viewer that cannot open never stops the work", readBy: "cli/live.mjs" },
  { path: ["live", "display"], type: "enum", values: DISPLAYS, default: "auto", narrow: "order", say: "what the coordinator tells a person they can open: auto (the host's status line when installed, else the full-screen viewer in a second terminal or one look) · compact (one look) · full (the full-screen viewer) · off (nothing, and no viewer opens by itself)", readBy: "src/automation/loop.mjs" },
];

// What a person may never set: shown fixed, refused if sent.
export const FIXED = { "skillFactory.allowExecutableCode": false, "skillFactory.requireValidation": true };

const at = (doc, path) => path.reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), doc);
const put = (doc, [head, ...rest], value) => ({ ...doc, [head]: rest.length ? put(doc?.[head] ?? {}, rest, value) : value });
const keyOf = (f) => f.path.join(".");

const policyDefaults = () => ({});

export const defaultsOf = () => FIELDS.reduce((doc, f) => put(doc, f.path, f.default), policyDefaults());

const TYPES = {
  integer: (f, v) => (v === null && f.default === null) || (Number.isInteger(v) && v >= f.min && v <= f.max),
  boolean: (f, v) => typeof v === "boolean",
  enum: (f, v) => f.values.includes(v),
};

const RANGE = {
  integer: (f) => `a whole number from ${f.min} to ${f.max}${f.default === null ? " (or null for no limit)" : ""}`,
  boolean: () => "true or false",
  enum: (f) => `one of ${f.values.join(", ")}`,
};

const problemOf = (doc, f) => (at(doc, f.path) === undefined || TYPES[f.type](f, at(doc, f.path)) ? null : `${keyOf(f)} is ${RANGE[f.type](f)} (${f.say})`);

const KNOWN = new Set(FIELDS.map(keyOf));
const leaves = (doc, prefix = []) => Object.entries(doc ?? {}).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? leaves(v, [...prefix, k]) : [[...prefix, k].join(".")]));

const fixedProblem = (p) => (Object.hasOwn(FIXED, p) ? `${p} is fixed at ${FIXED[p]} in this release — it is not a setting` : null);

const unknownProblem = (p) => fixedProblem(p) ?? (KNOWN.has(p) ? null : `${p} is not an automation setting`);

// Unknown fields are refused on reads and writes.
export function settingsProblems(doc) {
  const unknown = leaves(doc).map(unknownProblem).filter(Boolean);
  return [...unknown, ...FIELDS.map((f) => problemOf(doc, f)).filter(Boolean)];
}

// ---- reading and writing --------------------------------------------------------------------------

const STAMPED = ["revision", "updatedAt", "updatedBy", "schema", "unreadable"];

const filled = (doc, f) => put(doc, f.path, at(doc, f.path) ?? f.default);

export function readAutomation(io, file) {
  const kept = readState(io, file, {}, AUTOMATION_SCHEMA);
  const content = validContent(kept, file);
  const exists = io.read(file) !== null && !kept.unreadable;
  return { settings: FIELDS.reduce(filled, mergeDefaults(content)), content: exists ? content : {}, revision: exists ? revisionFor(content) : null, exists, unreadable: kept.unreadable ?? null, updatedAt: kept.updatedAt ?? null };
}

const refused = (code, message) => Object.assign(new Refused(message), { code });

function admitted(writer) {
  if (writer?.door !== "control") throw refused(AUTOMATION_DOOR, "automation settings are a person's, written only through Orbit Control — a terminal cannot prove who typed it, and an agent must never raise its own autonomy");
}

function refusedIf(code, problems) {
  if (problems.length) throw refused(code, `automation settings not changed: ${problems.join("; ")}`);
}

function merged(content, changes) {
  refusedIf(AUTOMATION_SETTINGS_INVALID, settingsProblems(changes));
  return leaves(changes).reduce((doc, p) => put(doc, p.split("."), at(changes, p.split("."))), content);
}

const stamped = (content, writer) => ({ ...content, updatedAt: writer.at, updatedBy: "person" });

function written(io, file, changes, writer) {
  const kept = readAutomation(io, file);
  checkRevision(kept, writer, "automation settings");
  writeState(io, file, stamped(merged(kept.content, changes), writer), AUTOMATION_SCHEMA);
  return readAutomation(io, file);
}

const locked = (io, file, fn) => withLock(dirname(file), fn, io, "another person is saving automation settings — try again in a moment");

export function writeAutomation(io, file, changes, writer) {
  admitted(writer);
  io.ensureDir(dirname(file));
  return locked(io, file, () => written(io, file, changes, writer));
}

// ---- narrowing --------------------------------------------------------------------------------

// Each rule answers which of the documents that SET a field wins: the earliest that narrows most.
const NARROWING = {
  and: (set) => set.find((s) => s.value === false) ?? set.at(-1),
  min: (set) => set.filter((s) => s.value !== null).reduce((best, s) => (best === null || s.value < best.value ? s : best), null) ?? set.at(-1),
  order: (set, f) => set.reduce((best, s) => (best === null || f.values.indexOf(s.value) < f.values.indexOf(best.value) ? s : best), null),
};

const setBy = (docs, f) => docs.filter((d) => at(d.content, f.path) !== undefined && TYPES[f.type](f, at(d.content, f.path))).map((d) => ({ value: at(d.content, f.path), by: d.by }));

const effectiveField = (docs, f) => ((set) => (set.length ? NARROWING[f.narrow](set, f) : { value: f.default, by: "default" }))(setBy(docs, f));

// docs: [{ by: "machine"|"project"|…, content }] in order, broadest first -- content of either schema.
export function effectiveOf(docs) {
  for (const doc of docs) refusedIf(AUTOMATION_SETTINGS_INVALID, settingsProblems(doc.content));
  const rows = Object.fromEntries(FIELDS.map((f) => [keyOf(f), effectiveField(docs, f)]));
  const values = FIELDS.reduce((doc, f) => put(doc, f.path, rows[keyOf(f)].value), policyDefaults());
  return { fields: rows, values };
}

// The budget a coordinated task is created with: what was asked, never above what the settings allow.
const lower = (asked, allowed) => (allowed === null || allowed === undefined ? asked ?? undefined : Math.min(asked ?? allowed, allowed));

export const narrowedBudget = (values, asked = {}) => ({ attempts: lower(asked.attempts, values.execution.maxAttempts), actions: lower(asked.actions, values.execution.maxActions), minutes: lower(asked.minutes, values.execution.maxMinutes) });

const mergeDefaults = (content) => ({ ...policyDefaults(), ...content, trigger: { ...policyDefaults().trigger, ...content.trigger }, skillFactory: { ...policyDefaults().skillFactory, ...content.skillFactory } });

function validContent(kept, file) {
  if (kept.unreadable) throw refused(AUTOMATION_SETTINGS_INVALID, `${file}: ${kept.unreadable} state; file unchanged`);
  const content = contentOf(kept, STAMPED);
  refusedIf(AUTOMATION_SETTINGS_INVALID, settingsProblems(content));
  return content;
}
