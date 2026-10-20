// A Browser port that never spawns anything. `answers` maps a JS expression (or
// a regex) to what the page would return; `calls` records every action, and
// `times[i]` is when calls[i] happened on the fake clock.
//
// Requests are a TIMELINE, not a fixed string: what the log holds depends on
// WHEN you look. That is what makes the watermark testable at all -- a request
// that already existed before a click must not satisfy a step asking about the
// click -- and a fixed string cannot express it.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseRequests, summarize } from "../../src/browser/index.mjs";
import { fakeClock } from "./clock.mjs";

// Every method that would be a playwright-cli round trip moves the clock, which
// is the real pacing: in the adapter, "the round trip IS the pacing".
const TRIP_MS = 500;

export function fakeBrowser({ answers = [], host = "app.test", requests = "", profile = "fake-profile", dir = "/tmp/fake-run", clock = fakeClock(), details = true, consoleLog = [] } = {}) {
  const calls = [];
  const times = [];
  const note = (a) => { clock.tick(TRIP_MS); calls.push(a); times.push(clock.now()); return ""; };
  const log = timeline(requests, calls, times, clock);
  const seen = { calls, times, clock, trip: () => clock.tick(TRIP_MS) };
  return { calls, times, clock, ...reads(answers, note), ...session(dir, host, profile, note), ...acts(note, log, seen.trip), ...inspect(requests, consoleLog, details, seen) };
}

// The detail half of the port. A timeline entry may carry what `request <n>`
// would print -- `headers`, `responseHeaders`, `body`, `type`, `durationMs` --
// and `details: false` is a CLI that cannot answer `request <n>` at all, which
// is the "insufficient metadata" case a caller must report rather than invent.
function inspect(requests, consoleLog, details, seen) {
  const listed = (n) => (Array.isArray(requests) ? requests.find((r) => r.n === n && visible(r, seen)) : null);
  const detail = (n) => { seen.trip(); return details && listed(n) ? detailOf(listed(n), seen) : null; };
  const body = (n) => { seen.trip(); return details && listed(n)?.body !== undefined ? listed(n).body : null; };
  const logged = () => consoleLog.filter((m) => began(m, seen.calls, seen.times) !== null && seen.clock.now() >= began(m, seen.calls, seen.times));
  return { requestDetail: detail, requestBody: body, consoleTotals: () => { seen.trip(); return totals(logged()); }, consoleErrors: () => { seen.trip(); return logged().filter((m) => m.level === "error").map((m) => `[ERROR] ${m.text}`); } };
}

const visible = (r, seen) => began(r, seen.calls, seen.times) !== null && seen.clock.now() >= began(r, seen.calls, seen.times);

function detailOf(r, seen) {
  const answered = seen.clock.now() >= began(r, seen.calls, seen.times) + (r.respondsAfterMs ?? 0);
  const status = answered && r.status ? r.status : null;
  return { n: r.n, method: r.method, url: r.url, status, statusText: status ? "ok" : null, failed: answered ? r.failed ?? null : null, durationMs: r.durationMs ?? null, type: r.type ?? "fetch", mimeType: r.mimeType ?? null, requestHeaders: r.headers ?? {}, responseHeaders: r.responseHeaders ?? {} };
}

const totals = (msgs) => ({ total: msgs.length, errors: msgs.filter((m) => m.level === "error").length, warnings: msgs.filter((m) => m.level === "warning").length });

function reads(answers, note) {
  const ev = (js) => { note(["eval", js]); return answer(answers, js); };
  const truthy = (js) => ev(`!!(${js})`) === true;
  return { ev, truthy, settle: (js, tries = 40) => settled(truthy, js, tries) };
}

function settled(truthy, js, tries) {
  for (let i = 1; i <= tries; i++) if (truthy(js)) return i;
  return null;
}

function answer(answers, js) {
  const hit = answers.find(([k]) => (k instanceof RegExp ? k.test(js) : k === js));
  if (!hit) return `ERROR: no fake answer for ${js}`;
  return typeof hit[1] === "function" ? hit[1](js) : hit[1];
}

function session(dir, host, profile, note) {
  let current = dir;
  return { dir: () => current, use: (d) => (current = d || current), state: () => host, settled: () => host, profile: () => profile,
    cli: (args) => note(["cli", ...args]) };
}

function acts(note, log, trip) {
  return {
    goto: (u) => note(["goto", u]), click: (s) => note(["click", s]), fill: (s, v) => note(["fill", s, v]), press: (k) => note(["press", k]),
    screenshot: (file) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, "png"); return note(["screenshot", file]); },
    console: () => { trip(); return "Errors: 0"; },
    requests: () => { trip(); return log(); }, requestList: () => { trip(); return parseRequests(log()); },
    networkSummary: () => { trip(); return summarize(log()); }, close: () => note(["close"]),
  };
}

// A string is a log that never changes. An array is a timeline, one entry each:
//   { n, method, url, status, at: 0 }           in the log from that moment
//   { …, afterCall: ["click", selector] }       in the log once that call ran
//   { …, afterCall: ["click", selector, 2] }    ...once it ran the SECOND time
//   { …, respondsAfterMs: 1500 }                in flight until then
function timeline(requests, calls, times, clock) {
  if (typeof requests === "string") return () => requests;
  return () => requests.map((r) => line(r, began(r, calls, times), clock.now())).filter(Boolean).join("\n");
}

function began(r, calls, times) {
  if (r.at !== undefined) return r.at;
  const i = occurrence(calls, r.afterCall);
  return i < 0 ? null : times[i];
}

// The index of the Nth matching call (the first by default), or -1.
const occurrence = (calls, after) => calls.map((c, i) => [c, i]).filter(([c]) => c[0] === after?.[0] && c[1] === after?.[1]).map(([, i]) => i)[(after?.[2] ?? 1) - 1] ?? -1;

// No `=> [status]` until it has answered: that is a request in flight, and the
// parser has to be able to see one.
function line(r, from, now) {
  if (from === null || now < from) return null;
  const answered = now >= from + (r.respondsAfterMs ?? 0);
  if (answered && r.failed) return `${r.n}. [${r.method}] ${r.url} => [FAILED] ${r.failed}`;
  return `${r.n}. [${r.method}] ${r.url}${answered && r.status ? ` => [${r.status}] ok` : ""}`;
}

// The name is absent on the first ask (skip-if) and present afterwards (after Save).
const seenAfterFirstAsk = () => { let n = 0; return () => ++n > 1; };

// Answers that make the open-thing fixture pass end to end: the thing is already
// on the screen, and the detail page is the one the CAPTURED id names.
export const opened = () => [
  [/^!!\(document\.body\.innerText\.length>0\)$/, true],
  [/^!!\(document\.body\.innerText\.includes\('TC-1'\)\)$/, true],
  [/^!!\(location\.pathname===/, true],
  ["location.pathname", "/things/42"],
  ["document.body.innerText.slice(0,600)", "Thing TC-1"],
  [/^JSON\.stringify\(\{open:/, JSON.stringify({ open: true })],
];

// Answers that make the create-thing fixture pass end to end.
export const happy = () => [
  [/^!!\(document\.body\.innerText\.length>0\)$/, true],
  [/^!!\(document\.body\.innerText\.includes\('TC-1'\)\)$/, seenAfterFirstAsk()],
  [/^!!\(document\.querySelector\('\[role=dialog\]'\)\)$/, true],
  [/^!!\(location\.pathname===/, true],
  ["location.pathname", "/home"],
  ["document.body.innerText.slice(0,600)", "Home TC-1"],
  [/^JSON\.stringify\(\{created:/, JSON.stringify({ created: true })],
];

export const SAVE = "getByRole('button',{name:'Save'})";

// The POST the Save click causes. A timeline on purpose: written as a fixed
// string it was in the log BEFORE the click, and create-thing's api step passed
// on a request its own click had not made. This default IS the regression test.
export const savePost = (extra = {}) => [{ n: 1, method: "POST", url: "https://app.test/api/things", status: 201, afterCall: ["click", SAVE], ...extra }];
