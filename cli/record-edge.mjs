#!/usr/bin/env node
// Write to <ui-tests>/graph/edges.json, validated before and verified after --
// the map is rolled back if `check` finds anything.
//
//   node record-edge.mjs <edges.jsonl> [--dry]            append NEW controls
//   node record-edge.mjs <edges.jsonl> --replace [--dry]  replace fields of records already there
//
// Appending refuses a key the map already has. `--replace` is its inverse: it
// refuses a key the map does NOT have.
//
// It replaces the fields each line NAMES, and only those: a locator repair says
// `selector` and says nothing about `destructive`, `options` or the note
// somebody wrote at 2am, and a whole-record swap would drop all three -- one of
// which is a safety flag. The record also keeps its position in the file, so a
// diff shows the change and nothing else.
//
// Replacing is the commonest write a map ever takes and it used to have no
// tool. An append refused the key with "correct it with a new record" and then
// refused that record too, so a drifted selector was hand-edited: no
// validation, no re-check, no rollback, and no trace of what it used to say.
//
// Exit 0 = written (or nothing to do), 1 = rejected or rolled back, 2 = usage/IO.
import { command } from "../src/project/command.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadCases } from "../src/dsl/index.mjs";
import { appendEdges, replaceEdges, judge, judgeReplacements, parseCandidates } from "../src/graph/record-edge.mjs";
import { edgeKey, loadGraph } from "../src/graph/index.mjs";
import { checkFindings } from "../src/query/index.mjs";
import { createContext } from "../src/run/context.mjs";
import { join } from "node:path";
import { dataPath, editData } from "../src/store/edit.mjs";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const REPLACE = argv.includes("--replace");
const input = argv.find((a) => !a.startsWith("--"));

// The two writes a map takes, as a table. They differ in three values, which is
// not enough to justify two paths through judging, printing, re-checking and
// rolling back -- and those four are the whole reason this file exists.
const APPENDING = { judge, write: appendEdges, line: (a) => `  + ${edgeKey(a)}  [${a.kind}] ${a.selector}`, verb: "append", did: "appended" };
const REPLACING = { judge: judgeReplacements, write: replaceEdges, line: replaceLine, verb: "replace", did: "replaced" };
const mode = REPLACE ? REPLACING : APPENDING;

function main() {
  if (!input) return usage();
  const ctx = createContext();
  const { accepted, rejected } = mode.judge(ctx.graph, parseCandidates(read(input), console.error));
  report(accepted, rejected);
  return decide(ctx, accepted, rejected);
}

function usage() {
  console.error("usage: node record-edge.mjs <edges.jsonl> [--replace] [--dry]");
  process.exit(2);
}

function read(file) {
  try {
    return readFileSync(resolve(file), "utf8");
  } catch (e) {
    console.error(`cannot read ${file}: ${e.message}`);
    process.exit(2);
  }
}

function report(accepted, rejected) {
  for (const r of rejected) console.log(`  ✖ ${r.e.from && r.e.via ? edgeKey(r.e) : "?"}  ${r.why}\n      ${input}:${r.i + 1}`);
  for (const a of accepted) console.log(mode.line(a));
}

// The before AND the after. A correction is the one write that destroys the
// only copy of what the record used to say, so at minimum it says so on screen.
function replaceLine(a) {
  return `  ~ ${a.key}\n      was  ${values(a, a.was)}\n      now  ${values(a, a.now)}`;
}

const values = (a, rec) => a.changed.map((k) => `${k}=${held(rec[k])}`).join(" · ");

// A field the record did not carry reads "absent". `JSON.stringify(undefined)`
// is undefined, which lands in a template as the word and looks like a value.
const held = (v) => (v === undefined ? "absent" : JSON.stringify(v));

function decide(ctx, accepted, rejected) {
  if (!accepted.length) return exit(`nothing to ${mode.verb} (${rejected.length} rejected)`, rejected.length ? 1 : 0);
  if (DRY) return exit(`\n--dry: ${accepted.length} would be ${mode.did}, ${rejected.length} rejected — nothing written`, 0);
  const findings = writeEdges(ctx, accepted);
  if (findings.length) return rolledBack(findings);
  done(ctx, accepted);
}

function writeEdges(ctx, accepted) {
  const file = dataPath(ctx.project, join(ctx.project.graphDir, "edges.json"));
  const entry = { file, before: JSON.stringify(ctx.graph.edges), normalize: (text) => JSON.stringify(text === null ? [] : JSON.parse(text)) };
  return editData(ctx.project, [entry], () => mode.write(ctx.project.graphDir, accepted, () => recheck(ctx)));
}

function done(ctx, accepted) {

  provenance(accepted);
  exit(`\n${accepted.length} edge(s) ${mode.did} in graph/edges.json · check clean`, 0);
}

// What the record used to say is worth more to the next reader than to us:
// "this was a different selector at abc1234" is the sentence that stops the
// same afternoon being spent twice. It belongs in the notes -- committed,
// already keyed by <screen>/<via>, stamped with the frontend commit, and
// marked STALE by itself once the frontend moves past it. The engine prints the
// command rather than running it, the same way a report prints the command that
// repeats its SQL: what to record is a judgement, and it is not the tool's.
function provenance(accepted) {
  if (!REPLACE) return;
  console.log("\nwrite down what it used to say — a correction is the one write that erases evidence:");
  for (const a of accepted) console.log(`  node <engine>/cli/note.mjs ${arg(a.key)} ${arg(`corrected ${a.changed.join(", ")}`)} ${arg(`was ${values(a, a.was)}`)} --type=finding`);
}

// Printed to be pasted, so it is quoted the way a shell needs. A selector is
// full of quotes already, and so is the summary built out of one.
const arg = (s) => `"${String(s).replace(/(["\\$`])/g, "\\$1")}"`;

const recheck = (ctx) => checkFindings({ ...ctx, graph: loadGraph(ctx.project.graphDir), cases: loadCases(ctx.project.screensDir) });

function rolledBack(findings) {
  console.error(`\nrolled back — check reported ${findings.length} finding(s) after the write:`);
  for (const f of findings) console.error(`  ${f}`);
  exit("the graph is unchanged. Fix the records and re-run.", 1);
}

function exit(msg, code) {
  console.log(msg);
  process.exit(code);
}

command(main);
