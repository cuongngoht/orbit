// WHICH work item, in WHICH system, read by WHOM -- the discovery ladder.
//
// "Implement PBI 4312" names an item and nothing else. This answers the rest from
// the strongest thing already known, in a fixed order, and stops at the first row
// that can:
//
//   explicit   the reference is a link, and a reader that recognises it says whose
//   work       a piece of work already started on this id, and it knows its system
//   binding    this project's own binding (a person's word, or the engine's after a
//              first successful read) says which system its items are in
//   registry   exactly one system has a reader that is ready here
//   tool       a command line tool a descriptor names, and only those, is looked
//              for and asked, read-only, what it is configured for
//   gap        nothing above could say -- and, if nothing can READ a work item at
//              all, that is remembered as the one opportunity per capability that
//              knowledge already keeps
//
// It never assumes a vendor: which systems exist, what a link to one looks like and
// which tools know a default are DATA descriptors carry. It never reads an item, never
// installs anything, and writes only the opportunity (through the existing door) --
// looking is not doing. Two systems that could both hold an id is AMBIGUOUS, refused,
// with the candidates named: a guess between two products would attach one team's
// requirement to another's name.
//
// The reader that will read is not chosen here. The existing resolver ranks whatever
// provides `workitem.read` (src/knowledge/verify.mjs); this only keeps the ones that
// can read for THIS system.
import { Refused } from "../errors.mjs";
import { discovered } from "../knowledge/opportunities.mjs";
import { resolved } from "../knowledge/verify.mjs";
import { everyResource } from "../resources/registry.mjs";
import { bareIdOf, descriptorFor, requiresProject, serves, systemOf } from "./descriptors.mjs";
import { canonicalIdentity, identityFindings } from "./model.mjs";

export const WORKFLOW = "orbit-requirements";

// The one thing this asks of the resolver, shaped as a need knowledge already knows.
export const NEED = [{ capability: "workitem.read", proves: { subject: "source" }, context: {}, conditional: false, tier: "rule", because: ["a work item is read to settle what it should do"], by: "sources" }];

const URL_SHAPED = /^[a-z][a-z0-9+.-]*:\/\//i;

const keyOf = (identity) => JSON.stringify(canonicalIdentity(identity));

const distinct = (identities) => identities.filter((i, at) => identities.findIndex((x) => keyOf(x) === keyOf(i)) === at);

const said = (i) => `${i.provider} ${[i.organization, i.project].filter(Boolean).join("/")} #${i.id}`;

const ambiguous = (what, options) => new Refused(`AMBIGUOUS: ${what}: ${options.join("; ")} — say which with the link, or bind this project's system with bind --human`);

function stateOf(ref, w) {
  const effective = w.effective();
  const reading = resolved(NEED, effective).results[0];
  return { ref: String(ref ?? "").trim(), w, reading, resources: new Map(everyResource(effective).map((r) => [r.key, r])), partial: null };
}

// The first of the resolver's ranked providers that is ready AND reads for this
// system -- so a ready reader for one product is never asked for another's item.
function readerFor(identity, s) {
  const chosen = s.reading.candidates.find((c) => c.selectable && serves(s.resources.get(c.key), identity.provider, s.w.descriptors));
  return chosen ? { key: chosen.key, kind: chosen.kind, ownership: chosen.ownership, verdict: chosen.verdict } : null;
}

// An identity that holds, with the reader that would read it -- or null, so the next
// row gets its turn rather than a malformed identity travelling on.
function known(s, identity, say) {
  if (identityFindings(identity).length) return null;
  const provider = readerFor(identity, s);
  return { identity, provider, gap: !provider, say: provider ? say : `${say}, but nothing ready here reads ${identity.provider} items — add a connection for it in Orbit Control, or an adapter` };
}

const firstBareId = (s) => (s.w.descriptors ?? []).map((d) => bareIdOf(d, s.ref)).find(Boolean) ?? null;

// The reader that would read THIS identity, chosen the way the ladder chooses one: the
// resolver's ranked providers, kept to the ones ready here that read for its system.
export const providerFor = (identity, w) => readerFor(identity, stateOf("", w));

// ---- the rows ------------------------------------------------------------------------

function explicit(s) {
  if (!URL_SHAPED.test(s.ref)) return null;
  const found = distinct(s.w.readers.map((r) => r.resolves(s.ref)).filter(Boolean));
  if (found.length > 1) throw ambiguous("that link reads as more than one item", found.map(said));
  return found.length ? known(s, found[0], `the link names its system: ${said(found[0])}`) : null;
}

function fromWork(s) {
  const id = firstBareId(s);
  const roots = id ? distinct(s.w.works().map((x) => x.root).filter((r) => r.id === id)) : [];
  if (roots.length > 1) throw ambiguous(`work has already started on ${id} in more than one system`, roots.map(said));
  return roots.length ? known(s, roots[0], `work on ${said(roots[0])} is already under way`) : null;
}

const safeExec = (source, text) => {
  try { return new RegExp(source).exec(text); }
  catch { return null; }
};

function matching(refs, ref) {
  const hit = Object.entries(refs).map(([pattern, target]) => ({ target, m: safeExec(pattern, ref) })).find((x) => x.m);
  return hit ? { target: hit.target, id: hit.m.groups?.id ?? null } : null;
}

const identityOf = (target, id) => ({ provider: target.provider, organization: target.organization, ...(target.project ? { project: target.project } : {}), id });

function fromBinding(s) {
  const { doc } = s.w.bindings();
  const hit = matching(doc.refs, s.ref) ?? (doc.default ? { target: doc.default, id: null } : null);
  const id = hit ? hit.id ?? bareIdOf(descriptorFor(s.w.descriptors, hit.target.provider), s.ref) : null;
  return id ? known(s, identityOf(hit.target, id), `this project's binding puts its items in ${hit.target.provider}`) : null;
}

// The systems that have a reader ready to read for them -- a reader nobody has set
// up a connection for, a server the host merely configured and a catalog entry
// nobody added are none of them ready, so they are none of them a system.
const readySystems = (s) => [...new Set(s.reading.candidates.filter((c) => c.selectable).map((c) => systemOf(s.resources.get(c.key), s.w.descriptors)).filter(Boolean))];

// One organization when every usable connection of the system is for the same one.
function soleOrganization(s, d) {
  const mine = (s.w.connections?.list() ?? []).filter((c) => c.provider === d?.connection && c.credential?.set);
  const names = [...new Set(mine.map((c) => String(c.organization).toLowerCase()))];
  return names.length === 1 ? mine[0].organization : null;
}

function fromSystem(s, system, id) {
  const d = descriptorFor(s.w.descriptors, system);
  const organization = soleOrganization(s, d);
  const identity = { provider: system, ...(organization ? { organization } : {}), id };
  s.partial = organization && !requiresProject(d) ? null : identity;
  return s.partial ? null : known(s, identity, `${system} is the one system here that can read it`);
}

function fromRegistry(s) {
  const id = firstBareId(s);
  const systems = id ? readySystems(s) : [];
  if (systems.length > 1) throw ambiguous(`item ${id} could be in more than one system, and each has a reader ready here`, systems);
  return systems.length ? fromSystem(s, systems[0], id) : null;
}

// The tools a descriptor names -- for the system the registry already narrowed it to,
// or every descriptor's when nothing has. A bounded list, read off data: this row
// never looks for a command nobody declared.
const toolsFor = (s) => (s.partial ? [descriptorFor(s.w.descriptors, s.partial.provider)] : s.w.descriptors ?? []).flatMap((d) => (d?.tools ?? []).filter((t) => t.defaults).map((tool) => ({ descriptor: d, tool })));

function completed(descriptor, g, id) {
  const identity = { provider: descriptor.id, organization: String(g.organization ?? "").trim(), ...(g.project ? { project: g.project.trim() } : {}), id };
  return identityFindings(identity).length || (requiresProject(descriptor) && !identity.project) ? null : identity;
}

function probed(s, { descriptor, tool }, id, finding) {
  const run = s.w.probe(tool.bin, tool.defaults.argv, finding);
  const groups = run?.ok ? safeExec(tool.defaults.parse, String(run.out))?.groups : null;
  return groups ? completed(descriptor, groups, id) : null;
}

// Which of those tools are here, asked about ONLY through their declared argv.
function askedTools(s, tools, id) {
  const seen = s.w.observe([...new Set(tools.map((x) => x.tool.catalog))]);
  const ready = tools.map((x) => ({ x, finding: seen.find((f) => f.id === x.tool.catalog) })).filter((r) => r.finding?.status === "ready");
  return ready.map((r) => probed(s, r.x, id, r.finding)).filter(Boolean);
}

// What the engine would REMEMBER after a first successful read: offered, not written.
function viaTool(s, identity) {
  const { provider, organization, project } = identity;
  return { ...known(s, identity, `read off the configured defaults of a tool that is here: ${said(identity)}`), suggest: { default: { provider, organization, ...(project ? { project } : {}) } } };
}

function fromTools(s) {
  const id = firstBareId(s);
  const tools = id ? toolsFor(s) : [];
  const identities = tools.length ? distinct(askedTools(s, tools, id)) : [];
  if (identities.length > 1) throw ambiguous(`item ${id} could be in more than one system, and the tools here are configured for each`, identities.map(said));
  return identities.length ? viaTool(s, identities[0]) : null;
}

// The opportunity for a capability nothing here provides: through the door knowledge
// already keeps -- one per capability, moved only by evidence or a person -- and
// nothing is installed, enabled or generated. Only when NOTHING can read a work item
// is it a gap; a reader that exists for another system is a sentence, not an opportunity.
function remembered(s) {
  const run = { at: s.w.now(), workflow: WORKFLOW, subjects: ["source"], context: {} };
  const kept = s.w.opportunities.settle(discovered(s.w.opportunities.docs(), [s.reading], run));
  return kept.written[0] ?? null;
}

const SAYS = [
  { when: (s) => s.reading.gap, say: (s) => `nothing here can read a work item: ${s.reading.why}` },
  { when: (s) => s.partial, say: (s) => `it looks like ${s.partial.provider}, but which ${requiresProject(descriptorFor(s.w.descriptors, s.partial.provider)) && !s.partial.project ? "project" : "organization"} is not known here — give the link, or bind this project's system with bind --human` },
  { when: (s) => URL_SHAPED.test(s.ref), say: () => "no system this project knows recognises that link — give a link it does, or bind this project's system with bind --human" },
  { when: (s) => !firstBareId(s), say: () => "that is neither a link nor an item id this project can read — give the link" },
  { when: () => true, say: () => "which system holds it could not be decided — give the link, or bind this project's system with bind --human" },
];

function gap(s) {
  return { identity: null, provider: null, gap: s.reading.gap, say: SAYS.find((r) => r.when(s)).say(s) };
}

// First row that answers; the last always does.
export const LADDER = [
  { id: "explicit", ask: explicit },
  { id: "work", ask: fromWork },
  { id: "binding", ask: fromBinding },
  { id: "registry", ask: fromRegistry },
  { id: "tool", ask: fromTools },
  { id: "gap", ask: gap },
];

const tagged = (row, hit) => (hit ? { rung: row.id, ...hit } : null);

// Whatever the row that answered, the opportunity is reconciled against what the
// resolver said: raised when nothing at all can read a work item, and moved on by
// the engine when something can again. Evidence moves it, nothing else does.
//
// w: { descriptors, readers, works(), bindings(), connections, effective(), observe(ids),
//      probe(bin, argv, finding), opportunities: { docs(), settle(docs) }, now() }
export function resolveSource(ref, w) {
  const s = stateOf(ref, w);
  const hit = LADDER.reduce((found, row) => found ?? tagged(row, row.ask(s)), null);
  return { partial: s.partial, suggest: null, candidates: s.reading.candidates, ...hit, opportunity: remembered(s) };
}
