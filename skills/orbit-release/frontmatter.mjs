// The FRONTMATTER a host must parse (1.8.9). Every shipped SKILL.md and agents/*.md opens with a YAML block, and a host
// that cannot parse one strips the whole block -- the skill ships with no name, no description and no allowed tools,
// and a host says "SKILL.md must start with YAML frontmatter". That is what 1.8.8's orbit-engineering-agent did, over
// ONE list item that lost its indent.
//
// Zero dependencies, so this is not a YAML parser: it holds each block to the shape every shipped one uses, which is
// enough to refuse every mistake that has broken one -- a line at the margin that is not a key, a tab in an indent, an
// indented line under no key, a plain value that itself reads as a key -- and it names the file and the line.
//
//   node skills/orbit-release/frontmatter.mjs     "ok", or each broken file's first problem, "; "-joined
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const KEY = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t](.*))?$/;

const indentOf = (l) => l.match(/^\s*/)[0];

// A plain (unquoted, not a block) value holding ": " is read by YAML as a second mapping, and refused there.
const colonInPlain = (l) => ((m) => Boolean(m?.[2]) && !/^["'>|]/.test(m[2].trim()) && /:\s/.test(m[2]))(KEY.exec(l));

// Ordered; the first rule a line breaks is its problem. `keyed`: a key came before this line.
export const LINE_RULES = [
  { breaks: (l) => indentOf(l).includes("\t"), say: "a tab indents it — YAML indents with spaces" },
  { breaks: (l, keyed) => /^\s/.test(l) && l.trim() !== "" && !keyed, say: "it is indented under no key" },
  { breaks: (l) => !/^\s/.test(l) && l.trim() !== "" && !KEY.test(l), say: "it is at the margin and is not a key — an item of the list above it lost its indent" },
  { breaks: (l) => colonInPlain(l), say: "its plain value holds ': ', which YAML reads as a second key — quote the value" },
];

const brokenRule = (lines, i) => LINE_RULES.find((r) => r.breaks(lines[i], lines.slice(0, i).some((x) => KEY.test(x)))) ?? null;

// -> null, or the first problem, with the line number as an editor counts it.
export function frontmatterProblem(text) {
  if (!String(text).startsWith("---\n")) return "it does not open with a --- line, so a host finds no frontmatter at all";
  const end = text.indexOf("\n---", 3);
  if (end < 0) return "its frontmatter is never closed by a --- line";
  const lines = text.slice(4, end).split("\n");
  return ((at) => (at < 0 ? null : `line ${at + 2}: ${brokenRule(lines, at).say}`))(lines.findIndex((l, i) => brokenRule(lines, i)));
}

// Every file a host reads frontmatter from: each skill's SKILL.md, and each agent.
export const declaredFiles = (root) => [...readdirSync(join(root, "skills")).map((d) => join("skills", d, "SKILL.md")), ...(existsSync(join(root, "agents")) ? readdirSync(join(root, "agents")).filter((f) => f.endsWith(".md")).map((f) => join("agents", f)) : [])].filter((f) => existsSync(join(root, f)));

export const problems = (root) => declaredFiles(root).map((f) => [f, frontmatterProblem(readFileSync(join(root, f), "utf8"))]).filter(([, p]) => p).map(([f, p]) => `${f}: ${p}`);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(problems(process.cwd()).join("; ") || "ok");
