// What both provider readers share: which connection a read goes through, the
// credential read at the moment it is used, one client that cannot leave its origin,
// and the mapping from what a source did to what a caller is told.
//
// The credential is never returned by anything here and never appears in what a
// reader returns: it goes into one header, and the answer is scanned for it before
// it leaves (a source that echoes a token back is a leak, and BLOCKED).
import { Blocked, Refused } from "../../../src/errors.mjs";
import { short } from "../../../src/hash.mjs";
import { maskValues } from "../../../src/scrub.mjs";
import { HttpStop, createHttp } from "../../orbit-report/sources/http.mjs";

export const PACK = "orbit-requirements";

export const readerKey = (d) => `pack:${PACK}/${d.id}`;

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// The connections of THIS provider that have a credential, from the public view
// (which says only whether one is set).
export const usable = (d, connections) => connections.list().filter((c) => c.provider === d.connection && c.credential?.set);

// The one for this item's organization -- a credential reaches the owner it was made
// for, and trying another owner with it would only teach a person the wrong lesson.
export function connectionFor(d, identity, connections) {
  const mine = usable(d, connections);
  const found = mine.find((c) => same(c.organization, identity.organization));
  if (found) return found;
  throw new Blocked(mine.length ? `no ${d.label} connection is set up for ${identity.organization} — the ones here are for ${mine.map((c) => c.organization).join(", ")}; add one in Orbit Control (Connections)` : `no ${d.label} connection with a credential is set up here — add one in Orbit Control (Connections); a person enters the credential once`);
}

// Read NOW, from the reference the connection holds (never from its public view),
// and handed to nothing but the request it is for.
export async function credentialOf(connection, connections, secrets) {
  const value = await secrets.read(connections.record(connection.id).credential);
  if (!value) throw new Blocked(`the credential of connection ${connection.id} is not set on this machine — a person sets it in Orbit Control (Connections)`);
  return value;
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const httpFor = (deps, origin, headers) => createHttp({ fetch: deps.fetch, origin, headers: { "user-agent": "orbit-requirements", ...headers }, sleep: deps.sleep ?? sleepMs, nowMs: deps.nowMs, limits: deps.limits });

// What a source did, as what the caller is told. An item that is not there, or not
// visible to this credential, is the REQUEST's fault; a source that refused the
// credential, kept failing, could not be reached or asked for another host is the
// MACHINE's -- and none of it says a word about the work item.
export async function guarded(fn) {
  try { return await fn(); }
  catch (e) { throw e instanceof HttpStop ? typed(e) : e; }
}

const typed = (e) => (e.kind === "not-found" ? new Refused(e.message) : new Blocked(e.message));

// A source that echoes the credential back is not answered, however it did it.
export function leakFree(item, credential) {
  const text = JSON.stringify(item);
  if (maskValues(text, [credential]) !== text) throw new Blocked("the source's answer contained the credential, so it was withheld");
  return item;
}

// Who said what, without who: a stable name for the same person within the answer.
export const pseudonym = (name) => `person-${short(String(name ?? ""), 6)}`;

const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&apos;": "'" };

// HTML as the plain text a person read: tags gone, block ends kept as line breaks.
export function htmlText(html) {
  return String(html ?? "")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const encoded = (v) => encodeURIComponent(String(v));

// An item that may simply not be there (no parent, no sub-issues): null when the
// source says not-found, and every other stop still stops.
export async function optional(api, path) {
  try { return (await api.http.request(`${api.base}${path}`)).json; }
  catch (e) { if (e instanceof HttpStop && e.kind === "not-found") return null; throw e; }
}
