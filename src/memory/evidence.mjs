// Support lanes are provenance domains, not independent sources. Repeating the
// same source in another domain cannot add credit. No native host vocabulary.
import { Refused } from "../errors.mjs";
import { sha } from "../hash.mjs";
import { knownIn, sessionMarks } from "./session.mjs";

export const EVIDENCE_VERSION = 2;
export const domainOf = (seen) => /^[a-z][a-z0-9-]*:[a-f0-9]{16}$/.test(seen?.session ?? "") ? seen.session.split(":")[0] : null;

export function evidenceOf(candidate, stamp, seen, existing) {
  const domain = domainOf(seen);
  if (!domain) return existing?.support?.evidence ? { v: EVIDENCE_VERSION, domain: "unknown", uncertain: true } : null;
  const scope = sha(JSON.stringify([...(candidate.scope ?? [])].sort()));
  return { v: EVIDENCE_VERSION, domain, scope, group: sha(JSON.stringify([scope, stamp.status === "fresh" ? stamp.fingerprint : "unknown", candidate.source ?? "source"])) };
}

export function credited(existing, proposed, seen, evidence) {
  if (!evidence) return proposed;
  const state = currentEvidence(existing, evidence);
  if (evidence.uncertain) return { ...proposed, sessions: existing.support.sessions, evidence: state };
  if (state.unresolved || state.sessions.length >= 2048) return { ...proposed, sessions: Math.max(state.floor, existing?.support?.sessions ?? 0), evidence: { ...state, floor: Math.max(state.floor, existing?.support?.sessions ?? 0), unresolved: true }, diagnostic: "evidence history incomplete or bounded; support held at baseline" };
  return acceptedCredit(proposed, included(state, evidence.group, evidence.domain, seen));
}

function included(state, key, domain, seen) {
  const group = state.groups[key] ?? {};
  const lane = group[domain] ?? { count: 0, marks: [] };
  const updated = knownIn(lane.marks, seen) ? lane : { count: lane.count + 1, marks: [...new Set([...lane.marks, ...sessionMarks(seen)])] };
  return { ...state, groups: { ...state.groups, [key]: { ...group, [domain]: updated } }, total: state.total + (knownIn(state.sessions, seen) ? 0 : 1), sessions: [...new Set([...state.sessions, ...sessionMarks(seen)])] };
}

// Choose only the largest domain lane in each group. Deduplicate credited
// sessions across groups too: an echoed session cannot unlock earlier credit.
function creditOf(state) {
  const groups = Object.entries(state.groups).sort(([a], [b]) => a.localeCompare(b)).map(([, lanes]) => winners(lanes));
  const sets = groups.reduce((sets, lanes) => combinations(sets, lanes), [[]]);
  return Math.min(state.total, Math.max(0, ...sets.map((set) => set.length)));
}
function winners(lanes) {
  const entries = Object.entries(lanes).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(0, ...entries.map(([, lane]) => lane.count));
  return entries.filter(([, lane]) => lane.count === max).map(([, lane]) => lane.marks.filter((m) => m.startsWith('r:')));
}
const combinations = (sets, lanes) => sets.flatMap((set) => lanes.map((lane) => [...new Set([...set, ...lane])])).slice(0, 256);

const acceptedCredit = (proposed, state) => ({ ...proposed, sessions: Math.max(state.floor, creditOf(state)), evidence: state });

const emptyEvidence = () => ({ v: EVIDENCE_VERSION, floor: 0, unresolved: false, groups: {}, sessions: [], total: 0 });

function currentEvidence(existing, evidence) {
  if (evidence.v !== EVIDENCE_VERSION) throw new Refused("Unsupported evidence schema");
  if (existing && existing.support?.evidence?.v !== EVIDENCE_VERSION) throw new Refused("unsupported support record; no provenance was reconstructed");
  return structuredClone(existing?.support?.evidence ?? emptyEvidence());
}
