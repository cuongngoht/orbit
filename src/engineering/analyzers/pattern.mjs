// Design-pattern ROLE families, read off tracked file NAMES -- and nothing else.
//
// `OrderRepository`, `CustomerRepository` and `InvoiceRepository` are three
// files whose names say the same thing: this project builds persistence access
// as repositories. That is a signal with very little room to hallucinate in --
// a name is written on purpose -- and it is still only a NAME, so the fact is
// `observed`, and its unknowns say that nobody read the code.
//
// ROLES is a list of design-pattern vocabulary, the words a pattern catalogue
// uses. It is engineering vocabulary, not product vocabulary: no stack, vendor
// or product is named, and none may be -- a row naming a framework's own
// convention would be this engine learning a stack.
//
// Tests of a role are not members of it: a `RepositoryTests` file is evidence
// the repository is tested, which is a different fact.
import { basename, dirname } from "node:path/posix";

export const ROLES = ["repository", "factory", "strategy", "adapter", "builder", "decorator", "visitor", "specification"];

export const MIN_MEMBERS = 2;
export const MAX_EVIDENCE = 6;

const TEST_PATH = /(^|\/)(tests?|specs?|__tests__)\//i;
const TEST_NAME = /[._-](test|spec)s?$|tests?$|specs?$/i;

// The role a file's name declares, or null. The name must carry something
// BEFORE the role word: a bare `repository.ts` is the abstraction's home, not
// a member of the family.
export function roleOf(path) {
  const stem = basename(path).replace(/\.[^.]*$/, "");
  if (TEST_PATH.test(path) || TEST_NAME.test(stem)) return null;
  const flat = stem.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ROLES.find((r) => flat.endsWith(r) && flat.length > r.length) ?? null;
}

export function families(files) {
  const byRole = new Map();
  for (const f of [...files].sort()) byRole.set(roleOf(f), [...(byRole.get(roleOf(f)) ?? []), f]);
  byRole.delete(null);
  return byRole;
}

export function pattern(input) {
  const found = [...families(input.files)].filter(([, members]) => members.length >= MIN_MEMBERS && touches(members, input.scopes));
  return { candidates: found.map(([role, members]) => candidate(role, members)), unknowns: found.length ? [] : ["no design-pattern role is repeated in the scopes this session touched"] };
}

// Relevant to THIS session: at least one member sits in a scope it touched. An
// empty scope list means the caller asked about the whole tree.
export const touches = (members, scopes) => !scopes?.length || members.some((m) => scopes.some((s) => m === s || m.startsWith(`${s}/`)));

const candidate = (role, members) => ({
  kind: "pattern",
  key: role,
  statement: `${role} is a pattern this project uses — ${members.length} tracked file(s) are named as one`,
  scope: [...new Set(members.map((m) => dirname(m)))].slice(0, MAX_EVIDENCE),
  evidence: members.slice(0, MAX_EVIDENCE),
  source: "repository",
  strength: "observed",
  because: `${members.length} file name(s) end in "${role}" — a name is written on purpose, which makes it evidence of intent, not proof of shape`,
  unknowns: ["whether each member actually has the pattern's shape — this read names, never code", "whether a new one MUST follow it — repeated is not adopted"],
});
