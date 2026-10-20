// HOST MEMORY -- what a coding host remembers about this project, as CONTEXT
// for one invocation. A port: the core knows the contract and never a host.
//
//   provider  { id, doc, recall({ tokens, context, limit }) → { hints, unknowns } }
//   hint      { id, title?, text?, paths?, claims? }
//
// A provider is handed the TOKENS of a task, never its text. What it returns is
// a hint, never a fact:
//
//   text      scrubbed, then reduced to tokens -- which steer, and are never
//             printed or stored
//   title     scrubbed, quoted and clipped: the one thing shown, so a person can
//             tell which of their own notes pointed here
//   paths     kept only if this checkout tracks them
//   claims    a STRUCTURED hint (a host whose memory already holds claims)
//             becomes SESSION claims: source host-memory, layer session,
//             observed at most, cited as `host:<provider>#<hint>`, confidence
//             possible. They answer this invocation's questions and are never
//             written anywhere -- so a hint cannot become truth by being
//             recalled twice, and current source outranks it whenever the two
//             disagree (src/knowledge/vocab.mjs AUTHORITY)
//
// `targets` is what makes discovery TARGETED: the known concepts a hint's
// words point at, and the tracked scopes worth confirming against source.
import { dirname } from "node:path/posix";
import { short } from "../hash.mjs";
import { quote } from "../quote.mjs";
import { scrub } from "../scrub.mjs";
import { tokens } from "../tokens.mjs";
import { CLAIM_VERSION, canonical, claimFindings, claimId, isObject } from "./model.mjs";

export const MAX_HINTS = 16;
export const MAX_HINT_CLAIMS = 8;
export const MAX_TARGETS = 8;
export const TITLE_LIMIT = 80;

export const NO_HOST_MEMORY = { id: "none", doc: "no host memory is bound for this invocation", recall: () => ({ hints: [], unknowns: [] }) };

// A provider nobody could call is a composition bug, said as one unknown --
// never a crash in somebody's project context.
export const providerProblems = (p) => [...(isObject(p) && /^[a-z][a-z0-9-]*$/.test(String(p.id)) ? [] : ["a host-memory provider needs a slug id"]), ...(typeof p?.recall === "function" ? [] : [`${p?.id ?? "a provider"} has no recall()`])];

export function recalled(providers, ask, world = {}) {
  const answers = providers.map((p) => (providerProblems(p).length ? { hints: [], unknowns: providerProblems(p) } : guarded(p, ask, world)));
  const hints = answers.flatMap((a) => a.hints).slice(0, MAX_HINTS);
  return { hints, claims: hints.flatMap((h) => h.claims), unknowns: answers.flatMap((a) => a.unknowns) };
}

function guarded(provider, ask, world) {
  try { return normalised(provider, provider.recall({ tokens: ask.tokens ?? [], context: ask.context ?? {}, limit: MAX_HINTS }), ask, world); }
  catch (e) { return { hints: [], unknowns: [`${provider.id}: its memory could not be read — ${quote(scrub(String(e?.message ?? e)), 120)}`] }; }
}

function normalised(provider, answer, ask, world) {
  const hints = (Array.isArray(answer?.hints) ? answer.hints : []).map((h) => hintOf(provider, h, world)).filter((h) => h && related(h, ask));
  return { hints, unknowns: (Array.isArray(answer?.unknowns) ? answer.unknowns : []).map((u) => quote(scrub(String(u)), 160)) };
}

function hintOf(provider, raw, world) {
  if (!isObject(raw) || raw.id === undefined) return null;
  const id = `${provider.id}#${short(String(raw.id), 12)}`;
  return { id, provider: provider.id, title: quote(scrub(String(raw.title ?? "")), TITLE_LIMIT), tokens: tokens(scrub(`${raw.title ?? ""} ${raw.text ?? ""}`)), paths: tracked(raw.paths, world), claims: claimsOf(raw.claims, id) };
}

// A hint is worth anything only when it speaks to what was asked: a word in
// common, or a claim about a concept the task names.
const related = (hint, ask) => hint.tokens.some((t) => (ask.tokens ?? []).includes(t)) || hint.claims.some((c) => (ask.subjects ?? []).includes(c.subject));

const tracked = (paths, world) => (Array.isArray(paths) ? paths : []).filter((p) => typeof p === "string" && Boolean(world.tracked?.has(p))).slice(0, MAX_TARGETS);

const claimsOf = (list, hintId) => (Array.isArray(list) ? list : []).slice(0, MAX_HINT_CLAIMS).map((c) => sessionClaim(c, hintId)).filter(Boolean);

function sessionClaim(raw, hintId) {
  const claim = { v: CLAIM_VERSION, subject: raw?.subject, relation: raw?.relation, object: raw?.object, context: canonical(raw?.context), source: "host-memory", strength: raw?.strength === "suggested" ? "suggested" : "observed", layer: "session", evidence: [`host:${hintId}`], confidence: "possible", status: "unknown", because: "a host's memory says so — never checked against the code", unknowns: ["whether current source agrees — a hint is context, never evidence"] };
  const withId = { ...claim, id: claimId(claim) };
  return claimFindings(withId, "hint").length ? null : withId;
}

// Which KNOWN concepts a hint's words point at -- every token of the concept's
// id among a hint's tokens -- and which tracked scopes to confirm. Steering,
// never asserting: nothing here makes a claim.
export function targets(hints, claims) {
  const words = new Set(hints.flatMap((h) => h.tokens));
  const concepts = [...new Set(claims.flatMap((c) => [c.subject, c.object]))].filter((id) => tokens(id).length > 0 && tokens(id).every((t) => words.has(t)));
  return { subjects: concepts.slice(0, MAX_TARGETS), scopes: [...new Set(hints.flatMap((h) => h.paths.map(scopeOf)))].slice(0, MAX_TARGETS) };
}

const scopeOf = (path) => (dirname(path) === "." ? path : dirname(path));
