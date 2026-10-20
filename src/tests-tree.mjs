// WHERE a project's cases and plans sit on disk: one folder per SCREEN.
//
//   screens/<screen-id>/<plan-id>.plan.json   (+ <plan-id>.md, rendered beside it)
//   screens/<screen-id>/cases/<case-id>.json
//   schema/case.schema.json · schema/plan.schema.json
//
// A flat directory of fifty cases is where nobody can find the three a changed
// screen invalidates. A screen is what gets rewritten, re-run and handed to the
// next team, so it is the folder. The folder is for PEOPLE: an id is still the
// file name and still unique across the whole tree, so the ledger, the evidence
// room, retention and every plan link keep asking by id and never by path.
//
// A LEAF, because the case loader (dsl) and the plan loader (qa) both need it and
// neither may import the other. The scan is two levels deep and no deeper: a
// flat file in the directory itself (the drafts room is flat) and one folder per
// screen. Anything deeper is somebody's scratch, not a case.
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Refused } from "./errors.mjs";

export const SCREENS_DIR = "screens";
export const CASES_DIR = "cases";
export const SCHEMA_DIR = "schema";
export const CASE_SCHEMA = "case.schema.json";
export const PLAN_SCHEMA = "plan.schema.json";
export const PLAN_EXT = ".plan.json";
export const MD_EXT = ".md";
export const NO_SCREEN = "_no-screen";

export const screensDir = (paths) => join(paths.uiTests, SCREENS_DIR);
export const schemaDir = (paths) => join(paths.uiTests, SCHEMA_DIR);

// What a screen id must look like to BE a folder: one path segment on every
// platform, no leading dot (so never `..`), no separator. The map itself does
// not constrain screen ids, so this is asked here, where one becomes a path.
export const FOLDER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// The folder a case belongs in. A case with no `start` still has to live
// somewhere a person will look, and `_` sorts it away from every screen id. A
// start that cannot be a folder is null, never a guessed spelling of it: the
// placement rule says so, and nothing writes a file there.
export function folderOf(c) {
  if (typeof c?.start !== "string" || !c.start) return NO_SCREEN;
  return FOLDER.test(c.start) ? c.start : null;
}

// The folder a plan belongs in: the screen it names or, for a plan about NO
// screen (a requirement behind an API, a PBI with no UI yet), the same reserved
// folder a case with no start lives in. That is not a fake screen: the map is
// untouched, and the plan says what it IS about with its `feature`.
export function planFolderOf(p) {
  if (typeof p?.screen !== "string" || !p.screen) return NO_SCREEN;
  return FOLDER.test(p.screen) ? p.screen : null;
}

export const caseFile = (dir, c) => join(dir, segment(folderOf(c), c.start), CASES_DIR, `${c.id}.json`);
export const planFile = (dir, p) => join(dir, segment(planFolderOf(p), p.screen), `${p.id}${PLAN_EXT}`);

function segment(folder, screen) {
  if (folder === null) throw new Refused(`screen id ${JSON.stringify(screen)} cannot be a folder name — a screen id used for placement matches ${FOLDER.source}`);
  return folder;
}

export const caseFiles = (dir) => [...flat(dir, isCase), ...perScreen(dir, (s) => flat(join(dir, s, CASES_DIR), isCase))].sort(byName);
export const planFiles = (dir) => [...flat(dir, isPlan), ...perScreen(dir, (s) => flat(join(dir, s), isPlan))].sort(byName);
export const markdownFiles = (dir) => [...flat(dir, isMd), ...perScreen(dir, (s) => flat(join(dir, s), isMd))].sort(byName);

// The screen folder a file was FOUND in, or null for a flat file. What the
// placement rules compare against `start` and `screen`.
export function placedIn(dir, file) {
  const up = basename(dirname(file)) === CASES_DIR ? dirname(dirname(file)) : dirname(file);
  return resolve(dirname(up)) === resolve(dir) ? basename(up) : null;
}

const isCase = (f) => f.endsWith(".json") && !f.endsWith(PLAN_EXT) && f !== "schema.json";
const isPlan = (f) => f.endsWith(PLAN_EXT);
const isMd = (f) => f.endsWith(MD_EXT);
const byName = (a, b) => basename(a).localeCompare(basename(b)) || a.localeCompare(b);

function flat(dir, keep) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && keep(e.name)).map((e) => join(dir, e.name));
}

function perScreen(dir, fn) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => fn(e.name));
}

// The reports directory (in the store) follows the same idea: a run's report goes under its
// screen and case (src/report/index.mjs reportFile), and a page that is about
// more than one run goes into a room of its own, `_`-prefixed so it sorts away
// from every screen id.
export const REPORT_ROOMS = { screens: "_screens", plans: "_plans", sessions: "_sessions", investigations: "_investigations" };
