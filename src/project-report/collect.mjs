// COLLECTING one run: the project's source, read once with full pagination by
// the standard collector for its provider; the planning documents as they were
// at the cut-off; then any local collector a project added -- and all of it
// assembled into the snapshot that is frozen before anything computes.
//
// What authorizes the source's requests is the connection's AUTH (src/connections/auth.mjs): a
// RequestAuth, resolved here and handed to the source adapter -- code in this process -- and to
// nothing else. It is LAZY: nothing is read or started until the adapter's first request asks
// for its header, and it is asked again for every request, so a token that was good when a long
// run began is replaced before it is spent. A secret is only ever an answer: no part receives it,
// the snapshot and every raw page are scanned for every token the RequestAuth ISSUED (read after
// the collection, so a token replaced halfway is covered) before anything is written, and none is
// kept once the collector returns.
//
// A source adapter (bound by the composition root, one per provider) answers
//   collect({ connection, scope, window, auth, fetch, nowMs, log })
//     -> { source: { provider, host, organization, scope }, completeness,
//          collections, raw: [page…], earliest }
// and throws Refused (the request was wrong) or Blocked (the source could not answer, or did not
// accept who was asking: an AuthBlocked). What it could not read is a completeness status, never
// an empty list.
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { sha } from "../hash.mjs";
import { compose } from "./compose.mjs";
import { computeParts } from "./compute.mjs";
import { prepareDocs } from "./documents.mjs";
import { SNAPSHOT_CONTRACT } from "./snapshot.mjs";
import { calendarOf } from "./window.mjs";

// ctx: { project, room, io, settings, connection (the RECORD), runId, window, parts, facts, python, env, root, interactive?, notify? }
// deps: { sources, auth (createAuth), interactive?, notify?, fetch, process, shim, nowMs, log }
export async function collect(ctx, deps) {
  const began = new Date(deps.nowMs()).toISOString();
  const auth = authOf(ctx, deps);
  const read = await fromSource(ctx, deps, auth);
  const local = await localCollections(ctx, deps, read);
  return { snapshot: snapshotOf(ctx, read, local, began, deps), raw: read.raw ?? [], secrets: auth.secrets() };
}

// What a person may be asked to do while a run goes on -- sign in again -- is the composition root's to allow (`interactive`)
// and to show (`notify`), on its deps or its ctx; a run that nobody said anything about may ask.
function authOf(ctx, deps) {
  if (!ctx.connection) throw new Refused("this project's report settings name no connection; choose one in Orbit Control → PO Reports → Connection");
  return deps.auth.resolve(ctx.connection, { interactive: deps.interactive ?? ctx.interactive ?? "when-required", notify: deps.notify ?? ctx.notify });
}

function fromSource(ctx, deps, auth) {
  const source = deps.sources[ctx.settings.provider];
  if (!source) throw new Refused(`no collector reads ${ctx.settings.provider}`);
  return source.collect({ connection: ctx.connection, scope: ctx.settings.scope ?? {}, window: ctx.window, auth, fetch: deps.fetch, nowMs: deps.nowMs, log: deps.log });
}

// ---- local collectors: the documents tree, and a project's own -------------

async function localCollections(ctx, deps, read) {
  const calendar = calendarOf(ctx.window, read.earliest);
  const docs = ctx.settings.docs?.path ? prepared(ctx, deps) : null;
  const plan = compose(ctx.parts.filter((p) => p.kind === "collector" && p.runtime !== "node"), { ...ctx.facts, phases: ["collector"], base: docs?.ok ? ["report.docs"] : [] });
  const state = plan.run.length ? await computeParts(plan.run, unitOf(ctx, calendar, docs), { ...deps, python: ctx.python?.file, env: ctx.env, io: ctx.io, secrets: [] }) : { results: [] };
  return { calendar, docs, results: state.results, skipped: plan.skipped };
}

function prepared(ctx, deps) {
  const into = join(ctx.room.snapshot(ctx.runId), "docs");
  return prepareDocs({ root: ctx.root, path: ctx.settings.docs.path, cutoffUtc: ctx.window.cutoffUtc, into, io: ctx.io, process: deps.process });
}

const unitOf = (ctx, calendar, docs) => ({ runId: ctx.runId, snapshot: { window: ctx.window, calendar }, snapshotFile: null, dir: join(ctx.room.run(ctx.runId), "collect"), entryOf: ctx.entryOf, rootsOf: (p) => ((p.needs ?? []).includes("report.docs") && docs?.ok ? [join(ctx.room.snapshot(ctx.runId), "docs")] : []), settingsOf: (p) => ({ ...ctx.settingsOf(p), docsLabel: docs?.label ?? null, pointInTime: docs?.pointInTime ?? false, commit: docs?.commit ?? null }), kitChanged: ctx.kitChanged });

// ---- the snapshot --------------------------------------------------------------

function snapshotOf(ctx, read, local, began, deps) {
  const gathered = local.results.map(collectionOf).filter(Boolean);
  const source = { ...read.source, connection: ctx.connection.id, identity: identityOf(read.source) };
  return { contract: SNAPSHOT_CONTRACT, run: { id: ctx.runId, createdAt: began }, project: { name: ctx.project.name, key: ctx.project.key }, source, window: ctx.window, calendar: local.calendar, collectedAt: { started: began, finished: new Date(deps.nowMs()).toISOString() }, completeness: completenessOf(ctx, read, local, gathered), parts: partsOf(ctx, local), collections: { ...read.collections, ...Object.fromEntries(gathered.filter((g) => g.value !== undefined).map((g) => [g.name, g.value])) } };
}

// The source's own statuses, then the documents', then each local collector's;
// documents read as they are NOW keep that sentence even when parsed fine.
function completenessOf(ctx, read, local, gathered) {
  const states = { ...read.completeness, ...documentsState(ctx, local), ...Object.fromEntries(gathered.map((g) => [g.name, g.state])) };
  if (states.documents && local.docs?.reason) states.documents = { ...states.documents, reason: states.documents.reason ?? local.docs.reason, pointInTime: local.docs.pointInTime };
  return states;
}

// Same source, same scope -> same identity, however the scope was spelled.
export const identityOf = (source) => sha(canonical({ provider: source.provider, host: source.host, organization: source.organization ?? null, scope: source.scope ?? {} })).slice(0, 16);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

// A collector's outputs become collections: the kit's documents collector
// fills `documents`; a project's may add only names under its own id.
function collectionOf({ part, outcome }) {
  const [name, file] = Object.entries(outcome.files ?? {})[0] ?? [part.provides?.[0]?.replace(/^report\.collection\./, "") ?? part.id];
  if (part.source === "store" && !String(name).startsWith(`${part.from}.`)) return null;
  return { name, state: outcome.ok ? { status: "complete", reason: file ? null : "the collector wrote nothing" } : { status: "missing", reason: `the collector ${outcome.status === "unavailable" ? "had nothing to read" : "failed"}: ${outcome.error ?? (outcome.notes ?? []).join(" ")}` }, value: outcome.ok ? outcome.outputs[name] : undefined };
}

const DOCS_STATE = [
  { when: (ctx) => !ctx.settings.docs?.path, state: () => ({ status: "not-configured", reason: "no planning documents are set for this project" }) },
  { when: (ctx, local) => !local.docs?.ok, state: (ctx, local) => ({ status: "missing", reason: local.docs?.reason ?? "the documents could not be read" }) },
  { when: () => true, state: () => null },
];

function documentsState(ctx, local) {
  const state = DOCS_STATE.find((r) => r.when(ctx, local)).state(ctx, local);
  return state ? { documents: state } : {};
}

const partsOf = (ctx, local) => [{ id: `orbit.report.${ctx.settings.provider}`, version: ctx.parts.find((p) => p.provider === ctx.settings.provider)?.version ?? null, source: "builtin" }, ...local.results.map(({ part, outcome }) => ({ id: part.id, version: part.version, source: part.source, from: part.from, sha256: part.sha256 ?? null, status: outcome.ok ? "ok" : outcome.status }))];
