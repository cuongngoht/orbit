#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Blocked, EXIT, Refused } from "../src/run/errors.mjs";
import { createDrafts } from "../src/draft/index.mjs";
import { draftPlans } from "../src/draft/plans.mjs";
import { errors } from "../src/qa/finding.mjs";
import { planFindings } from "../src/qa/validate.mjs";
import { plansDir } from "../src/qa/load.mjs";
import { planWorld } from "../src/qa/world.mjs";
import { machineContext } from "../src/store/context.mjs";
import { createContext } from "../src/run/context.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { realIo } from "../src/store/io.mjs";

const [cmd, ...args] = process.argv.slice(2);

export const COMMANDS = {
  list: listDrafts,
  show: showDraft,
  discard: discardDraft,
  promote: promoteDrafts,
  write: writeDraft,
};

function main() {
  if (!COMMANDS[cmd]) return help();
  tryCommand();
}

function tryCommand() {
  try {
    COMMANDS[cmd](args);
  } catch (e) {
    stopped(e);
  }
}

function help() {
  console.log("Commands: list, show <id>, discard <id>, promote <id>, promote --all, write — each covers draft cases and draft plans (an id is unique across both)");
}

function stopped(e) {
  if (e instanceof Refused) return exitWith("REFUSED", e.message);
  if (e instanceof Blocked) return exitWith("BLOCKED", `BLOCKED: ${e.message}`);
  throw e;
}

function exitWith(status, text) {
  console.error(text);
  process.exit(EXIT[status] ?? 1);
}

function context() {
  const ctx = createContext();
  return { ctx, ...machineContext(ctx) };
}

function listDrafts() {
  const { store, io } = context();
  for (const d of createDrafts(store.root, io).all()) console.log(`${d.id}: ${d.name}`);
  for (const p of draftPlans(store.root, io).all()) console.log(`${p.id}: ${p.title ?? p.id} (plan)`);
}

function showDraft([id]) {
  if (!id) throw new Refused("No id given");
  const { store, io } = context();
  const d = createDrafts(store.root, io).find(id) ?? draftPlans(store.root, io).find(id);
  if (!d) throw new Refused(`No draft found for ${id}`);
  console.log(JSON.stringify(d, null, 2));
}

function discardDraft([id]) {
  if (!id) throw new Refused("No id given");
  const { store, io } = context();
  const removed = createDrafts(store.root, io).remove(id) || draftPlans(store.root, io).remove(id);
  if (!removed) throw new Refused(`No draft found for ${id}`);
}

function writeDraft() {
  const c = JSON.parse(readFileSync(0, "utf8"));
  if (!c.id) throw new Refused("No id given");
  const { store, io } = context();
  saved(c, createDrafts(store.root, io));
}

function saved(c, drafts) {
  drafts.save(c);
  console.log(`saved draft ${c.id} in ${drafts.paths.cases} — prove it with: run-case ${c.id} --draft --dry`);
}

function promoteDrafts([id]) {
  if (!id) throw new Refused("No id given");
  const { ctx, store, io } = context();
  const drafts = { cases: createDrafts(store.root, io), plans: draftPlans(store.root, io) };
  if (id === "--all") return promoteAll(ctx, drafts);
  promoteOne(id, ctx, drafts);
}

function promoteAll(ctx, drafts) {
  for (const d of [...drafts.cases.all(), ...drafts.plans.all()]) promoteOne(d.id, ctx, drafts);
}

function promoteOne(id, ctx, drafts) {
  const d = drafts.cases.find(id);
  if (!d) return promotePlan(id, ctx, drafts.plans);
  checkValid(ctx, d);
  drafts.cases.promote(id, ctx.project.screensDir, realIo(), d);

}

// A draft PLAN goes into the tree only when the plan rules find no error in it,
// and it arrives with every source it did not qualify marked `authority: draft`
// (src/draft/plans.mjs): promoting an agent's plan is not accepting it.
function promotePlan(id, ctx, plans) {
  const p = plans.find(id);
  if (!p) throw new Refused(`No draft found for ${id}`);
  planChecked(ctx, p);
  console.log(`promoted plan ${id} to ${plans.promote(id, plansDir(ctx.project), realIo())} — its unqualified sources read authority: draft until a person accepts them`);

}

function planChecked(ctx, p) {
  const wrong = errors(planFindings(p, planWorld(ctx, { drafts: true })));
  if (wrong.length) throw new Refused(`Invalid plan ${p.id}: ${wrong[0].say}`);
}

function checkValid(ctx, d) {
  const wrong = validate(d, ctx.graph);
  if (wrong.length) throw new Refused(`Invalid case ${d.id}: ${wrong[0]}`);
}

main();
