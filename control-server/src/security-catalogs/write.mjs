// Security catalogs in Orbit Control, CHANGED BY A PERSON (ADR 0040) -- the only place they are:
//
//   preview   a document a person pasted, a file they chose, or the https link they typed (fetched
//             here, on their action): its digest, its control count and what differs from the one
//             this machine already holds. Writes nothing
//   adopt     the document they PREVIEWED -- the digest the page shows must be the digest adopted, so
//             a link whose content moved since is refused, never adopted unseen
//   editor    a catalog they wrote, validated against the contract, kept as a new revision
//   enabled   which catalogs this project is held to, each pinned by digest, filtered by level or group
//   marks     a control marked not applicable here, with the reason, or the mark taken back
//
// Every change names the revision the page read (a stale one is a 409), and goes through the engine's
// own writers with Control's door -- the only door they open for.
import { STALE_REVISION, adoptCatalog, catalogDigest, enableCatalogs, markControl, parsedCatalog, previewOf } from "../core.mjs";
import { conflict, guarded, invalid } from "../errors.mjs";
import { fetchCatalog } from "./fetch.mjs";
import { securityWorld, stateHere } from "./project.mjs";

const writerOf = (ctx, body) => ({ door: "control", revision: body?.revision ?? null, at: ctx.now().toISOString() });

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// Where the document comes from, in the page's words: a parsed object, a file's text, or a link.
const SOURCES = [
  { when: (b) => isObject(b.document), read: async (ctx, b) => ({ doc: b.document, source: { kind: "editor" } }) },
  { when: (b) => typeof b.text === "string", read: async (ctx, b) => ({ doc: parsedCatalog(b.text), source: { kind: "file", ...(typeof b.name === "string" ? { name: b.name.slice(0, 120) } : {}) } }) },
  { when: (b) => typeof b.url === "string", read: async (ctx, b) => ({ doc: await fetchCatalog(ctx, b.url), source: { kind: "url", url: new URL(b.url).href } }) },
];

async function documentOf(ctx, body) {
  const row = isObject(body) ? SOURCES.find((s) => s.when(body)) : null;
  if (!row) throw invalid("SECURITY_BODY_INVALID", "send { document }, { text, name } or { url }");
  return row.read(ctx, body);
}

export const previewSecurityCatalog = (ctx, body) => guarded("SECURITY_CATALOG_INVALID", async () => previewed(ctx, await documentOf(ctx, body)));

const previewed = (ctx, got) => ({ preview: previewOf(got.doc, stateHere(securityWorld(ctx)).layers), source: got.source });

export const adoptSecurityCatalog = (ctx, body) => guarded("SECURITY_CATALOG_INVALID", async () => adopted(ctx, body, await documentOf(ctx, body)));

function adopted(ctx, body, got) {
  if (got.source.kind !== "editor" && body.digest !== catalogDigest(got.doc)) throw conflict("SECURITY_PREVIEW_STALE", "this catalog is not the one you previewed — preview it again, then adopt what you saw");
  const w = securityWorld(ctx);
  return { adopted: written(() => adoptCatalog(w.machineIo, w.rooms, stateHere(w).layers, got, writerOf(ctx, body))) };
}

export const saveSecurityCatalog = (ctx, body) => guarded("SECURITY_CATALOG_INVALID", async () => adopted(ctx, body, { doc: isObject(body?.document) ? body.document : null, source: { kind: "editor" } }));

export const putSecurityEnabled = (ctx, body) => guarded("SECURITY_CATALOG_INVALID", () => projectChange(ctx, (w) => enableCatalogs(w.projectIo, w.rooms, stateHere(w).layers, { enabled: body?.enabled }, writerOf(ctx, body))));

export const putSecurityMark = (ctx, body) => guarded("SECURITY_CATALOG_INVALID", () => projectChange(ctx, (w) => markControl(w.projectIo, w.rooms, stateHere(w).layers, { catalog: body?.catalog, control: body?.control, why: body?.why, clear: body?.clear === true }, writerOf(ctx, body))));

function projectChange(ctx, change) {
  const w = securityWorld(ctx);
  if (!w.projectIo) throw conflict("NOT_IN_CHECKOUT", "Start Orbit Control from the project's checkout: which catalogs a project follows is that project's.");
  return { saved: written(() => change(w)) };
}

function written(fn) {
  try { return fn(); }
  catch (e) { throw e?.code === STALE_REVISION ? conflict(STALE_REVISION, "These security settings were changed since you opened them. Reload, then make your change again.") : e; }
}
