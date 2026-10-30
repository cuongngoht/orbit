// What an Orbit IMPROVEMENT campaign (0.3.0, Orbit ADR 0045) may ask of Satellite, bound in one place beside Satellite's
// own composition root: every agent run its missions concluded, read back off their journals (the role pin the mission
// engine bound at dispatch, and the outcome it concluded on its owners' records); a role's successor held to the role
// rules and published as a CANDIDATE through the one immutable door; and which kept version is offered, chosen through
// the registry's own rules. Nothing here writes a mission's journal, and nothing reads a host's report as evidence.
//
//   improvementPorts({ io, storeRoot, now }) -> { records(), subject: { current, content, validate, stage, select }, missions: { read, runs } }
import { strongest } from "../src/evidence/vocab.mjs";
import { roleFindings } from "../src/factories/role/validate.mjs";
import { modelOf as missionModel } from "../src/mission/fold.mjs";
import { journalOf } from "../src/mission/world.mjs";
import { readPolicy } from "../src/store/policy.mjs";
import { definitionsPort } from "../src/store/port.mjs";
import { kindOfId, listMissions, roomsOf } from "../src/store/rooms.mjs";

const proposalOf = (c) => ({ purpose: c?.purpose, responsibilities: c?.responsibilities, requiredCapabilities: c?.requiredCapabilities, inputContract: c?.inputContract, outputContract: c?.outputContract, restrictions: c?.restrictions, completionCriteria: c?.completionCriteria, profile: c?.requestedPermissionProfile });

// A role held to the role rules a role factory holds a proposal to; anything else is not improved in this release (an
// agent template is DERIVED from its role, and a workflow template is proposed through a mission's own action).
export const roleValidation = (record) => ((findings) => ({ ok: findings.length === 0, findings: findings.map((f) => ({ id: f.id, says: f.say })) }))(record?.kind === "role" ? roleFindings(proposalOf(record.content), null) : [{ id: "SAT_KIND", say: `${record?.kind ?? "this definition"} is improved only as a role in this release` }]);

const currentOf = (defs, id) => ((rows) => ((offered) => (offered ? { pin: offered.pin, status: "active", archived: false, revoked: false, selectedBy: defs.selection(id)?.by ?? null } : { pin: null, status: rows.some((r) => r.eligibility.revoked) ? "revoked" : "unknown", archived: false, revoked: rows.some((r) => r.eligibility.revoked) }))(rows.find((r) => r.eligibility.offered)))(defs.index(kindOfId(id)).filter((r) => r.id === id));

const unchanged = (of) => ({ ok: false, findings: [{ id: "SF_UNCHANGED", says: `the successor says what ${of} says` }] });

const published = (id, s) => (w) => (w.pin === s.of ? unchanged(s.of) : { ok: true, reused: w.reused, id, pin: w.pin, digest: w.record.contentDigest, successorOf: s.of, campaign: s.campaign });

const candidateOf = (id, parent, content, s, now) => ({ id, kind: parent.kind, schemaVersion: parent.schemaVersion, scope: parent.scope, dependencies: parent.dependencies, compatibility: { profiles: [content.requestedPermissionProfile] }, content, provenance: { by: "improvement", campaign: s.campaign, successorOf: s.of, at: now(), reason: "a successor an improvement campaign proposed" }, evidenceRefs: [] });

// s: { of: <pin>, campaign, content } -- the host's proposal; the role's name is the role's own and never changes.
function stagedRole(defs, id, s, now) {
  const parent = defs.read(s.of);
  const content = { ...parent.content, ...(s.content ?? {}), displayName: parent.content.displayName };
  const v = roleValidation({ kind: parent.kind, content });
  if (!v.ok) return { ok: false, findings: v.findings };
  return published(id, s)(defs.publishCandidate(candidateOf(id, parent, content, s, now)));
}

const levelOf = (m, run) => ((rows) => (rows.some((e) => e.verified) ? "VERIFIED" : strongest(rows.map((e) => e.level))))([...m.evidence.values()].filter((e) => e.agentRun === run));

// An agent run as an improvement campaign reads it: ended, with the role its mission bound -- RUNTIME_BOUND, the mission
// engine pinned it at dispatch -- and the outcome its mission concluded on its owners' records.
const runOf = (m, msn) => (r) => ({ kind: "satellite", mission: msn, run: r.id, rolePin: r.rolePin, at: r.ended.at ?? r.at, session: m.meta?.session ?? null, host: m.meta?.host ?? null, outcome: r.ended.outcome, level: levelOf(m, r.id), signature: r.ended.failureSignature ?? null, attribution: "RUNTIME_BOUND" });

export function improvementPorts({ io, storeRoot, now }) {
  const rooms = roomsOf(storeRoot);
  const defs = () => definitionsPort(io, rooms, readPolicy(io, rooms.policyFile));
  const missionOf = (msn) => missionModel(journalOf({ io, rooms }, msn).read() ?? []);
  const runs = (msn) => ((m) => [...m.runs.values()].filter((r) => r.rolePin && r.ended).map(runOf(m, msn)))(missionOf(msn));
  return { records: () => listMissions(io, rooms).flatMap(runs), subject: { current: (id) => currentOf(defs(), id), content: (pin) => ({ ...defs().read(pin), pin }), validate: (pin) => roleValidation(defs().read(pin)), stage: (id, s) => stagedRole(defs(), id, s, now), select: (id, sel) => defs().select({ ...sel, at: now() }) }, missions: { read: (msn) => ((m) => (m.meta ? { goalDigest: m.meta.goalDigest ?? null, runs: [...m.runs.values()] } : null))(missionOf(msn)), runs } };
}
