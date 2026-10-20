// Cases on disk: one pretty-printed JSON file each, under the folder of the
// screen it starts on (src/tests-tree.mjs) -- or the copy a report carries,
// which is the last one left when the file is gone.
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { caseInPage } from "../case-block.mjs";
import { CASE_SCHEMA, caseFiles } from "../tests-tree.mjs";

export const SCHEMA_FILE = CASE_SCHEMA;

// A case that is not valid JSON, or is not an object, used to throw a SyntaxError
// that named no file -- and `loadCases` maps over every case, so ONE bad file
// took `query check` down for the whole directory. It becomes a case the
// validator can report on instead.
export function loadCase(file) {
  const c = parsed(file);
  if (!isObject(c)) return { _file: file, _broken: `is not a JSON object` };
  c._file = file;
  return c;
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function parsed(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { return { _broken: `is not valid JSON: ${e.message}` }; }
}

export const loadCases = (dir) => caseFiles(dir).map(loadCase);

// By id -- found in whichever screen folder holds it, so a case that moved to
// another screen is still `run-case <id>` -- or by a path to any .json or
// report, so a fixture outside the tree can be validated too.
export function findCase(dir, ref) {
  const file = named(ref) ? resolve(ref) : caseFiles(dir).find((f) => basename(f, ".json") === ref);
  if (!file || !existsSync(file)) return null;
  return file.endsWith(".html") ? caseInPage(readFileSync(file, "utf8"), file) : loadCase(file);
}

const named = (ref) => ref.endsWith(".json") || ref.endsWith(".html");
