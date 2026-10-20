#!/usr/bin/env node
// Make a Git checkout a Orbit project, and say where everything is. Since 1.8.9 every checkout already IS one, its
// test data in the machine store, and `/orbit-help` seats it the first time anybody asks; this does the same on
// purpose (src/seat.mjs):
//
//   node init.mjs <repo> [--origin=URL] [--project-id=shared-id]
//        the project's seat in the store -- a project.json naming it and the generated schemas -- and nothing at
//        all in the checkout. A checkout that already commits ui-tests/ keeps it; nothing is moved or written
//        (node cli/storage.mjs import brings it into the store, a person's choice)
//   node init.mjs <repo> --in-checkout [--origin=URL] [--project-id=shared-id]
//        the 1.8.8 layout, a person's choice: ui-tests/ written into the checkout for the team to commit, copied
//        into the store, and the store stamped so the checkout is the home from now on
//
// Exit 0 done · 2 refused (not a Git checkout, a tree already there for --in-checkout, a checkout bound to another
// project) · 3 blocked (the store cannot be written here).
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { caseSchema } from "../src/dsl/index.mjs";
import { planSchema } from "../src/qa/schema.mjs";
import { initialize } from "../src/store/scaffold.mjs";
import { createContext } from "../src/run/context.mjs";
import { ensureProject } from "../src/seat.mjs";
import { CASE_SCHEMA, PLAN_SCHEMA, SCHEMA_DIR } from "../src/tests-tree.mjs";
import { Blocked, Refused } from "../src/errors.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const USAGE = "usage: node init.mjs <repo> [--in-checkout] [--origin=URL] [--project-id=shared-id]";

function main() {
  const root = argv.find((a) => !a.startsWith("--"));
  if (!root) throw new Refused(USAGE);
  console.log(argv.includes("--in-checkout") ? inCheckout(resolve(root)) : seated(resolve(root)));
}

// What each kind of project was told: where its data is, and what is left for a person to do.
const SAID = {
  created: (p) => [`home: store — this project's test data lives in the machine store, nothing in the checkout`, `data: ${p.dataRoot}`, "status: seated (project.json and the generated schemas, nothing invented)"],
  present: (p) => [`home: store — this project's test data lives in the machine store, nothing in the checkout`, `data: ${p.dataRoot}`, "status: already seated, nothing overwritten"],
  checkout: (p) => [`home: checkout — this checkout commits its test data (${p.dataRoot}); nothing was moved or written`, `data: ${p.dataRoot}`, "status: kept where it is — node <engine>/cli/storage.mjs import brings it into the store, a person's choice"],
};

function seated(root) {
  const seat = ensureProject(process.env, root, { checkout: true, origin: flag("origin"), projectId: flag("project-id") });
  return [...SAID[seat.status](seat.paths), `reports: ${seat.paths.reportsDir ?? "(the project's reports setting)"}`, `next: set origin in ${join(seat.paths.dataRoot, "project.json")} (or ORBIT_ORIGIN), record screens (orbit-ui-map), then query check`].join("\n");
}

function inCheckout(root) {
  const project = initialize(root, process.env, options());

  return `home: checkout — written for the team to commit, a person's choice\ndata: ${project.dataRoot}\nreports: ${project.reportsDir}\nnext: edit ui-tests/project.json, record screens in graph/, then query check`;
}

function options() {
  const templates = join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "ui-tests");
  return { templates, origin: flag("origin") ?? "https://CHANGE-ME.example.com", projectId: flag("project-id"), generated: { [join(SCHEMA_DIR, CASE_SCHEMA)]: json(caseSchema()), [join(SCHEMA_DIR, PLAN_SCHEMA)]: json(planSchema()) } };
}

try { main(); }
catch (e) { console.error(e.message); process.exitCode = e instanceof Blocked ? 3 : 2; }
