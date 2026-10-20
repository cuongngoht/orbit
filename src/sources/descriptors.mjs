// What the ENGINE may read off a provider descriptor -- and only that.
//
// A descriptor is data a pack ships (skills/orbit-requirements/providers.json): the
// engine never names a provider, but it can read a row: which id it has, which
// connection provider it goes with, which catalog server would read for it, what a
// bare id looks like, and whether a link names a project. Those few answers are what
// lets the discovery ladder turn "88" into "an item in THIS system" without a word
// about any system in the code that does it.
import { ITEM_ID } from "./fields.mjs";

export const descriptorFor = (descriptors, provider) => (descriptors ?? []).find((d) => d.id === provider) ?? null;

// A bare id as a descriptor spells one (`#88`, `4312`). With no descriptor -- a
// binding for a system this pack does not know -- an id is what an item id may be.
const ANY_ID = new RegExp(`^#?(?<id>${ITEM_ID.slice(1, -1)})$`);

export function bareIdOf(descriptor, ref) {
  const text = String(ref ?? "").trim();
  const pattern = descriptor?.match?.bareId ? new RegExp(descriptor.match.bareId) : ANY_ID;
  return pattern.exec(text)?.groups?.id ?? null;
}

// A system whose every link names a project needs one to be found: read from the
// descriptor's own patterns, not asked of anybody.
export const requiresProject = (descriptor) => (descriptor?.match?.urls ?? []).length > 0 && descriptor.match.urls.every((u) => String(u).includes("(?<project>"));

// Which SYSTEM a registry resource reads for, by what it declared: a reader or an
// adapter names the connection provider it goes through, and a managed server the
// catalog row it came from. A resource that says neither is unscoped -- it reads
// for nobody in particular, and is never guessed to read for somebody.
export function systemOf(resource, descriptors) {
  const connection = resource?.detail?.connection ?? null;
  if (connection) return (descriptors ?? []).find((d) => d.connection === connection)?.id ?? connection;
  const catalog = resource?.detail?.catalog ?? null;
  return catalog ? (descriptors ?? []).find((d) => d.mcp?.catalog === catalog)?.id ?? null : null;
}

// May this resource read items of `provider`? An unscoped one may (it named no
// system, so it excludes none); one that names a system may only read that one.
export function serves(resource, provider, descriptors) {
  const system = systemOf(resource, descriptors);
  return system === null || system === provider;
}
