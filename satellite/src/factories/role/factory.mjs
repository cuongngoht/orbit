// The ROLE FACTORY: one resolve-role action, from the proposal to a pinned role on the unit. Validated first (every
// rule, role.validated), then reuse-first (discover.mjs): an existing role is REUSED, a starter is published and
// reused, two roles are COMPOSED into one that names them, or a new role is GENERATED -- named from its
// responsibilities, published as an immutable definition (role.generated, role.registered) -- within the mission's
// budget for generated definitions. A rejected proposal publishes nothing (role.rejected).
//
//   planRole(ports, lw, a)      -> what the action will do (decides its mode before it is proposed); writes nothing
//   runRole(ports, lw, a, plan) -> { outcome, pin, summary }, its lines appended through lw
import { STARTER_ROLES } from "./starters.mjs";
import { discoverRole } from "./discover.mjs";
import { pairsOf, roleIdOf, roleNameOf, sameResponsibilities } from "./naming.mjs";
import { roleFindings } from "./validate.mjs";
import { ROLE_SCHEMA } from "./vocab.mjs";

const proposalOf = (a) => Object.fromEntries(Object.entries(a).filter(([k]) => !["kind", "unit"].includes(k)));

const unitFor = (lw, a) => lw.m.units.get(a.unit) ?? null;

export function planRole(ports, lw, a) {
  const findings = roleFindings(proposalOf(a), unitFor(lw, a));
  const discovered = findings.length ? null : discoverRole(ports.definitions.offered("role"), { responsibilities: a.responsibilities, profile: a.profile });
  return { findings, word: findings.length ? "REJECT" : discovered.word, found: discovered?.found ?? null };
}

export const roleModeOf = (plan) => (["REUSE", "REUSE_STARTER"].includes(plan.word) ? "REUSING" : "ROLE_GENERATING");

const contentOf = (p, extra = {}) => ({ displayName: roleNameOf(p.responsibilities), purpose: p.purpose, responsibilities: p.responsibilities, requiredCapabilities: p.requiredCapabilities ?? [], inputContract: p.inputContract ?? { accepts: [] }, outputContract: p.outputContract ?? { shape: "findings", fields: ["findings"] }, restrictions: p.restrictions, completionCriteria: p.completionCriteria, requestedPermissionProfile: p.profile, ...extra });

// The id a generated role takes: its name's, unless that id already answers for OTHER responsibilities -- then the
// first free -2, -3 …; the same responsibilities again are a new VERSION of the same role.
function roleIdFor(ports, content) {
  const base = roleIdOf(content.displayName);
  const ids = [base, ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${base}-${n}`)];
  return ids.find((id) => ((rows) => rows.length === 0 || sameResponsibilities(rows.at(-1).record?.content?.responsibilities, content.responsibilities))(ports.definitions.versions("role", id))) ?? `${base}-${Date.parse(ports.now()) % 100000}`;
}

const provenanceOf = (ports, lw, by, reason) => ({ by, mission: lw.id, at: ports.now(), reason });

const published = (ports, lw, content, x) => ports.definitions.write({ id: roleIdFor(ports, content), kind: "role", schemaVersion: ROLE_SCHEMA, scope: "project", dependencies: x.dependencies ?? [], compatibility: { profiles: [content.requestedPermissionProfile] }, content, provenance: provenanceOf(ports, lw, x.by, x.reason), evidenceRefs: x.evidenceRefs ?? [] });

function pinned(lw, a, w, content, word) {
  lw.append(word === "reused" ? "role.reused" : "role.generated", { pin: w.pin, roleId: w.record.id, displayName: content.displayName, profile: content.requestedPermissionProfile, unit: a.unit, action: lw.action, ...(word === "reused" ? { coverage: pairsOf(content.responsibilities) } : { composedOf: content.composedOf }) });
  if (!w.reused || word !== "reused") lw.append("role.registered", { pin: w.pin, version: w.record.version, action: lw.action });
  if (a.unit) lw.append("unit.updated", { id: a.unit, rolePin: w.pin, action: lw.action });
  return { outcome: word, pin: w.pin, summary: `${content.displayName} (${w.pin}) ${word} for ${a.unit ?? "the mission"}` };
}

const rejected = (lw, a, findings) => (lw.append("role.rejected", { roleId: roleIdOf(roleNameOf(a.responsibilities ?? [{ activity: "x", subject: "role" }])), findings: findings.map((f) => f.id), say: findings.map((f) => f.say).join("; "), action: lw.action }), { outcome: "rejected", pin: null, summary: findings.map((f) => f.id).join(", ") });

const overBudget = (ports, lw) => lw.spent().generated >= lw.limits.maxGeneratedDefinitions;

const budgetSpent = (lw) => ({ id: "ROLE_BUDGET", say: `the mission generated ${lw.spent().generated} definition(s), the most its policy allows` });

// Published, unless what would be published is a version a person revoked: a revocation is never undone by proposing
// the same content again.
function publishedOrRevoked(ports, lw, a, x) {
  const w = published(ports, lw, x.content, x);
  return ports.definitions.revoked(w.pin) ? rejected(lw, a, [{ id: "ROLE_REVOKED", say: `${w.pin} was revoked by a person and is never pinned again` }]) : pinned(lw, a, w, x.content, x.word);
}

const composedContent = (a, plan) => contentOf(a, { composedOf: plan.found.map((r) => r.pin), restrictions: [...new Set([...a.restrictions, ...plan.found.flatMap((r) => r.record.content.restrictions)])].slice(0, 8) });

const STEPS = {
  REJECT: (ports, lw, a, plan) => rejected(lw, a, plan.findings),
  REUSE: (ports, lw, a, plan) => pinned(lw, a, { pin: plan.found.pin, record: plan.found.record, reused: true }, plan.found.record.content, "reused"),
  REUSE_STARTER: (ports, lw, a, plan) => publishedOrRevoked(ports, lw, a, { content: contentOf(plan.found), by: "starter", reason: "a starter role answers for exactly what was asked", word: "reused" }),
  COMPOSE: (ports, lw, a, plan) => (overBudget(ports, lw) ? rejected(lw, a, [budgetSpent(lw)]) : publishedOrRevoked(ports, lw, a, { content: composedContent(a, plan), by: "engine", dependencies: plan.found.map((r) => r.pin), reason: "two roles together answer for what was asked", word: "composed" })),
  GENERATE: (ports, lw, a) => (overBudget(ports, lw) ? rejected(lw, a, [budgetSpent(lw)]) : publishedOrRevoked(ports, lw, a, { content: contentOf(a), by: "engine", reason: "no role answers for these responsibilities", word: "generated" })),
};

export function runRole(ports, lw, a, plan) {
  lw.append("role.validated", { roleId: roleIdOf(roleNameOf(a.responsibilities?.length ? a.responsibilities : [{ activity: "propose", subject: "role" }])), ok: plan.findings.length === 0, findings: plan.findings.map((f) => f.id), action: lw.action });
  return STEPS[plan.word](ports, lw, a, plan);
}

export const STARTERS = STARTER_ROLES;
