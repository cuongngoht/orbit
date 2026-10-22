#!/usr/bin/env node
// Run the repo's definition of done, once, and say whether this is shippable.
//
//   node skills/orbit-release/ship.mjs              # from the plugin's own clone
//   node skills/orbit-release/ship.mjs --bump=added # …and what the next version would be
//   node skills/orbit-release/ship.mjs --ci         # what a pipeline can hold (0.0.2): CI's run
//
// Exit 0 = every gate held · 2 = a gate failed, and nothing should be tagged. With --ci, native host acceptance --
// recorded from live host runs a pipeline cannot make -- and native backend acceptance (0.1.0: acceptance/run.mjs on a
// machine with Docker) are PENDING instead of failures: CI is green on everything a pipeline can prove, and the release
// (ship.mjs without --ci) is still refused until each record names this source.
// The gates themselves are data in gates.mjs; this file only binds them to a
// real process and prints.
import { awaited, nativeAcceptance } from "./hosts.mjs";
import { backendAcceptance } from "./backend.mjs";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GATES, bump, report, shippable } from "./gates.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHANGE = process.argv.find((a) => a.startsWith("--bump="))?.slice(7);
const CI = process.argv.includes("--ci");

// Every gate is `node <args>` from the plugin root, so the child inherits
// nothing about where this was invoked from. The deadline only stops a hang: a Windows runner takes
// eight to ten minutes over the suite, and a ten-minute deadline failed releases that were green.
const DEADLINE_MS = 20 * 60000;

function runner(args, env = {}) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env }, timeout: DEADLINE_MS, maxBuffer: 64 * 1024 * 1024 });
  return { out: (r.stdout ?? "") + (r.stderr ?? ""), code: r.status, read };
}

const read = (file) => (existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), "utf8") : null);

const mark = (r) => (r.pending ? "wait" : r.ok ? "ok  " : "FAIL");

const verdict = (rows) => (!shippable(rows) ? "\nNOT shippable — fix the FAIL above; nothing is tagged." : rows.some((r) => r.pending) ? "\nevery gate a pipeline can hold held; native host acceptance is awaited -- a release runs ship.mjs without --ci." : `\nshippable. ${next(rows)}`);

function main() {
  const rows = [...report(runner, GATES), awaited(nativeAcceptance(ROOT), CI), awaited(backendAcceptance(ROOT), CI)];
  for (const r of rows) console.log(`${mark(r)}  ${r.name}\n        ${r.detail}`);
  console.log(verdict(rows));
  process.exit(shippable(rows) ? 0 : 2);
}

// The version gate already read the five version files, so the current version is
// the VALUE it carried back -- never its sentence, which is for the reader.
function next(rows) {
  const now = rows.find((r) => r.version)?.version;
  if (!now) return "the version could not be read.";
  if (!CHANGE) return `version ${now}. Pass --bump=changed|added|fixed|release to see the next one.`;
  return `version ${now} -> ${bump(now, CHANGE)} (${CHANGE}) — set it in all FIVE version files.`;
}

main();
