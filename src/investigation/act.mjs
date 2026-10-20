// ONE action, inside an observation boundary, and everything each layer said
// about it.
//
//   1. gate        src/investigation/gates.mjs, with the control and the browser's
//                  host -- nothing reaches the browser before every row holds
//   2. mark        the request log's highest number, the page's URL, the
//                  console's count -- taken BEFORE, never after (src/run/watermark.mjs)
//   3. act         goto, click or fill, by the map's own selector
//   4. settle      poll until the log is QUIET: nothing newer than the mark still
//                  in flight, and the same count on consecutive reads. An
//                  observable state, never a fixed delay; the budget is
//                  settings limits.pollSeconds and running out is recorded, not
//                  hidden
//   5. read        every request past the mark (at most limits.requestsPerAction),
//                  each with its detail and -- for a write, when permitted -- a
//                  fingerprint of its body; the console's new errors; the URL
//   6. keep        one action record and one observation per layer, each with a
//                  STATE (src/investigation/vocab.mjs), plus a screenshot
//
// Actions against one browser session run one at a time: a lock per session
// in the store, held for as long as an action can take, and gated again once
// it is held. The journal has a lock of its own, taken only around read → next
// id → append, never around the browser.
// Raw values never outlive this file: a request is kept only as
// src/network/observe.mjs's view of it, console text only scrubbed.
import { join } from "node:path";
import { Blocked, Refused } from "../errors.mjs";
import { short } from "../hash.mjs";
import { highestRequest } from "../browser/index.mjs";
import { contained } from "../project/boundary.mjs";
import { pollUntil } from "../run/poll.mjs";
import { scrub } from "../scrub.mjs";
import { withLock } from "../store/lock.mjs";
import { canonicalUrl } from "../network/canonical.mjs";
import { NEVER_OBSERVED, observedRequest, writes } from "../network/observe.mjs";
import { gate } from "./gates.mjs";
import { modelOf, nextId } from "./model.mjs";
import { controlOf } from "./surfaces.mjs";

// w: { ctx (browser, graph, now), store, id, settings, environment, mode, on, io, identity }
// spec: { kind: goto|click|fill, url?, on?, value?, reproduces?, identity? }
export function act(w, spec) {
  const control = controlFor(w, spec);
  const target = spec.kind === "goto" ? targetOf(w, spec) : null;
  gate(worldOf(w, current(w), spec, control, w.ctx.browser.state()));
  return driving(w, () => performed(w, { ...spec, target }, control));
}

export const current = (w) => modelOf(w.store.read(w.id));

export function worldOf(w, model, spec, control, host) {
  return { on: w.on, settings: w.settings, environment: w.environment, mode: w.mode, model, acting: true, identity: spec.identity ?? w.identity ?? null, host, edge: control, now: w.now ?? w.ctx.now, runtime: w.runtime ?? null };
}

// One driver per browser session. The lock is held for as long as an action
// may take -- the settle budget plus one read per request, and a margin -- and
// holder and waiter derive that from the same limits, so nobody breaks a lock
// whose holder is still settling (src/store/lock.mjs judges staleness by it).
export function driving(w, fn) {
  const session = join(w.store.paths.sessions, short(w.ctx.browser.dir?.() ?? "default", 16));
  w.io.ensureDir(session);
  return withLock(session, fn, { ...w.io, staleMs: holdMs(w.settings.limits) }, DRIVING);
}

export const holdMs = (limits) => (limits.pollSeconds + limits.requestsPerAction + 60) * 1000;

// One writer per journal, around read → next id → append and NOTHING longer:
// a lock held through a settle would outlive the lock's own idea of stale.
export const withJournal = (w, fn) => withLock(w.store.dirOf(w.id), fn, w.io, WRITING);

const DRIVING = "another action is driving this browser session — autonomous QA drives one browser one action at a time; retry once it has finished";
const WRITING = "another command is writing this investigation's journal — retry in a moment";

function controlFor(w, spec) {
  if (spec.kind === "goto") return null;
  const edge = w.ctx.graph.edgeOn.get(spec.on);
  if (!edge) throw new Refused(`${spec.on} is not a control the map records — an investigation touches only what the map names (orbit-ui-map)`);
  return usableControl(controlOf(w.ctx.graph, edge));
}

function usableControl(control) {
  if (!control.selector) throw new Refused(`${control.key} has no usable selector in the map — orbit-ui-map records one; a selector is never guessed`);
  return control;
}

// A goto goes only to the approved environment's own origin.
function targetOf(w, spec) {
  const url = new URL(spec.url, w.environment?.origin ?? "http://invalid.invalid");
  if (w.environment && url.origin !== new URL(w.environment.origin).origin) throw new Refused(`${url.origin} is not the approved environment's origin (${w.environment.origin})`);
  return url.href;
}

// Gated AGAIN once the browser is ours: a cancel, a spent budget or a deadline
// that landed while this action waited for the session stops it here.
function performed(w, spec, control) {
  gate(worldOf(w, current(w), spec, control, w.ctx.browser.state()));
  const before = markOf(w);
  const done = attempt(w, spec, control);
  const seen = done.state === "done" ? witnessed(w, current(w), before) : null;
  return withJournal(w, () => recorded(w, current(w), { spec, control, before, done, seen }));
}

// What every layer said, read from the browser BEFORE the journal is locked:
// the reads are the slow part, the append is not.
function witnessed(w, model, before) {
  const after = afterOf(w, before);
  return { after, observations: observe(w, model, { before, after }) };
}

function markOf(w) {
  const b = w.ctx.browser;
  return { mark: highestRequest(b.requestList()), url: urlView(b.ev("location.href")), console: b.consoleTotals?.() ?? null };
}

// No query VALUES in a kept URL -- canonical, as the network layer keeps them.
const urlView = (u) => (typeof u === "string" && canonicalUrl(u) ? `${new URL(u).host}${canonicalUrl(u).template}` : null);

const PERFORM = {
  goto: (w, spec) => w.ctx.browser.goto(spec.target),
  click: (w, spec, control) => w.ctx.browser.click(control.selector),
  fill: (w, spec, control) => w.ctx.browser.fill(control.selector, synthetic(spec.value)),
};

// explore-write types SYNTHETIC values only: a TC- prefix a person can find
// and remove, never a value somebody's real data could collide with.
function synthetic(value) {
  if (!/^TC-[A-Za-z0-9-]{1,60}$/.test(String(value ?? ""))) throw new Refused(`an investigation types synthetic TC- values only, not ${JSON.stringify(String(value ?? "").slice(0, 20))}`);
  return value;
}

function attempt(w, spec, control) {
  const t0 = w.ctx.now();
  try { PERFORM[spec.kind](w, spec, control); return { state: "done", why: null, ms: w.ctx.now() - t0 }; }
  catch (e) { return failed(e, w.ctx.now() - t0); }
}

function failed(e, ms) {
  if (e instanceof Refused) throw e;
  const state = e instanceof Blocked ? "blocked" : "failed";
  return { state, why: scrub(String(e?.stderr || e?.message || e)).split("\n")[0].slice(0, 240), ms };
}

function afterOf(w, before) {
  const quiet = settled(w, before.mark);
  const b = w.ctx.browser;
  return { ...quiet, url: urlView(b.ev("location.href")), console: b.consoleTotals?.() ?? null };
}

// Quiet = every request past the mark has an answer (or failed), and the count
// held across two more reads. `pace` spaces the reads on a real browser; the
// round trip already does on a fake one.
function settled(w, mark) {
  const seen = { last: -1, steady: 0 };
  const budget = { tries: 120, timeoutSec: w.settings.limits.pollSeconds };
  const quiet = pollUntil(w.ctx, budget, (i) => quietNow(w, mark, seen, i));
  return quiet ?? { requests: newer(w, mark), settled: false };
}

function quietNow(w, mark, seen, i) {
  if (i > 1) w.io.sleep?.(w.pace ?? 0);
  const now = newer(w, mark);
  seen.steady = now.length === seen.last && now.every((r) => r.status !== null || r.failed) ? seen.steady + 1 : 0;
  seen.last = now.length;
  return seen.steady >= 2 ? { requests: now, settled: true } : null;
}

const newer = (w, mark) => w.ctx.browser.requestList().filter((r) => r.n > mark);

// Under the journal lock, over a model read under it: the ids are the journal's.
function recorded(w, model, a) {
  const id = nextId(model, "action");
  const action = actionRecord(w, id, a);
  w.store.append(w.id, "action", action);
  appendObservations(w, model, id, a.seen?.observations ?? []);
  return { action, observations: a.seen?.observations ?? [] };
}

const appendObservations = (w, model, id, observations) => observations.forEach((o, i) => w.store.append(w.id, "observation", { ...o, id: `obs-${model.observations.length + i + 1}`, action: id }));

function actionRecord(w, id, a) {
  const after = a.seen?.after ?? null;
  return { id, do: a.spec.kind, on: a.control?.key ?? null, surface: a.control?.from ?? a.spec.surface ?? null, target: a.spec.target ? pathOnly(a.spec.target) : undefined, identity: a.spec.identity ?? w.identity ?? null, reproduces: a.spec.reproduces ?? null, boundary: { mark: a.before.mark, last: after ? highestRequest(after.requests) : null, settled: after?.settled ?? null }, url: { before: a.before.url, after: after?.url ?? null }, synthetic: a.spec.kind === "fill" ? { [a.control.key]: a.spec.value } : undefined, state: a.done.state, why: a.done.why, ms: a.done.ms, screenshot: after ? shot(w, id) : null };
}

// A goto's target as the path it went to: what a reproduction replays. It came
// from the map or the tenancy contract, never from the page.
const pathOnly = (href) => `${new URL(href).pathname}${new URL(href).search}`;

function shot(w, id) {
  const file = contained(w.store.evidenceDir(w.id), join(w.store.evidenceDir(w.id), `${id}.png`));
  try { w.ctx.browser.screenshot(file); return `evidence/${id}.png`; }
  catch { return null; }
}

function observe(w, model, a) {
  return [uiLayer(a), consoleLayer(w, a), networkLayer(w, model, a)];
}

const uiLayer = (a) => ({ layer: "ui", state: "observed", data: { before: a.before.url, after: a.after.url, navigated: a.before.url !== a.after.url } });

function consoleLayer(w, a) {
  if (!a.before.console || !a.after.console) return { layer: "console", state: "unavailable", why: "the browser adapter reports no console totals" };
  const added = Math.max(a.after.console.errors - a.before.console.errors, 0);
  const messages = added ? (w.ctx.browser.consoleErrors?.() ?? []).slice(-added).map((m) => scrub(m).slice(0, 200)) : [];
  return { layer: "console", state: added ? "observed" : "empty", data: { errors: added, messages } };
}

function networkLayer(w, model, a) {
  const limit = w.settings.limits.requestsPerAction;
  const requests = a.after.requests.slice(0, limit).map((r) => detailed(w, model, r));
  const detail = detailState(w, requests);
  return { layer: "network", state: requests.length ? "observed" : "empty", why: a.after.settled ? null : `still busy after ${w.settings.limits.pollSeconds}s — what arrived later is not in this window`, data: { requests, truncated: Math.max(a.after.requests.length - limit, 0), settled: a.after.settled, detail, neverObserved: NEVER_OBSERVED } };
}

function detailed(w, model, r) {
  const b = w.ctx.browser;
  const detail = w.settings.network.details && b.requestDetail ? b.requestDetail(r.n) : null;
  const body = writes(r.method) && w.settings.network.fingerprints && detail && b.requestBody ? b.requestBody(r.n) : undefined;
  return observedRequest(r, detail, body, { salt: model.meta.salt, fingerprints: w.settings.network.fingerprints, ...w.settings.network });
}

function detailState(w, requests) {
  if (!w.settings.network.details) return "off";
  if (!w.ctx.browser.requestDetail) return "unavailable";
  const with_ = requests.filter((r) => !r.missing.includes("detail")).length;
  return with_ === requests.length ? "full" : with_ ? "partial" : "unavailable";
}
