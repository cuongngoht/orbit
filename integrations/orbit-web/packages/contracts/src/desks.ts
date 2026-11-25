// AN EMPLOYEE'S DESK, AS A PERSON LOOKS INTO IT AND CLEANS IT UP (Governance → Employee desks, ADR 0061). The desk is the
// directory the account owns for an employee's work: what its accepted work left there, and the toolbox it wrote for
// itself. The account's owner may look into it -- one folder at a time, or one file's text, read only, each look decided
// by the account's policy (`employee.desk.read`) and recorded with what was looked at, never what it holds -- and clean
// it up when it fills (`employee.desk.clean`): named paths, everything but the toolbox, and the dependency cache. A
// clean happens only while the employee holds no work, so nothing it is doing is disturbed and no later publish of an
// older work tree puts back what was removed; an employee that left keeps its desk read only.
//
// Orbit Web's own names at the top of a desk -- its publishing's stage, the file system's lost+found, the marker an
// isolation check plants for a moment -- are never shown, read or removed. Only those: Orbit Web never seeds or
// publishes such a name, so nothing an employee wrote is ever hidden from the person reviewing its desk.
import type { Checked } from "./validate.js";

export const DESK_LIMITS = {
  // A path's length, and how many paths one clean may name.
  pathLength: 1024,
  removePaths: 500,
  // The entries one folder's listing shows (the biggest first), and how much of a file's text is shown.
  entries: 2000,
  readBytes: 512 * 1024,
} as const;

// The toolbox's folders stay: what is in them may be removed, one by one.
export const DESK_TOOLBOX_DIRS = ["toolbox", "toolbox/skills", "toolbox/scripts"] as const;

const CANARY = /^\.orbit-canary-[0-9a-f]+$/;
const RESERVED = new Set([".orbit", ".orbit-publish", "lost+found"]);

// A name at the top of a desk that is Orbit Web's own, never the employee's.
export const isDeskReserved = (name: string): boolean => RESERVED.has(name) || CANARY.test(name);

// eslint-disable-next-line no-control-regex -- control characters are what is refused
const CONTROL = /[\u0000-\u001f\u007f]/;

// A path inside the desk, from its root, "/"-separated: relative, no "." or ".." segment, no empty segment, no control
// character, never one of Orbit Web's own names at the top. Null when it is not one.
function deskPath(v: unknown, root: boolean): string | null {
  if (typeof v !== "string" || v.length > DESK_LIMITS.pathLength || CONTROL.test(v)) return null;
  if (v === "") return root ? "" : null;
  const segments = v.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return isDeskReserved(segments[0] as string) ? null : v;
}

// A file, or a folder to remove.
export const checkDeskPath = (v: unknown): string | null => deskPath(v, false);
// A folder to list: "" is the desk's root.
export const checkDeskDir = (v: unknown): string | null => deskPath(v, true);

// What is in one folder of the desk: its files, folders and links, never followed.
export interface DeskEntry {
  name: string;
  // From the desk's root. Null when the name cannot be addressed (not valid UTF-8): it is shown, and only "empty"
  // removes it.
  path: string | null;
  type: "file" | "dir" | "link" | "other";
  // A file's size; a folder's: what everything under it holds.
  bytes: number;
  // A folder's: how many files are under it.
  files: number;
  modifiedAt: string;
  // A link's target as written (never followed).
  target: string | null;
}

// GET /api/employees/:id/desk?dir= -- one folder of the desk, read now.
export interface DeskTree {
  employee: { id: string; name: string; employment: string };
  dir: string;
  // The desk's version: how many accepted results changed it. A clean names the version it was chosen at (If-Match).
  deskVersion: number;
  // The folder's entries, the biggest first; more than DESK_LIMITS.entries is `truncated`.
  entries: DeskEntry[];
  truncated: boolean;
  // What everything under the folder holds.
  bytes: number;
  files: number;
  // The desk's and the cache's quota and what was measured in them (null: not measured).
  storage: { deskQuotaMiB: number; cacheQuotaMiB: number; deskUsedMiB: number | null; cacheUsedMiB: number | null; measuredAt: string | null };
  // Whether the desk may be cleaned now, and why not.
  clean: { allowed: boolean; why: string | null };
  asOf: string;
}

// GET /api/employees/:id/desk/file?path= -- one file's text, read now: the first DESK_LIMITS.readBytes of it. A file
// that is not text (a NUL byte, or not UTF-8) is named and sized; its bytes are not sent.
export interface DeskFile {
  path: string;
  bytes: number;
  text: string | null;
  truncated: boolean;
  deskVersion: number;
  modifiedAt: string;
}

// POST /api/employees/:id/desk/clean (If-Match: the desk's version): named paths, or everything but the toolbox
// ("empty"), and/or the dependency cache.
export interface DeskCleanRequest {
  remove?: string[];
  empty?: boolean;
  cache?: boolean;
}

export interface DeskCleanResult {
  // How many entries went, and the first of them by path.
  removed: number;
  paths: string[];
  // A named path that was not there (already gone).
  missing: string[];
  cacheEmptied: boolean;
  deskVersion: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const CLEAN_FIELDS = ["remove", "empty", "cache"];
const flag = (v: unknown, name: string, errors: string[]): boolean => {
  if (v === undefined) return false;
  if (typeof v !== "boolean") errors.push(`${name} must be true or false`);
  return v === true;
};

// The paths to remove, each once, and none inside another one named.
function removals(v: unknown, errors: string[]): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return (errors.push("remove must be a list of paths in the desk"), []);
  if (v.length > DESK_LIMITS.removePaths) return (errors.push(`remove names at most ${DESK_LIMITS.removePaths} paths`), []);
  const paths: string[] = [];
  for (const p of v) {
    const path = checkDeskPath(p);
    if (path === null) errors.push(`${JSON.stringify(p)} is not a path in the desk`);
    else if ((DESK_TOOLBOX_DIRS as readonly string[]).includes(path)) errors.push(`${path} is kept: remove what is in it instead`);
    else if (!paths.includes(path)) paths.push(path);
  }
  return paths.filter((p) => !paths.some((q) => q !== p && p.startsWith(`${q}/`)));
}

export function checkDeskClean(body: unknown): Checked<Required<DeskCleanRequest>> {
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = Object.keys(body)
    .filter((k) => !CLEAN_FIELDS.includes(k))
    .map((k) => `${k} is not a field of this request`);
  const remove = removals(body.remove, errors);
  const empty = flag(body.empty, "empty", errors);
  const cache = flag(body.cache, "cache", errors);
  if (empty && remove.length > 0) errors.push("empty removes everything but the toolbox: name no paths with it");
  if (errors.length === 0 && remove.length === 0 && !empty && !cache) errors.push("name what to remove: paths (remove), everything but the toolbox (empty), or the cache (cache)");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { remove, empty, cache } };
}
