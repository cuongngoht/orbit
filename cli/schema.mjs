#!/usr/bin/env node
// Print or write the editor schema generated from the DSL vocabulary.
//
//   node schema.mjs             print the case schema to stdout
//   node schema.mjs --plan      print the plan schema to stdout
//   node schema.mjs --write     write <ui-tests>/schema/{case,plan}.schema.json (and graph/schema.json, project.schema.json from the plugin's copies)
//
// Each schema is an OUTPUT -- the case schema from src/dsl/{fields,verbs}.mjs, the
// plan schema from src/qa/{fields,vocab}.mjs -- never edited by hand; `query
// check` reports a stale copy of either. Writes go to the selected data home.
//
// Plain `node schema.mjs` prints the CASE schema and nothing else: the ship gate
// and every consuming repo compare their schema/case.schema.json against exactly that.
import { command } from "../src/project/command.mjs";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { caseSchema } from "../src/dsl/index.mjs";
import { planSchema } from "../src/qa/schema.mjs";
import { createContext } from "../src/run/context.mjs";
import { CASE_SCHEMA, PLAN_SCHEMA, SCHEMA_DIR } from "../src/tests-tree.mjs";
import { dataPath, editData } from "../src/store/edit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const json = (o) => JSON.stringify(o, null, 2) + "\n";
const text = json(caseSchema());

function main() {
  if (process.argv.includes("--plan")) return process.stdout.write(json(planSchema()));
  if (!process.argv.includes("--write")) return process.stdout.write(text);
  written(createContext());
}

function written(ctx) {
  editData(ctx.project, [], () => generated(ctx.project));

  console.log(`wrote ${join(ctx.project.schemaDir, CASE_SCHEMA)}, ${SCHEMA_DIR}/${PLAN_SCHEMA}, graph/schema.json, project.schema.json`);
}

function generated(paths) {
  mkdirSync(dataPath(paths, paths.schemaDir), { recursive: true });
  writeFileSync(dataPath(paths, join(paths.schemaDir, CASE_SCHEMA)), text);
  writeFileSync(dataPath(paths, join(paths.schemaDir, PLAN_SCHEMA)), json(planSchema()));
  copyStatic(paths);
}

function copyStatic(paths) {
  mkdirSync(dataPath(paths, paths.graphDir), { recursive: true });
  copyFileSync(join(HERE, "..", "schemas", "graph.schema.json"), dataPath(paths, join(paths.graphDir, "schema.json")));
  copyFileSync(join(HERE, "..", "schemas", "project.schema.json"), dataPath(paths, join(paths.uiTests, "project.schema.json")));
}

command(main);
