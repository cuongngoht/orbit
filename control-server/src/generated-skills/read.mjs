// A project's GENERATED PLAYBOOKS, as a person reviews them: every registered one with its version, status,
// what it provides and needs, which workflow drafted it and why, whether its files are still what was verified
// (quarantined if not) and whether the resolver is offered it -- and, for one, its text, printable. Drafts a
// workflow is still writing are listed apart. Kept apart from the plugin's own skills (control-server/src/skills/):
// a generated playbook is never a shipped skill and never edited in the shipped editor.
//
// Since 0.0.4 a playbook that DECLARES its workflow shows it -- each step, what it asks and what it must prove -- with
// every run the project's coordinators carried of it and the review those runs answer, read from their journals on
// every look (skills/orbit-help/factory.mjs runs, review). Nothing here writes, and a review only proposes.
import { createTasks, effectiveOf, effectiveResourcesOf, factoryPort, projectStoreRoot, readAutomation, recentTasks, resolved, SKILL_SOURCE, skillRunsOf } from "../core.mjs";
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
  const root = projectStoreRoot(ctx.world.storeBase, key);
  return factoryPort({ paths: { storeRoot: root }, io: ctx.world.io }, () => valuesOf(ctx, key), resolverOf(ctx), { history: historyOf(ctx, root) });
}

// A declared playbook's history (0.0.4): the project's coordinated workflows, read only, and the live core's reading of
// a run off them -- what its page's runs and review are made of, on every look.
const historyOf = (ctx, root) => ({ tasks: () => recentTasks({ tasks: createTasks(root, ctx.world.io), now: () => ctx.now().toISOString() }, "automation"), runsOf: skillRunsOf });

export function generatedSkills(ctx, key) {
  const f = factoryFor(ctx, key);
  return { version: 1, project: key, skills: f.list(), drafts: f.drafts() };
}

export function generatedSkill(ctx, key, id) {
  const f = factoryFor(ctx, key);
  const row = f.list().find((r) => r.id === skillIdOf(id));
  if (!row) throw missing("SF_UNKNOWN", "no generated playbook like that is registered for this project");
  return { version: 1, project: key, skill: row, playbook: f.playbook(row.pin), workflow: declaredOf(f, row), runs: f.runs(row.id).slice(0, 20), review: f.review(row.id) };
}

// A declared playbook's workflow as a viewer draws it, read from the version in place (its digest checked); a
// followed one declares none, and one whose files moved is said to be unreadable rather than drawn.
function declaredOf(f, row) {
  if (row.runs !== "declared") return null;
  try { return SKILL_SOURCE.projectionOf(f.workflow(row.pin)); }
  catch (e) { return { unreadable: e.code ?? "SF_WORKFLOW_INVALID", because: String(e.message).slice(0, 240) }; }
}
