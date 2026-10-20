// Whether a SKILL.md holds to the contract the shipped skills already hold to.
//
// The rules are a TABLE, first to last, and every one of them is a rule that is
// already in force somewhere -- none is new:
//
//   frontmatter, name, description   what a host needs to load a skill at all
//   name === directory               how a host names it; this server cannot
//                                    rename one, so a different name is a rename
//   no <tag> in the description      skills/orbit-release/gates.mjs refuses the
//                                    archive for it; saving one here would pass
//                                    today and fail the next release
//   user-invocable is true or false  the host reads anything else as a typo
//
// control-server/test/skills.test.mjs holds the table against every skill this repository ships, so a
// rule that would call one of them invalid fails there first. It is Orbit Control's editor's table AND the
// first rows the skill factory holds a generated playbook to (src/skill-factory/validate.mjs): one table.
import { frontmatter } from "./frontmatter.mjs";

const XML = /<[a-zA-Z/][^>]*>/;
const BOOLEAN = new Set(["true", "false"]);

const RULES = [
  { says: () => "SKILL.md must begin with a frontmatter block: a line ---, the keys, and a closing ---", fails: (f) => f === null, stops: true },
  { says: () => "the frontmatter has no name", fails: (f) => !text(f.name) },
  { says: (f, id) => `name is "${f.name}" but the skill directory is "${id}" — a skill cannot be renamed here`, fails: (f, id) => text(f.name) && text(f.name) !== id },
  { says: () => "the frontmatter has no description", fails: (f) => !text(f.description) },
  { says: () => "the description contains <angle brackets>, which a host reads as XML and refuses; a placeholder belongs in argument-hint", fails: (f) => XML.test(text(f.description)) },
  { says: (f) => `user-invocable is "${f["user-invocable"]}", but it can only be true or false`, fails: (f) => f["user-invocable"] !== undefined && !BOOLEAN.has(String(f["user-invocable"])) },
];

const text = (v) => (typeof v === "string" ? v.trim() : "");

// Every problem at once, so a person fixes the file in one pass rather than
// one save per rule. A missing frontmatter stops the table: every later rule
// would only restate it.
export const INSTRUCTION_RULES = RULES;

export function problemsOf(id, content) {
  const front = frontmatter(content);
  const stop = RULES.findIndex((r) => r.stops && r.fails(front, id));
  return stop >= 0 ? [RULES[stop].says(front, id)] : RULES.filter((r) => !r.stops && r.fails(front, id)).map((r) => r.says(front, id));
}

// What a list shows of a skill, from the same parse the rules read.
export function metadataOf(id, content) {
  const front = frontmatter(content) ?? {};
  return { id, name: text(front.name) || id, description: text(front.description), userInvocable: String(front["user-invocable"] ?? "true") !== "false", allowedTools: toolsOf(front["allowed-tools"]) };
}

// A host takes `allowed-tools` as a list or as one comma-separated line.
const toolsOf = (value) => (Array.isArray(value) ? value : text(value).split(/,\s*/).filter(Boolean));
