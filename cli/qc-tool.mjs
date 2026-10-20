#!/usr/bin/env node
// The life of a project's own QC tool -- or project-report part: scaffold,
// verify, register, retire, roll back.
//
//   node qc-tool.mjs where                    where this project's QC tools live
//   node qc-tool.mjs list                     what is registered, and what failed to load
//   node qc-tool.mjs new <id> <dir> [--tool=psql] [--mutates] [--provides=<a.b,c.d>] [--connection=<provider>]
//                                             scaffold a draft capability into a SCRATCH directory --
//                                             --provides names the semantic capabilities it answers
//                                             (an acquisition one, such as workitem.read, scaffolds a
//                                             reader of requirements) and --connection the provider
//                                             of the connection it needs
//   node qc-tool.mjs new <id> [<dir>] --report=<kind> --for="<the need>"
//                                             scaffold a draft project-report part (metric, section,
//                                             transform, exporter, collector, workflow) -- into the
//                                             project's drafts room when no directory is given
//   node qc-tool.mjs put <id> <file>          write stdin into a draft's <file> (.py, .json or .md)
//   node qc-tool.mjs verify <dir|id>          hold a candidate to the real contract -- a report part
//                                             is also checked statically and RUN on a snapshot
//   node qc-tool.mjs register <dir|id> [--human]
//                                             verify, then move it into the store (--human: a person's
//                                             registration, the only kind that may replace a standard
//                                             report part or overwrite files edited in the store)
//   node qc-tool.mjs status <id> <status>     draft|verified|active|stale|retired|broken
//   node qc-tool.mjs rollback <id> [--to=<version>] [--human]
//                                             back to a version kept aside, verified again
//
// Nothing here writes into a repository: a generated QC tool is this plugin's,
// it churns as a project changes, and it is full of one tenant's particulars, so
// it lives in the machine store beside the ledger and the lessons.
//
// Exit 0 = fine · 2 = REFUSED (a candidate that is not verified is never
// registered) · 3 = BLOCKED (nowhere to keep it).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { command } from "../src/project/command.mjs";
import { Refused } from "../src/errors.mjs";
import { createContext } from "../src/run/context.mjs";
import { withExtensions } from "../src/extensions/index.mjs";
import { registerTool, rollbackTool, setStatus, verifyTool } from "../src/extensions/lifecycle.mjs";
import { scaffold } from "../src/extensions/scaffold.mjs";
import { createQcTools, qcToolPaths } from "../src/extensions/store.mjs";
import { contained } from "../src/project/boundary.mjs";
import { reportProject } from "../src/project-report/context.mjs";
import { snapshotFile } from "../src/project-report/snapshot.mjs";
import { runIds } from "../src/project-report/store.mjs";
import { createProcess } from "../src/process/index.mjs";
import { storeBase } from "../src/project/repository.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { capabilities, extensions } from "../src/query/extensions.mjs";
import { pythonFor } from "../skills/orbit-report/bind.mjs";
import { REPORT_KINDS, checkReport, scaffoldReport } from "../skills/orbit-report/extend.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const args = rest.filter((a) => !a.startsWith("--"));
const flag = (n) => rest.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const has = (n) => rest.includes(`--${n}`);
const listFlag = (n) => (flag(n) ? flag(n).split(",").map((x) => x.trim()).filter(Boolean) : undefined);

const io = realIo();

const COMMANDS = { where, list, new: create, put, verify, register, status, rollback };

async function main() {
  if (!COMMANDS[cmd]) return usage();
  await COMMANDS[cmd]();
}

const usage = () => console.log(`node qc-tool.mjs where | list | new <id> <dir> | new <id> --report=<kind> --for="…" | put <id> <file> | verify <dir|id> | register <dir|id> | status <id> <status> | rollback <id>`);

// A project that never ran `init` (it has no UI tests) still has a store,
// keyed by its Git identity: a report part needs no more than that.
function contextOf() {
  try {
    return createContext();
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    return reportContext();
  }
}

function reportContext() {
  const found = reportProject(process.env, process.cwd());
  return { store: (write = false) => (write && found.prepare(), found.store.root), reportRoom: found.room };
}

function where() {
  const paths = qcToolPaths(contextOf().store(false));
  console.log(`room     : ${paths.root}`);
  console.log(`registry : ${paths.registry}`);
  console.log(`\nOutside every repository, keyed to this project. Upgrading the engine does not touch it.`);
}

async function list() {
  const ctx = await withExtensions(createContext());
  extensions(ctx);
  console.log("");
  capabilities(ctx);
}

// A scaffold is a DRAFT: something just generated has been proved nothing, and
// the loader will not run a draft.
function create() {
  const [id, dir] = args;
  if (!id) throw new Refused("node qc-tool.mjs new <id> <scratch-dir> [--tool=psql] [--mutates] [--provides=a.b,c.d] [--connection=<provider>] · new <id> [<dir>] --report=<kind> --for=\"<the need>\"");
  return flag("report") ? createReport(id, dir) : createCapability(id, dir);
}

function createCapability(id, dir) {
  if (!dir) throw new Refused("node qc-tool.mjs new <id> <scratch-dir> [--tool=psql] [--mutates] [--provides=a.b,c.d] [--connection=<provider>]");
  const made = scaffold(resolve(dir), id, io, { tools: flag("tool") ? [flag("tool")] : [], mutates: has("mutates"), provides: listFlag("provides"), connection: flag("connection") });
  console.log(`${made.files.join(", ")} -> ${made.dir}\n\nstatus is "draft", so nothing will run it. Write the capability, run its test.mjs,\nthen: node qc-tool.mjs verify ${dir}`);
}

function createReport(id, dir) {
  if (!REPORT_KINDS.includes(flag("report"))) throw new Refused(`--report is one of ${REPORT_KINDS.join(", ")}`);
  if (!flag("for")) throw new Refused("--for=\"<the need>\": a report part is made for a need somebody has, and carries it as its provenance");
  const made = scaffoldReport(dir ? resolve(dir) : draftDir(contextOf(), id), id, flag("report"), flag("for"), io);
  console.log(`${made.files.join(", ")} -> ${made.dir}\n\nstatus is "draft". Write the part (node qc-tool.mjs put ${id} <file> < file), then: node qc-tool.mjs register ${id}`);
}

// A project's drafts room, beside its drafted cases: outside every repository.
function draftDir(ctx, id) {
  const root = join(ctx.store(true), "drafts", "qc-tools");
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(String(id))) throw new Refused(`${id} is not an extension id (lower-case letters, digits and dashes)`);
  return contained(root, join(root, id));
}

// Content in on stdin, so a session writes a draft without writing anywhere
// outside its workspace: one flat file of a draft that exists.
function put() {
  const [id, file] = args;
  if (!id || !file) throw new Refused("node qc-tool.mjs put <id> <file> < content");
  const dir = draftDir(contextOf(), id);
  if (!existsSync(dir)) throw new Refused(`no draft ${id}; start one with: node qc-tool.mjs new ${id} --report=<kind> --for="…"`);
  console.log(`wrote ${io.write(flatIn(dir, file), readFileSync(0, "utf8"))}`);
}

function flatIn(dir, file) {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}\.(py|json|md)$/.test(String(file))) throw new Refused(`${file}: a draft's file is a flat, lower-case .py, .json or .md name`);
  return contained(dir, join(dir, file));
}

// A path that exists is a directory to verify; anything else names a draft.
function dirOf(arg, ctx) {
  if (!arg) throw new Refused(`node qc-tool.mjs ${cmd} <dir|id>`);
  return existsSync(resolve(arg)) ? resolve(arg) : draftDir(ctx, arg);
}

async function verify() {
  const ctx = contextOf();
  const dir = dirOf(args[0], ctx);
  const verdict = await checked(await verifyTool(ctx, dir, io), dir, ctx);
  said(verdict, dir);
  process.exitCode = verdict.ok ? 0 : 2;
}

// The loader's word first; a report part's own checks only after it said yes.
async function checked(verdict, dir, ctx) {
  if (!verdict.ok || !verdict.manifest?.reporting) return verdict;
  const findings = await reportCheck(ctx)(dir, verdict);
  return findings.length ? { ...verdict, ok: false, findings } : verdict;
}

const reportCheck = (ctx) => (dir, verdict) => (verdict.manifest?.reporting ? checkReport(dir, verdict.manifest, { python: pythonFor(process.env, stateRooms(storeBase(process.env))).file, process: createProcess(), env: process.env, io, human: has("human"), latest: latestSnapshot(ctx) }) : []);

function latestSnapshot(ctx) {
  const room = ctx.reportRoom ?? reportProject(process.env, process.cwd()).room;
  const id = runIds(room, io)[0];
  return id && existsSync(snapshotFile(room, id)) ? snapshotFile(room, id) : null;
}

function said(verdict, dir) {
  if (verdict.ok) return console.log(`ok  ${verdict.manifest.id} holds to ${verdict.manifest.apiVersion}${offered(verdict)}`);
  console.error(`REFUSED  ${dir} is not something this engine will load:`);
  for (const f of verdict.findings) console.error(`  ${f}`);
}

const offered = (v) => [v.loaded?.capabilities?.length ? ` — offers ${v.loaded.capabilities.join(", ")}` : "", v.loaded?.reportParts?.length ? ` — report parts ${v.loaded.reportParts.join(", ")}` : ""].join("");

// Verify happens INSIDE register too. A builder that could register an unproved
// tool is a builder whose verification step is decoration.
async function register() {
  const ctx = contextOf();
  const kept = await registerTool(ctx, dirOf(args[0], ctx), io, {}, { human: has("human"), check: reportCheck(ctx) });
  console.log(`registered ${kept.id} [${kept.entry.kind}] -> ${kept.at}`);
  console.log(`status: verified · engine ${kept.entry.engine} · ${kept.entry.lastVerified}${kept.entry.kind.includes("report") ? `\nnext: node qc-tool.mjs status ${kept.id} active` : ""}`);
}

function status() {
  const [id, next] = args;
  if (!id || !next) throw new Refused("node qc-tool.mjs status <id> <draft|verified|active|stale|retired|broken>");
  const out = setStatus(contextOf(), id, next, io);
  console.log(`${out.id} is now ${out.status}`);
}

async function rollback() {
  const [id] = args;
  if (!id) throw new Refused("node qc-tool.mjs rollback <id> [--to=<version>] [--human]");
  const ctx = contextOf();
  const kept = await rollbackTool(ctx, id, io, { to: flag("to") ?? null, human: has("human"), check: reportCheck(ctx) });
  console.log(`${kept.id} is back at ${kept.entry.rolledBackTo} (verified again) -> ${kept.at}`);
}

export { createQcTools };

command(main);
