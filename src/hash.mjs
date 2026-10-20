// One hash, for everything in this engine that needs one.
//
// A leaf with no imports, because two branches need it and neither may import
// the other -- the same reason src/constraints.mjs and src/scrub.mjs sit here.
// It used to live in src/learn/fingerprint.mjs, which is fine while lessons are
// the only caller and wrong the moment a second one appears: that file also
// knows what a LESSON's identity is, and it reaches into src/memory/note.mjs for
// the slug rule. Anything below src/learn/ importing it would point back up into
// a branch, which is how a dependency direction stops being a direction.
//
// So the hash is here and the lesson identity stays there. The split is by what
// the code KNOWS, not by who happened to need it first.
import { createHash } from "node:crypto";

export const sha = (text) => createHash("sha256").update(String(text)).digest("hex");

// The same hash over BYTES as they are, never through a text decoding: two files that differ only in bytes no
// encoding can show would otherwise share a digest, and a copy checked by its digest would pass a wrong copy.
export const shaBytes = (bytes) => createHash("sha256").update(bytes ?? Buffer.alloc(0)).digest("hex");

// Eight characters is a directory name somebody has to be able to read in a
// path, and a collision between two projects on one laptop is a store that
// merges two products -- so it is short for the eye, never for the guarantee.
export const short = (text, n = 8) => sha(text).slice(0, n);

// A value written the one way two readers must agree on: keys sorted at every
// depth, so {a, b} and {b, a} are one document. What a revision, a fingerprint
// and a proposal's digest are taken over. It lives beside `sha` because three
// subsystems each wrote it out by hand, and a revision that two of them
// computed differently would be a settings page refusing its own writer.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
