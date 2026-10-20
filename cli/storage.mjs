#!/usr/bin/env node
// Where this checkout's test data lives, and moving it between the machine store and the checkout -- a person's
// decision, never a side effect of anything else (1.8.9, src/store/publish.mjs).
//
//   node storage.mjs where [--json]
//        both copies, which one is read and why, and the newest import and export
//   node storage.mjs import [--apply] [--replace] [--json]
//        the checkout's committed ui-tests/ copied into the store, which becomes the home; the checkout's copy is
//        kept as it is. A preview unless --apply, and only the store is written
//   node storage.mjs export (--all | --screen=<id> | --case=<id> | --plan=<id>) [--move] [--apply --human] [--replace] [--json]
//        the store's test data copied into the checkout's ui-tests/ for the team to commit; the store keeps its
//        originals and stays the home (--move, with --all only: the checkout becomes the home). A preview unless
//        applied -- and applying writes a REPOSITORY, which is a person's: --apply --human in a terminal a person is
//        typing in, where they type back the id the preview showed, or Orbit Control. An agent's shell has no
//        terminal, so it is refused there, with the command a person runs themselves
//
// A file that is not what Orbit last wrote at its destination is somebody's, and stops the whole copy unless
// --replace. Every copy keeps a record in the store (imports/, exports/): what was chosen, by which door, and each
// file's digest.
//
// Exit 0 printed, previewed or done · 2 refused (nothing written) · 3 blocked (this machine could not)
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Refused } from "../src/errors.mjs";
import { printable } from "../src/printable.mjs";
import { command } from "../src/project/command.mjs";
import { repositoryPaths } from "../src/project/repository.mjs";
import { createContext } from "../src/run/context.mjs";
import { machineContext } from "../src/store/context.mjs";
import { realIo } from "../src/store/io.mjs";
import { homedir } from "node:os";
import { describeSelection, exportApply, exportPlan, importApply, importPlan, selectionOf, shownPlan, whereOf } from "../src/store/publish.mjs";
import { HOME_DIR } from "../src/project/paths.mjs";

const SELF = join(resolve(dirname(fileURLToPath(import.meta.url))), "storage.mjs");
const [cmd, ...args] = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
  if (!Object.hasOwn(COMMANDS, cmd ?? "")) return usage();
  return COMMANDS[cmd](checkout());
}

// The checkout this command runs in, by its own Git identity: what ORBIT_UI_TESTS or a loose directory would find is
// not this checkout's to move.
function checkout() {
  const paths = repositoryPaths(process.cwd(), process.env);
  if (!paths) throw new Refused(`${process.cwd()} is not inside a Git checkout — storage moves a checkout's own test data`);
  return paths;
}

// ---- where -----------------------------------------------------------------------------------------------------

const BY = { stamped: "a person's decision, stamped in the store", explicit: "the explicitly named data directory", store: "the default: nothing moved it" };

function where(paths) {
  const w = whereOf(paths);
  if (has("json")) return console.log(JSON.stringify(w, null, 2));
  console.log(printable(whereLines(w).join("\n")));
}

const whereLines = (w) => [
  `home      ${w.dataHome} — ${BY[w.dataHomeBy]}`,
  `read      ${w.dataRoot}`,
  `store     ${w.store.dir} · ${w.store.files} file(s) · ${w.store.read ? "read" : "kept, not read"}`,
  `checkout  ${w.checkout.dir} · ${w.checkout.files} file(s)${w.checkout.read ? " · read" : w.checkout.files ? " · not read" : ""}`,
  `imported  ${w.lastImport ? `${w.lastImport.id} at ${w.lastImport.at}, ${w.lastImport.written} file(s) written` : "never"}`,
  `exported  ${w.lastExport ? `${w.lastExport.id} at ${w.lastExport.at} (${w.lastExport.selection}, ${w.lastExport.mode}), ${w.lastExport.written} file(s) written` : "never"}`,
];

// ---- import ----------------------------------------------------------------------------------------------------

function imported(paths) {
  const plan = importPlan(paths);
  shown(plan, `node "${SELF}" import --apply`, has("apply"));
  if (!has("apply")) return null;
  return said(importApply(plan, applying(paths, null)));
}

// ---- export ----------------------------------------------------------------------------------------------------

async function exported(paths) {
  const plan = exportPlan(paths, selectionOf({ all: has("all"), screen: flag("screen"), case: flag("case"), plan: flag("plan") }), has("move") ? "move" : "copy");
  shown(plan, personsCommand(plan), has("apply"));
  if (!has("apply")) return null;
  const result = exportApply(plan, await actorOf(plan), applying(paths, personsCommand(plan)));
  return said(result);
}

const personsCommand = (plan) => `node "${SELF}" export ${describeSelection(plan.selection)}${plan.mode === "move" ? " --move" : ""} --apply --human`;

// What this process could establish about who is asking -- never what an argument claims. A terminal can make no
// claim to be Orbit Control; `--human` counts only with a person typing at it, who types back the preview's id.
async function actorOf(plan) {
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const human = has("human");
  return { door: "terminal", human, tty, confirmed: human && tty ? await typed(plan.id) : null };
}

async function typed(id) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(`type ${id} to write these files into this checkout: `)).trim(); }
  finally { rl.close(); }
}


// ---- shared ----------------------------------------------------------------------------------------------------

function applying(paths, commandLine) {
  const machine = machineContext({ project: paths, config: {} }, process.env);
  return { io: cmd === "export" ? realIo() : machine.io, storeIo: machine.io, prepare: machine.prepare, replace: has("replace"), now: () => new Date().toISOString(), host: machine.io.host, command: commandLine };
}

function shown(plan, next, going) {
  if (has("json")) return going ? null : console.log(JSON.stringify({ ...shownPlan(plan), apply: next }, null, 2));
  console.log(printable(previewLines(shownPlan(plan), next, going).join("\n")));
}

const previewLines = (view, next, going) => [
  `${view.kind.toUpperCase()} ${view.id}  ${view.selection} · ${view.mode}`,
  `  from  ${view.from}`,
  `  to    ${view.to}`,
  ...view.files.map((f) => `  ${f.state.padEnd(9)} ${f.rel}`),
  `  ${view.files.length} file(s): ${Object.entries(view.counts).map(([s, n]) => `${n} ${s}`).join(" · ")}`,
  ...(going ? [] : ["nothing written — this is a preview. To write it:", `  ${next}`]),
];

function said(result) {
  if (has("json")) return console.log(JSON.stringify(result, null, 2));
  const written = result.files.filter((f) => ["CREATE", "MODIFY", "REPLACE"].includes(f.state)).length;
  console.log(printable(`${result.status === "unchanged" ? "UNCHANGED" : "DONE"} ${result.id} — ${written} file(s) written · the home of this project's test data is the ${result.home}`));
}

const usage = () => console.log(HELP);

const HELP = "usage:\n  node storage.mjs where [--json]\n  node storage.mjs import [--apply] [--replace] [--json]\n  node storage.mjs export (--all | --screen=<id> | --case=<id> | --plan=<id>) [--move] [--apply --human] [--replace] [--json]";

const COMMANDS = { where, import: imported, export: exported };

command(main);
