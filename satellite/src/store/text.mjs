// Text that came from a host or an agent: one printable line, refused above the limit rather than cut (nothing is
// silently lost), and secret-shaped text masked on the way to the disk by the journal door (src/scrub.mjs).
import { printable } from "../../../src/printable.mjs";
import { scrub } from "../../../src/scrub.mjs";

export const TEXT_LIMIT = 240;

export const oneLine = (text) => printable(String(text ?? "")).replace(/\s+/g, " ").trim();

export const isSentence = (v, limit = TEXT_LIMIT) => typeof v === "string" && oneLine(v).length > 0 && v.length <= limit;

// What the ENGINE writes about itself, shortened to fit: never used on what a host sent, which is refused instead.
export const clip = (text, limit = TEXT_LIMIT) => ((t) => (t.length > limit ? `${t.slice(0, limit - 1)}…` : t) || undefined)(oneLine(text));

export const secretShaped = (v) => typeof v === "string" && scrub(v) !== v;

export const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

export const list = (v) => (Array.isArray(v) ? v : []);

export const unique = (items) => [...new Set(items)];

export const quietly = (fn) => {
  try { return fn(); }
  catch { return null; }
};

export const refused = (Refused, code, say) => Object.assign(new Refused(`${code}: ${say}`), { code });
