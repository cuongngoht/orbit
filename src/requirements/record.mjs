// The one door a proposed requirement comes through -- src/knowledge/record.mjs's
// discipline: one candidate per line, every citation checked against what was actually
// read here, and a batch is all or nothing, because the lines came from ONE reading and
// keeping the readable half keeps half an answer.
//
// This JUDGES and nothing else. What a candidate may say is candidate.mjs; what becomes of
// it is reconcile.mjs, through ingest.mjs. What a citation MEANS -- which source it names,
// at which revision, of what kind -- is asked of `world`, handed in by the composition
// root, so nothing here reads another subsystem's store:
//
//   world.resolves(ref)   the source a citation names, as { sid, cited, revision, kind,
//                         authorityBearing } -- or null when nothing was read under that id
//   world.seen(sid)       the revisions of it already cited to this requirement
//   world.fact(id)        the standing fact with that id, or null
//
// A citation is refused when nothing was read under it, when what it names is CONTEXT (a
// pull request, a commit, code, a test), and when it names a revision nobody read. What
// the product does is not what it should do, and no reading of it is a source.
import { factCandidateFindings } from "./candidate.mjs";
import { citesOf } from "./model.mjs";
import { isCurrent, settles } from "./vocab.mjs";

export const MAX_BATCH = 200;

export function parseCandidates(text) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, MAX_BATCH + 1).map((line, i) => parsed(line, i));
}

function parsed(line, i) {
  try { return { i, raw: JSON.parse(line) }; }
  catch (e) { return { i, raw: null, why: `line ${i + 1}: not valid JSON — ${e.message}` }; }
}

const candidateOf = (raw) => ({ ...raw, status: raw.status ?? "stated", sources: raw.sources ?? [] });

const KNOWN = (found, world) => found.cited === found.revision || world.seen(found.sid).includes(found.cited);

// One citation, held to what was actually read.
function citeWhy(cite, at, world) {
  const found = world.resolves(`source:${cite.sid}@${cite.revision}`);
  if (!found) return `${at}: source ${cite.sid} is not one that was read here`;
  if (!found.authorityBearing) return `${at}: source ${cite.sid} is a ${found.kind} — context for what was built, never where a requirement comes from`;
  return KNOWN(found, world) ? null : `${at}: revision ${cite.revision} of ${cite.sid} was never read here (it stands at ${found.revision})`;
}

// A derived fact follows from STANDING facts that SAY something -- not from an unknown, a
// conflict or something a later version replaced.
function followsWhy(raw, at, world) {
  return (raw.derivedFrom ?? []).map((id) => world.fact(id)).flatMap((f, i) => (f && isCurrent(f.status) && settles(f.status) ? [] : [`${at}: derivedFrom ${raw.derivedFrom[i]} is not a standing fact that says something`]));
}

const citeFindings = (raw, at, world) => [...citesOf(raw.sources).map((c) => citeWhy(c, at, world)).filter(Boolean), ...followsWhy(raw, at, world)];

function weighed(c, world) {
  const at = `line ${c.i + 1}`;
  const why = [...factCandidateFindings(c.raw, at), ...(c.raw && typeof c.raw === "object" ? citeFindings(c.raw, at, world) : [])];
  return why.length ? { ...c, why: why.join("\n      ") } : { ...c, candidate: candidateOf(c.raw) };
}

export function judge(candidates, world) {
  if (candidates.length > MAX_BATCH) return { accepted: [], rejected: [{ i: MAX_BATCH, why: `more than ${MAX_BATCH} candidates in one batch — split it` }], refused: true };
  const rows = candidates.map((c) => (c.why ? c : weighed(c, world)));
  const rejected = rows.filter((r) => r.why);
  return { accepted: rejected.length ? [] : rows.map((r) => r.candidate), rejected, refused: rejected.length > 0 };
}
