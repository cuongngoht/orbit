// The relation adapter for Python sources (0.6.0, U3; the contract is src/context/relations.mjs).
//
// `import a.b` and `from a.b import c` name a module -- over the whole text, so a parenthesised name list spread over
// lines (`from a import (\n  x,\n  y)`) and a backslash continuation are read as one statement, and a line holding
// only `from a import (` still names `a`; `from .a import b` and `from . import b` name one relative to the
// importing file's own package (a dot per level). A relative name resolves inside that package; an absolute one
// resolves only when EXACTLY ONE tracked file ends in its path (`a/b.py`, or `a/b/__init__.py`) -- two candidates are
// two guesses, and none is taken. A name imported FROM a module may itself be a module (`from app import routes`), so
// each is offered both ways and only what the tree holds resolves.
//
// WHICH TESTS GO WITH `name.py` is what the checkout DECLARES for its test runner, and the runner's own default only when
// it declares nothing (0.6.0, P3b): pytest's `python_files` (and `testpaths`, where it narrows where tests live), from
// the first of pytest.ini [pytest] (which wins even without the section, as pytest reads it), pyproject.toml
// [tool.pytest.ini_options], tox.ini [pytest] and setup.cfg [tool:pytest] the tracked tree holds at the checkout's root
// -- read through the walk's own `read` port, line by line and bounded, never parsed by a dependency. A test goes with
// `name.py` when its file name matches a declared pattern with ONE of its `*` standing for `name`: with the default
// `test_*.py` and `*_test.py` that is `test_name.py` or `name_test.py`; with `*test_*.py`, `unittest_name.py` too. A
// pattern with no `*` names no file for a source, and nothing is guessed.
const FROM = /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(?:\(([^)]*)\)?|([\w \t,]+))/gm;
const IMPORT = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm;

const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

const baseOf = (p) => p.slice(p.lastIndexOf("/") + 1);

const stemOf = (p) => baseOf(p).replace(/\.py$/, "");

const names = (list) => list.split(",").map((n) => n.trim().split(/\s+/)[0]).filter(Boolean);

const joinedName = (mod, name) => (/^\.+$/.test(mod) ? `${mod}${name}` : `${mod}.${name}`);

const fromSpecs = (m) => [m[1], ...names(m[2] ?? m[3]).map((n) => joinedName(m[1], n))].filter(Boolean);

// A backslash at a line's end continues the statement on the next: joined first, so a name after it is still read.
const joinedLines = (text) => String(text ?? "").replace(/\\\r?\n/g, " ");

export const specifiersOf = (text) => ((code) => [...[...code.matchAll(FROM)].flatMap(fromSpecs), ...[...code.matchAll(IMPORT)].flatMap((m) => names(m[1]))])(joinedLines(text));

const moduleFiles = (base) => [`${base}.py`, `${base}/__init__.py`];

// `from ..a import b` in pkg/sub/x.py: one dot is pkg/sub, each more dot a level up.
const packageOf = (from, dots) => dirOf(from).split("/").slice(0, Math.max(0, dirOf(from).split("/").length - (dots - 1))).join("/");

const relativeBase = (spec, from) => ((dots) => [packageOf(from, dots), ...spec.slice(dots).split(".").filter(Boolean)].filter(Boolean).join("/"))(/^\.+/.exec(spec)[0].length);

const relative = (spec, from, tree) => moduleFiles(relativeBase(spec, from)).find((p) => tree.files.has(p)) ?? null;

const endsIn = (p, tail) => p === tail || p.endsWith(`/${tail}`);

const absolute = (spec, tree) => ((tails) => ((hits) => (hits.length === 1 ? hits[0] : null))([...tree.files].filter((p) => tails.some((t) => endsIn(p, t)))))(moduleFiles(spec.split(".").join("/")));

export const resolve = (spec, from, tree) => (String(spec).startsWith(".") ? relative(String(spec), from, tree) : absolute(String(spec), tree));

// ---- what the checkout declares for its test runner --------------------------------------------------------------

export const DEFAULT_FILES = Object.freeze(["test_*.py", "*_test.py"]);

// pytest's own order: the first file the tree holds whose section is there decides.
export const RUNNER_CONFIGS = Object.freeze([
  { file: "pytest.ini", section: "pytest", always: true },
  { file: "pyproject.toml", section: "tool.pytest.ini_options" },
  { file: "tox.ini", section: "pytest" },
  { file: "setup.cfg", section: "tool:pytest" },
]);

export const MAX_CONFIG_BYTES = 65536;
export const MAX_PATTERNS = 16;

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A header opens a line with `[`, never with a quoted string (an open TOML array's next item may too).
const isHeader = (line) => /^\s*\[/.test(line) && !/^\s*\[\s*["']/.test(line);

const untilHeader = (rest) => rest.slice(0, ((end) => (end < 0 ? rest.length : end))(rest.findIndex(isHeader)));

const isComment = (line) => /^\s*[#;]/.test(line);

const headerOf = (section) => new RegExp(`^\\s*\\[\\s*${escaped(section)}\\s*\\]\\s*$`);

// The section's own lines: after its header, up to the next header.
function sectionLines(text, section) {
  const lines = String(text).slice(0, MAX_CONFIG_BYTES).split(/\r?\n/);
  const at = lines.findIndex((l) => headerOf(section).test(l));
  return at < 0 ? null : untilHeader(lines.slice(at + 1)).filter((l) => !isComment(l));
}

const keyLine = (key) => new RegExp(`^\\s*${key}\\s*[=:]\\s*(.*)$`);

// A value goes on while the lines after it are indented (an ini continuation) or its TOML array is still open.
const continues = (value, line) => /^\s+\S/.test(line) || (value.includes("[") && !value.includes("]"));

function valueOf(lines, key) {
  const at = lines.findIndex((l) => keyLine(key).test(l));
  if (at < 0) return null;
  return lines.slice(at + 1).reduce((v, l) => (v.open && continues(v.text, l) ? { text: `${v.text} ${l}`, open: true } : { ...v, open: false }), { text: keyLine(key).exec(lines[at])[1], open: true }).text;
}

// Quoted strings when the value quotes them (TOML), else its words (ini), at most MAX_PATTERNS.
const wordsOf = (value) => (value === null ? [] : (/["']/.test(value) ? [...value.matchAll(/["']([^"']+)["']/g)].flatMap((m) => m[1].split(/\s+/)) : value.replace(/\s[#;].*$/, "").split(/[\s,]+/)).filter(Boolean).slice(0, MAX_PATTERNS));

const declaredIn = (text, config) => ((lines) => (lines ? { files: wordsOf(valueOf(lines, "python_files")), paths: wordsOf(valueOf(lines, "testpaths")) } : config.always ? { files: [], paths: [] } : null))(text === null || text === undefined ? null : sectionLines(text, config.section));

// What the checkout declares, or null: read only through the port the walk hands in, a file the tree holds.
export const declaredTests = (tree, read) => RUNNER_CONFIGS.filter((c) => tree.files.has(c.file)).map((c) => declaredIn(typeof read === "function" ? read(c.file) : null, c)).find(Boolean) ?? null;

// ---- a declared pattern, with one `*` standing for the source's name -----------------------------------------------

const globPart = (part) => escaped(part).replace(/\\\*/g, "[^/]*").replace(/\\\?/g, "[^/]");

const instancesOf = (pattern, stem) => pattern.split("*").slice(1).map((_, i) => new RegExp(`^${pattern.split("*").map(globPart).reduce((re, part, j) => (j === 0 ? part : `${re}${j === i + 1 ? escaped(stem) : "[^/]*"}${part}`), "")}$`));

const prefixOf = (dir) => String(dir).replace(/^\.\//, "").replace(/\/+$/, "");

const underPaths = (p, paths) => !paths.length || paths.map(prefixOf).some((d) => d === "." || d === "" || p.startsWith(`${d}/`));

const matchersOf = (declared, stem) => (declared?.files?.length ? declared.files : DEFAULT_FILES).flatMap((pattern) => instancesOf(pattern, stem));

export const testsOf = (path, tree, read) => ((declared) => ((matchers) => [...tree.files].filter((p) => matchers.some((m) => m.test(baseOf(p))) && underPaths(p, declared?.paths ?? [])))(matchersOf(declared, stemOf(path))))(declaredTests(tree, read));

// Who imports `pkg/name.py` writes `name` on that line; a package's `__init__.py` is imported by its directory's name.
export const importersPattern = (path) => (stemOf(path) === "__init__" ? baseOf(dirOf(path)) || null : stemOf(path));

export const PYTHON = Object.freeze({ id: "python", detects: (path) => /\.py$/.test(String(path)), specifiersOf, resolve, testsOf, importersPattern });
