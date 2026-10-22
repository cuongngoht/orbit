// A person's LIMITS for Satellite, and the definitions they REVOKED: read from <storeRoot>/satellite/policy/settings.json
// (defaults in code when the file is absent), and written only through a door that proves a person -- Orbit Control
// sets `door: "control"` after its mutation token; a terminal cannot prove who typed a flag, and an agent must never
// raise its own limits. No Satellite command writes it in this release (writePolicy exists so the rule is held).
//
// Every limit only NARROWS what Orbit's own automation settings already allow (cli/bind.mjs hands both in).
import { dirname } from "node:path";
import { Refused } from "../../../src/errors.mjs";
import { readState, writeState } from "../../../src/store/control.mjs";
import { withLock } from "../../../src/store/lock.mjs";
import { contentOf, checkRevision, revisionFor } from "../../../src/store/revisioned.mjs";
import { isObject, list, refused } from "./text.mjs";

export const POLICY_SCHEMA = 1;

export const LIMITS = Object.freeze([
  { key: "maxAgentRuns", default: 12, min: 1, max: 100, say: "agent runs one mission may start" },
  { key: "maxConcurrency", default: 3, min: 1, max: 20, say: "agent runs a mission may have open at once" },
  { key: "maxDepth", default: 2, min: 1, max: 5, say: "how deep delegation from one agent run to another may nest" },
  { key: "maxGeneratedDefinitions", default: 6, min: 0, max: 50, say: "roles, agent templates, skills and workflows one mission may generate" },
  { key: "maxUnits", default: 12, min: 1, max: 12, say: "work units one plan may hold (never above Orbit's execution.maxPlanSteps)" },
  { key: "maxHandoffs", default: 32, min: 1, max: 200, say: "handoffs one mission may publish" },
]);

export const defaultsOf = () => Object.fromEntries(LIMITS.map((l) => [l.key, l.default]));

const limitProblems = (limits) => LIMITS.filter((l) => limits?.[l.key] !== undefined && !(Number.isInteger(limits[l.key]) && limits[l.key] >= l.min && limits[l.key] <= l.max)).map((l) => `limits.${l.key} is an integer from ${l.min} to ${l.max}`);

const revokedProblems = (revoked) => (revoked === undefined || (Array.isArray(revoked) && revoked.every((r) => isObject(r) && typeof r.ref === "string")) ? [] : ["revoked is a list of { ref: <id or pin>, because }"]);

const STAMPED = ["schema", "unreadable", "revision", "updatedAt", "updatedBy"];

export const policyProblems = (doc) => [...Object.keys(doc ?? {}).filter((k) => !["limits", "revoked", ...STAMPED].includes(k)).map((k) => `unknown field "${k}"`), ...limitProblems(doc?.limits), ...revokedProblems(doc?.revoked)];

export function readPolicy(io, file) {
  const kept = readState(io, file, {}, POLICY_SCHEMA);
  const problems = policyProblems(kept);
  if (problems.length) throw refused(Refused, "POLICY_INVALID", `${file}: ${problems.join("; ")}; file unchanged`);
  return { limits: { ...defaultsOf(), ...(kept.limits ?? {}) }, revoked: list(kept.revoked), exists: io.read(file) !== null, revision: revisionFor(contentOf(kept, STAMPED)) };
}

const admitted = (writer) => {
  if (writer?.door !== "control") throw refused(Refused, "SATELLITE_PERSON_UNPROVEN", "Satellite's limits and revocations are a person's, written only through a door that proves a person (Orbit Control) — a terminal cannot prove who typed it, and an agent must never raise its own limits");
};

export function writePolicy(io, file, changes, writer) {
  admitted(writer);
  io.ensureDir(dirname(file));
  return withLock(dirname(file), () => written(io, file, changes, writer), io, "another person is saving Satellite's policy — try again in a moment");
}

function written(io, file, changes, writer) {
  const kept = readPolicy(io, file);
  checkRevision(kept, writer, "Satellite policy");
  writeState(io, file, { limits: { ...kept.limits, ...(changes.limits ?? {}) }, revoked: changes.revoked ?? kept.revoked, updatedAt: writer.at, updatedBy: "person" }, POLICY_SCHEMA);
  return readPolicy(io, file);
}

// The ref a revocation names: a pin, or an id that revokes every version under it.
export const isRevoked = (policy, pin) => (policy?.revoked ?? []).some((r) => r.ref === pin || r.ref === String(pin).split(":")[0]);
