// The SKILL actions: resolve-skill (discover, reuse, wrap, or scaffold a draft), write-skill (the host's text into the
// draft), validate-skill (held to Orbit's contract, nothing written), register-skill (registered through Orbit's one
// door, then pinned by Satellite). Every one is a gateway action with its own mode, so each factory step shows in Live.
import { generatedContent, planSkill, skillModeOf, skillOperationOf, skillProposed, wrappedContent } from "../../factories/skill/skill.mjs";
import { clip, isObject, list } from "../../store/text.mjs";
import { ENGINE, ORCHESTRATOR, finding, unitIn } from "./common.mjs";

const pinnedTo = (lw, a, pin) => (a.unit && lw.m.units.has(a.unit) ? lw.append("unit.updated", { id: a.unit, skillPins: [...new Set([...lw.m.units.get(a.unit).skillPins, pin])], action: lw.action }) : null);

const discovered = (lw, a, plan, pin) => lw.append("skill.discovered", { capability: a.capability, label: plan.label, provider: plan.found?.record?.content?.provider?.key ?? plan.resolved?.provider?.key ?? undefined, pin: pin ?? undefined, unit: a.unit, action: lw.action });

function reusedSkill(ports, lw, a, plan, w) {
  discovered(lw, a, plan, w.pin);
  lw.append("skill.reused", { capability: a.capability, pin: w.pin, orbitPin: w.record.content.orbitPin ?? undefined, unit: a.unit, action: lw.action });
  pinnedTo(lw, a, w.pin);
  return { outcome: "reused", level: "CONTRACT_MET", summary: `${a.capability} is served by ${w.record.content.provider?.key ?? w.pin}`, refs: [`definition:${w.pin}`], result: { pin: w.pin, provider: w.record.content.provider } };
}

const RESOLVE = {
  REUSE: (ports, lw, a, plan) => reusedSkill(ports, lw, a, plan, { pin: plan.found.pin, record: plan.found.record }),
  WRAP: (ports, lw, a, plan) => reusedSkill(ports, lw, a, plan, ports.definitions.write(skillProposed(lw, ports, wrappedContent(ports, a, plan.resolved), `Orbit's resolver finds ${plan.resolved.provider.key} provides it`))),
  BLOCKED: (ports, lw, a, plan) => (discovered(lw, a, plan), { outcome: "blocked", level: "BLOCKED", summary: clip(`${a.capability}: ${plan.label} -- ${plan.resolved?.why ?? "nothing here provides it"}; nothing is generated to get around it`), result: { label: plan.label, why: plan.resolved?.why ?? null } }),
};

async function scaffolded(ports, a) {
  const got = await ports.factory.scaffold({ provides: a.capability, needs: list(a.needs), because: a.because });
  return { id: got.id, shape: got.shape ?? null };
}

function drafted(ports, lw, a, plan, got) {
  if (got.error) return { outcome: "refused", level: "UNKNOWN", summary: clip(`Orbit's skill factory refused a draft for ${a.capability}: ${got.error}`) };
  discovered(lw, a, plan);
  lw.append("skill.generated", { capability: a.capability, draft: got.id, shape: got.shape ?? undefined, action: lw.action });
  return { outcome: "drafted", level: "CONTRACT_MET", summary: `draft ${got.id} scaffolded for ${a.capability}`, result: { draft: got.id, shape: got.shape, next: `write-skill { draft: "${got.id}", files: [{ name: "SKILL.md", text }] }: an instruction-only playbook using only what is provided here` } };
}

export const resolveSkill = {
  fields: ["capability", "unit", "needs", "because"],
  required: ["capability"],
  plan: planSkill,
  mode: (plan) => skillModeOf(plan),
  operation: (plan) => skillOperationOf(plan),
  provider: ENGINE,
  profile: ORCHESTRATOR,
  contract: (ports, lw, a) => (!/^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/.test(String(a.capability)) ? finding("SKILL_CAPABILITY", "capability is a dotted, lower-case capability word") : a.unit && !unitIn(lw, a.unit) ? finding("UNIT_UNKNOWN", `no unit ${a.unit} in this mission`) : null),
  async: (plan) => plan.word === "GENERATE",
  run: (ports, lw, a, plan) => RESOLVE[plan.word](ports, lw, a, plan),
  call: (ports, a) => scaffolded(ports, a),
  settle: drafted,
};

const draftOf = (lw, a) => lw.m.drafts.get(a.draft) ?? null;

const FILE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,63}\.md|workflow\.json)$/;

const filesOk = (files) => Array.isArray(files) && files.length >= 1 && files.length <= 4 && files.every((f) => isObject(f) && FILE.test(String(f.name)) && typeof f.text === "string" && Buffer.byteLength(f.text, "utf8") <= 32768);

const draftContract = (lw, a) => (!draftOf(lw, a) ? finding("SKILL_DRAFT_UNKNOWN", `${a.draft} is no draft this mission scaffolded`) : null);

function written(ports, lw, a) {
  for (const f of a.files) ports.factory.put({ id: a.draft, name: f.name, text: f.text });
  lw.append("skill.written", { draft: a.draft, files: a.files.map((f) => f.name), action: lw.action });
  return { outcome: "written", level: "TOOL_COMPLETED", summary: `${a.files.length} file(s) written into draft ${a.draft}` };
}

export const writeSkill = {
  fields: ["draft", "files"],
  required: ["draft", "files"],
  mode: () => "SKILL_GENERATING",
  operation: () => "skill.draft",
  provider: ENGINE,
  profile: ORCHESTRATOR,
  contract: (ports, lw, a) => draftContract(lw, a) ?? (!filesOk(a.files) ? finding("SKILL_FILES", "files are 1 to 4 { name: a .md file name or workflow.json, text: at most 32 KB }") : null),
  run: written,
};

function validated(ports, lw, a) {
  const v = ports.factory.verify(a.draft);
  const ok = v.ok === true;
  lw.append("skill.validated", { draft: a.draft, ok, findings: list(v.findings).map((f) => f.id), action: lw.action });
  return { outcome: ok ? "valid" : "invalid", level: ok ? "CONTRACT_MET" : "TOOL_COMPLETED", summary: clip(ok ? `${a.draft} holds to Orbit's playbook contract` : `${a.draft} breaks ${list(v.findings).map((f) => f.id).join(", ")}`), result: { ok, findings: list(v.findings) } };
}

export const validateSkill = {
  fields: ["draft"],
  required: ["draft"],
  mode: () => "SKILL_VALIDATING",
  operation: () => "schema.validate",
  provider: ENGINE,
  profile: ORCHESTRATOR,
  contract: (ports, lw, a) => draftContract(lw, a),
  run: validated,
};

async function registered(ports, a) {
  const r = await ports.factory.register(a.draft, { by: "satellite" });
  return r.ok ? { ok: true, pin: r.pin, status: r.status, reused: r.reused === true } : { ok: false, findings: list(r.findings).map((f) => f.id) };
}

function pinnedSkill(ports, lw, a, plan, got) {
  if (got.error || !got.ok) return (lw.append("skill.validated", { draft: a.draft, ok: false, findings: list(got.findings), action: lw.action }), { outcome: "refused", level: "TOOL_COMPLETED", summary: clip(`${a.draft} was not registered: ${got.error ?? list(got.findings).join(", ")}`) });
  const w = ports.definitions.write(skillProposed(lw, ports, generatedContent(draftOf(lw, a).capability, a.draft, got), "registered through Orbit's skill factory for a gap nothing provided"));
  lw.append("skill.registered", { capability: draftOf(lw, a).capability, pin: w.pin, orbitPin: got.pin, status: got.status, unit: a.unit, action: lw.action });
  pinnedTo(lw, a, w.pin);
  return { outcome: "registered", level: "CONTRACT_MET", summary: `${a.draft} registered (${got.pin}) and pinned as ${w.pin}`, refs: [`definition:${w.pin}`], result: { pin: w.pin, orbitPin: got.pin } };
}

export const registerSkill = {
  fields: ["draft", "unit"],
  required: ["draft"],
  mode: () => "SKILL_GENERATING",
  operation: () => "definition.register",
  provider: ENGINE,
  profile: ORCHESTRATOR,
  contract: (ports, lw, a) => draftContract(lw, a) ?? (a.unit && !unitIn(lw, a.unit) ? finding("UNIT_UNKNOWN", `no unit ${a.unit} in this mission`) : null),
  call: (ports, a) => registered(ports, a),
  settle: pinnedSkill,
};
