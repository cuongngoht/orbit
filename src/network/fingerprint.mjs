// A value reduced to something two requests can be COMPARED by and nobody can
// read: a salted hash of its canonical form. The salt is the investigation's
// own, so a fingerprint means something inside one investigation and nothing
// outside it -- two investigations cannot be joined on a payload, and a stored
// fingerprint is not a lookup table for the value it came from.
//
// The value itself is never returned, logged or kept. A payload is read only
// long enough to be fingerprinted, and only when the project's settings permit
// it (src/investigation/settings.mjs `network.fingerprints`).
import { canonicalJson, sha } from "../hash.mjs";

export const FINGERPRINT_LENGTH = 16;

export const fingerprint = (value, salt) => sha(`${salt}\u0000${canonical(value)}`).slice(0, FINGERPRINT_LENGTH);

// Keys sorted, so {a,b} and {b,a} are one payload. The one definition is in
// src/hash.mjs; this name stays because the investigation reads it from here.
export const canonical = canonicalJson;

// -> { fp, form } where form says what was compared: "json" (fields named in
// `ignore` dropped at any depth -- a timestamp or a nonce the client stamps on
// every attempt), "text", or "empty". null body is "empty": two POSTs that
// carry nothing carry the same thing.
export function payloadFingerprint(body, { salt, ignore = [] }) {
  if (body === null || body === undefined || body === "") return { fp: fingerprint("", salt), form: "empty" };
  const json = jsonOf(body);
  if (json === undefined) return { fp: fingerprint(String(body), salt), form: "text" };
  return { fp: fingerprint(without(json, new Set(ignore.map((k) => k.toLowerCase()))), salt), form: "json" };
}

function jsonOf(text) {
  try { return JSON.parse(text); }
  catch { return undefined; }
}

function without(value, ignore) {
  if (Array.isArray(value)) return value.map((v) => without(v, ignore));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !ignore.has(k.toLowerCase())).map(([k, v]) => [k, without(v, ignore)]));
}
