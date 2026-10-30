// One project's SELF-IMPROVEMENT as Orbit Control reaches it (0.3.0, ADR 0045): the improvement room, the effective
// automation settings, and every owner a person's decision goes through -- the skill factory (the same binding the
// generated-skills page uses) and Satellite's definitions -- behind Orbit Control's door, which proves a person. Nothing
// here runs an evaluation or asks a provider: a person promotes, reverts or rejects what evaluations already decided.
import { createImprovement, effectiveOf, improvementSubject, projectStoreRoot, readAutomation, satelliteImprovementPorts } from "../core.mjs";
import { machineFile, projectFile } from "../automation/read.mjs";
import { factoryFor } from "../generated-skills/read.mjs";
import { readProject } from "../projects/read.mjs";

export const settingsOf = (ctx, key) => ((machine, project) => ({ machine, project, effective: effectiveOf([{ by: "machine", content: machine.content }, { by: "project", content: project.content }]) }))(readAutomation(ctx.world.io, machineFile(ctx)), readAutomation(ctx.world.io, projectFile(ctx, key)));

const NOT_HERE = { kept: false, because: "a person's decision is taught by the campaign's next step, in a session" };

// door: null for a read, "control" for a person's decision -- set here, never by anything a page sends.
export function improvementOf(ctx, key, door = null) {
  readProject(ctx, key);
  const root = projectStoreRoot(ctx.world.storeBase, key);
  const store = createImprovement(root, ctx.world.io);
  const now = () => ctx.now().toISOString();
  return portsOf(ctx, key, { root, store, now, sat: satelliteImprovementPorts({ io: ctx.world.io, storeRoot: root, now }), door });
}

function portsOf(ctx, key, p) {
  const factory = factoryFor(ctx, key);
  const history = (subject) => (subject.kind === "satellite" ? p.sat.records().filter((r) => String(r.rolePin).startsWith(`${subject.id}:`)) : factory.runs(subject.id));
  return { store: p.store, ctx: { store: p.store, door: p.door, session: null, host: ctx.world.io.host, pid: null, now: p.now }, values: () => settingsOf(ctx, key).effective.values, now: p.now, nowMs: () => ctx.now().getTime(), records: () => [], history, inputsOf: () => [], subjects: { skill: improvementSubject(factory), satellite: p.sat.subject }, missions: p.sat.missions, evaluation: null, liveness: () => null, learn: () => NOT_HERE, trace: () => null };
}
