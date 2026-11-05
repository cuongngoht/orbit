// REFERENCES A HOST PROPOSES for a task, verified against the TRACKED tree before any of them is listed (0.5.0, B21;
// docs/backlog/0.5.0-proactive-orchestration.md §5.4).
//
// `context --with-refs` reads one envelope on stdin:
//
//   { "task": "…", "refs": [{ "kind": "file" | "symbol", "ref": "…", "why": "…" }] }
//
// Pure: what the tree answered is handed in (`treeOf` over the git-only source port's listing, and `symbolHits`: ONE
// identifier search of the index for every proposed symbol, asked through the search the composition root hands in),
// and every reference comes back HELD -- with where the tree holds it -- or REFUSED BY NAME, with the reason:
//
//   file     held when the tracked listing names it exactly. A directory is not a file, and is refused saying so
//   symbol   ONE identifier, held when a line of the tracked index has it as a whole word (`symbolPattern`). Its
//            answer is read for at most `maxFiles` files (MAX_EVIDENCE_FILES, handed in by the composition root),
//            and the first WHERE_LIMIT of them are where it is held
//
// A reference the tree does not hold is never listed: Orbit never invents a file, a symbol or a relationship, and a
// host's word that one exists is not evidence that it does. `why` is the host's one sentence, checked and never kept.
import { scrub } from "../scrub.mjs";

export const MAX_REFS = 40;
export const REF_KINDS = ["file", "symbol"];
export const REF_FIELDS = ["kind", "ref", "why"];
export const ENVELOPE_FIELDS = ["task", "refs"];
export const REF_LIMIT = 512;
export const WHY_LIMIT = 240;
export const WHERE_LIMIT = 3;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function parsed(text) {
  try { return JSON.parse(String(text ?? "")); }
  catch { return undefined; }
}

const SHAPE = '{ "task": "…", "refs": [{ "kind": "file|symbol", "ref": "…", "why": "…" }] }';

const unknownKey = (raw) => Object.keys(raw).find((k) => !ENVELOPE_FIELDS.includes(k));

// What is wrong with the ENVELOPE refuses the whole call; what is wrong with one reference refuses that reference.
const ENVELOPE = [
  { when: (raw) => !isObject(raw), says: () => `--with-refs reads one JSON object on stdin: ${SHAPE}` },
  { when: (raw) => unknownKey(raw) !== undefined, says: (raw) => `--with-refs: unknown field "${unknownKey(raw)}" — the envelope holds task and refs` },
  { when: (raw) => raw.task !== undefined && typeof raw.task !== "string", says: () => "--with-refs: task is the task, in one sentence" },
  { when: (raw) => raw.refs !== undefined && !Array.isArray(raw.refs), says: () => `--with-refs: refs is a list: ${SHAPE}` },
  { when: (raw) => (raw.refs ?? []).length > MAX_REFS, says: () => `--with-refs: at most ${MAX_REFS} references — propose the ones the task touches most` },
];

// -> { task, refs } or { problem }: the envelope `context --with-refs` read on stdin.
export function envelopeOf(text) {
  const raw = parsed(text);
  const wrong = ENVELOPE.find((row) => row.when(raw));
  return wrong ? { problem: wrong.says(raw) } : { task: raw.task ?? null, refs: raw.refs ?? [] };
}

// ---- one reference, as the host wrote it ---------------------------------------------------------------------------

const firstUnknown = (r) => Object.keys(r).find((k) => !REF_FIELDS.includes(k));

const normalized = (ref) => String(ref).trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");

// Repository-relative, as git spells it: never absolute, never above the checkout, never a URL.
const safePath = (ref) => !/^(\/|[A-Za-z]:\/)/.test(normalized(ref)) && !normalized(ref).split("/").includes("..") && !ref.includes("://") && !ref.includes("\0");

const RULES = [
  { when: (r) => !isObject(r), why: () => "a reference is an object: { kind, ref, why }" },
  { when: (r) => firstUnknown(r) !== undefined, why: (r) => `unknown field "${firstUnknown(r)}" — a reference holds kind, ref and why` },
  { when: (r) => !REF_KINDS.includes(r.kind), why: () => `kind is one of ${REF_KINDS.join(", ")}` },
  { when: (r) => typeof r.ref !== "string" || !r.ref.trim() || r.ref.length > REF_LIMIT, why: () => `ref is a name of at most ${REF_LIMIT} characters` },
  { when: (r) => r.why !== undefined && (typeof r.why !== "string" || r.why.length > WHY_LIMIT || scrub(r.why) !== r.why), why: () => `why is one sentence of at most ${WHY_LIMIT} characters, and nothing that looks like a secret` },
  { when: (r) => r.kind === "file" && !safePath(r.ref), why: () => "a file is a repository-relative path — never absolute, never ../, never a URL" },
  { when: (r) => r.kind === "symbol" && !IDENTIFIER.test(r.ref.trim()), why: () => "a symbol is ONE identifier — letters, digits, _ or $, not starting with a digit; propose its file, or its last name" },
];

const nameOf = (r) => scrub(String(isObject(r) ? r.ref ?? "" : JSON.stringify(r) ?? "")).slice(0, REF_LIMIT);

const refusal = (r, why) => ({ kind: isObject(r) && REF_KINDS.includes(r.kind) ? r.kind : "unknown", ref: nameOf(r), why });

// ---- what the tree holds --------------------------------------------------------------------------------------------

const parentsOf = (path) => path.split("/").slice(0, -1).map((_, at, all) => all.slice(0, at + 1).join("/"));

// The tracked listing, as the two questions asked of it: is this a file, is this a directory. Null: no listing.
export const treeOf = (listing) => (Array.isArray(listing) ? { files: new Set(listing), dirs: new Set(listing.flatMap(parentsOf)) } : null);

const FILE_ANSWERS = [
  { when: (p, tree) => !tree.files, why: () => "the tracked tree could not be listed here, so nothing can be verified against it" },
  { when: (p, tree) => tree.files.has(p), why: () => null },
  { when: (p, tree) => tree.dirs.has(p), why: (p) => `${p} is a directory the tree holds, not a file — propose the files in it` },
  { when: () => true, why: () => "the tracked tree holds no such file" },
];

function heldFile(r, tree) {
  const path = normalized(r.ref);
  const why = FILE_ANSWERS.find((row) => row.when(path, tree)).why(path);
  return why ? { refused: refusal(r, why) } : { held: { kind: "file", ref: path, where: [{ path }] } };
}

// An identifier as a whole word, as an extended regular expression git and JavaScript read alike. The identifier was
// checked first, so `$` is the only character that needs escaping.
const escaped = (name) => String(name).replace(/\$/g, "\\$");

export const symbolPattern = (name) => `(^|[^A-Za-z0-9_$])${escaped(name)}([^A-Za-z0-9_$]|$)`;

// Every identifier at once: ONE search of the whole index, whose every line `located` then tests again for the one
// symbol it is asked about.
export const symbolsPattern = (names) => `(^|[^A-Za-z0-9_$])(${names.map(escaped).join("|")})([^A-Za-z0-9_$]|$)`;

// How long a search that could not answer every symbol at once may be followed by one search per symbol.
export const SEARCH_BUDGET_MS = 30_000;

const oneByOne = (names, search, clock, until) => Object.fromEntries(names.map((name) => [name, clock() < until ? search(symbolPattern(name)) : null]));

// -> { <symbol>: the hits that answered it | null }   search: (pattern) => hits | null, never throwing; clock: () => ms.
// ONE search answers every proposed symbol. Only when it could not run at all -- more lines than the port reads, or
// slower than git's deadline -- is each symbol asked on its own, until SEARCH_BUDGET_MS is spent: one asked by neither
// is null, which `verifiedRefs` refuses as unsearched, never as absent.
export function symbolHits(refs, search, clock) {
  const names = symbolsOf(refs);
  const all = names.length ? search(symbolsPattern(names)) : null;
  return all ? Object.fromEntries(names.map((name) => [name, all])) : oneByOne(names, search, clock, clock() + SEARCH_BUDGET_MS);
}

const firstPerFile = (hits) => ((seen) => hits.filter((h) => !seen.has(h.path) && seen.add(h.path)))(new Set());

const tracked = (tree, path) => !tree.files || tree.files.has(path);

// Where the tree holds it: a line that has it as a whole word, in a file the listing tracks -- the answer read for at
// most `maxFiles` files, and the first WHERE_LIMIT of them kept.
const located = (hits, word, tree) => firstPerFile(hits.filter((h) => word.test(String(h.text ?? "")) && tracked(tree, h.path))).slice(0, tree.maxFiles ?? Infinity).slice(0, WHERE_LIMIT).map((h) => ({ path: h.path, line: h.line }));

function heldSymbol(r, tree) {
  const name = r.ref.trim();
  const hits = tree.hits?.[name];
  if (!Array.isArray(hits)) return { refused: refusal(r, "the tracked tree could not be searched for it here") };
  const where = located(hits, new RegExp(symbolPattern(name)), tree);
  return where.length ? { held: { kind: "symbol", ref: name, where } } : { refused: refusal(r, "no tracked file holds that identifier as a whole word") };
}

const HOLDS = { file: heldFile, symbol: heldSymbol };

function judged(r, tree) {
  const wrong = RULES.find((rule) => rule.when(r));
  return wrong ? { refused: refusal(r, wrong.why(r)) } : HOLDS[r.kind](r, tree);
}

const keyOf = (r) => (isObject(r) ? `${r.kind}\u0000${typeof r.ref === "string" ? normalized(r.ref) : JSON.stringify(r.ref)}` : JSON.stringify(r));

const distinct = (refs) => refs.filter((r, at) => refs.findIndex((x) => keyOf(x) === keyOf(r)) === at);

const bounded = (refs) => distinct(Array.isArray(refs) ? refs.slice(0, MAX_REFS) : []);

// The symbols worth one search each: every well-formed symbol among the references.
export const symbolsOf = (refs) => [...new Set(bounded(refs).filter((r) => isObject(r) && r.kind === "symbol" && typeof r.ref === "string" && IDENTIFIER.test(r.ref.trim())).map((r) => r.ref.trim()))];

// -> { held: [{ kind, ref, where: [{ path, line? }] }], refused: [{ kind, ref, why }] }
//    tree: `treeOf`'s answer (or null), plus `hits` (symbol -> the search's answer, null where it could not run) and
//    `maxFiles`.
export function verifiedRefs(refs, tree) {
  const judgedAll = bounded(refs).map((r) => judged(r, tree ?? { files: null }));
  return { held: judgedAll.filter((j) => j.held).map((j) => j.held), refused: judgedAll.filter((j) => j.refused).map((j) => j.refused) };
}
