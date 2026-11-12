#!/usr/bin/env node
// SHIP: Orbit's release gate (ADR 0057). Two modes, and nothing here tags, pushes, publishes or writes the checkout.
//
//   node skills/orbit-release/ship.mjs --ci [--bump=changed|added|fixed|release]
//        THE FAST TIER: the definition of done (the suite and its count, Five Lines, the fixture project and plans, the
//        generated schemas, the five version files, the archive a host accepts, frontmatter, no compatibility layer, zero
//        dependencies, the control server's Five Lines), the rows a release only reports (native host and backend
//        acceptance, the control panel's build), and release qualification AWAITED (`wait`) -- a green fast tier is
//        never release qualification. What a pipeline used to run is this one command, run where the release is made.
//
//   node skills/orbit-release/ship.mjs --evidence --evaluation=<record.json> [--artifact=<zip>] [--json]
//        THE PUBLISH GATE: exit 0 only when, in order, this checkout is clean, the fast tier holds on this tree, the
//        independent evaluator's record (node evaluator/cli.mjs record) has the shape the evaluator writes and is about
//        this release, the pre-registration it names is the committed one, the plugin every release-candidate arm ran
//        is the plugin HEAD ships (content digests of the two archives, computed here), every pre-registered held-out
//        run has an outcome word, the record's comparisons are what its runs say, and the release's pre-registered
//        verdict is not REGRESSED. It prints the comparison table, IMPROVED / NO_DIFFERENCE / INCONCLUSIVE said plainly.
//
// Exit 0 = every gate of the fast tier held, or PUBLISHABLE · 2 = a gate failed, NOT PUBLISHABLE (naming the row), or
// the command was not one of the two.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flag, has } from "../../src/learn/args.mjs";
import { printable } from "../../src/printable.mjs";
import { command } from "../../src/project/command.mjs";
import { backendAcceptance } from "./backend.mjs";
import { GATES, bump, report, shippable } from "./gates.mjs";
import { nativeAcceptance, optional } from "./hosts.mjs";
import { controlPanel } from "./panel.mjs";
import { archiveOf } from "./ship/artifact.mjs";
import { AWAITED, ciVerdict, markOf } from "./ship/ci.mjs";
import { factsOf, publishableOf, saidEvidence } from "./ship/evidence.mjs";
import { gatesAt, gitAt } from "./ship/ports.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const JSON_OUT = has(args, "json");

const print = (text) => console.log(printable(text));

// ---- the fast tier ----------------------------------------------------------------------------------------------------------

const optionalRows = (root) => [optional(nativeAcceptance(root)), optional(backendAcceptance(root)), optional(controlPanel(root, process.env))];

// What --ci runs and what --evidence holds this tree to: one list, so the two can never disagree about done.
const fastTier = () => [...report(gatesAt(process.env)(ROOT), GATES), ...optionalRows(ROOT)];

const versionOf = () => JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

const CHANGE = flag(args, "bump");

const nextVersion = () => (CHANGE ? `version ${versionOf()} -> ${bump(versionOf(), CHANGE)} (${CHANGE}) — set it in all FIVE version files.` : `version ${versionOf()}. Pass --bump=changed|added|fixed|release to see the next one.`);

function ciShip() {
  const rows = [...fastTier(), AWAITED];
  for (const r of rows) print(`${markOf(r)}  ${r.name}\n        ${r.detail}`);
  print(`\n${ciVerdict(rows)}\n  ${nextVersion()}`);
  return shippable(rows) ? 0 : 2;
}

// ---- the publish gate ---------------------------------------------------------------------------------------------------------

const git = gitAt(ROOT, process.env);

// Every path git would call changed or new here -- tracked or not, ignored files aside.
const dirty = () => ((r) => (r.ok ? r.out.split("\n").filter(Boolean).map((l) => l.slice(3)) : [`git status failed: ${r.err.trim().slice(0, 200)}`]))(git(["status", "--porcelain=v1", "--untracked-files=all"]));

const readIn = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : null);

const readAt = (file) => (file && existsSync(resolve(file)) ? readFileSync(resolve(file), "utf8") : null);

const recordText = () => ((file) => (file ? { file, text: readAt(file) } : null))(flag(args, "evaluation"));

const given = () => ((file) => (file ? readFileSync(resolve(file)) : null))(flag(args, "artifact"));

const announcedTier = () => (JSON_OUT ? null : print("the fast tier, on this tree (the suite takes minutes) ..."), fastTier());

const ports = () => ({ dirty, fastTier: announcedTier, version: versionOf, recordText, read: readIn, archive: (rev) => archiveOf(git, rev), given });

function evidence() {
  const e = publishableOf(factsOf(ports()));
  print(JSON_OUT ? JSON.stringify(e, null, 2) : saidEvidence(e));
  return e.publishable ? 0 : 2;
}

const usage = () => (print("usage: node skills/orbit-release/ship.mjs --ci [--bump=…] | --evidence --evaluation=<record.json> [--artifact=<zip>] [--json] (see the head of ship.mjs)"), 2);

const MODES = [
  { when: () => has(args, "ci"), run: ciShip },
  { when: () => has(args, "evidence"), run: evidence },
  { when: () => true, run: usage },
];

command(async () => {
  process.exitCode = await MODES.find((m) => m.when()).run();
});
