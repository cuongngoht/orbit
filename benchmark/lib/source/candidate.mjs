// A CANDIDATE: what a repair round left in the engineering task's workspace, against the subject it started from --
// and the SCOPE it is held to before anything of it runs. The changes are read back by the inspect container (which
// executes nothing of the candidate's); here they are only data: which files were added, modified or deleted, and the
// text of each. A candidate that reaches outside its case's scope, touches the harness or a check, deletes, weakens
// or skips an existing test, smuggles a process or the global object into the source, or brings no regression test
// of its own is refused by name -- every finding at once, and none of them can be argued with by a sentence.
//
//   changesOf(baseline, workspace) -> [{ rel, change, kind, digest, size }]
//   scopeFindings(changes, ctx) -> [{ id, rel, says }]      ctx: { allow, deny, imports, agentTests, textOf }
//   agentTestsOf(changes, pattern) -> [rel]                 overlaid(baseline, changes, filesOf) -> entries
//
// `imports` is a case's own allow-list of module specifiers (globs) a change may newly import -- a feature in a small
// project imports its sibling modules; with none, a source file may import nothing it did not import before.
import { shaBytes } from "../../../src/hash.mjs";
import { HARNESS } from "../core/freeze.mjs";
import { matchesAny, safeRel } from "../core/paths.mjs";

// What a check is: never a candidate's to change. What the harness holds as its own is the core's (HARNESS).
export { HARNESS };
export const TAMPER = ["package.json", "package-lock.json", "cli/check-five-lines.mjs", "src/lint/**", "test/lint.test.mjs", "test/home.mjs", "test/fakes/**", "satellite/test/lint.test.mjs", "satellite/test/fakes/**", ".github/**", "skills/orbit-release/**", ".gitattributes", ".gitignore", "**/.npmrc", "**/node.config.json", "**/.node-version", "**/.nvmrc"];

// What a TEST is, wherever the repository keeps one: the root's test/, or a package's own (Satellite keeps its tests in
// satellite/test/). One rule for SCOPE and for the gates, so a test is never a test to one and source to the other.
export const TEST_PATH = /^((satellite|control-server)\/)?test\//;

export const MAX_FILE = 2 * 1024 * 1024;

// ---- the changes, as data --------------------------------------------------------------------------------------------

const byRel = (entries) => new Map(entries.map((e) => [e.rel, e]));

// A listing says `kind` where a frozen entry says `mode`; both name the same thing (file, exec, link).
const changeOf = (before, after) => (!before ? "added" : !after ? "deleted" : before.digest !== after.digest || before.mode !== (after.mode ?? after.kind) ? "modified" : null);

// `workspace` is what the inspect container listed: [{ rel, kind, digest, size }] for every file of the tree.
export function changesOf(baseline, workspace) {
  const b = byRel(baseline);
  const w = byRel(workspace);
  const rels = [...new Set([...b.keys(), ...w.keys()])].sort();
  return rels.map((rel) => ({ rel, change: changeOf(b.get(rel), w.get(rel)), kind: w.get(rel)?.kind ?? b.get(rel)?.mode ?? null, digest: w.get(rel)?.digest ?? null, size: w.get(rel)?.size ?? 0 })).filter((c) => c.change);
}

// The tree a candidate is: the subject with the changes laid over it. `filesOf(rel)` hands the bytes a change brought.
export function overlaid(baseline, changes, filesOf) {
  const gone = new Set(changes.filter((c) => c.change === "deleted").map((c) => c.rel));
  const brought = changes.filter((c) => c.change !== "deleted").map((c) => ((bytes) => ({ rel: c.rel, mode: c.kind === "exec" ? "exec" : "file", bytes, digest: shaBytes(bytes) }))(filesOf(c.rel)));
  const replaced = new Set(brought.map((e) => e.rel));
  return [...baseline.filter((e) => !gone.has(e.rel) && !replaced.has(e.rel)), ...brought];
}

// ---- reading the text of a change ------------------------------------------------------------------------------------

const linesOf = (text) => String(text ?? "").replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd());

// Every line of the old text, in order, somewhere in the new one: nothing was taken out or changed, only added.
export function onlyAdded(oldText, newText) {
  const old = linesOf(oldText);
  let i = 0;
  for (const line of linesOf(newText)) i += i < old.length && old[i] === line ? 1 : 0;
  return i === old.length;
}

// The lines a change brought: the new text's lines less the old text's, counted.
export function addedLines(oldText, newText) {
  const left = linesOf(oldText).reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map());
  return linesOf(newText).filter((l) => ((n) => (n > 0 ? (left.set(l, n - 1), false) : true))(left.get(l) ?? 0));
}

const SKIP = /\.(skip|todo|only)\s*\(|\b(skip|todo|only)\s*:\s*(true|["'`])|\b(test|it|describe)\s*\.\s*(skip|todo|only)\b/;

const UNSAFE = /\bprocess\s*(\.|\[)|child_process|worker_threads|\bglobalThis\b|Object\s*\.\s*prototype|__proto__|\beval\s*\(|\bnew\s+Function\b|\bimport\s*\(|\bFunction\s*\(|\brequire\s*\(|createRequire|\bReflect\s*\./;

// The modules a source file imports, by specifier: a repair of an oracle needs no module the file did not already
// import, and a new one is how a source file would reach something the checks run beside (an assert, a process).
const IMPORT = /\b(?:import|export)\b[^"'`]*?\bfrom\s*["'`]([^"'`]+)["'`]|\bimport\s*["'`]([^"'`]+)["'`]/g;

export const importsOf = (text) => new Set([...String(text ?? "").matchAll(IMPORT)].map((m) => m[1] ?? m[2]));

const newImports = (c, ctx) => ((before) => [...importsOf(ctx.textOf(c.rel, "after"))].filter((spec) => !before.has(spec) && !matchesAny(ctx.imports, spec)))(importsOf(c.change === "modified" ? ctx.textOf(c.rel, "before") : ""));

const TEXT_FILE = /\.(mjs|cjs|js|json|md|ts)$/;

export const isTest = (rel) => TEST_PATH.test(rel);

const isSource = (rel) => !isTest(rel) && /\.(mjs|cjs|js)$/.test(rel);

const binary = (text) => text === null || text.includes("\u0000");

const brought = (c, ctx) => addedLines(c.change === "modified" ? ctx.textOf(c.rel, "before") : "", ctx.textOf(c.rel, "after"));

// ---- the rules, each by name -------------------------------------------------------------------------------------------

export const SCOPE = [
  { id: "NOT_REGULAR", fails: (c, ctx) => c.change !== "deleted" && (!["file", "exec"].includes(c.kind) || c.size > MAX_FILE || !TEXT_FILE.test(c.rel) || binary(ctx.textOf(c.rel, "after"))), says: () => "is not a regular text file of a kind a source change is made of (a link, a binary, a file too large)" },
  { id: "UNSAFE_PATH", fails: (c) => !safeRel(c.rel), says: () => "is not a path inside the repository" },
  { id: "BENCHMARK_TOUCHED", fails: (c) => matchesAny(HARNESS, c.rel), says: () => "belongs to the benchmark harness, which a repair never touches" },
  { id: "CHECK_TAMPERED", fails: (c) => matchesAny(TAMPER, c.rel), says: () => "is how a check runs or what it is held to, which a repair never changes" },
  { id: "OUT_OF_SCOPE", fails: (c, ctx) => !matchesAny(ctx.allow, c.rel) || matchesAny(ctx.deny, c.rel), says: () => "is outside the paths the case allows a repair to change" },
  { id: "TEST_DELETED", fails: (c) => c.change === "deleted" && isTest(c.rel), says: () => "is an existing test file, deleted" },
  { id: "TEST_WEAKENED", fails: (c, ctx) => c.change === "modified" && isTest(c.rel) && !onlyAdded(ctx.textOf(c.rel, "before"), ctx.textOf(c.rel, "after")), says: () => "is an existing test file with lines taken out or changed — an existing test may only gain lines" },
  { id: "TEST_SKIPPED", fails: (c, ctx) => c.change !== "deleted" && isTest(c.rel) && brought(c, ctx).some((l) => SKIP.test(l)), says: () => "skips, marks to do or narrows to one test" },
  { id: "UNSAFE_CODE", fails: (c, ctx) => c.change !== "deleted" && isSource(c.rel) && brought(c, ctx).some((l) => UNSAFE.test(l)), says: () => "brings a process, the global object, a prototype or code built from text into the source" },
  { id: "NEW_IMPORT", fails: (c, ctx) => c.change !== "deleted" && isSource(c.rel) && newImports(c, ctx).length > 0, says: (c, ctx) => `imports what it did not import before (${newImports(c, ctx).join(", ")})` },
];

export const agentTestsOf = (changes, pattern) => changes.filter((c) => c.change !== "deleted" && new RegExp(pattern).test(c.rel)).map((c) => c.rel);

const NONE = { id: "NO_REGRESSION_TEST", says: "brings no test of its own: a repair adds a regression test that fails before it and passes after" };

const findingsFor = (c, ctx) => SCOPE.filter((r) => r.fails(c, ctx)).map((r) => ({ id: r.id, rel: c.rel, says: `${c.rel} ${r.says(c, ctx)}` }));

export const scopeFindings = (changes, ctx) => [...changes.flatMap((c) => findingsFor(c, ctx)), ...(ctx.agentTests?.required && changes.length && !agentTestsOf(changes, ctx.agentTests.pattern).length ? [{ id: NONE.id, rel: null, says: NONE.says }] : [])];
