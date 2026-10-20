// The places an answer says it came from -- and nothing else about the answer.
//
// A receipt has to say what its result rested on without keeping the result. So it keeps the
// URLs the answer itself named, in the fields a provider names them in (`url`, `href`,
// `source`, `ref`, `link`), reduced to where they point: no credentials, no query, no
// fragment. A tool that answers in text content that is itself JSON is read one level in.
// Bounded three ways -- how many nodes are visited, how deep, how many references are kept --
// so an answer built to be enormous costs a bounded walk.
//
// A reference is what lets a claim say "this was read from there". No reference, no claim
// that it was observed (src/work/memory.mjs).
import { scrub } from "../scrub.mjs";

export const MAX_REFS = 16;
export const MAX_NODES = 2000;
export const MAX_DEPTH = 8;
export const PARSE_LIMIT = 256 * 1024;
export const REF_KEYS = new Set(["url", "href", "source", "ref", "link"]);

// Where a link points, and only that: an http(s) URL as origin and path.
export function cleanUrl(text) {
  try {
    const url = new URL(String(text));
    return /^https?:$/.test(url.protocol) ? scrub(`${url.origin}${url.pathname}`).slice(0, 200) : null;
  } catch {
    return null;
  }
}

function embedded(text) {
  if (text.length > PARSE_LIMIT || !/^\s*[[{]/.test(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// A node's fields, and the JSON its text carries if it is a text content item.
function children(node) {
  const inner = node.type === "text" && typeof node.text === "string" ? embedded(node.text) : null;
  return [...Object.entries(node), ...(inner ? [["", inner]] : [])];
}

function visit(node, depth, out) {
  if (out.budget-- <= 0 || depth > MAX_DEPTH || node === null || typeof node !== "object") return;
  for (const [key, value] of children(node)) {
    if (REF_KEYS.has(key.toLowerCase()) && typeof value === "string") out.found.push(value);
    visit(value, depth + 1, out);
  }
}

export function refsIn(value) {
  const out = { budget: MAX_NODES, found: [] };
  visit(value, 0, out);
  return [...new Set(out.found.map(cleanUrl).filter(Boolean))].slice(0, MAX_REFS);
}
