// Task and build SCRIPT files -- a Makefile, a task runner's file -- read for the
// commands they say they have, by NAME: the generic fallback for a project whose
// stack no ecosystem adapter reads, and the only evidence there is of how such a
// project is built, started and tested.
//
// Only a target whose name says it builds, starts or tests becomes a command
// (src/runtime/vocab.mjs `PURPOSES`), and only a name that is a plain word is put
// in front of the runner. What a target DOES is never read: a Makefile's recipe
// is a shell script, and Orbit does not interpret one. The command is `make
// <name>` -- the runner, with the name -- which is exactly what a person would
// type, and nothing else.
//
// A directory that has such a file and no manifest above it is a component of its
// own, so a project that is only a Makefile and a Dockerfile still has a build
// and a start to offer (the assembler adds it when no unit encloses it).
import { posix } from "node:path";
import { scriptFile } from "../../catalog.mjs";
import { purposeOf } from "../../vocab.mjs";
import { filled, safeName } from "../commands.mjs";
import { parseYaml } from "../yaml-lite.mjs";
import { merged } from "./merge.mjs";

export const scriptsReader = {
  name: "script-files",
  claims: (path, input) => scriptFile(input.catalog, path) !== null,
  read: (input) => merged(input.paths.map((path) => oneFile(input, path))),
};

// A recipe line starts with a tab or sits under another line; a target starts at
// the margin, may name several, and is followed by a colon that is not `:=`.
const MAKE_TARGET = /^([A-Za-z0-9][A-Za-z0-9_.\/-]*(?:[ \t]+[A-Za-z0-9][A-Za-z0-9_.\/-]*)*)[ \t]*:(?![=:])/;
const JUST_NAME = /^[A-Za-z_][A-Za-z0-9_-]*/;
const JUST_KEYWORD = /^(set|alias|export|import|mod)\b/;

// A recipe: a name, then optional parameters (anything but `:` or `=`), then the first colon, which
// is not `:=`. Found by looking for that colon, not by a pattern with three quantifiers over the same
// characters: that one backtracks cubically on a name followed by a long run of spaces and no colon,
// and a line is the checkout's to write.
function justRecipe(line) {
  const name = JUST_NAME.exec(line)?.[0];
  const colon = name ? line.indexOf(":", name.length) : -1;
  if (colon < 0 || line[colon + 1] === "=") return null;
  const between = line.slice(name.length, colon);
  return between === "" || (/^[ \t]/.test(between) && !between.includes("=")) ? name : null;
}

const FORMATS = {
  makefile: (text) => String(text).split(/\r?\n/).flatMap((l) => MAKE_TARGET.exec(l)?.[1].split(/\s+/) ?? []),
  justfile: (text) => String(text).split(/\r?\n/).filter((l) => !JUST_KEYWORD.test(l)).flatMap((l) => justRecipe(l) ?? []),
  taskfile: (text) => Object.keys(taskTable(text)),
};

function taskTable(text) {
  const tasks = parseYaml(text).value?.tasks;
  return tasks && typeof tasks === "object" && !Array.isArray(tasks) ? tasks : {};
}

function oneFile(input, path) {
  const text = input.read(path);
  if (text === null) return { observations: [], unknowns: [] };
  const row = scriptFile(input.catalog, path);
  const names = [...new Set(FORMATS[row.format](text))].filter((n) => safeName(n) && purposeOf(n) !== "other");
  return { observations: names.length ? observationsOf(path, row, names) : [], unknowns: [] };
}

function observationsOf(path, row, names) {
  const dir = posix.dirname(path);
  const stamp = { dir, path, source: "script", confidence: "certain" };
  const commands = names.map((name) => ({ type: "command", ...stamp, declaredAs: name, text: filled(row.argv, name).join(" "), argv: filled(row.argv, name), safe: true, runner: row.runner, why: null }));
  return [{ type: "unit", ...stamp, ecosystem: row.runner, kinds: [], weak: true }, { type: "requirement", ...stamp, requirement: row.runner, range: null, why: `its targets are run with ${row.runner}` }, ...commands];
}
