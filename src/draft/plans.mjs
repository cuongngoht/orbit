// The drafts room's PLANS: a plan an agent wrote -- during an investigation,
// from a PBI it read -- kept in the machine store and never in a checkout.
//
//   <store>/drafts/plans/<plan-id>.plan.json      flat, like the draft cases
//
// A draft has no screen folder yet, so the placement rule leaves it alone
// (src/qa/rules/place.mjs reads `_draft`). Promotion is a person's explicit
// request, exactly as it is for a case, and it STAMPS `authority: "draft"` on
// every source that does not already say what it is: a plan an agent typed must
// never become the team's accepted contract by being moved into the tree. A
// person accepting it changes that one word, in review, where it belongs.
//
// A plan id has the shape of a case id (src/qa/fields.mjs PLAN_ID and the case
// row are the same pattern, and a test holds them equal), so the case id's
// constraint is the one asked here and no second copy of it exists.
import { basename, dirname, join } from "node:path";
import { PLAN_EXT, planFile, planFiles } from "../tests-tree.mjs";
import { writeAtomic } from "../store/atomic.mjs";
import { ROOT_FIELDS } from "../dsl/fields.mjs";
import { checkedId } from "../store/id.mjs";
import { contained } from "../project/boundary.mjs";
import { withLock } from "../store/lock.mjs";
import { Refused } from "../errors.mjs";
import { draftPaths } from "./store.mjs";

export function draftPlans(root, io) {
  const c = { paths: draftPaths(root), io };
  return { dir: c.paths.plans, all: () => allPlans(c), find: (id) => allPlans(c).find((p) => p.id === id) ?? null, save: (p) => savePlan(c, p), remove: (id) => removePlan(c, id), promote: (id, targetDir, io) => promotePlan(c, id, targetDir, io) };
}

const planPath = (c, id) => contained(c.paths.plans, join(c.paths.plans, `${checkedId(id, ROOT_FIELDS.id)}${PLAN_EXT}`));

function locked(c, fn) {
  c.io.ensureDir(c.paths.state);
  return withLock(c.paths.state, fn, c.io, "another command is writing this project's drafts — retry in a moment");
}

// A draft is written whole, atomically, and never over a file that changed
// since it was read.
function savePlan(c, plan) {
  const file = planPath(c, plan.id);
  const before = c.io.read(file);
  c.io.ensureDir(c.paths.plans);
  return locked(c, () => unchangedSave(c, file, before, plan));
}

function unchangedSave(c, file, before, plan) {
  if (c.io.read(file) !== before) throw new Refused(`${file} changed since it was read — reload before writing`);
  writeAtomic(file, `${JSON.stringify(plan, null, 2)}\n`, c.io);
  return file;
}

function allPlans(c) {
  return planFiles(c.paths.plans).map((file) => readPlan(c, file)).filter(Boolean);
}

function readPlan(c, file) {
  try { return { ...JSON.parse(c.io.read(file)), _file: file, _draft: true }; }
  catch { return null; }
}

function removePlan(c, id) {
  const file = planPath(c, id);
  if (!c.io.exists(file)) return false;
  c.io.removeFile(file);
  return true;
}

// Into the folder planFile says (the screen it names, or _no-screen), never
// beside a plan that already holds the id, and never over a file.
function promotePlan(c, id, targetDir, io) {
  const plan = allPlans(c).find((p) => p.id === id);
  if (!plan) return false;
  const target = contained(targetDir, planFile(targetDir, plan));
  return locked(c, () => promoted(c, plan, unclaimed(targetDir, id, target), io));
}

function unclaimed(dir, id, target) {
  const other = planFiles(dir).find((f) => basename(f, PLAN_EXT) === id && f !== target);
  if (other) throw new Refused(`${other} already holds plan ${id} — promotion never makes a second plan with one id`);
  return target;
}

function promoted(c, plan, target, io) {
  if (io.exists(target)) throw new Refused(`${target} already exists — promotion never overwrites a plan`);
  io.ensureDir(dirname(target));
  io.write(target, `${JSON.stringify(stamped(plan), null, 2)}\n`);
  c.io.removeFile(plan._file);
  return target;
}

// Every source says what it is once the plan leaves the drafts room: one the
// agent wrote without a word reads `draft` until a person says otherwise.
const stamped = (plan) => ({ ...Object.fromEntries(Object.entries(plan).filter(([k]) => !k.startsWith("_"))), sources: (plan.sources ?? []).map((s) => ({ ...s, authority: s.authority ?? "draft" })) });
