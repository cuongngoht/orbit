// What both provider readers share: which connection a read goes through, what authorizes
// its requests, one client that cannot leave its origin, and the mapping from what a source
// did to what a caller is told.
//
// What authorizes a request is a RequestAuth (src/connections/auth.mjs): resolved from the
// connection's record, LAZY -- a header is asked for at every request, never kept here -- and
// the same one for every read of a connection for as long as a reader lives, so a token is
// asked for once and not once per read. Neither a token nor a credential is ever returned by
// anything here or appears in what a reader returns: it goes into one header, and the answer
// is scanned for every token the RequestAuth issued before it leaves (a source that echoes a
// token back is a leak, and BLOCKED).
import { Blocked, Refused } from "../../../src/errors.mjs";
import { short } from "../../../src/hash.mjs";
import { maskValues } from "../../../src/scrub.mjs";
import { HttpStop, authorizedHttp, refused } from "../../orbit-report/sources/http.mjs";

export const PACK = "orbit-requirements";

export const readerKey = (d) => `pack:${PACK}/${d.id}`;

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// The connections of THIS provider that can be used at all, from the public view: a credential
// connection needs its reference, one that signs in needs nothing until it is read. Pure -- the
// view already says (`configured`), so asking starts nothing and reads no credential.
export const configured = (d, connections) => connections.list().filter((c) => c.provider === d.connection && c.configured);

// The one for this item's organization -- a connection reaches the owner it was made
// for, and trying another owner with it would only teach a person the wrong lesson.
export function connectionFor(d, identity, connections) {
  const mine = configured(d, connections);
  const found = mine.find((c) => same(c.organization, identity.organization));
  if (found) return found;
  throw new Blocked(mine.length ? `no ${d.label} connection is set up for ${identity.organization} — the ones here are for ${mine.map((c) => c.organization).join(", ")}; add one in Orbit Control (Connections)` : `no ${d.label} connection is set up here — add one in Orbit Control (Connections); a person signs in, or enters a credential, once`);
}

// The RequestAuth of a connection, made once per reader: `resolve` reads nothing (the first
// request does), from the RECORD the connection holds -- never from its public view.
// deps: { auth (createAuth), connections, interactive?, notify? }
export function authsOf(deps) {
  const kept = new Map();
  const made = (c) => deps.auth.resolve(deps.connections.record(c.id), { interactive: deps.interactive ?? "when-required", notify: deps.notify });
  return (connection) => (kept.has(connection.id) ? kept.get(connection.id) : kept.set(connection.id, made(connection)).get(connection.id));
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The client of one read: its own headers, and the authorization the RequestAuth answers with. A source that
// holds itself to more (only reading) hands in the client that does.
export const httpFor = (deps, origin, auth, headers = {}, client = authorizedHttp) => client({ fetch: deps.fetch, origin, auth, headers: { "user-agent": "orbit-requirements", ...headers }, sleep: deps.sleep ?? sleepMs, nowMs: deps.nowMs, limits: deps.limits });

// What a source did, as what the caller is told. An item that is not there, or not
// visible to this connection, is the REQUEST's fault; a source that did not accept who was
// asking is the RequestAuth's to word (a code, and what to do next, BLOCKED); one that kept
// failing, could not be reached or asked for another host is the MACHINE's -- and none of it
// says a word about the work item.
export async function guarded(auth, fn) {
  try { return await fn(); }
  catch (e) { throw e instanceof HttpStop ? await typed(auth, e) : e; }
}

const STOPS = { "not-found": (a, e) => new Refused(e.message), auth: refused, forbidden: refused };

const typed = (auth, e) => (STOPS[e.kind] ?? ((a, stop) => new Blocked(stop.message)))(auth, e);

// A source that echoes a token back is not answered, however it did it: `secrets` is every
// token the RequestAuth ever issued.
export function leakFree(item, secrets) {
  const text = JSON.stringify(item);
  if (maskValues(text, secrets) !== text) throw new Blocked("the source's answer contained the credential, so it was withheld");
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
