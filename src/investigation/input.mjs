// What an investigation was ASKED about, as data -- and which of three ways in
// that makes it, derived, never declared.
//
//   screen   a screen in the map (or only the objective's words, as before):
//            the map's surfaces are what there is to look at
//   pbi      a requirement -- a QA plan with no screen, or a requirement snapshot
//            read from a file -- and no screen: nothing makes up a screen for it
//   hybrid   a requirement AND a screen (named, or the one the plan names):
//            each criterion is checked on whichever layer can witness it
//
// A snapshot keeps where it came from and WHAT it was -- ref, revision, a sha
// of the content, when it was read, whose word it is -- and never its text: a
// requirement can hold anything, and the journal keeps what it needs to tell
// whether the requirement moved, not a copy somebody has to redact later. The
// agent reads the file itself. A source that cannot be read is recorded as
// such, and the investigation carries on with what it has.
//
// Authority is `draft` unless a PERSON relays otherwise: an agent reading a
// ticket does not make the ticket the team's accepted contract.
//
// The field is `type`, never `kind`: `kind` is the journal's own word for which
// record a line is, and an input carrying one would overwrite it on the disk.
import { sha } from "../hash.mjs";

export const INPUT_KINDS = [
  { id: "screen", requirement: false, say: "a screen in the map" },
  { id: "plan", requirement: true, say: "a QA plan: acceptance criteria, scenarios and what each commits to" },
  { id: "pbi", requirement: true, say: "a requirement snapshot: its ref, revision and digest — never its text" },
];

const requirement = (i) => INPUT_KINDS.find((k) => k.id === i.type)?.requirement === true;
const screened = (i) => i.type === "screen" || (i.type === "plan" && Boolean(i.screen));

// First row that holds; the last always does.
export const INPUT_MODES = [
  { id: "hybrid", when: (inputs) => inputs.some(requirement) && inputs.some(screened), say: "a requirement and a screen: each criterion on the layer that can witness it" },
  { id: "pbi", when: (inputs) => inputs.some(requirement), say: "a requirement and no screen: verified below the UI, with no screen made up for it" },
  { id: "screen", when: () => true, say: "the map's surfaces: what there is to look at, and what each control is recorded to do" },
];

export const inputModeOf = (inputs) => INPUT_MODES.find((m) => m.when(inputs ?? [])).id;

// A screen, as the map knows it or does not.
export const screenInput = (graph, id) => ({ type: "screen", ref: id, state: graph.screens.has(id) ? "read" : "unavailable", why: graph.screens.has(id) ? null : `the map has no screen ${id}` });

// A QA plan -- the checkout's, or a DRAFT an agent wrote -- by id and content.
export function planAsInput(plan, ref) {
  if (!plan) return { type: "plan", ref, state: "unavailable", why: `no plan ${ref} in the checkout or the drafts room` };
  return { type: "plan", ref: plan.id, revision: plan.revision ?? null, digest: digestOf(plan), authority: plan._draft ? "draft" : "accepted", screen: plan.screen ?? null, state: "read" };
}

// A requirement file read NOW. `text` null means it could not be read.
export function pbiInput(spec, text, now) {
  if (text === null) return { type: "pbi", ref: spec.ref ?? spec.file, state: "unavailable", why: `${spec.file} could not be read — carried on without it`, read: now };
  return { type: "pbi", ref: spec.ref ?? ownRef(text) ?? spec.file, revision: spec.revision ?? ownRevision(text), digest: sha(text), authority: spec.accepted ? "accepted" : "draft", state: "read", read: now };
}

// A frozen requirement snapshot (src/requirements/snapshot.mjs), read NOW, as the same input a
// requirement file is: its own id, a short form of its digest as the revision, the digest, whose
// word it is AT ITS WEAKEST, and never a fact's text. Its authority is the snapshot's own, derived
// from the sources it stands on, so a draft item stays a draft and an item a person accepted is
// accepted without anyone being asked again; a person's `--authority=accepted --human` is still
// the one door that makes a draft snapshot accepted for THIS investigation (`accepted`).
// One that cannot be read is recorded as such, and the investigation carries on.
export function snapshotAsInput(snapshot, now, opts = {}) {
  if (!snapshot) return { type: "pbi", ref: opts.ref, state: "unavailable", why: `${opts.why ?? `no snapshot ${opts.ref} is kept here`} — carried on without it`, read: now };
  return { type: "pbi", ref: snapshot.id, revision: snapshot.digest.slice(0, 16), digest: snapshot.digest, authority: opts.accepted ? "accepted" : snapshot.authority, state: "read", read: now };
}

const digestOf = (plan) => sha(JSON.stringify(Object.fromEntries(Object.entries(plan).filter(([k]) => !k.startsWith("_")))));

// A JSON snapshot may say its own id and revision; anything else says neither.
const ownRef = (text) => jsonOf(text)?.ref ?? jsonOf(text)?.id ?? null;
const ownRevision = (text) => (jsonOf(text)?.revision === undefined ? null : String(jsonOf(text).revision));

function jsonOf(text) {
  try { return JSON.parse(text); }
  catch { return null; }
}
