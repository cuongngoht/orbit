// A project's GENERATED PLAYBOOKS, as a person reviews them: every registered one with its version, status,
// what it provides and needs, which workflow drafted it and why, whether its files are still what was verified
// (quarantined if not) and whether the resolver is offered it -- and, for one, its text, printable. Drafts a
// workflow is still writing are listed apart. Kept apart from the plugin's own skills (control-server/src/skills/):
// a generated playbook is never a shipped skill and never edited in the shipped editor.
import { effectiveOf, effectiveResourcesOf, factoryPort, projectStoreRoot, readAutomation, resolved } from "../core.mjs";
import { invalid, missing } from "../errors.mjs";
import { readProject } from "../projects/read.mjs";
import { machineFile, projectFile } from "../automation/read.mjs";

const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;

export function skillIdOf(id) {
  if (!ID.test(String(id ?? ""))) throw invalid("INVALID_SKILL_ID", "a generated playbook's id is lower case letters, digits and dashes");
  return id;
}

const valuesOf = (ctx, key) => effectiveOf([{ by: "machine", content: readAutomation(ctx.world.io, machineFile(ctx)).content }, { by: "project", content: readAutomation(ctx.world.io, projectFile(ctx, key)).content }]).values;

// What a playbook's needs are held to: the registry this machine's router and workflows resolve against.
const resolverOf = (ctx) => (capability) => resolved([{ capability, proves: { subject: capability } }], effectiveResourcesOf({ ...ctx.world })).results[0];

export function factoryFor(ctx, key) {
  readProject(ctx, key);
  return factoryPort({ paths: { storeRoot: projectStoreRoot(ctx.world.storeBase, key) }, io: ctx.world.io }, () => valuesOf(ctx, key), resolverOf(ctx));
}

export function generatedSkills(ctx, key) {
  const f = factoryFor(ctx, key);
  return { version: 1, project: key, skills: f.list(), drafts: f.drafts() };
}

export function generatedSkill(ctx, key, id) {
  const f = factoryFor(ctx, key);
  const row = f.list().find((r) => r.id === skillIdOf(id));
  if (!row) throw missing("SF_UNKNOWN", "no generated playbook like that is registered for this project");
  return { version: 1, project: key, skill: row, playbook: f.playbook(row.pin) };
}
