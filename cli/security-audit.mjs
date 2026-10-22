#!/usr/bin/env node
// THE SECURITY AUDITOR, as a terminal and a host reach it (ADR 0040): which security catalogs this
// project is held to, where each control applies, the security obligations they owe, and an
// assessment taken from evidence -- standalone: a person or a host asks for it directly, with no Goal.
//
//   node security-audit.mjs catalogs [--json]
//            the catalogs in effect for this project (enabled here, or Orbit's default), the ones
//            Orbit ships, the ones adopted on this machine, and any that were refused, with why
//   node security-audit.mjs applicability [--graph=<file>] [--json]
//            every control in effect: applicable (with the graph refs that made it hold),
//            not-applicable (only on a graph complete for its scope, or by a person's mark), or
//            unknown (with what would settle it). No graph: every control is unknown
//   node security-audit.mjs plan [--graph=<file>] [--json]
//            the security obligations the applicable controls owe -- shape, boundary, controls,
//            templates -- for QA to design tests from
//   node security-audit.mjs assess --results=<file> [--graph=<file>] [--json]
//            an assessment snapshot from the evidence in <file>, pinned to the catalogs it used and
//            kept in the project's store room. Evidence a file REPORTS is shown and never proof: it
//            makes nothing verified and no finding confirmed -- only evidence read back from its
//            owner's record does
//   node security-audit.mjs assess --investigation=<id> [--graph=<file>] [--json]
//            the same, from an autonomous QA investigation's OWN record: what each generated test
//            came to, per control role its design ran, read back from the journal -- the evidence
//            that can verify a control or confirm a finding; the graph is the one it froze
//   node security-audit.mjs report <asm-id> [--graph=<file>] [--json]
//            a kept assessment, read from its frozen snapshot, and whether it is still current
//   node security-audit.mjs adopt | enable | mark
//            REFUSED here: adopting a catalog, enabling one for a project and marking a control not
//            applicable are a person's, in Orbit Control (Security → Catalogs) -- a terminal cannot
//            prove who typed them, and an agent never chooses the standard it is assessed against
//
// <file> for --graph is the System Graph's projection: { nodes: [{ id, role }], relations: [{ id,
// role, from, to }], complete }. No command here fetches or edits a catalog, starts a goal, or
// writes anything but an assessment's own snapshot.
//
// Exit 0 = done · 2 = REFUSED · 3 = BLOCKED. Never 1.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Refused } from "../src/errors.mjs";
import { canonicalJson, sha } from "../src/hash.mjs";
import { printable } from "../src/printable.mjs";
import { command } from "../src/project/command.mjs";
import { storeBase } from "../src/project/repository.mjs";
import { COMMANDS, stateOf } from "../src/qa/security/index.mjs";
import { modelOf } from "../src/investigation/model.mjs";
import { readSettings } from "../src/investigation/settings.mjs";
import { createInvestigations } from "../src/investigation/store.mjs";
import { resultsFromInvestigation } from "../skills/orbit-security-audit/evidence.mjs";
import { securityRooms } from "../src/qa/security/store.mjs";
import { runtimeProject } from "../src/runtime/context.mjs";
import { machineContext } from "../src/store/context.mjs";

const ENV = process.env;
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, ...args] = process.argv.slice(2);

const flag = (name) => (args.find((a) => a.startsWith(`--${name}=`)) ?? "").slice(name.length + 3) || null;

async function main() {
  const entry = Object.hasOwn(COMMANDS, cmd ?? "") ? COMMANDS[cmd] : null;
  if (!entry) return help();
  const result = await entry.run(portsHere(), args);
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : printable(entry.say(result)));
}

function jsonFile(name) {
  const file = flag(name);
  if (!file) return null;
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { throw new Refused(`--${name}=${file} is not a readable JSON document — ${e.message}`); }
}

function here() {
  const { paths, config } = runtimeProject(ENV, process.cwd());
  if (paths.layout !== 3 || !paths.storeRoot) throw new Refused("the security audit is a project's: run it inside the project's checkout");
  return { paths, io: machineContext({ project: paths, config: config ?? {} }, ENV).io };
}

// Evidence from a FILE is reported evidence, whatever it says about itself: only a composition root
// that read an owner's record back may call it the owner's -- here, an investigation's own journal
// (`--investigation=<id>`), whose graph is the one its obligations were derived against.
function portsHere() {
  const h = here();
  const owner = flag("investigation") ? investigationOf(h, flag("investigation")) : null;
  const graph = jsonFile("graph") ?? owner?.graph ?? null;
  const p = { io: h.io, rooms: securityRooms(storeBase(ENV), h.paths.storeRoot), shippedDir: join(PLUGIN_ROOT, "skills", "orbit-security-audit", "catalogs"), graph: () => graph, scopeDigest: () => (graph ? sha(canonicalJson(graph)) : null), resultsSource: owner ? "owner" : "reported", now: () => new Date().toISOString(), door: null };
  return { ...p, results: () => (owner ? resultsFromInvestigation({ ...owner, controls: controlsInEffect(p) }) : jsonFile("results") ?? []) };
}

// The investigation, read only: its fold, its artifacts and frozen versions, the store its evidence is kept in, its
// tenancy contract, and the System Graph it froze.
function investigationOf(h, id) {
  const machine = machineContext({ project: h.paths, config: {} }, ENV);
  const store = createInvestigations(machine.store.root, machine.io);
  const model = modelOf(store.read(id));
  if (!model.meta) throw new Refused(`no investigation ${String(id).slice(0, 40)} in this project — autonomous-qa.mjs list`);
  return { model, graph: frozenGraphOf(store, id, model), readArtifact: (kind, digest) => store.readArtifact(id, kind, digest), readVersion: (path) => store.readVersion(id, path), storeRoot: machine.store.root, tenancy: readSettings(store.paths, machine.io).settings.tenancy };
}

const frozenGraphOf = (store, id, model) => model.bindings.filter((b) => b.type === "graph").map((b) => store.readArtifact(id, "graphs", b.digest)).at(-1) ?? null;

const controlsInEffect = (p) => stateOf(p).effective.catalogs.flatMap((e) => e.controls.filter((c) => (c.shapes ?? []).length).map((c) => ({ catalog: e.catalog, control: c.id, shapes: c.shapes })));

function help() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const end = lines.findIndex((l) => !l.startsWith("//"));
  console.log(lines.slice(0, end).join("\n"));
}

command(main);
