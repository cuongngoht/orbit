#!/usr/bin/env node
// Query the UI map and the test cases.
//
// The map answers the question an agent has before driving the UI: "I need to
// do X — which screen, which controls, in what order?" Reading the whole map
// into context defeats the point, so every command prints only the slice asked for.
//
//   node query.mjs screen <id>          controls on that screen, and where each leads
//   node query.mjs path <from> <to>     shortest click-path between two screens
//   node query.mjs to <id>              reverse lookup: what leads INTO this screen
//   node query.mjs find <text>          search screens and controls
//   node query.mjs screens              every screen, with its url and health
//   node query.mjs layers <id>          which backend layers this screen touches
//   node query.mjs effect <id>          per-action backend trace, QC verify-ready
//   node query.mjs regress <table|topic> every action touching it — regression scope
//   node query.mjs cases                every test case in screens/*/cases/*.json
//   node query.mjs case <id>            one case's steps, resolved to real selectors
//   node query.mjs dsl                  the case vocabulary, summarised from the DSL tables
//   node query.mjs verb <name>          one verb: kind, needs, fields, what it does to the run
//   node query.mjs field <name>         one field: type, which verbs allow it, what it means
//   node query.mjs doctor              which tools this project needs, and what is missing here
//   node query.mjs check                integrity: dangling edges, invalid cases, stale schema
//   node query.mjs verify               do the cited file:line refs still exist? (+ case drift)
//   node query.mjs triage [<dir>]       one run's evidence: what it shows, and what it cannot tell
//   node query.mjs history [<case>]     what happened the last times it actually ran
//   node query.mjs flaky                cases whose verdict keeps flipping
//   node query.mjs notes [<about>]      what agents concluded about this case/screen/machine
//   node query.mjs storage [--json]     resolved repo, data (and its home), runtime and report paths
//   node query.mjs extensions           this project's own QC tools: loaded, refused, why
//   node query.mjs capabilities         what a {"do":"call"} step may ask here
//   node query.mjs capability <id>      one capability: its input contract and what it needs
import { command } from "../src/project/command.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadCases } from "../src/dsl/index.mjs";
import { COMMANDS, runQuery } from "../src/query/index.mjs";
import { createContext } from "../src/run/context.mjs";
import { withExtensions } from "../src/extensions/index.mjs";

const [cmd, ...args] = process.argv.slice(2);

async function main() {
  if (!COMMANDS[cmd]) return console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 31).join("\n"));
  const ctx = await withExtensions(createContext());
  process.exitCode = badly(runQuery({ ...ctx, cases: loadCases(ctx.project.screensDir) }, cmd, args));
}

// `check` is a GATE: CI runs it, record-edge rolls an append back on it, and
// every playbook tells an agent to see zero findings. It always exited 0, so not
// one of those could actually fail. Advisories never affect the code.
const badly = (result) => (result?.findings ? 1 : 0);

command(main);
