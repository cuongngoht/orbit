// What a sandbox LOOKS like, for a person, Orbit Control and the orchestrator -- one read, so they cannot disagree.
//
// It says what the sandbox was built from and whether that is still the workspace, where each component runs and
// on which port, what answers, who owns what, and what the sandbox depends on outside itself. It never carries a
// path (the workspace owner resolves one live), a log's location (a log is read through `sandbox-logs`, bounded and
// scrubbed) or a verdict: whether the application is CORRECT is not a thing a runtime says.
import { Refused } from "../../errors.mjs";
import { openSecretLine, scrub, scrubLines } from "../../scrub.mjs";
import { connectivityNow } from "../connectivity/check.mjs";
import { scopeOf } from "../lifecycle/deps.mjs";
import { status } from "../lifecycle/status.mjs";
import { targetsOf } from "../connectivity/targets.mjs";
import { CLASSIFICATIONS } from "../settings.mjs";
import { sandboxNow } from "./model.mjs";
import { leasesOf } from "./held.mjs";
import { effectivePolicy } from "./policy.mjs";
import { reconciled } from "./reconcile.mjs";
import { LOG_BYTES, LOG_LINES, SESSION_UNKNOWN } from "./vocab.mjs";

// How the data a sandbox's components depend on is classified, worst first, so the worst one named wins. Ordered.
const WORST_FIRST = ["production", "external-readonly", "shared-development", "task-isolated", "unknown"];

const asWorst = (kinds) => WORST_FIRST.find((k) => kinds.includes(k)) ?? null;

// -> { state, because }: `NONE` when no component depends on a server outside the sandbox.
export function dataIsolation(settings, placements) {
  const needed = targetsOf(settings).filter((t) => t.requiredBy.some((k) => k in placements));
  const worst = asWorst(needed.map((t) => (CLASSIFICATIONS.includes(t.classification) ? t.classification : "unknown")));
  return worst ? { state: worst, because: `${needed.map((t) => `${t.label} (${t.classification ?? "unknown"})`).join(", ")} — a person classifies each server in the runtime settings; runtime reports it and enforces nothing` } : { state: "NONE", because: "no component depends on a server outside the sandbox" };
}

// Where to look, as a person or a browser would say it: a URL for something that speaks HTTP, an address for the rest.
// Always this machine's loopback: a sandbox listens nowhere else.
const ADDRESS = [
  { kind: "http", say: (e) => `http://127.0.0.1:${e.port}` },
  { kind: undefined, say: (e) => `127.0.0.1:${e.port}` },
];

const endpointText = (e) => (e ? ADDRESS.find((a) => a.kind === e.kind || a.kind === undefined).say(e) : null);

const componentOf = (doc, sessions) => (component) => ((s) => ({ component, execution: doc.placements[component], session: s?.id ?? null, requestedAt: s?.requestedAt ?? null, state: s?.state ?? "NOT_STARTED", readiness: s?.readiness ?? { state: "NOT_RUNNING" }, endpoint: endpointText(doc.endpoints.find((e) => e.component === component)) }))(sessions.find((x) => x.component === component));

// How much of what is running is Orbit's own, as the OS proof says: processes, containers, and the servers it depends on.
const ownershipOf = (sessions, doc, settings) => ({ processes: sessions.filter((s) => s.state === "RUNNING" && s.ownership === "ORBIT_OWNED" && doc.placements[s.component] === "native").length, containers: sessions.filter((s) => s.state === "RUNNING" && s.ownership === "ORBIT_OWNED" && doc.placements[s.component] === "devcontainer").length, external: targetsOf(settings).filter((t) => t.requiredBy.some((k) => k in doc.placements)).length });

const reachOf = (ctx, doc) => connectivityNow(ctx).targets.filter((t) => t.requiredBy.some((k) => k in doc.placements)).flatMap((t) => Object.entries(t.observations).map(([from, o]) => ({ target: t.id, from, state: o.state, because: o.because, checkedAt: o.checkedAt ?? null, stale: o.freshness?.stale ?? true })));

// -> the view of THIS context's sandbox.
export async function sandboxView(ctx) {
  const now = ctx.sandboxNow();
  const seen = await status(ctx);
  const settings = ctx.readSettings().settings;
  return composed(ctx, now, seen, settings);
}

function composed(ctx, now, seen, settings) {
  const doc = ctx.sandboxes.read(ctx.envId) ?? now;
  const sessions = seen.sessions;
  return { environment: ctx.envId, owner: doc.owner, workspace: doc.workspace, state: now.state, tree: doc.source?.tree ?? null, currentTree: ctx.workspaces.tree(ctx.task), stale: now.state === "STALE", ...(now.because ? { because: now.because } : {}), blocked: doc.blocked ?? null, components: Object.keys(doc.placements ?? {}).map(componentOf(doc, sessions)), endpoints: doc.endpoints ?? [], leases: leasesOf(ctx).list().filter((l) => l.env === ctx.envId).map((l) => ({ port: l.port, component: l.component, since: l.requestedAt })), connectivity: reachOf(ctx, doc), ownership: ownershipOf(sessions, doc, settings), dataIsolation: dataIsolation(settings, doc.placements ?? {}), qa: effectivePolicy(settings).policy.qa, reconcile: ["PREPARING", "AMBIGUOUS"].includes(doc.state) ? reconciled(ctx) : null, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
}

// -> the sandboxes of this checkout, as a person's context lists them.
export function sandboxesView(ctx) {
  const docs = ctx.sandboxes.list().filter((d) => d.kind === "sandbox");
  const held = leasesOf(ctx);
  const leases = held.list();
  return { sandboxes: docs.map((d) => briefOf(ctx, d, leases)), leases: leases.map(leaseBrief), staleLeases: held.stale().map(leaseBrief) };
}

const briefOf = (ctx, doc, leases) => ((now) => ({ id: doc.id, owner: doc.owner, workspace: doc.workspace, state: now.state, tree: doc.source?.tree ?? null, stale: now.state === "STALE", components: Object.keys(doc.placements ?? {}).length, leases: leases.filter((l) => l.env === doc.id).map((l) => l.port), updatedAt: doc.updatedAt }))(sandboxNow(doc, { tree: ctx.workspaces?.tree(doc.owner.id) ?? null, files: doc.backing?.devcontainer?.files ?? {} }));

const leaseBrief = (l) => ({ port: l.port, env: l.env, owner: l.owner, component: l.component, project: l.project });

// What an application printed, with where it ran said as a place and never as a path of this machine's store: a log is the
// application's own words, and the paths in it are not what a reader of a sandbox needs.
const placed = (ctx, text) => [[ctx.root, "<workspace>"], [ctx.primaryRoot, "<checkout>"], [ctx.storeRoot, "<store>"]].filter(([from]) => from).reduce((out, [from, to]) => out.split(from).join(to), text);

// A log of one of THIS sandbox's sessions, scrubbed and bounded because a log is an application's and may be as long as
// it ran. Two ways to read it, as a table: the last lines (a person opening it), or from a byte offset on (a live console
// asking only for what is new). Either way the lines are placed and scrubbed here, so no page ever sees a path.
export function logsOf(ctx, session, opts = {}) {
  const stream = opts.stream ?? "out";
  if (!["out", "err"].includes(stream)) throw new Refused("a log is `out` or `err`");
  if (!ctx.sessions.list(scopeOf(ctx)).some((s) => s.id === session)) throw Object.assign(new Refused(`no session ${session} belongs to this sandbox`), { code: SESSION_UNKNOWN });
  const file = ctx.sessions.logs(session)[stream];
  return { session, stream, ...READS.find((r) => r.when(opts)).read(ctx, file, opts) };
}

const READS = [
  { when: (o) => o.from !== undefined && o.from !== null, read: (ctx, file, o) => incremental(ctx, file, offsetOf(o.from)) },
  { when: () => true, read: (ctx, file, o) => tailed(ctx, file, o.tail ?? LOG_LINES) },
];

function tailed(ctx, file, tail) {
  const lines = scrub(placed(ctx, String(ctx.io.read(file) ?? ""))).split("\n");
  const kept = lines.slice(-Math.min(Math.max(1, Number(tail) || LOG_LINES), LOG_LINES)).join("\n").slice(-LOG_BYTES);
  return { lines: kept.split("\n"), truncated: kept.length < lines.join("\n").length, bytes: kept.length };
}

const OFFSET = /^\d{1,12}$/;

function offsetOf(raw) {
  if (!OFFSET.test(String(raw))) throw new Refused("from is a byte offset into the log: a whole number");
  return Number(raw);
}

// From `from` on, whole lines only, at most LOG_BYTES of them: `next` is always a line start. A log smaller than `from` was
// pruned or begun again, and says `reset` -- the reader starts over at 0.
//
// What a piece shows is what the whole-log read shows, by construction: every read scrubs the log from its FIRST byte to
// the last line end, exactly as the last-lines read does (placed, then scrubbed), only keeping each line end a mask
// swallowed (`scrubLines`), so line n of the masked text IS line n of the file; the piece is a slice of those lines. A
// secret's name and value any distance apart, a match the slice would cut, a long line: the whole text is masked first,
// and a long line is shown cut only after it is masked. The one thing a prefix of the log cannot know is how a value it
// ends inside will close, so a QUOTED secret value still open (`openSecretLine`, `named`'s own pairing) is held back from
// the line it begins on until its closing quote is written. Reading the whole log is what the last-lines read already
// does; a log larger than MAX_FOLLOW is refused for live following, with the reason, and its last lines stay readable.
export const MAX_FOLLOW = 16 * 1024 * 1024;
export const LINE_SHOWN = 4096;
export const LOG_TOO_LARGE = "LOG_TOO_LARGE";

function incremental(ctx, file, from) {
  const size = ctx.io.size(file) ?? 0;
  if (from > size) return { from: 0, next: 0, size, lines: [], truncated: false, bytes: 0, reset: true };
  if (size > MAX_FOLLOW) throw Object.assign(new Refused(`this log is ${size} bytes, more than ${MAX_FOLLOW} can be followed live; read its last lines instead`), { code: LOG_TOO_LARGE });
  return pageOf(maskedLog(ctx, file, size), from, size);
}

// The log's complete lines, masked as the whole-log read masks them: their text, where each begins in the file, and the
// first line a still-open quoted secret value holds back (the count of lines when none does).
function maskedLog(ctx, file, size) {
  const buffer = ctx.io.readFrom(file, 0, size)?.buffer ?? Buffer.alloc(0);
  const text = placed(ctx, buffer.subarray(0, buffer.lastIndexOf(0x0a) + 1).toString("utf8"));
  const masked = scrubLines(text).split("\n").slice(0, -1);
  const open = openSecretLine(text);
  return { masked, starts: lineStarts(buffer), held: open < 0 ? masked.length : open };
}

// Where every complete line begins, in bytes, and where the last one ends.
function lineStarts(buffer) {
  const starts = [0];
  for (let i = buffer.indexOf(0x0a); i >= 0; i = buffer.indexOf(0x0a, i + 1)) starts.push(i + 1);
  return starts;
}

// From the first line that begins at or after `from` (a cursor inside a line goes on from the next one); a cursor inside
// the last, unfinished line waits where it is.
function pageOf(log, from, size) {
  const first = ((i) => (i < 0 ? log.masked.length : i))(log.starts.findIndex((at) => at >= from));
  const last = lastLineOf(log, first, from);
  const next = last > first ? log.starts[last] : Math.max(from, log.starts[first] ?? from);
  return { from, next, size, lines: log.masked.slice(first, last).map(shownLine), truncated: next < size, bytes: next - from, held: last === log.held && log.held < log.masked.length };
}

// The lines from `first` on that a read shows: up to the one an open value holds back, at most LOG_BYTES of them -- and at
// least one, so a line longer than the bound is read whole and shown cut.
function lastLineOf(log, first, from) {
  let last = first;
  while (last < log.held && (last === first || log.starts[last + 1] - from <= LOG_BYTES)) last += 1;
  return last;
}

// A masked line, cut for a page when it is longer than LINE_SHOWN characters: it was masked whole, so the cut splits nothing a mask needs.
const shownLine = (line) => ((l) => (l.length <= LINE_SHOWN ? l : `${l.slice(0, LINE_SHOWN)} … [${l.length - LINE_SHOWN} more characters not shown]`))(line.replace(/\r$/, ""));
