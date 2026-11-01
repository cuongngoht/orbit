#!/usr/bin/env node
// SHIP: Orbit's release, qualified end to end and only on evidence (ADR 0049) -- the definition of done, a fresh release
// artifact and fresh benchmark images, every case of every suite run in Docker, every row a model must carry carried by
// the real Claude Code CLI in the benchmark's runner, a repairable source defect repaired through the benchmark's own
// repair path and integrated only once an independent verifier passed it, and the whole catalog run again on the
// result -- one Orbit task (provider `release`) whose journal says where it stands, so Orbit Live and Mission Control
// show it and `--resume` carries it on. Claude Code is the one coding host a release needs; native host acceptance
// (Grok, Antigravity, Codex, Claude) and native backend acceptance are optional rows that never block it.
//
//   node skills/orbit-release/ship.mjs              PREFLIGHT → BUILD → BENCHMARK → DIAGNOSE → REPAIR → REBUILD →
//                                                   FULL_RETEST → SHIPPABLE, from this checkout's HEAD
//        [--no-repair]                              verify only: a failure stands, nothing is repaired
//        [--resume=<shp-…>]                         carry an interrupted, blocked or held ship on, from its journal
//        [--usd=<n> --minutes=<n> --cycles=<n> --attempts=<n>]
//                                                   limits, within the release policy's bounds (raised on --resume)
//        [--model=<id> --credential=<NAME> --ca-file=<pem> --no-fail-fast --json --bump=changed|added|fixed|release]
//   node skills/orbit-release/ship.mjs --status[=<shp-…>]
//                                                   where this checkout's newest ship (or the one named) stands
//   node skills/orbit-release/ship.mjs --evidence[=<shp-…>] [--artifact=<zip>]
//                                                   THE PUBLISH GATE: exit 0 only when a ship qualified this very tree,
//                                                   its evidence holds as read again now, and the artifact is the one
//   node skills/orbit-release/ship.mjs --ci         the fast tier a pipeline can hold: the definition of done, the
//                                                   optional rows, and the autonomous ship AWAITED (`wait`) -- a green
//                                                   fast CI is never release qualification
//
// Exit 0 = SHIPPABLE, PUBLISHABLE, or every gate --ci holds held · 2 = NOT SHIPPABLE, refused, or a gate failed --
// nothing is tagged · 3 = BLOCKED: Docker, the coding host, its credential, a limit (resumable) · 4 = a person paused or
// cancelled it. Nothing here writes this checkout, pushes, tags or publishes: integrated repairs reach a branch only as
// a patch and a bundle a person applies.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Refused } from "../../src/errors.mjs";
import { flag, has } from "../../src/learn/args.mjs";
import { printable } from "../../src/printable.mjs";
import { command } from "../../src/project/command.mjs";
import { repositoryPaths } from "../../src/project/repository.mjs";
import { backendAcceptance } from "./backend.mjs";
import { GATES, bump, report, shippable } from "./gates.mjs";
import { nativeAcceptance, optional } from "./hosts.mjs";
import { AWAITED, ciVerdict, markOf } from "./ship/ci.mjs";
import { doorOf } from "./ship/door.mjs";
import { policyOf } from "./ship/policy.mjs";
import { benchPort, gatesAt, gitPort, workspacesOf } from "./ship/ports.mjs";
import { CREDENTIAL_NAMES } from "./ship/preflight.mjs";
import { saidEvidence, saidOptional, saidResult, saidStatus } from "./ship/report.mjs";
import { begunShip, evidenceAsked, resumedShip, statusOf } from "./ship/session.mjs";
import { driven } from "./ship/steps.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const JSON_OUT = has(args, "json");

const print = (text) => console.log(printable(text));

// ---- the fast tier: what a pipeline can hold ----------------------------------------------------------------------------

const optionalRows = (root) => [optional(nativeAcceptance(root)), optional(backendAcceptance(root))];

const versionOf = () => JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

const CHANGE = flag(args, "bump");

const nextVersion = () => (CHANGE ? `version ${versionOf()} -> ${bump(versionOf(), CHANGE)} (${CHANGE}) — set it in all FIVE version files.` : `version ${versionOf()}. Pass --bump=changed|added|fixed|release to see the next one.`);

function ciShip() {
  const rows = [...report(gatesAt(process.env)(ROOT), GATES), ...optionalRows(ROOT), AWAITED];
  for (const r of rows) print(`${markOf(r)}  ${r.name}\n        ${r.detail}`);
  print(`\n${ciVerdict(rows)}`);
  return shippable(rows) ? 0 : 2;
}

// ---- the ports this machine binds ---------------------------------------------------------------------------------------

// What the task door, the store and the benchmark are asked with: this process's environment, without a ui-tests
// override that would point the checkout's project somewhere else.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ORBIT_UI_TESTS"));

function pathsOf() {
  const p = repositoryPaths(ROOT, env);
  if (!p) throw new Refused(`${ROOT} is not a git checkout: a ship runs from Orbit's own clone`);
  return p;
}

function worldOf() {
  const p = pathsOf();
  const policy = policyOf(readFileSync(join(ROOT, "skills", "orbit-release", "ship", "policy.json"), "utf8"));
  return { root: ROOT, env, now: () => Date.now(), storeRoot: p.storeRoot, project: { key: p.storeKey, checkoutId: p.checkoutId }, policy, door: doorOf({ cli: join(ROOT, "cli", "task.mjs"), cwd: ROOT, env }), bench: benchPort(ROOT, env), git: gitPort(join(p.storeRoot, "workspaces", ".no-hooks"), env), gatesAt: gatesAt(process.env), workspaces: workspacesOf(ROOT, p.storeRoot, env), print: JSON_OUT ? null : print, everyMs: 15000, optional: optionalRows(ROOT) };
}

const int = (v) => (v === undefined ? undefined : /^\d+$/.test(v) ? Number(v) : Number.NaN);

const num = (v) => (v === undefined ? undefined : Number(v));

const credentialAsked = (v) => (v === undefined || CREDENTIAL_NAMES.includes(v) ? v ?? null : refused(`--credential names one of ${CREDENTIAL_NAMES.join(", ")} -- a NAME, never a value`));

function refused(says) {
  throw new Refused(says);
}

const optionsAsked = () => ({ model: flag(args, "model") ?? null, credential: credentialAsked(flag(args, "credential")), caFile: flag(args, "ca-file") ?? env.ORBIT_BENCHMARK_CA_FILE ?? null, limits: { minutes: int(flag(args, "minutes")), usd: num(flag(args, "usd")), cycles: int(flag(args, "cycles")), repairAttempts: int(flag(args, "attempts")) }, repair: !has(args, "no-repair"), failFast: !has(args, "no-fail-fast"), version: versionOf() });

// ---- the autonomous ship -------------------------------------------------------------------------------------------------

const shipOf = (world) => (flag(args, "resume") ? resumedShip(world, flag(args, "resume"), optionsAsked()) : begunShip(world, optionsAsked()));

const announced = (ctx) => (JSON_OUT ? ctx : (print(`SHIP  ${ctx.ship.id} · task ${ctx.task} · ${ctx.manifest.mode} · from ${ctx.manifest.start.branch ?? "detached"}@${ctx.manifest.start.commit.slice(0, 12)} · limits ${ctx.manifest.limits.minutes} min, ${ctx.manifest.limits.usd} USD, ${ctx.manifest.limits.cycles} cycle(s)`), ctx));

async function autonomousShip() {
  const world = worldOf();
  const ctx = announced(shipOf(world));
  const result = { ...(await driven(ctx)), optional: world.optional };
  print(JSON_OUT ? JSON.stringify(result, null, 2) : `${saidResult(result)}${result.exit === 0 ? `\n  ${nextVersion()}` : ""}`);
  return result.exit;
}

async function status() {
  const s = await statusOf(worldOf(), flag(args, "status") ?? null);
  print(JSON_OUT ? JSON.stringify(s, null, 2) : saidStatus(s));
  return 0;
}

async function evidence() {
  const e = await evidenceAsked(worldOf(), flag(args, "evidence") ?? null, flag(args, "artifact") ?? null);
  print(JSON_OUT ? JSON.stringify(e, null, 2) : `${saidEvidence(e)}\n${saidOptional(optionalRows(ROOT)).join("\n")}`);
  return e.publishable ? 0 : 2;
}

const MODES = [
  { when: () => has(args, "ci"), run: ciShip },
  { when: () => has(args, "status") || flag(args, "status") !== undefined, run: status },
  { when: () => has(args, "evidence") || flag(args, "evidence") !== undefined, run: evidence },
  { when: () => true, run: autonomousShip },
];

command(async () => {
  process.exitCode = await MODES.find((m) => m.when()).run();
});
