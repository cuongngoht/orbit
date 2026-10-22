// The rules a SYSTEM GRAPH fact is held to beyond its field table (ADR 0033; doc §4.2).
//
// A node is a part of the running system and a relation an edge between two; both arrive through
// the one door every architecture fact does (`architecture record`, src/architecture/record.mjs),
// which already refuses a file the repository does not track. What these rows add is what a field
// table cannot say about one field at a time:
//
//   identity    a node's key is its kind and its name -- `queue:billing.reminders`, qualified in
//               between if a recorder needs to (`queue:broker-a/billing.reminders`) -- and a
//               relation's key is exactly `<from> <relation> <to>`, so one edge recorded twice is
//               ONE fact, the rule every architecture fact keeps by deriving its id from its key
//   unknown     a target the source does not fix -- a name computed at run time, a routing nobody
//               can read off a file -- is the end `unknown`, never a guess; an edge with an unknown
//               end can never be `certain` and must say what is unknown, and an edge with two
//               unknown ends says nothing at all
//   attributes  flat, bounded name → value pairs a file declares, never a secret: a secret-named
//               key or a URL that carries a credential is refused, not masked into a fact
//
// What a kind or a relation MEANS -- its role -- is never a field here. The graph projection reads
// it off the vocabulary (src/topology/vocabulary.mjs) every time, so a name nobody declared is
// kept, shown and derives nothing, and a role cannot be claimed by filling a field in.

export const UNKNOWN_END = "unknown";

const MAX_TEXT = 240;
const MAX_ATTRIBUTES = 32;
const MAX_VALUE = 200;
const PRINTABLE = /^[^\x00-\x1f\x7f]+$/;
const ATTRIBUTE_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const SECRET_KEY = /pass(word)?|pwd|secret|token|credential|api[-_.]?key|private[-_.]?key|connection[-_.]?string/i;
const CREDENTIAL_URL = /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@/i;

const has = (raw, k) => raw[k] !== undefined && raw[k] !== null && raw[k] !== "";

const missingOf = (raw, keys, kind, where) => keys.filter((k) => !has(raw, k)).map((k) => `${where}: a ${kind} fact names its ${k}`);

const textFindings = (raw, keys, where) => keys.filter((k) => has(raw, k) && !(typeof raw[k] === "string" && raw[k].length <= MAX_TEXT && PRINTABLE.test(raw[k]))).map((k) => `${where}: ${k} is one printable line of at most ${MAX_TEXT} characters`);

// ── attributes ─────────────────────────────────────────────────────────────

function attributeFindings(raw, where) {
  const entries = Object.entries(isTable(raw.attributes) ? raw.attributes : {});
  const size = entries.length > MAX_ATTRIBUTES ? [`${where}: at most ${MAX_ATTRIBUTES} attributes`] : [];
  return [...size, ...entries.flatMap(([k, v]) => ATTRIBUTE_RULES.flatMap((rule) => rule(k, v, where)))];
}

const isTable = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const ATTRIBUTE_RULES = [
  (k, v, where) => (ATTRIBUTE_KEY.test(k) ? [] : [`${where}: attribute "${String(k).slice(0, 64)}" is not a name`]),
  (k, v, where) => (["string", "number", "boolean"].includes(typeof v) ? [] : [`${where}: attribute ${k} is a string, a number or true/false — a graph fact keeps flat values`]),
  (k, v, where) => (typeof v === "string" && (v.length > MAX_VALUE || !PRINTABLE.test(v || " ")) ? [`${where}: attribute ${k} is one printable line of at most ${MAX_VALUE} characters`] : []),
  (k, v, where) => (SECRET_KEY.test(k) ? [`${where}: attribute ${k} is named like a secret — a graph fact never keeps one; name the variable it comes from in the project's own settings instead`] : []),
  (k, v, where) => (typeof v === "string" && CREDENTIAL_URL.test(v) ? [`${where}: attribute ${k} is a URL that carries a credential — refused, never masked into a fact`] : []),
];

// ── nodes ──────────────────────────────────────────────────────────────────

const NODE_RULES = [
  (raw, where) => missingOf(raw, ["nodeKind", "name"], "node", where),
  (raw, where) => textFindings(raw, ["key", "name", "of"], where),
  (raw, where) => (has(raw, "nodeKind") && has(raw, "name") && !nodeKeyHolds(raw) ? [`${where}: a node's key is its kind and its name — "${raw.nodeKind}:${raw.name}", qualified in between if it must be`] : []),
  (raw, where) => attributeFindings(raw, where),
];

// `<kind>:<name>`, or `<kind>:<qualifier>/<name>` when two parts share a name.
function nodeKeyHolds(raw) {
  const prefix = `${raw.nodeKind}:`;
  const rest = String(raw.key ?? "").startsWith(prefix) ? String(raw.key).slice(prefix.length) : null;
  return rest === String(raw.name) || (rest !== null && rest.endsWith(`/${raw.name}`) && rest.length > String(raw.name).length + 1);
}

// ── relations ──────────────────────────────────────────────────────────────

const unknownEnds = (raw) => [raw.from, raw.to].filter((end) => end === UNKNOWN_END).length;

const RELATION_RULES = [
  (raw, where) => missingOf(raw, ["relation", "from", "to"], "relation", where),
  (raw, where) => textFindings(raw, ["from", "to"], where),
  (raw, where) => (has(raw, "relation") && has(raw, "from") && has(raw, "to") && raw.key !== relationKey(raw) ? [`${where}: a relation's key is exactly "${relationKey(raw)}" — its from, its relation and its to`] : []),
  (raw, where) => (unknownEnds(raw) === 2 ? [`${where}: an edge between two unknown ends says nothing — record what IS known`] : []),
  (raw, where) => (unknownEnds(raw) === 1 && raw.confidence === "certain" ? [`${where}: an edge with an unknown end is never certain — say possible or unknown, and what would settle it`] : []),
  (raw, where) => (unknownEnds(raw) === 1 && !(Array.isArray(raw.unknowns) && raw.unknowns.length) ? [`${where}: an edge with an unknown end says, in unknowns, what is unknown about it`] : []),
  (raw, where) => attributeFindings(raw, where),
];

export const relationKey = (raw) => `${raw.from} ${raw.relation} ${raw.to}`;

const KIND_RULES = { node: NODE_RULES, relation: RELATION_RULES };

// Every rule a node or a relation is held to beyond the field table; nothing for any other kind.
export const graphFactFindings = (raw, where) => (KIND_RULES[raw?.kind] ?? []).flatMap((rule) => rule(raw, where));
