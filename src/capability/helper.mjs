// The one way a capability reaches a program of its own: its HELPER (ADR 0036).
//
// invokeCapability is synchronous and stays so -- the runner, the verdict and every verb are
// written to an answer that is THERE, and a capability returning a promise is refused rather
// than judged as `{}`. A backend operation is not synchronous: a publication waits for its
// confirm, an observation for its deadline. So the asynchronous part runs in a separate
// process the engine starts, asks ONCE and waits for, bounded:
//
//   request  one JSON document on stdin  {v, op, request, bound, limits, deadlineMs}
//   answer   exactly one JSON line       {v, ok: true, value}
//                                        {v, ok: false, class, message, gap?, operationKey?}
//
// The capability chooses neither WHAT runs nor WHERE. Its declaration names the program, and
// the composition root's launcher (`ctx.helpers.launch`) decides whether it runs on this
// machine, inside the task's isolated worker or in its own digest-pinned image. Values the
// binding gate resolved from logical refs travel in `bound`; a secret travels only in the
// child's environment -- never in the request, an argument, the log or the answer. The timeout
// is the narrowest of the capability's own, the adapter's, the policy's and what is left of the
// run, and when nothing is left nothing is started.
import { Blocked, Refused } from "../errors.mjs";
import { scrub } from "../scrub.mjs";
import { CAPABILITY_ID } from "./contract-v1.mjs";

export const HELPER_API = "orbit.helper/v1";
export const DEFAULT_ANSWER_BYTES = 4 * 1024 * 1024;
// The longest any one helper call may take, whatever its capability or adapter declares: an observation's window
// (two minutes is a common accepted one) plus the time to start the helper and read its answer back. Every call is
// still bounded by the run's own budget, which a person sets (limits.caseSeconds).
export const DEFAULT_HELPER_TIMEOUT_MS = 180 * 1000;

// What a helper is told its deadline is: the host's own bound on it, less the time it takes to start the helper and to
// read its one answer back -- so a helper that watches until its deadline has answered before the host's bound ends
// it. Told the bound itself, a helper that waited its whole window raced the host, and lost as often as process start
// and its last read took longer than its margin: a timeout no product caused.
export const HELPER_LAUNCH_MS = 2000;

export const helperDeadlineMs = (timeoutMs) => Math.max(1, timeoutMs - Math.min(HELPER_LAUNCH_MS, Math.floor(timeoutMs / 10)));

// How a helper is launched, as the capability or the adapter DECLARES it. An argument list,
// never a shell line; where it runs is the launcher's.
export const HELPER_FIELDS = {
  argv: { type: "array", items: { type: "string" }, minItems: 1, doc: "The program and its arguments. The first is a path inside the declaring directory or a tool name; never an absolute path, never a shell line." },
  runIn: { enum: ["host", "worker", "image"], doc: "Where it runs: on this machine, inside the task's isolated worker, or in its own pinned image on the task's network." },
  image: { type: "string", pattern: "^[^\\s@]+@sha256:[0-9a-f]{64}$", doc: "The digest-pinned image it runs in, when runIn is image. Trusted by fingerprint in Orbit Control." },
};

export function helperFindings(h, at) {
  if (!h || typeof h !== "object" || !Array.isArray(h.argv)) return [];
  const first = String(h.argv[0] ?? "");
  const leaves = /^([/\\]|[A-Za-z]:)/.test(first) || first.split(/[/\\]/).includes("..");
  const where = leaves ? [`${at}: helper.argv[0] "${first.slice(0, 60)}" leaves its directory — an absolute path or .. is refused`] : [];
  return [...where, ...(h.runIn === "image" && !h.image ? [`${at}: helper.runIn is image and no image is pinned`] : []), ...h.argv.filter((a) => /[\0\n\r]/.test(String(a))).map(() => `${at}: helper.argv holds a control character`)];
}

// What a helper may say went wrong, and the typed stop each earns. None of them is a FAIL: a
// helper that could not reach a broker has said nothing about the product. `incomplete` is the
// one a negative assertion depends on -- an observation that could not see everything can never
// let "nothing arrived" pass. `ambiguous` is a write whose outcome is unknown: read back, never
// resent (ADR 0037).
export const HELPER_CLASSES = [
  { id: "transport", stop: "blocked", say: "the system behind it could not be reached — nothing about the product was observed" },
  { id: "protocol", stop: "blocked", say: "it answered something this engine cannot read — that is the tool failing, not the product" },
  { id: "timeout", stop: "blocked", say: "it did not answer within its bound — a spent budget proves nothing about the product" },
  { id: "incomplete", stop: "blocked", say: "it could not see everything it was asked to see — an absence is never concluded from missing data" },
  { id: "ambiguous", stop: "blocked", ambiguous: true, say: "it sent something whose outcome is unknown — it is read back, never sent again" },
  { id: "refused", stop: "refused", say: "the request was not one it can make as asked — the case's mistake, not the product's" },
];

export const HELPER_CLASS_IDS = HELPER_CLASSES.map((c) => c.id);

export const helperFacade = (ctx, run, cap, invocation = {}) => ({ run: (op, request = {}) => asked(ctx, run, cap, invocation, op, request) });

function asked(ctx, run, cap, inv, op, request) {
  const launch = launchOf(ctx, cap, op);
  const timeoutMs = boundedMs(ctx, run, cap, inv);
  const sent = JSON.stringify({ v: HELPER_API, op, request, bound: inv.bound ?? {}, limits: inv.limits ?? {}, deadlineMs: helperDeadlineMs(timeoutMs) });
  const out = ctx.process.run(launch.file, launch.args ?? [], { input: sent, timeoutMs, maxBuffer: inv.limits?.answerBytes ?? DEFAULT_ANSWER_BYTES, env: { ...(launch.env ?? {}), ...(inv.env ?? {}) }, ...(launch.cwd ? { cwd: launch.cwd } : {}) });
  return answerOf(cap, op, out);
}

// A launcher answers what to start, or WHY it starts nothing -- said, because "nothing could be
// launched" is the first thing a person reads when an adapter of their own does not run.
function launchOf(ctx, cap, op) {
  const launch = ctx.helpers?.launch?.(cap, op) ?? null;
  if (!launch?.file) throw new Blocked(`${cap.id} asks its helper, and ${launch?.why ?? "nothing here can launch one — the composition root that loaded its pack binds the launcher"}; nothing about the product was observed`);
  return launch;
}

const leftOf = (ctx, run) => (run?.budget?.endsAt === undefined ? Infinity : Math.max(run.budget.endsAt - ctx.now(), 0));

function boundedMs(ctx, run, cap, inv) {
  const left = leftOf(ctx, run);
  const ms = Math.min(left, cap.timeoutSec ? cap.timeoutSec * 1000 : Infinity, inv.limits?.timeoutMs ?? Infinity, DEFAULT_HELPER_TIMEOUT_MS);
  if (ms <= 0) throw new Blocked(`${cap.id}: the run's deadline is spent — nothing was started, and nothing about the product was observed`);
  return ms;
}

function answerOf(cap, op, out) {
  if (out.timedOut) throw typedError(cap, op, { class: "timeout", message: "no answer" });
  if (out.overflow) throw typedError(cap, op, { class: "incomplete", message: "it answered more than it may" });
  const answer = parsedAnswer(out.out);
  if (!answer) throw typedError(cap, op, { class: "protocol", message: `no single ${HELPER_API} line${out.error ? ` (${out.error})` : ""}` });
  return answer.ok === true ? answer.value : thrown(cap, op, answer);
}

function parsedAnswer(text) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length !== 1) return null;
  const answer = jsonOf(lines[0]);
  return answer?.v === HELPER_API && typeof answer.ok === "boolean" ? answer : null;
}

function jsonOf(line) {
  try { return JSON.parse(line); }
  catch { return null; }
}

function thrown(cap, op, answer) {
  throw typedError(cap, op, answer);
}

// The helper's own words are untrusted: scrubbed and bounded before a person reads them.
function typedError(cap, op, a) {
  const row = HELPER_CLASSES.find((c) => c.id === a.class) ?? HELPER_CLASSES[1];
  const message = `${cap.id} ${op}: ${scrub(String(a.message ?? "").slice(0, 300))} — ${row.say}`;
  const err = row.stop === "refused" ? new Refused(message) : new Blocked(message);
  return Object.assign(err, { helperClass: row.id, gap: gapOf(a.gap), ambiguous: row.ambiguous ? keyOf(a.operationKey) : null });
}

// A gap a helper names is held to the one shape a gap has -- a capability id and a reason -- and
// anything else it put there is dropped: the helper is untrusted, and a gap is what a person reads.
const gapOf = (g) => (g && typeof g === "object" && CAPABILITY_ID.test(String(g.capability ?? "")) ? { need: "capability", capability: g.capability, why: scrub(String(g.why ?? "").slice(0, 200)) } : null);

// The key a write whose outcome is unknown is read back by: bounded, and printable.
const keyOf = (k) => (typeof k === "string" && /^[\x21-\x7e]{1,128}$/.test(k) ? k : "unknown");
