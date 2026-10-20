// MOVING a project's test data between the machine store and its checkout -- a person's decision, never a side
// effect of anything else (1.8.9). The store is the home of a project's test data (src/project/data-home.mjs); what
// is published into a repository, or brought in from one, goes through here and nowhere else.
//
//   import   a checkout's committed ui-tests/ copied INTO the store, which then becomes its home. The checkout's
//            copy is never touched, let alone deleted. Only the store is written, so a preview and --apply suffice.
//   export   the store's test data (all of it, one screen, one case or one plan) copied INTO the checkout's
//            ui-tests/ for a team to commit. The store keeps its originals and stays the home; `--move` (the whole
//            tree) makes the checkout the home instead and leaves the store's copy where it was. Writing a
//            repository is a PERSON's, so applying an export is authorized by AUTHORIZE below, never by a flag.
//
// Every file is planned before anything is written: SAME, CREATE, MODIFY (the destination still holds exactly what
// Orbit last wrote there, by the digest in the newest record) or CONFLICT (anything else: somebody's edit, or a file
// Orbit never wrote), and a CONFLICT stops the whole operation unless --replace says otherwise. The plan is taken
// again under the store's authoring lock (the one src/store/edit.mjs takes), and anything that moved since the
// preview refuses. Each file is written atomically and read back by its digest; the provenance record is written
// LAST, so an interrupted copy leaves files that the next preview calls SAME and never a record of a copy that did
// not finish. Nothing is read or written through a link, and nothing leaves the store or the checkout it names.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Blocked, Refused } from "../errors.mjs";
import { short, shaBytes } from "../hash.mjs";
import { contained } from "../project/boundary.mjs";
import { DATA_DIR, dataRootOf, checkoutDataRoot } from "../project/data-home.mjs";
import { CASES_DIR, FOLDER, MD_EXT, PLAN_EXT, SCREENS_DIR } from "../tests-tree.mjs";
import { writeAtomic } from "./atomic.mjs";
import { storePath } from "./guard.mjs";
import { realIo } from "./io.mjs";
import { withLock } from "./lock.mjs";
import { restamp } from "./repository.mjs";
import { treeDigest, treeFiles } from "./tree.mjs";

export const RECORD_SCHEMA = 1;
const ROOMS = { export: "exports", import: "imports" };
const BUSY = "another session is writing this project's test data — try again in a moment";

// What a tree holds that is never test data: reports a project pointed there, a person's machine-local choices, the
// ledger's pre-1.4 home. None of it is moved.
const NOT_DATA = ["reports", ".local", "memory"];
const skipOf = (dir) => NOT_DATA.map((d) => join(dir, d));

// ---- what may be chosen ----------------------------------------------------------------------------------------

const segments = (rel) => rel.split("/");
const caseNamed = (rel, id) => ((s) => s[0] === SCREENS_DIR && s.at(-1) === `${id}.json` && (s.length === 2 || (s.length === 4 && s[2] === CASES_DIR)))(segments(rel));
const planNamed = (rel, id) => ((s) => s[0] === SCREENS_DIR && [`${id}${PLAN_EXT}`, `${id}${MD_EXT}`].includes(s.at(-1)) && s.length <= 3)(segments(rel));

// Ordered by how much they take; exactly one is chosen, and an id is one path segment like a screen folder's.
export const SELECTIONS = [
  { flag: "all", pick: (rels) => rels },
  { flag: "screen", pick: (rels, id) => rels.filter((r) => r.startsWith(`${SCREENS_DIR}/${id}/`)) },
  { flag: "case", pick: (rels, id) => rels.filter((r) => caseNamed(r, id)) },
  { flag: "plan", pick: (rels, id) => rels.filter((r) => planNamed(r, id)) },
];

// -> { flag, id } from what a caller named, or Refused with what may be named.
export function selectionOf(named) {
  const chosen = SELECTIONS.filter((s) => named[s.flag] !== undefined && named[s.flag] !== false);
  if (chosen.length !== 1) throw new Refused("choose exactly one of --all, --screen=<id>, --case=<id> or --plan=<id>");
  const id = chosen[0].flag === "all" ? null : String(named[chosen[0].flag]);
  if (id !== null && !FOLDER.test(id)) throw new Refused(`${JSON.stringify(id)} is not an id: one path segment, ${FOLDER.source}`);
  return { flag: chosen[0].flag, id };
}

export const describeSelection = (s) => (s.flag === "all" ? "--all" : `--${s.flag}=${s.id}`);

// ---- what each file is -----------------------------------------------------------------------------------------

// Ordered; the first that matches is the file's state, and the last always does.
export const STATES = [
  { state: "SAME", when: (f) => f.there === f.digest },
  { state: "CREATE", when: (f) => f.there === null },
  { state: "MODIFY", when: (f) => f.ours !== null && f.there === f.ours },
  { state: "CONFLICT", when: () => true },
];

const WROTE = ["CREATE", "MODIFY", "REPLACE"];

const stateOf = (f) => ({ ...f, state: STATES.find((s) => s.when(f)).state });

// ---- where each copy is ----------------------------------------------------------------------------------------

const storeData = (paths) => dataRootOf(paths.root, paths.storeRoot, "store");
const checkoutData = (paths) => contained(paths.root, join(paths.root, DATA_DIR));
const filesIn = (dir) => treeFiles(dir, skipOf(dir));

// -> both copies, which one is read, and the newest import and export.
export function whereOf(paths, io = realIo()) {
  const copy = (dir, home) => ({ dir, files: filesIn(dir).length, read: paths.dataHome === home });
  return { dataHome: paths.dataHome, dataHomeBy: paths.dataHomeBy, dataRoot: paths.dataRoot, store: copy(storeData(paths), "store"), checkout: { ...copy(checkoutData(paths), "checkout"), committed: checkoutDataRoot(paths.root) !== null }, lastImport: summary(latest(paths, "import", io)), lastExport: summary(latest(paths, "export", io)) };
}

const summary = (r) => (r ? { id: r.id, at: r.at, mode: r.mode, selection: r.selection, written: r.files.filter((f) => WROTE.includes(f.state)).length } : null);

// ---- plans -----------------------------------------------------------------------------------------------------

// A checkout's committed ui-tests/ into the store.
export function importPlan(paths, io = realIo()) {
  const from = checkoutDataRoot(paths.root);
  if (!from) throw new Refused(`${join(paths.root, DATA_DIR)} holds no project.json — this checkout commits no test data to import`);
  return planned({ kind: "import", paths, selection: { flag: "all", id: null }, mode: "copy", from: contained(paths.root, from), to: storeData(paths), readGuard: (p) => contained(paths.root, p), writeGuard: (p) => storePath(paths.storeRoot, p) }, io);
}

// The store's test data, or a part of it, into the checkout's ui-tests/. `mode`: "copy" (the store stays the home)
// or "move" (the whole tree, and the checkout becomes the home).
export function exportPlan(paths, selection, mode, io = realIo()) {
  if (paths.dataHome !== "store") throw new Refused(`this project's test data lives in the checkout (${paths.dataRoot}): the store holds only its mirror, so there is nothing to export — storage import goes the other way`);
  if (mode === "move" && selection.flag !== "all") throw new Refused("--move takes the whole tree (--all): a checkout that becomes the home needs every file of it, project.json included");
  return planned({ kind: "export", paths, selection, mode, from: storeData(paths), to: checkoutData(paths), readGuard: (p) => storePath(paths.storeRoot, p), writeGuard: (p) => contained(paths.root, p) }, io);
}

function planned(spec, io) {
  const rels = SELECTIONS.find((s) => s.flag === spec.selection.flag).pick(filesIn(spec.from), spec.selection.id);
  if (!rels.length) throw new Refused(`nothing in ${spec.from} matches ${describeSelection(spec.selection)}`);
  const ours = lastWritten(spec.paths, spec.kind, io);
  const files = rels.map((rel) => stateOf({ rel, digest: digestAt(spec.readGuard, spec.from, rel), there: digestAt(spec.writeGuard, spec.to, rel), ours: ours.get(rel) ?? null }));
  return { ...spec, id: planId(spec, files), files, treeDigest: treeDigest(files) };
}

function digestAt(guard, dir, rel) {
  const file = guard(join(dir, rel));
  if (realIo().kind(file) === "symlink") throw new Refused(`${file} is a link — nothing is read or written through a link`);
  return existsSync(file) ? shaBytes(readFileSync(file)) : null;
}

// The same preview is the same id: what a person is shown is what a person confirms.
const planId = (spec, files) => `${spec.kind === "export" ? "exp" : "imp"}-${short([spec.selection.flag, spec.selection.id, spec.mode, ...files.map((f) => `${f.rel}:${f.digest}:${f.state}`)].join("\n"), 8)}`;

// What a plan looks like to a reader: no guard, no paths object, nothing but the facts.
export const shownPlan = (plan) => ({ kind: plan.kind, id: plan.id, selection: describeSelection(plan.selection), mode: plan.mode, from: plan.from, to: plan.to, treeDigest: plan.treeDigest, files: plan.files.map(({ rel, state }) => ({ rel, state })), counts: countsOf(plan.files) });

export const countsOf = (files) => Object.fromEntries([...STATES.map((s) => s.state), "REPLACE"].map((s) => [s, files.filter((f) => f.state === s).length]).filter(([, n]) => n));

// ---- who may write the checkout -------------------------------------------------------------------------------

// `actor`: { door, human, tty, confirmed } -- what the composition root could establish, never what a caller says.
// Orbit Control sets door "control" after its mutation token (the proof of a person every grant in this engine
// needs); a terminal is a person only when one is typing in it and types back the id the preview showed. An
// agent's shell has no terminal, so `--human` there is refused, with the command a person runs themselves.
// Ordered; the first that matches decides, and the last always does.
export const AUTHORIZE = [
  { when: (a) => a.door === "control", allowed: true, says: () => "a person, through Orbit Control" },
  { when: (a) => !a.human, allowed: false, says: (a, plan, command) => `writing into the checkout is a person's: this was a preview, and nothing was written. A person runs, in a terminal of their own:\n  ${command}` },
  { when: (a) => !a.tty, allowed: false, says: (a, plan, command) => `--human needs a terminal a person is typing in, and this one has none (an agent's shell never does) — nothing written. A person runs, in a terminal of their own:\n  ${command}` },
  { when: (a, plan) => a.confirmed !== plan.id, allowed: false, says: (a, plan) => `what was typed is not ${plan.id}, the export the preview showed — nothing written` },
  { when: () => true, allowed: true, says: () => "a person at this terminal, who typed the export's id" },
];

export const authorized = (actor, plan, command) => ((row) => ({ allowed: row.allowed, says: row.says(actor, plan, command) }))(AUTHORIZE.find((r) => r.when(actor, plan)));

// ---- applying --------------------------------------------------------------------------------------------------

// `opts`: { io (writes the destination), storeIo (writes records and the stamp), prepare? (labels the store, asked
// only once a copy is going ahead), replace, now, host, command (what a person runs, for a refusal to name) }.
export function exportApply(plan, actor, opts) {
  const verdict = authorized(actor, plan, opts.command);
  if (!verdict.allowed) throw new Refused(verdict.says);
  return applied(plan, { ...opts, door: actor.door === "control" ? "control" : "terminal" });
}

export const importApply = (plan, opts) => applied(plan, { ...opts, door: "terminal" });

function applied(plan, opts) {
  const conflicts = plan.files.filter((f) => f.state === "CONFLICT");
  if (conflicts.length && !opts.replace) throw new Refused(`${conflicts.length} file(s) are not what Orbit last wrote there, so they are somebody's: ${conflicts.slice(0, 5).map((f) => f.rel).join(", ")}${conflicts.length > 5 ? ", …" : ""} — nothing written; --replace writes over them`);
  opts.prepare?.();
  return withLock(authoringLock(plan, opts.storeIo), () => locked(plan, opts), opts.storeIo, BUSY);
}

// The lock every writer of this project's test data takes (src/store/edit.mjs), so a copy never races a promote.
const authoringLock = (plan, io) => ((lock) => (io.ensureDir(lock), lock))(storePath(plan.paths.storeRoot, join(plan.paths.storeRoot, "state", "authoring")));

function locked(plan, opts) {
  const now = planned(plan, opts.storeIo);
  if (now.id !== plan.id) throw new Refused("the files changed since the preview — nothing written; preview it again");
  const files = now.files.map((f) => (f.state === "CREATE" || f.state === "MODIFY" || (f.state === "CONFLICT" && opts.replace) ? copied(now, f, opts.io) : f));
  return settled(now, files, opts);
}

function copied(plan, f, io) {
  const target = plan.writeGuard(join(plan.to, f.rel));
  io.ensureDir(dirname(target));
  writeAtomic(target, readFileSync(plan.readGuard(join(plan.from, f.rel))), io, false);
  if (shaBytes(readFileSync(target)) !== f.digest) throw new Blocked(`${target} did not read back as it was written — the copy stopped there, and what was written before it stays`);
  return { ...f, state: f.state === "CONFLICT" ? "REPLACE" : f.state };
}

// What each operation decides about where the data lives, once its files are in place.
const HOME_AFTER = { import: () => "store", export: (plan) => (plan.mode === "move" ? "checkout" : "store") };

// Nothing written and nothing to decide (an import already made, an export the checkout already holds byte for byte
// under a store that is already the home) is UNCHANGED: no second record of a copy that copied nothing.
function settled(plan, files, opts) {
  const home = HOME_AFTER[plan.kind](plan);
  const record = recordOf(plan, files, opts);
  if (!files.some((f) => WROTE.includes(f.state)) && decided(plan.paths, home)) return { ...record, status: "unchanged", home };
  kept(plan, record, opts, home);
  return { ...record, status: "applied", home };
}

const decided = (paths, home) => paths.dataHomeBy === "stamped" && paths.dataHome === home;

// The record first, then the decision it records: a stamp with no record behind it would be a move nobody can trace.
function kept(plan, record, opts, home) {
  writeAtomic(recordFile(plan, record), `${JSON.stringify(record, null, 2)}\n`, opts.storeIo, false);
  restamp(plan.paths.storeRoot, { dataHome: home }, opts.storeIo);
}

const recordFile = (plan, record) => storePath(plan.paths.storeRoot, join(plan.paths.storeRoot, ROOMS[plan.kind], `${record.at.replace(/[:.]/g, "-")}-${record.id}.json`));

// The provenance of one copy: what was chosen, by which door, every file with its digest and what happened to it --
// rooms and relative paths only, never an absolute path, so a record says the same wherever the store is opened.
const recordOf = (plan, files, opts) => ({ schema: RECORD_SCHEMA, id: plan.id, kind: plan.kind, at: opts.now(), host: opts.host, checkout: plan.paths.checkoutId, selection: describeSelection(plan.selection), mode: plan.mode, door: opts.door, from: plan.kind === "export" ? "store:ui-tests" : "checkout:ui-tests", to: plan.kind === "export" ? "checkout:ui-tests" : "store:ui-tests", treeDigest: treeDigest(files), files: files.map(({ rel, digest, state }) => ({ rel, digest, state })) });

// ---- the records ------------------------------------------------------------------------------------------------

function records(paths, kind, io) {
  const room = storePath(paths.storeRoot, join(paths.storeRoot, ROOMS[kind]));
  return io.list(room).filter((n) => n.endsWith(".json")).sort().map((n) => parsedRecord(io.read(join(room, n)))).filter(Boolean);
}

function parsedRecord(text) {
  try { return ((r) => (r?.schema === RECORD_SCHEMA && Array.isArray(r.files) ? r : null))(JSON.parse(text)); }
  catch { return null; }
}

const latest = (paths, kind, io) => records(paths, kind, io).at(-1) ?? null;

// rel -> the digest the newest record of this kind wrote there: what makes a destination file Orbit's own to replace.
function lastWritten(paths, kind, io) {
  const map = new Map();
  for (const r of records(paths, kind, io)) for (const f of r.files.filter((x) => WROTE.includes(x.state))) map.set(f.rel, f.digest);
  return map;
}
