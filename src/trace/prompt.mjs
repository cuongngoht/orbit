// What the trail may say about a PROMPT and the router's decision on it -- and
// the line it will never cross: the prompt's text.
//
// A prompt is kept as a FINGERPRINT: an HMAC under a salt that never leaves this
// machine, cut to 12 hex, beside its length. That is enough to see that the same
// prompt was routed twice and took two paths, and it is not the prompt -- the
// salt makes a guessed sentence unverifiable anywhere else. No salt (a store
// that cannot be written) means no fingerprint at all, never an unsalted one.
//
// The DECISION is the router's own RouteDecision (src/routing/resolve.mjs),
// which is built from table words, requirement names and resource ids and never
// from the prompt -- so it can be kept whole-ish: the intent, the cues that
// matched (table words), each requirement node's level and status and provider,
// and what was selected, needed approval, was blocked or missing. Bounded.
import { createHmac, randomBytes } from "node:crypto";
import { withLock } from "../store/lock.mjs";
import { join } from "node:path";

export const MAX_NODES = 24;
export const MAX_LIST = 8;

export function promptFacts(prompt, salt) {
  const text = String(prompt ?? "").normalize("NFC").trim();
  return { chars: [...text].length, ...(salt ? { hash: createHmac("sha256", salt).update(text).digest("hex").slice(0, 12) } : {}) };
}

// The machine's salt, made once, the first time a prompt is fingerprinted.
// Anything that goes wrong answers null: the trail then keeps no fingerprint.
export function saltOf(io, dir) {
  try { return String(io.read(join(dir, "salt")) ?? "").trim() || lockedSalt(io, dir); }
  catch { return null; }
}

function made(io, file) {
  const salt = randomBytes(16).toString("hex");
  io.write(file, salt);
  return salt;
}

const entries = (list) => (list ?? []).slice(0, MAX_LIST).map((e) => ({ kind: e.kind, id: e.id, requirement: e.requirement }));

const nodeOf = (n) => ({ requirement: n.requirement, level: n.level, status: n.status, transitive: Boolean(n.transitive), provider: n.provider ? { kind: n.provider.kind, id: n.provider.id } : null });

export function decisionFacts(decision, injected) {
  if (!decision) return { routing: "off" };
  return { routing: "on", intent: decision.intent?.id ?? null, confidence: decision.intent?.confidence ?? null, cues: (decision.cues ?? []).slice(0, 12), requirements: (decision.requirements ?? []).slice(0, 12), graph: (decision.graph?.nodes ?? []).slice(0, MAX_NODES).map(nodeOf), selected: entries(decision.selected), approval: entries(decision.approval), blocked: entries(decision.blocked), missing: entries(decision.missing), injected: Boolean(injected) };
}

function lockedSalt(io, dir) {
  io.ensureDir(dir);
  return withLock(dir, () => String(io.read(join(dir, "salt")) ?? "").trim() || made(io, join(dir, "salt")), { ...io, backoff: [5, 10, 20] });
}
