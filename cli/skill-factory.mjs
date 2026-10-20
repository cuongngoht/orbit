#!/usr/bin/env node
// THE SKILL FACTORY, as a terminal and a host reach it: this project's generated PLAYBOOKS -- instruction-only
// skills a coordinated workflow drafted when nothing here provided the workflow its objective needed, held to
// the contract a shipped SKILL.md is held to, kept in the project's room of the machine store (never in a
// repository, never in the plugin), and followed by a host inside a workflow. A playbook is never a host's
// native slash command.
//
//   node skill-factory.mjs list            every registered playbook: its pin, status, and whether it is offered
//   node skill-factory.mjs drafts          the drafts a workflow scaffolded and a host is writing
//   node skill-factory.mjs show <id|pin>   the playbook's text, printable, for a host to follow -- by pin, the
//                                          exact version a workflow pinned, wherever it is kept now
//   node skill-factory.mjs put <id> <file.md> [--as=<name.md>] [--needs=a.b,c.d]
//                                          the playbook's text (and the capabilities it needs) into its DRAFT --
//                                          never into a registered playbook
//   node skill-factory.mjs verify <id>     the draft held to the contract; writes nothing
//   node skill-factory.mjs discover --for=<capability>
//                                          what the resolver answers for a capability, in one word: REUSABLE (and the
//                                          pin it would be), APPROVAL_REQUIRED, WORKFLOW_GAP, POLICY_GAP,
//                                          ENVIRONMENT_GAP, CAPABILITY_GAP or UNRESOLVED -- read, never stored
//   node skill-factory.mjs workflow <id|pin>
//                                          a declared playbook's workflow.json, its steps in the order they run, read
//                                          from that exact version and held to the workflow contract again
//   node skill-factory.mjs where           where this project's playbooks are kept
//
// Every command takes --json. Registering a draft is a coordinated workflow's own step (automation.mjs), gated
// by the automation policy; activating, disabling, retiring, rolling back and archiving are a person's, in Orbit
// Control (Automation → Generated skills). No command here does any of them.
//
// Exit 0 = done · 2 = REFUSED · 3 = BLOCKED. Never 1.
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
import { factoryPort, projectSkillsOf } from "../skills/orbit-help/factory.mjs";
import { generates } from "../src/automation/intelligence.mjs";
import { gapOf } from "../src/skill-factory/gap.mjs";
import { effectiveOf, readAutomation } from "../src/automation/settings.mjs";
import { Refused } from "../src/errors.mjs";
import { resolved } from "../src/knowledge/verify.mjs";
import { printable } from "../src/printable.mjs";
import { command } from "../src/project/command.mjs";
import { storeBase } from "../src/project/repository.mjs";
import { effectiveResourcesOf } from "../src/resources/compose.mjs";
import { runtimeProject } from "../src/runtime/context.mjs";
import { COMMANDS } from "../src/skill-factory/index.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { machineContext } from "../src/store/context.mjs";
import { realWorld } from "../skills/orbit-control/world.mjs";
import { withExtensions } from "../src/extensions/index.mjs";
import { createContext } from "../src/run/context.mjs";

const ENV = commandEnvironment(process.env, process.argv);
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, ...args] = process.argv.slice(2);

async function main() {
  const entry = Object.hasOwn(COMMANDS, cmd ?? "") ? COMMANDS[cmd] : null;
  if (!entry) return help();
  const result = await entry.run(await portsHere(), args);
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : printable(entry.say(result)));
}

function here() {
  const { paths, config } = runtimeProject(ENV, process.cwd());
  if (paths.layout !== 3 || !paths.checkoutId) throw new Refused("the skill factory works from a Git checkout — run it inside one");
  return { paths, io: machineContext({ project: paths, config: config ?? {} }, ENV).io };
}

const valuesOf = (h) => effectiveOf([{ by: "machine", content: readAutomation(h.io, join(stateRooms(storeBase(ENV)).automation, "settings.json")).content }, { by: "project", content: readAutomation(h.io, join(h.paths.storeRoot, "automation", "settings.json")).content }]).values;

async function extended(h) {
  try { return await withExtensions(createContext({}, ENV, h.paths.root)); }
  catch (e) { if (e instanceof Refused) return null; throw e; }
}

// `verify` and `discover` ask the SAME registry the router and a workflow resolve against -- the project's own
// capabilities loaded, and (for discover, as a workflow sees it) its active playbooks.
const RESOLVES = ["verify", "discover"];

async function resolverFor(h) {
  const caps = RESOLVES.includes(cmd) ? await extended(h) : null;
  const effective = RESOLVES.includes(cmd) ? effectiveResourcesOf({ ...realWorld({ pluginRoot: PLUGIN_ROOT, projectRoot: h.paths.root, env: ENV }), capabilities: () => caps?.capabilities?.list?.() ?? [], ...(cmd === "discover" ? { projectSkills: projectSkillsOf(h, valuesOf(h)) } : {}) }) : null;
  return (capability) => resolved([{ capability, proves: { subject: capability } }], effective).results[0];
}

// One capability, read the way a coordinated workflow reads it: the resolver's answer, its gap, and whether the
// automation policy lets the factory close it.
const discovered = (factory, resolve, values) => (capability) => ((r) => ((gap) => factory.discover({ capability, resolved: r, gap, generates: generates(gap, values) }))(r?.outcome === "provided" ? null : gapOf(r, [])))(resolve(capability));

async function portsHere() {
  const h = here();
  const resolve = await resolverFor(h);
  const factory = factoryPort(h, () => valuesOf(h), resolve);
  return { factory, discover: discovered(factory, resolve, valuesOf(h)), readFile: (file) => readFileSync(file, "utf8"), basename: (file) => basename(file) };
}

function help() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const end = lines.findIndex((l) => !l.startsWith("//"));
  console.log(lines.slice(0, end).join("\n"));
}

command(main);
