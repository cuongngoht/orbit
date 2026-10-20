// Making a source's identity and its RECORD, and holding what a reader returned to
// the table that declares it.
//
// An id is a pure function of WHAT a source is, so the same work item read on two
// machines is one file: `sourceId` (one per item and kind), `rootId` (the
// requirement set an item is the root of) and `workId` (the piece of work done on
// it) hash the same canonical identity. An organization or a project is compared
// lowercased -- two spellings of one place must not become two products -- and
// stored as the system spells it, because that spelling is what a reader must send.
//
// A record keeps where a source came from and WHAT it was -- ref, revision, a sha of
// its content, whose word it is, when it was read, its state -- and NEVER its text.
// A requirement can hold anything, so the store keeps what it needs to tell whether
// the source moved, not a copy somebody would have to redact later (ADR 0007).
// `sourceRecord` takes the text only to hash it and drops it on the floor.
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { Refused } from "../errors.mjs";
import { sha, short } from "../hash.mjs";
import { quote } from "../quote.mjs";
import { scrub } from "../scrub.mjs";
import { AUTHORITIES, SOURCE_KIND_NAMES } from "./contract-v1.mjs";
import { COMMENT_FIELDS, CONTENT_FIELDS, IDENTITY_FIELDS, IDENTITY_REQUIRED, ITEM_ID, RELATED_FIELDS, REVISION_FIELDS, WORKITEM_FIELDS, WORKITEM_REQUIRED } from "./fields.mjs";

export const SOURCE_RECORD_VERSION = 1;

// Related items one record remembers. A work item with more is several questions.
export const MAX_RELATIONS = 64;

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const lower = (v) => (typeof v === "string" ? v.toLowerCase() : v);

// Null and absent are the same thing to a reader that had nothing to say.
const present = (raw) => Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null && v !== undefined));

const unknownKeys = (raw, table, where) => Object.keys(raw).filter((k) => !(k in table)).map((k) => `${where}: unknown field "${k}"`);

// ---- identity ------------------------------------------------------------------------

// Sorted keys, comparison case folded: the shape every id below hashes.
export const canonicalIdentity = (i) => ({ id: i.id, organization: lower(i.organization), project: lower(i.project) ?? null, provider: i.provider });

export const sourceId = (identity, kind) => `src-${short(JSON.stringify([...Object.values(canonicalIdentity(identity)), kind]), 12)}`;

export const rootId = (identity) => `req-${short(JSON.stringify(canonicalIdentity(identity)), 12)}`;

export const workId = (identity) => `w-${short(JSON.stringify(canonicalIdentity(identity)), 12)}`;

// An identity field that looks like a secret is refused, never masked: masking it
// would quietly turn it into a different source, and it is part of the id.
const secretFindings = (raw, where) => Object.entries(raw).filter(([, v]) => typeof v === "string" && scrub(v) !== v).map(([k]) => `${where}: ${k} looks like a secret — refused, never masked, because an identity field is part of the id`);

export function identityFindings(raw, where = "identity") {
  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  const one = present(raw);
  const shape = [...missingFindings(IDENTITY_REQUIRED, one, where), ...constraintFindings(IDENTITY_FIELDS, one, where)];
  return [...shape, ...unknownKeys(one, IDENTITY_FIELDS, where), ...secretFindings(one, where)];
}

function checkedIdentity(raw) {
  const found = identityFindings(raw);
  if (found.length) throw new Refused(`not a source identity:\n  ${found.join("\n  ")}`);
  return present(raw);
}

// ---- what a reader returned ----------------------------------------------------------

const NESTED = [
  { field: "comments", table: COMMENT_FIELDS, required: ["id", "text"] },
  { field: "related", table: RELATED_FIELDS, required: ["ref", "relation"] },
  { field: "revisions", table: REVISION_FIELDS, required: ["revision"] },
];

const membersOf = (v) => (Array.isArray(v) ? v : []);

function memberFindings(member, spec, at) {
  if (!isObject(member)) return [`${at} must be an object`];
  const one = present(member);
  return [...missingFindings(spec.required, one, at), ...constraintFindings(spec.table, one, at), ...unknownKeys(one, spec.table, at)];
}

const nestedFindings = (item, where) => NESTED.flatMap((n) => membersOf(item[n.field]).flatMap((m, i) => memberFindings(m, n, `${where}: ${n.field}[${i}]`)));

const childFindings = (item, where) => membersOf(item.children).filter((c) => typeof c !== "string" || !new RegExp(ITEM_ID).test(c)).map((c) => `${where}: child "${String(c).slice(0, 40)}" is not an item id`);

// A reader answers or it answers wrongly. A wrong answer is the READER's fault --
// callers turn these findings into Blocked, never into a requirement fact.
export function workitemFindings(raw, where = "workitem", required = WORKITEM_REQUIRED) {
  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  const item = present(raw);
  const shape = [...missingFindings(required, item, where), ...constraintFindings(WORKITEM_FIELDS, item, where)];
  return [...shape, ...unknownKeys(item, WORKITEM_FIELDS, where), ...nestedFindings(item, where), ...childFindings(item, where)];
}

// A reader coerces what its system counts in numbers into the strings the contract
// speaks; the contract itself does not. A revision of 7 and an id of 4312 are the
// commonest case, and refusing them would refuse every system that counts.
const stringly = (table, obj) => (isObject(obj) ? Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, table[k]?.type === "string" && typeof v === "number" ? String(v) : v])) : obj);

const numberedChildren = (top) => (Array.isArray(top.children) ? { children: top.children.map((c) => (typeof c === "number" ? String(c) : c)) } : {});

const stringlyMembers = (top) => Object.fromEntries(NESTED.filter((n) => Array.isArray(top[n.field])).map((n) => [n.field, top[n.field].map((m) => stringly(n.table, m))]));

export function coercedItem(raw) {
  if (!isObject(raw)) return raw;
  const top = stringly(WORKITEM_FIELDS, raw);
  return { ...top, ...stringlyMembers(top), ...numberedChildren(top) };
}

// Key order is whatever a reader happened to produce, so it must not reach a digest.
function sorted(v) {
  if (Array.isArray(v)) return v.map(sorted);
  if (!isObject(v)) return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]));
}

// The stable text of any value, for a digest or a revision: same content, same bytes.
export const stableText = (value) => JSON.stringify(sorted(value));

// The text a digest is taken over: exactly the content fields of an item, in a
// stable form. Two reads of one item agree; a change to the content does not.
export const workitemText = (item) => stableText(Object.fromEntries(CONTENT_FIELDS.map((f) => [f, item?.[f] ?? null])));

// ---- the record ----------------------------------------------------------------------

function checkedKind(kind) {
  if (!SOURCE_KIND_NAMES.includes(kind)) throw new Refused(`"${kind}" is not a source kind — ${SOURCE_KIND_NAMES.join(", ")}`);
  return kind;
}

function checkedAuthority(authority) {
  if (!AUTHORITIES.includes(authority)) throw new Refused(`authority must be ${AUTHORITIES.join(" or ")}, not "${authority}"`);
  return authority;
}

// A link a person opens, and nothing that can carry a credential: no user info, no
// query, no fragment. Anything that is not http(s) is not a link.
export function safeUrl(url) {
  try { return httpLink(new URL(String(url))); }
  catch { return null; }
}

const httpLink = (u) => (/^https?:$/.test(u.protocol) ? `${u.origin}${u.pathname}` : null);

const storedIdentity = (i) => Object.fromEntries(["provider", "organization", "project", "id"].filter((k) => i[k] !== undefined).map((k) => [k, i[k]]));

const refOf = (ref, identity) => quote(String(ref ?? identity.id), 100);

// References only: which items are related, never what they say.
function relationsOf(r) {
  const related = membersOf(r?.related).slice(0, MAX_RELATIONS).map((x) => ({ ref: String(x.ref), relation: x.relation, kind: x.kind ?? "workitem" }));
  return { parent: r?.parent ?? null, children: membersOf(r?.children).slice(0, MAX_RELATIONS).map(String), related };
}

const provenanceOf = (p) => (p ? Object.fromEntries(["key", "kind", "capability", "at"].filter((k) => p[k] !== undefined).map((k) => [k, quote(String(p[k]), 100)])) : null);

const revisionOf = (revision) => {
  if (revision === undefined || revision === null || revision === "") throw new Refused("a source that was read has a revision — without one nothing can tell whether it moved");
  return String(revision);
};

export function sourceRecord(p) {
  const identity = checkedIdentity(p.identity);
  const kind = checkedKind(p.kind);
  const authority = checkedAuthority(p.authority ?? "draft");
  const link = safeUrl(p.url);
  return { schema: SOURCE_RECORD_VERSION, id: sourceId(identity, kind), kind, identity: storedIdentity(identity), ref: refOf(p.ref, identity), ...(link ? { url: link } : {}), revision: revisionOf(p.revision), digest: sha(p.text ?? ""), authority, read: p.now, state: "read", relations: relationsOf(p.relations), provenance: provenanceOf(p.provenance) };
}

// A source that could not be read is recorded as such, and the work carries on with
// what it has (ADR 0007). It is a draft: nothing was read that anybody accepted.
export function unavailableRecord(identity, kind, ref, why, now) {
  const who = checkedIdentity(identity);
  const what = checkedKind(kind);
  return { schema: SOURCE_RECORD_VERSION, id: sourceId(who, what), kind: what, identity: storedIdentity(who), ref: refOf(ref, who), revision: null, digest: null, authority: "draft", read: now, state: "unavailable", why: quote(scrub(why), 240), relations: relationsOf(null), provenance: null };
}

// A link to something that is CONTEXT, never read: a pull request, a commit. It is
// recorded so the requirement can say what was built for it, and it has no revision or
// digest because nothing of it was read -- and it can never bear the requirement's
// authority, whatever it says.
export function contextRecord(identity, kind, ref, provenance, now) {
  const who = checkedIdentity(identity);
  const what = checkedKind(kind);
  return { schema: SOURCE_RECORD_VERSION, id: sourceId(who, what), kind: what, identity: storedIdentity(who), ref: refOf(ref, who), revision: null, digest: null, authority: "draft", read: now, state: "context", relations: relationsOf(null), provenance: provenanceOf(provenance) };
}

// What reading a source AGAIN meant. The same revision with different content is an
// ANOMALY, not a change: the system said nothing moved and the content says
// otherwise, and quietly treating either as the truth would be a guess.
export function sameSource(existing, now) {
  if (!existing || !["read", "anomaly"].includes(existing.state)) return "changed";
  if (String(existing.revision) !== String(now.revision)) return "changed";
  return existing.digest === now.digest ? "unchanged" : "anomaly";
}
