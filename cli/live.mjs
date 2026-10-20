#!/usr/bin/env node
// Orbit LIVE in a terminal: the task this session (or this checkout) is working on, read from the journals the
// engine already keeps -- with Orbit Control running or not. Every command here READS, except two a person
// uses to say what a viewer should show: a pin and the live settings. Nothing here writes a task's journal,
// approves, resumes, cancels, stops a sandbox or runs anything (src/live/governance.mjs NOT_LIVE).
//
//   node live.mjs status [<task>] [--lines=1|2|3] [--json]
//                                          the task this session or checkout is working on, as a few lines
//   node live.mjs statusline --host=claude
//                                          a host's status line: reads the host's session JSON on stdin,
//                                          prints at most three short lines, always exits 0
//   node live.mjs watch [<task>] [--plain | --jsonl] [--logs[=<rs-id>]] [--since=<cursor>]
//                                          one task, live, until you leave: q or Ctrl+C detaches the VIEWER
//                                          and nothing else -- the task, its QA and its sandbox go on. A
//                                          terminal shows its MILESTONES (a sentence per one, a strip of
//                                          checks, or a workflow's steps); a shows every line, l the sandbox
//                                          console, c a workflow's engineering task and back.
//                                          --plain one line per event, --jsonl the same frames Orbit Control
//                                          streams; a pipe gets --plain by itself
//   node live.mjs tui [<task>] [--ascii] [--logs[=<rs-id>]] [--until-done[=<seconds>]] [--layout=pane|dashboard]
//                                          the same journals FULL SCREEN, until you leave: the stage, what it is
//                                          doing now and what a running check has reported, a workflow's steps and
//                                          its engineering task's checks, QA, the sandbox console (stdout and
//                                          stderr), the recent lines and the notices; i inspects every activity,
//                                          t picks a task of any known checkout, e shows the evidence, ? every key.
//                                          q or Ctrl+C gives the terminal back and leaves the task as it was;
//                                          --until-done leaves by itself once the task shown has ended (after 10
//                                          seconds, or the seconds named; any key keeps it open). Needs an
//                                          interactive terminal: a pipe or TERM=dumb is refused (exit 2) and told
//                                          to use watch --plain or --jsonl. Run it in a second terminal, tab or
//                                          tmux pane, never over an AI CLI that owns this one. --layout=pane
//                                          (1.8.6) draws what Claude Code's docked pane draws -- the checklist, NOW,
//                                          a view (1-6: events, tests, changes, notices, plan, timeline), task and
//                                          test progress, the LIVE indicator -- the layout a viewer opened beside
//                                          an AI CLI starts in (one with --lease or --until-done: only an opener
//                                          passes those); v switches between the two
//   node live.mjs ensure [<task>] [--entry=help|workflow] [--quiet]
//                                          what /orbit and /orbit-help run: this session's viewer, opened BESIDE it once and
//                                          reused after -- told to show <task> when one is named, never opened
//                                          twice for one session, never brought back after you closed it unless
//                                          you invoke /orbit or /orbit-help again (--entry=workflow, what a workflow's start
//                                          runs, never does). It waits a few seconds for the viewer to say it is
//                                          ready. Where nothing opens by itself (switched off in Orbit Control ›
//                                          Automation › Live, a headless run, no pane or window here) it says why
//                                          and prints the command for a second terminal. Always exits 0
//   node live.mjs open [<task>] [--print | --auto]
//                                          tui --until-done started BESIDE this session and returned from at once:
//                                          a tmux pane, a Windows Terminal split pane, or on macOS a Terminal
//                                          window; anywhere else (the VS Code terminal) the command is printed to
//                                          run in a second terminal. Your choice each time: another viewer, beside
//                                          any /orbit or /orbit-help opened; --print only prints the command; --auto is
//                                          `ensure --entry=workflow --quiet`
//   node live.mjs pane --host=claude [--lease=<key>.<owner>] [--columns=<n>] [--rows=<n>] [--left=<why>] [--auto]
//                                          the view a host DOCKS beside its session (1.8.5, a Claude Code mod draws
//                                          it): reads the host's session JSON on stdin, as the status line does,
//                                          and answers ONE JSON object -- a header line, the overview rows and the
//                                          NOW rows pinned at the bottom, as segments of text and a tone. While it
//                                          is open it holds this session's viewer lease (unless a window a launcher
//                                          opened holds it), so /orbit or /orbit-help opens no second viewer; --left says the
//                                          pane closed. Writes only that lease. --auto answers only whether
//                                          /orbit or /orbit-help opens it by itself here (a person's live.open and Live
//                                          display) and writes nothing. Always exits 0
//   node live.mjs pin <task> [--scope=session|checkout]
//                                          which task this session's (or every) viewer of this checkout shows
//   node live.mjs unpin [--scope=session|checkout]
//   node live.mjs settings [--apply='<json>' --revision=<r>]
//                                          how Live looks: statusLine.lines, statusLine.refreshInterval, idleAfterSec,
//                                          finishedForSec, terminal.maxRows, terminal.showQa, terminal.showLogs
//   node live.mjs where                    where this checkout's pins and the live settings are kept
//   node live.mjs doctor [--claude | --host=<claude|codex|antigravity>]
//                                          whether Live can show a task here, and why not; with a host, that host's
//                                          rows too -- where it can show Live (a docked pane, the VS Code companion,
//                                          a terminal split, a window, the CLI) and what `live open` reaches here
//
// Every command takes --json, and a checkout other than this one with --project=<key> --checkout=<id>.
// Which task is shown when none is named is decided by src/live/association.mjs: a task this session
// created, a pin, the one task running in this checkout -- never the newest task on the machine; two
// candidates are AMBIGUOUS, and `pin` chooses.
//
// This file is the COMPOSITION ROOT of the live core (ADR 0016): the stores, the task and investigation
// sources, the registry, the clock and the terminal are bound here, so nothing under src/live/ reads an
// environment, a disk or a terminal of its own. Finding this checkout spawns no git: it walks up to `.git`
// and reads the binding Orbit's first write in it left (state/checkouts/<id>.json).
//
// Exit 0 = done · 2 = REFUSED (bad usage, an unknown task, a stale revision) · 3 = BLOCKED (nothing to read
// here). Never 1. `statusline` always exits 0: a host's status row goes blank on any other code.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { attendedOf } from "../skills/orbit-learn/hosts/attended.mjs";
import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
import { effectiveOf, readAutomation } from "../src/automation/settings.mjs";
import { PLAN_SOURCE } from "../src/automation/source.mjs";
import { surfaceRows } from "../skills/orbit-learn/hosts/live-surfaces.mjs";
import { Blocked, Refused } from "../src/errors.mjs";
import { QA_SOURCE } from "../src/investigation/live.mjs";
import { ACTIVITY_SOURCE } from "../src/orchestration/activity/source.mjs";
import { flag, has, words } from "../src/learn/args.mjs";
import { focusOf } from "../src/live/activity.mjs";
import { associate } from "../src/live/association.mjs";
import { parseCursor, zeroCursor } from "../src/live/cursor.mjs";
import { switchRefusal } from "../src/live/ensure.mjs";
import { collectFeed, openFeed } from "../src/live/feed.mjs";
import { createFollowers } from "../src/live/followers.mjs";
import { claimedEnvironment, isRefusal, NO_SANDBOX, SESSION_ID, witnessedBy } from "../src/live/logs.mjs";
import { OPERATIONS, OPERATION_NAMES } from "../src/live/governance.mjs";
import { launching, leaseKey, leaseWhere, livenessOf, readLease, updateLease, viewerBeat, viewerLeft, viewerReady } from "../src/live/lease.mjs";
import { childIdOf as tuiChildOf, initialState as initialTui } from "../src/live/tui/model.mjs";
import { paneOf } from "../src/live/tui/pane.mjs";
import { reduce as reduceTui } from "../src/live/tui/reducer.mjs";
import { clearPin, readPins, writePin } from "../src/live/pin.mjs";
import { clearDown, cursorUp, hideCursor, showCursor } from "../src/live/render/ansi.mjs";
import { bandsOf, depthOf } from "../src/live/render/theme.mjs";
import { compactLines } from "../src/live/render/compact.mjs";
import { jsonlLine } from "../src/live/render/jsonl.mjs";
import { activityPlainLines, plainLine } from "../src/live/render/plain.mjs";
import { milestoneLines } from "../src/live/render/milestones.mjs";
import { screenLines } from "../src/live/render/screen.mjs";
import { readLive, writeLive } from "../src/live/settings.mjs";
import { snapshotOf } from "../src/live/snapshot.mjs";
import { SESSION_LIMITS, noSessionActivity, sessionActivityOf, sessionLinesOf } from "../src/live/session.mjs";
import { CHECKS as CHECK_CLASSES } from "../src/engineering/working-set/collect.mjs";
import { loadProject } from "../src/project/index.mjs";
import { workingSetDir } from "../src/project/runtime.mjs";
import { taskSessionMark } from "../src/memory/session.mjs";
import { printable } from "../src/printable.mjs";
import { createProcess } from "../src/process/index.mjs";
import { repositoryAt } from "../src/project/boundary.mjs";
import { command } from "../src/project/command.mjs";
import { switchOf } from "../src/project/env.mjs";
import { safeName } from "../src/project/paths.mjs";
import { checkoutId, projectStoreRoot, storeBase } from "../src/project/repository.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { writeAtomic } from "../src/store/atomic.mjs";
import { realIo } from "../src/store/io.mjs";
import { createRegistry } from "../src/store/registry.mjs";
import { COMMANDS as TASK_COMMANDS } from "../src/task/index.mjs";
import { TASK_SOURCE } from "../src/task/live.mjs";
import { createTasks, isTaskId, journalLine } from "../src/task/store.mjs";
import { createWorks } from "../src/work/store.mjs";
import { readView } from "../src/work/track/read.mjs";
import { currentOf, scanOf } from "../src/work/track/resolve.mjs";
import { viewLines } from "../src/work/track/say.mjs";
import { workingSetOf } from "../src/work/track/tail.mjs";

const ENV = commandEnvironment(process.env, process.argv);
const [cmd, ...args] = process.argv.slice(2);
const io = realIo();
const nowIso = () => new Date().toISOString();

// A journal touched in the last week is a candidate; at most this many first lines are read for one look.
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HEADS = 200;
const HEAD_BYTES = 8192;
const TAIL_BYTES = 16384;
const TICK_MS = 15_000;
const PAINT_MS = 250;
const LOG_MS = 500;
const LOG_KEPT = 200;
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function main() {
  const entry = Object.hasOwn(COMMANDS, cmd ?? "") ? COMMANDS[cmd] : null;
  if (!entry) return help();
  return entry.run();
}

const asJson = () => has(args, "json");

function printed(result, say) {
  console.log(asJson() ? JSON.stringify(result, null, 2) : printable(say(result)));
  return result;
}

// ---- where: this checkout, found without git -----------------------------------------------------

const readJson = (file) => quietly(() => JSON.parse(io.read(file) ?? "null"));

// The checkout `dir` is in, if Orbit has ever written for it: walk up to `.git`, hash the root the way every
// subject keys a checkout, and read the binding its first write left. Null when there is none.
function located(dir) {
  const root = quietly(() => repositoryAt(dir));
  const base = storeBase(ENV);
  const binding = root ? readJson(join(stateRooms(base).checkouts, `${checkoutId(root)}.json`)) : null;
  return binding?.key ? { root, base, checkoutId: checkoutId(root), key: binding.key, storeRoot: projectStoreRoot(base, binding.key) } : null;
}

function addressedAt(key, id) {
  const base = storeBase(ENV);
  const found = createRegistry(stateRooms(base), io).find(key, id);
  if (!found) throw new Refused("no project and checkout like that is known on this machine — `node cli/runtime.mjs projects` lists them");
  return { root: found.checkout.root, base, checkoutId: found.checkout.id, key: found.project.key, storeRoot: projectStoreRoot(base, found.project.key) };
}

const addressed = () => addressedAt(flag(args, "project"), flag(args, "checkout"));

function here() {
  const loc = flag(args, "project") || flag(args, "checkout") ? addressed() : located(process.cwd());
  if (!loc) throw new Blocked("no Orbit task can be here: this directory is not a checkout Orbit has written for — run it inside one, or name it with --project=<key> --checkout=<id>");
  return loc;
}

// The room a person's per-checkout facts on this machine live in (src/project/repository.mjs sessionDir).
const pinsDir = (loc) => join(loc.storeRoot, "runtime", safeName(hostname()), "sessions", loc.checkoutId.slice(0, 16), "live");

const settingsFile = (loc) => join(stateRooms(loc?.base ?? storeBase(ENV)).live, "settings.json");

const checkoutSummary = (loc) => quietly(() => createRegistry(stateRooms(loc.base), io).find(loc.key, loc.checkoutId)?.checkout) ?? null;

// ---- which task: candidates from each journal's first line, the fold only for this checkout's ------

const tasksOf = (loc) => createTasks(loc.storeRoot, io);

function headOf(file) {
  const got = quietly(() => io.readFrom(file, 0, HEAD_BYTES));
  const text = got ? got.buffer.toString("utf8") : "";
  return text.includes("\n") ? journalLine(text.slice(0, text.indexOf("\n"))) : null;
}

const recentlyTouched = (nowMs) => (file) => nowMs - (io.mtime(file) ?? 0) <= RECENT_MS;

// Whether a task ENDED, from its journal's last bytes alone (src/task/live.mjs ENDING_KINDS): a status line asked
// every second must not fold every journal of a project to learn which are still running. The first ending line
// in the tail is the one the fold keeps; the chosen task itself is then read whole, through the feed.
function endOf(file) {
  const size = io.size(file) ?? 0;
  const got = quietly(() => io.readFrom(file, Math.max(0, size - TAIL_BYTES), TAIL_BYTES));
  const lines = got ? got.buffer.toString("utf8").split("\n").slice(size > TAIL_BYTES ? 1 : 0) : [];
  return lines.map((l) => journalLine(l.replace(/\r$/, ""))).find((r) => r && TASK_SOURCE.ends.includes(r.kind)) ?? null;
}

// `coordinates`: a coordinated workflow's own task (src/automation/), which a session's viewer shows before the
// engineering task the workflow started -- a word the first line says, read here so the core names no provider.
const rowOf = ({ file, head }) => ((end) => ({ id: head.id, checkout: head.checkout, session: head.session ?? null, terminal: end !== null, createdAt: head.at ?? "", endedAt: end?.at ?? null, coordinates: head.provider === "automation" }))(endOf(file));

// Each journal's path is resolved (and held inside the store) once per look, not once per question asked of it.
function rowsOf(loc, nowMs) {
  const tasks = tasksOf(loc);
  const files = tasks.list().map((id) => tasks.journalFile(id)).filter(recentlyTouched(nowMs)).slice(-MAX_HEADS);
  return files.map((file) => ({ file, head: headOf(file) })).filter(({ head }) => head?.kind === "created" && head.checkout === loc.checkoutId).map(rowOf);
}

const scopeOf = (mark) => (flag(args, "scope") === "checkout" || !mark ? null : mark);

// Which task, and -- when it was chosen from this checkout's own first lines -- when it was created.
function chosen(loc, { explicit, mark, nowMs, settings }) {
  const rows = explicit ? [] : rowsOf(loc, nowMs);
  const answer = associate({ explicit, pins: readPins(io, pinsDir(loc), mark), mark, checkout: loc.checkoutId, rows, now: nowMs, finishedForMs: settings.finishedForSec * 1000 });
  return { ...answer, createdAt: rows.find((r) => r.id === answer.task)?.createdAt ?? null };
}

// ---- this session's own activity: the working set its hooks keep (1.8.7, src/live/session.mjs) ----------

// What a viewer shows when no task's journal speaks for the work: THIS session's file only -- named by the mark the
// pane, the status line and a task's journal share (src/memory/session.mjs) -- and only its tail, so a pane asked
// every two seconds reads a bounded slice and never another session's. Nothing is written; a reason stands in for
// the lines when there are none to read.
function sessionRead(loc, mark, nowMs, settings) {
  if (!mark) return noSessionActivity("no-session");
  if (!switchOf(ENV, "WORKING_SET", "working_set", true)) return noSessionActivity("off");
  const project = loc ? sessionProject(loc) : null;
  return project ? sessionFrom(join(workingSetDir(project), `${mark}.jsonl`), nowMs, settings) : noSessionActivity("no-project");
}

// Where the hooks keep this checkout's working sets: the runtime room its binding names (src/project/repository.mjs
// `sessionDir`), found without a git call, as pinsDir is; a protocol-2 host isolates session state per session
// (src/project/affinity.mjs), so there the project is resolved the way that host's own hook resolved it.
const bindingProject = (loc) => ((runtime) => ({ layout: 3, runtime, sessionDir: join(runtime, "sessions", loc.checkoutId.slice(0, 16)) }))(join(loc.storeRoot, "runtime", safeName(hostname())));

const sessionProject = (loc) => (ENV.ORBIT_HOST_PROTOCOL === "2" ? quietly(() => loadProject(ENV, loc.root)) : bindingProject(loc));

function sessionFrom(file, nowMs, settings) {
  const size = io.size(file);
  const got = size ? quietly(() => io.readFrom(file, Math.max(0, size - SESSION_LIMITS.TAIL_BYTES), SESSION_LIMITS.TAIL_BYTES)) : null;
  const lines = !size ? [] : got ? sessionLinesOf(got.buffer.toString("utf8"), size > SESSION_LIMITS.TAIL_BYTES) : null;
  return lines ? sessionActivityOf(lines, { nowMs, idleAfterMs: settings.idleAfterSec * 1000, checks: CHECK_CLASSES, partial: size > SESSION_LIMITS.TAIL_BYTES }) : noSessionActivity("unreadable");
}

// ---- the work this session tracks (1.8.8, src/work/track/) --------------------------------------------------------

// Where the hooks keep this checkout's working sets, for the work's sessions: the room the session's own host resolved
// (src/project/affinity.mjs for a protocol-2 host), else the binding's. A checkout `located` found is a KNOWN one, which is
// what the hooks observe (1.8.9, src/project/repository.mjs knownCheckout); a read of a room nothing wrote is empty, never
// an error.
const workProject = (loc) => sessionProject(loc) ?? bindingProject(loc);

const workContext = (loc, nowMs, settings) => ({ works: createWorks(loc.storeRoot, io), now: nowIso, nowMs, idleAfterMs: settings.idleAfterSec * 1000, checkout: loc.checkoutId, host: hostId(), workingSet: workingSetOf(io, workingSetDir(workProject(loc)), switchOf(ENV, "WORKING_SET", "working_set", true) ? "ok" : "off"), activity: { linesOf: sessionLinesOf, activityOf: sessionActivityOf, checks: CHECK_CLASSES }, taskView: (id) => TASK_COMMANDS.show.run(showCtx(loc), [id]) });

function currentWork(ctx, mark, loc) {
  const scan = scanOf(ctx.works);
  const current = currentOf(scan, mark, loc.checkoutId);
  return current ? readView(ctx, current.id, scan) : null;
}

// The ONE view of the work this session is bound to (the same `workViewOf` Orbit Control serves), or null: no session mark, no
// work bound, or anything that could not be read -- a viewer never fails for want of it, and never guesses another session's.
const workRead = (loc, mark, nowMs, settings) => (loc && mark ? quietly(() => currentWork(workContext(loc, nowMs, settings), mark, loc)) : null);

// What `status --json` says of it: the counts and the newest few, never a path beyond the ones it changed.
const sessionJson = (a) => ({ state: a.state, source: a.source, observed: a.observed, running: a.running, last: a.recent[0] ?? null, files: a.files.slice(0, 10), checks: a.checks.slice(0, 3) });

// ---- reading one task: the SAME feed Orbit Control streams ----------------------------------------

const deps = (followers) => ({ io, followers, task: TASK_SOURCE, qa: QA_SOURCE, activity: ACTIVITY_SOURCE, plan: PLAN_SOURCE });

// A task named on the line is read through `show` first -- the same door every reader uses, which refuses
// another checkout's id. One chosen from this checkout's own first lines needs no second whole read.
const createdAtOf = (loc, task, known) => known ?? TASK_COMMANDS.show.run({ tasks: tasksOf(loc), checkout: loc.checkoutId, now: nowIso }, [task]).task.createdAt ?? null;

function openedTask(loc, task, known = null) {
  const tasks = tasksOf(loc);
  return { taskCtx: { tasks, checkoutSummary: checkoutSummary(loc), now: nowIso }, task, createdAt: createdAtOf(loc, task, known), qa: QA_SOURCE.open(loc.storeRoot, io), activity: ACTIVITY_SOURCE.open(loc.storeRoot), plans: PLAN_SOURCE.open(loc.storeRoot, io) };
}

const collected = (loc, task, known = null) => collectFeed(deps(createFollowers()), openedTask(loc, task, known), zeroCursor());

// The picture a status line or `status` draws: which task, and the task as one read found it.
function looked(loc, opts) {
  const association = chosen(loc, opts);
  const got = association.task ? quietly(() => collected(loc, association.task, association.how === "explicit" ? null : association.createdAt)) : null;
  const read = association.task && !got ? { reads: 1, failures: 1, good: false } : undefined;
  return snapshotOf({ association, collected: got, read, nowMs: opts.nowMs, idleAfterMs: opts.settings.idleAfterSec * 1000 });
}

const settingsNow = (loc) => readLive(io, settingsFile(loc)).settings;

const linesWanted = (settings) => Number(flag(args, "lines") ?? settings.statusLine.lines);

const colourHere = (stream) => Boolean(stream.isTTY) && !ENV.NO_COLOR && ENV.TERM !== "dumb";


// ---- status --------------------------------------------------------------------------------------

function status() {
  const loc = here();
  const settings = settingsNow(loc);
  const facts = statusFacts(loc, settings);
  return printed(statusJson(facts.snap, facts.session, facts.work), () => statusText(facts.snap, settings, facts.session, facts.work));
}

function statusFacts(loc, settings) {
  const mark = taskSessionMark(ENV.ORBIT_SESSION);
  const nowMs = Date.now();
  return { snap: looked(loc, { explicit: words(args)[0] ?? null, mark, nowMs, settings }), session: sessionRead(loc, mark, nowMs, settings), work: workRead(loc, mark, nowMs, settings) };
}

// `activity` (1.8.5): what runs now -- or ended last -- with why, where, how far a check's runner reported, and next.
// `session` (1.8.7): what this session's own tools did, as its hooks observed them -- never the task's state.
// `work` (1.8.8): the work this session tracks -- its identity, mode, lifecycle, evidence level, the files and checks that were
// OBSERVED and its blocker -- or null when it tracks none.
const statusJson = (snap, session, work) => ({ work, association: snap.association, presentation: snap.presentation, lifecycle: snap.view?.lifecycle ?? null, stage: snap.view?.stage ?? null, attempt: snap.view?.attempt ?? null, revision: snap.view?.revision ?? null, current: snap.current, activity: focusOf(snap.activities ?? []), failure: snap.failure, cursor: snap.cursor, session: sessionJson(session) });

const sessionText = (a) => (a.running.length ? `this session is running ${a.running.at(-1).what} (observed)` : a.recent[0] ? `this session last ${a.recent[0].kind === "command" ? "ran" : a.recent[0].kind === "edit" ? "edited" : "used"} ${a.recent[0].what ?? "a tool"} (observed)` : null);

function statusText(snap, settings, session, work) {
  const lines = compactLines(snap, { lines: linesWanted(settings), columns: process.stdout.columns ?? 100, colour: false });
  const said = "no Orbit task in this checkout: a task this session starts, or one you pin (`live pin <task>`), is shown here";
  return [...(work ? viewLines(work, { all: false }) : []), ...(lines.length ? lines : [said, sessionText(session)])].filter(Boolean).join("\n");
}

// ---- statusline (a host's status row) -----------------------------------------------------------

// The host's adapter turns its session JSON into { sessionId, cwd, columns } and the session mark a task created
// in that session carries. Bound lazily: only a status line pays for it. The JSON arrives on stdin, or -- from
// the shim a host's settings name, which read stdin first -- in ORBIT_STATUSLINE_INPUT; it is never kept.
async function statusline() {
  const host = await import(`../skills/orbit-learn/hosts/${safeName(flag(args, "host") ?? "claude")}-statusline.mjs`);
  const input = host.sessionOf(quietly(() => JSON.parse(ENV.ORBIT_STATUSLINE_INPUT ?? readFileSync(0, "utf8"))), ENV);
  const lines = quietly(() => statuslineLines(input, host)) ?? [];
  if (lines.length) process.stdout.write(`${lines.join("\n")}\n`);
}

function statuslineLines(input, host) {
  const loc = input?.cwd ? located(input.cwd) : null;
  if (!loc || !host.enabled(ENV, io, storeBase(ENV))) return [];
  const settings = settingsNow(loc);
  const snap = looked(loc, { explicit: null, mark: input.mark, nowMs: Date.now(), settings });
  return compactLines({ ...snap, still: settings.pane?.animation === "off" }, { lines: settings.statusLine.lines, columns: host.room(input.columns), colour: true });
}

// ---- pin, unpin, settings, where ----------------------------------------------------------------

function pin() {
  const loc = here();
  const task = words(args)[0];
  TASK_COMMANDS.show.run({ tasks: tasksOf(loc), checkout: loc.checkoutId, now: nowIso }, [task ?? ""]);
  return printed(writePin(io, pinsDir(loc), { mark: scopeOf(taskSessionMark(ENV.ORBIT_SESSION)), task, at: nowIso(), nowMs: Date.now() }), (r) => `pinned ${r.task} for ${r.key === "checkout" ? "every viewer of this checkout" : "this session's viewers"}`);
}

function unpin() {
  const loc = here();
  return printed(clearPin(io, pinsDir(loc), scopeOf(taskSessionMark(ENV.ORBIT_SESSION))), (r) => `unpinned (${r.key === "checkout" ? "this checkout" : "this session"})`);
}

function settings() {
  const file = settingsFile(quietly(here));
  const applied = flag(args, "apply") ? writeLive(io, file, parsedApply(), { revision: flag(args, "revision") ?? null, at: nowIso(), by: "person" }) : null;
  return printed(applied ?? readLive(io, file), (r) => [`revision ${r.revision ?? "(defaults; nothing kept yet)"}`, JSON.stringify(r.settings, null, 2)].join("\n"));
}

function parsedApply() {
  const value = quietly(() => JSON.parse(flag(args, "apply")));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Refused("--apply is a JSON object of the settings to change, e.g. --apply='{\"statusLine\":{\"lines\":3}}'");
  return value;
}

function where() {
  const loc = quietly(here);
  const result = { checkout: loc?.checkoutId ?? null, project: loc?.key ?? null, pins: loc ? pinsDir(loc) : null, settings: settingsFile(loc) };
  return printed(result, (r) => Object.entries(r).map(([k, v]) => `${k.padEnd(9)} ${v ?? "-"}`).join("\n"));
}

// ---- doctor ---------------------------------------------------------------------------------------

const CHECKS = [
  { name: "checkout", run: (c) => (c.loc ? `bound: project ${c.loc.key}` : "not a checkout Orbit has written for: nothing to show here") },
  { name: "tasks", run: (c) => (c.loc ? `${c.rows.length} task(s) of this checkout touched in the last week, ${c.rows.filter((r) => !r.terminal).length} running` : "-") },
  { name: "session", run: () => (ENV.ORBIT_SESSION ? `this shell carries a session mark (${taskSessionMark(ENV.ORBIT_SESSION)})` : "this shell carries no session mark: a task is matched by checkout or pin only") },
  { name: "association", run: (c) => (c.loc ? `${c.association.how}${c.association.task ? ` → ${c.association.task}` : c.association.ids.length ? ` → ${c.association.ids.join(", ")}` : ""}` : "-") },
  { name: "settings", run: (c) => `lines ${c.settings.statusLine.lines}, refresh ${c.settings.statusLine.refreshInterval}s, idle after ${c.settings.idleAfterSec}s` },
  { name: "open", run: (c) => `live open would use ${c.opener}` },
  { name: "viewer", run: (c) => (c.viewer ? `${c.viewer.liveness.state}: ${c.viewer.liveness.why}${c.viewer.lease?.last ? ` · the last ensure: ${c.viewer.lease.last.status}${c.viewer.lease.last.why ? ` (${c.viewer.lease.last.why})` : ""}` : ""}` : "no session viewer can be kept here: no session mark, or not a repository") },
  { name: "full screen", run: () => (process.stdout.isTTY && process.stdin.isTTY && ENV.TERM !== "dumb" ? "this terminal can show `live tui`" : "not an interactive terminal here: `live tui` needs one (in another terminal or tmux pane); `watch --plain` works anywhere") },
];

// --claude (1.8.5) or --host=<name> (1.8.6: claude, codex, antigravity): that host's own rows too -- for Claude Code its
// status line, for every host the surfaces it can show Live on and the one `live open` reaches from here.
const doctorHost = () => (has(args, "claude") ? "claude" : flag(args, "host") ?? null);

async function doctor() {
  const o = await import("./live-open.mjs");
  const opener = o.openerOf(ENV, process.platform, binOf, companionSeen);
  const c = { ...diagnosed(), opener: opener.where };
  const host = doctorHost() ? await import(`../skills/orbit-learn/hosts/${safeName(doctorHost())}-statusline.mjs`) : null;
  return printed({ checks: CHECKS.map((k) => ({ name: k.name, says: k.run(c) })), host: host ? hostRows(host, opener.id) : null }, (r) => [...r.checks, ...(r.host ?? [])].map((k) => `${k.name.padEnd(12)} ${k.says}`).join("\n"));
}

const hostRows = (host, openerId) => [...host.doctor({ env: ENV, io, base: storeBase(ENV), opener: openerId }), ...(host.name === "claude" ? surfaceRows("claude", openerId) : [])];

function diagnosed() {
  const loc = quietly(here);
  const settings = settingsNow(loc);
  const rows = loc ? rowsOf(loc, Date.now()) : [];
  return { loc, settings, rows, association: loc ? chosen(loc, { explicit: null, mark: taskSessionMark(ENV.ORBIT_SESSION), nowMs: Date.now(), settings }) : null, viewer: quietly(viewerNow) };
}

// ---- watch: one task, followed until the viewer leaves -------------------------------------------

const MODES = [
  { mode: "jsonl", when: () => has(args, "jsonl") },
  { mode: "plain", when: () => has(args, "plain") || !process.stdout.isTTY },
  { mode: "screen", when: () => true },
];

function watch() {
  const loc = here();
  const settings = settingsNow(loc);
  const association = chosen(loc, { explicit: words(args)[0] ?? null, mark: taskSessionMark(ENV.ORBIT_SESSION), nowMs: Date.now(), settings });
  if (!association.task) throw new Blocked(association.how === "ambiguous" ? `${association.ids.length} tasks run in this checkout (${association.ids.join(", ")}): name one, or \`live pin <task>\`` : "no task to watch in this checkout: name one");
  return followed(loc, association, settings, MODES.find((m) => m.when()).mode);
}

function followed(loc, association, settings, mode) {
  const w = { loc, association, settings, mode, events: [], lines: 0, timers: [], feed: null, done: false, dirty: true, logs: null, showLogs: settings.terminal.showLogs || has(args, "logs") || Boolean(flag(args, "logs")) };
  w.feed = openFeed(deps(createFollowers()), openedTask(loc, association.task), parseCursor(flag(args, "since")));
  attached(w);
  w.feed.start(sinkOf(w));
  return new Promise((resolve) => { w.resolve = resolve; });
}

function attached(w) {
  w.timers.push(setInterval(() => w.feed.tick(), TICK_MS));
  if (w.showLogs) w.timers.push(setTimeout(() => toggledLogs(w, true), 0));
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => detached(w, "detached"));
  if (w.mode === "screen") screenAttached(w);
}

function screenAttached(w) {
  w.timers.push(setInterval(() => painted(w), PAINT_MS));
  keysOf(w);
  process.stdout.write(hideCursor());
}

const sinkOf = (w) => ({ get closed() { return w.done; }, send: (frame) => received(w, frame), end: () => ended(w) });

// A check's observation (1.8.5) prints, in a log, only when it starts, when its runner reports a failure, and when it
// ends -- against the projection last printed; in --jsonl it is the frame Control streams.
const plainOf = (f, w) => (f.event === "activity-view" ? ((lines) => (lines.length ? lines.join("\n") : null))(activityPlainLines(w.acts?.[f.data.action] ?? null, f.data.view)) : plainLine(f));

const OUT = { jsonl: (f) => jsonlLine(f), plain: (f, w) => plainOf(f, w), screen: () => null };

function received(w, frame) {
  took(w, frame);
  const line = OUT[w.mode](frame, w);
  Object.assign(w, { dirty: true, cursor: frame.id ?? w.cursor, acts: actsAfter(w.acts ?? {}, frame) });
  return written(line);
}

function took(w, frame) {
  if (frame.event === "task-event" || frame.event === "qa-event") w.events.push(frame.data);
  if (frame.event === "task-view") w.view = frame.data.view;
  if (frame.event === "end") w.endReason = frame.data.reason;
}

const actsAfter = (acts, f) => (f.event === "activity-view" ? { ...acts, [f.data.action]: f.data.view } : acts);

// A pipe that closed (`| head`) is a viewer that left, never a crash: the line is dropped and the feed ends.
const written = (line) => line === null || quietly(() => process.stdout.write(`${line}\n`)) !== null;

function ended(w) {
  if (w.endReason === "reset") return restarted(w);
  painted(w);
  detached(w, w.endReason === "terminal" ? "the task ended" : "its journal could not be followed");
}

// A journal that shrank (pruned, rewritten) is followed again from its first line, and the viewer says so.
function restarted(w) {
  w.feed.close();
  Object.assign(w, { events: [], view: null, endReason: null, acts: {} });
  process.stderr.write("live: the task's journal was begun again; reading it from its first line\n");
  w.feed = openFeed(deps(createFollowers()), openedTask(w.loc, w.association.task), zeroCursor());
  w.feed.start(sinkOf(w));
}

function detached(w, why) {
  if (w.done) return;
  Object.assign(w, { done: true });
  closedDown(w);
  process.stderr.write(`${plainSafe(`live: ${why} — ${w.association.task} ${w.view?.lifecycle ?? ""} ${w.view?.stage ?? ""} (cursor ${w.cursor ?? "t=0"}); the task itself is untouched`).replace(/ +/g, " ")}\n`);
  w.resolve?.();
}

function closedDown(w) {
  w.timers.forEach(clearInterval);
  w.feed.close();
  quietly(() => process.stdin.isTTY && process.stdin.setRawMode(false));
  process.stdin.pause();
  if (w.mode === "screen") process.stdout.write(showCursor());
}

// ---- the terminal: painted in place, keys read raw, nothing typed reaches anything but the viewer ----

const KEYS = {
  q: (w) => detached(w, "detached"),
  "\u0003": (w) => detached(w, "detached"),
  l: (w) => toggledLogs(w),
  a: (w) => Object.assign(w, { all: !w.all, dirty: true }),
  c: (w) => switched(w),
};

// ---- a coordinated workflow's engineering task, beside it -------------------------------------------

// The engineering task a coordinated workflow started: its latest `task:` receipt. Read through `show`, the same
// door every reader uses, at most every CHILD_MS -- never followed line by line here, and never written.
const CHILD_MS = 2000;

const childIdOf = (view) => view?.receipts?.filter((r) => r.domain === "task").at(-1)?.ref ?? null;

function childNow(w) {
  const id = childIdOf(w.view);
  if (!id || w.parent) return null;
  if (w.childAt && Date.now() - w.childAt < CHILD_MS && w.child?.task?.id === id) return w.child;
  return Object.assign(w, { child: quietly(() => TASK_COMMANDS.show.run({ tasks: tasksOf(w.loc), checkout: w.loc.checkoutId, now: nowIso }, [id])), childAt: Date.now() }).child;
}

// `c`: the viewer moves to the engineering task's own console, and back. Only what is SHOWN changes: both tasks
// go on exactly as they were, and nothing is written.
function switched(w) {
  const to = w.parent ?? childIdOf(w.view);
  if (!to) return;
  w.feed.close();
  Object.assign(w, { parent: w.parent ? null : w.association.task, association: { how: "explicit", task: to, ids: [to] }, events: [], view: null, child: null, acts: {}, dirty: true });
  reopened(w, to);
}

function reopened(w, task) {
  w.feed = openFeed(deps(createFollowers()), openedTask(w.loc, task), zeroCursor());
  w.feed.start(sinkOf(w));
}

function keysOf(w) {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (b) => [...b.toString("utf8")].forEach((k) => KEYS[k]?.(w)));
  process.stdout.on("resize", () => Object.assign(w, { dirty: true }));
}

function painted(w) {
  if (w.mode !== "screen" || (!w.dirty && !pulsing(w))) return;
  const snap = snapshotOf({ association: w.association, collected: { view: w.view ?? null, cursor: w.cursor }, events: w.events, nowMs: Date.now(), idleAfterMs: w.settings.idleAfterSec * 1000, child: childNow(w), activity: w.acts ?? {} });
  const lines = (w.all || w.showLogs ? screenLines : milestoneLines)(snap, { columns: (process.stdout.columns ?? 100) - 1, rows: Math.max(8, (process.stdout.rows ?? 30) - 1), colour: colourHere(process.stdout), showQa: w.settings.terminal.showQa, logs: w.showLogs ? w.logs : null });
  process.stdout.write(`${cursorUp(w.lines)}\r${clearDown()}${lines.join("\n")}\n`);
  Object.assign(w, { lines: lines.length, dirty: false });
}

// A LIVE screen repaints every second for its clock and pulse even with nothing new; an idle one does not.
const pulsing = (w) => Boolean(w.view && !w.view.terminal);

// ---- the sandbox console: the task's own sandbox, read through the runtime's door ------------------

// Whose output a viewer may show is decided as Orbit Control decides it (src/live/logs.mjs): the environment the
// task's journal claims, witnessed by the checkout's own sandboxes. Then the runtime's `sandbox-logs`, which
// reads only that sandbox's sessions and masks the WHOLE log before any piece is shown; no path is built here.
const stopOn = (x) => {
  if (isRefusal(x)) throw Object.assign(new Refused(x.why), { code: x.code });
  return x;
};

async function consoleOf(w) {
  const env = stopOn(claimedEnvironment(w.view ?? { receipts: [] }));
  if (env === null) return { session: null, stream: "out", lines: [NO_SANDBOX], from: 0 };
  const s = await sandboxBound(w.loc, w.association.task, env);
  return consoleReading(w, s.ctx, s.commands);
}

// The ONE chain to a task's sandbox, for `watch` and `tui` alike: the checkout's own sandboxes witness the
// environment the journal claims, then the runtime is bound to THAT task's sandbox and asked through its commands.
async function sandboxBound(loc, task, env) {
  const [bind, runtime] = await Promise.all([import("../skills/orbit-runtime/bind.mjs"), import("../src/runtime/index.mjs")]);
  stopOn(witnessedBy((await runtime.COMMANDS.sandboxes.run(bind.bindRuntime({ pluginRoot: PLUGIN_ROOT, env: ENV, cwd: loc.root }), [])).sandboxes, env, task));
  return { ctx: bind.bindSandbox({ pluginRoot: PLUGIN_ROOT, env: ENV, cwd: loc.root, task }), commands: runtime.COMMANDS };
}

async function consoleReading(w, ctx, commands) {
  const view = await commands.sandbox.run(ctx, [`--task=${w.association.task}`]);
  const session = flag(args, "logs") ?? view.components.find((c) => c.session && c.state === "RUNNING")?.session ?? view.components.find((c) => c.session)?.session ?? null;
  const read = (from) => commands["sandbox-logs"].run(ctx, [`--task=${w.association.task}`, `--session=${session}`, "--stream=out", `--from=${from}`]);
  return { session, stream: "out", lines: session ? [] : ["this sandbox has run no session yet"], from: 0, read: session ? read : null };
}

async function toggledLogs(w, on = !w.showLogs) {
  Object.assign(w, { showLogs: on, dirty: true });
  if (!on || w.logs) return;
  w.logs = await consoleOf(w).catch((e) => ({ session: null, stream: "out", lines: [`console unavailable: ${e.message}`], from: 0 }));
  if (w.logs.read) w.timers.push(setInterval(() => consoleRead(w), LOG_MS));
}

async function consoleRead(w) {
  if (w.logs.busy || w.done) return;
  w.logs.busy = true;
  try { consoleGot(w, await w.logs.read(w.logs.from)); }
  catch (e) { Object.assign(w.logs, { read: null, lines: [...w.logs.lines, `console stopped: ${e.message}`] }); }
  finally { w.logs.busy = false; }
}

function consoleGot(w, got) {
  if (got.reset) Object.assign(w.logs, { lines: [], from: 0 });
  if (!got.lines?.length) return;
  Object.assign(w.logs, { lines: [...w.logs.lines, ...got.lines].slice(-LOG_KEPT), from: got.next, dirty: true });
  Object.assign(w, { dirty: true });
  consolePrinted(w, got);
}

// A pipe gets the console as lines too: --plain prefixes them, --jsonl sends the frame Orbit Control streams.
const CONSOLE_OUT = {
  plain: (w, got) => got.lines.map((l) => `-  log   ${w.logs.session} ${l}`),
  jsonl: (w, got) => [jsonlLine({ event: "log", id: `o=${got.next}`, data: { source: "log", session: w.logs.session, stream: "out", from: got.from, next: got.next, lines: got.lines, truncated: got.truncated } })],
  screen: () => [],
};

const consolePrinted = (w, got) => CONSOLE_OUT[w.mode](w, got).forEach((line) => written(w.mode === "plain" ? plainSafe(line) : line));

const plainSafe = (line) => printable(line).replace(/\r?\n/g, " ");

// ---- tui: the same journals, full screen (src/live/tui/, cli/live-tui.mjs) ---------------------------------

const sessionFlag = () => (SESSION_ID.test(String(flag(args, "logs") ?? "")) ? flag(args, "logs") : null);

// --until-done[=<seconds>]: how long an ended task stays on screen before the viewer leaves by itself (0-3600).
const LINGER_S = 10;

const untilDone = () => (has(args, "until-done") || flag(args, "until-done") !== undefined ? { lingerMs: Math.min(3600, Math.max(0, Number(flag(args, "until-done") ?? LINGER_S) || 0)) * 1000 } : null);

const tuiTerminal = () => ({ stdin: process.stdin, stdout: process.stdout, signals: process, term: ENV.TERM, colour: colourHere(process.stdout), depth: depthOf(ENV), bands: bandsOf(ENV) });

async function tui() {
  const { runTui, tuiRefusal } = await import("./live-tui.mjs");
  const refused = tuiRefusal(tuiTerminal());
  if (refused) throw new Refused(refused);
  return tuiRan(runTui, tuiStart());
}

// Where the viewer stands and what it shows first: the checkout this directory is (or --project/--checkout), and
// the task the association names -- a task named on the line may be another known checkout's of this project.
function tuiStart() {
  const place = startPlace(quietly(here), words(args)[0] ?? null);
  const settings = settingsNow(place);
  const association = place ? chosen(place, { explicit: words(args)[0] ?? null, mark: taskSessionMark(ENV.ORBIT_SESSION), nowMs: Date.now(), settings }) : { how: "none", task: null, ids: [] };
  return { settings, state: { place, association, root: association.task, auto: association.how !== "explicit", overlay: association.task || leaseArg() ? null : "picker", waiting: Boolean(leaseArg()) && !association.task, console: settings.terminal.showLogs || has(args, "logs") || Boolean(flag(args, "logs")), session: sessionFlag(), layout: layoutWanted() } };
}

// A viewer an opener started BESIDE an AI CLI -- it carries the session's lease, or leaves once the task ended -- is a
// column, and starts as the pane a host docks (1.8.6); one a person started is the dashboard. --layout says otherwise.
const LAYOUT_FLAG = { pane: "pane", dashboard: "dashboard" };

function layoutWanted() {
  if (Object.hasOwn(LAYOUT_FLAG, flag(args, "layout") ?? "")) return LAYOUT_FLAG[flag(args, "layout")];
  return leaseArg() || untilDone() ? "pane" : "dashboard";
}

// Outside any repository on a machine that knows no checkout there is nothing to wait for; inside a repository Orbit
// has not written for yet, the viewer waits -- the first task started there binds it (tuiWorld `relocate`).
function startPlace(loc, explicit) {
  if (!loc && !quietly(() => repositoryAt(process.cwd())) && !createRegistry(stateRooms(storeBase(ENV)), io).list().length) throw new Blocked("no Orbit task can be shown: this directory is not a repository, and this machine knows no checkout Orbit has written for");
  return explicit && loc ? placeOfTask(loc, explicit) : placeOf(loc);
}

// What the header says about a checkout, from the registry: the project's name, the branch it last saw.
function placeOf(loc) {
  const found = loc ? quietly(() => createRegistry(stateRooms(loc.base), io).find(loc.key, loc.checkoutId)) : null;
  return loc ? { ...loc, project: found?.project?.name ?? loc.key, branch: found?.checkout?.summary?.branch ?? null } : null;
}

const showCtx = (loc) => ({ tasks: tasksOf(loc), checkout: loc.checkoutId, now: nowIso });

// A task this checkout's `show` refuses may be one another checkout of the same project created: its journal's
// first line says which, and the registry says whether this machine knows that checkout. Otherwise `show`'s
// own refusal stands, as for `watch`.
function placeOfTask(loc, id) {
  if (quietly(() => TASK_COMMANDS.show.run(showCtx(loc), [id]))) return placeOf(loc);
  const head = isTaskId(id) ? quietly(() => headOf(tasksOf(loc).journalFile(id))) : null;
  const other = head?.kind === "created" && head.checkout !== loc.checkoutId ? quietly(() => addressedAt(loc.key, head.checkout)) : null;
  if (!other) TASK_COMMANDS.show.run(showCtx(loc), [id]);
  return placeOf(other);
}

const tuiWorld = (followers, settings) => ({
  nowMs: () => Date.now(),
  followers,
  settings,
  projects: () => createRegistry(stateRooms(storeBase(ENV)), io).list(),
  rows: (place) => rowsOf(place, Date.now()),
  associate: (place) => chosen(place, { explicit: null, mark: taskSessionMark(ENV.ORBIT_SESSION), nowMs: Date.now(), settings }),
  session: (place) => sessionRead(place, taskSessionMark(ENV.ORBIT_SESSION), Date.now(), settings),
  work: (place) => workRead(place, taskSessionMark(ENV.ORBIT_SESSION), Date.now(), settings),
  locate: (key, id) => placeOf(addressedAt(key, id)),
  open: (place, id, cursor) => openFeed(deps(followers), openedTask(place, id), parseCursor(cursor)),
  show: (place, id) => TASK_COMMANDS.show.run(showCtx(place), [id]),
  console: (place, task, view) => sandboxConsole(place, task, view),
  relocate: () => (flag(args, "project") || flag(args, "checkout") ? null : placeOf(located(process.cwd()))),
  lease: leasePort(leaseArg()),
});

async function sandboxConsole(loc, task, view) {
  const env = stopOn(claimedEnvironment(view ?? { receipts: [] }));
  if (env === null) return { message: NO_SANDBOX };
  return consoleReader(await sandboxBound(loc, task, env), task, env);
}

const sessionsOf = (view) => view.components.filter((c) => c.session).map((c) => ({ session: c.session, component: c.component ?? null, state: c.state ?? null }));

async function consoleReader(s, task, env) {
  const sessions = async () => sessionsOf(await s.commands.sandbox.run(s.ctx, [`--task=${task}`]));
  const read = (session, stream, from) => s.commands["sandbox-logs"].run(s.ctx, [`--task=${task}`, `--session=${session}`, `--stream=${stream}`, `--from=${from}`]);
  return { env, sessions: await sessions(), refresh: sessions, read };
}

// The terminal is given back on every way out -- the viewer's own teardown, and the process's exit as a last
// resort -- and then ONE line says what the viewer left, never the screen it drew.
async function tuiRan(runTui, start) {
  const run = runTui(tuiWorld(createFollowers(), start.settings), tuiTerminal(), { start: start.state, ascii: has(args, "ascii"), untilDone: untilDone() });
  process.once("exit", run.restore);
  const got = await run;
  process.off("exit", run.restore);
  process.stderr.write(`${plainSafe(`live: ${got.why} — ${got.task ?? "no task"} ${got.lifecycle ?? ""} ${got.stage ?? ""} (cursor ${got.cursor ?? "t=0"}); the task itself is untouched`).replace(/ +/g, " ")}\n`, () => process.exit(0));
}

// ---- open: the full-screen viewer beside this session, returned from at once (cli/live-open.mjs) -----------

// An opener's program by its ABSOLUTE path, from absolute PATH directories outside this checkout only: a repository
// that puts its own directory on PATH cannot plant the `tmux` or `wt` this starts. Null when there is none.
// Paths compared as the disk names them (macOS spells its temp folders two ways), the checkout from its root down.
const real = (p) => quietly(() => realpathSync.native(p)) ?? resolve(p);

const checkoutRoot = () => real(quietly(() => repositoryAt(process.cwd())) ?? process.cwd());

const trustedDir = (dir) => isAbsolute(dir) && !(`${real(dir)}${sep}`).startsWith(`${checkoutRoot()}${sep}`);

const binOf = (name) => String(ENV.PATH ?? "").split(delimiter).filter(trustedDir).flatMap((dir) => [name, `${name}.exe`].map((f) => join(dir, f))).find((f) => existsSync(f)) ?? null;

async function open() {
  const o = await import("./live-open.mjs");
  const task = words(args)[0] ?? null;
  if (!o.taskShaped(task)) throw new Refused("a task is named by its id: tsk- and twelve hexadecimal characters");
  const viewer = { argv: o.viewerCommand({ node: process.execPath, cli: fileURLToPath(import.meta.url), task }), cwd: process.cwd(), env: o.passedEnv(ENV), ...besideOf() };
  return opened(o, viewer, o.openPlan(has(args, "print") ? o.OPENERS.at(-1) : o.openerOf(ENV, process.platform, binOf, companionSeen), viewer, binOf));
}

// What `open` says: opened, only when the opener itself said so; else why not, and the command to run instead.
// --auto (a workflow's start) says nothing at all when it opened nothing.
const opened = (o, viewer, plan) => ((started) => (has(args, "auto") && !started ? { opener: plan.id, started } : shown(o, viewer, plan, started)))(launched(plan));

const notOpened = (plan) => (plan.argv ? `could not open ${plan.id === "macos-terminal" ? "a Terminal window" : "a pane"} from here (a sandbox, or no display): run this in a second terminal:` : plan.say);

const shown = (o, viewer, plan, started) => printed({ opener: plan.id, started, say: started ? plan.say : notOpened(plan), command: o.typed(viewer) }, (r) => `${r.say}${r.started ? "" : `\n  ${r.command}`}`);

// The opener is run and WAITED for -- tmux, wt and `open` each return at once, once the pane or window exists --
// and only its own exit 0 counts as opened: a sandbox that lets the command run but not the window appear, or
// refuses the launch file (EPERM), is told so and handed the command. The macOS window runs a file in Orbit's own
// store, written again on every open (one per task); every other opener is an argument list.
const OPEN_TIMEOUT_MS = 5000;

function launched(plan, name = words(args)[0] ?? "this-checkout") {
  if (plan.request) return requested(plan.request, name);
  if (!plan.argv) return false;
  const argv = quietly(() => (plan.script ? [...plan.argv, scriptWritten(plan.script, name, plan.scriptExt)] : plan.argv));
  const got = argv ? spawnSync(argv[0], argv.slice(1), { stdio: "ignore", timeout: OPEN_TIMEOUT_MS }) : null;
  return got?.status === 0 && followedUp(plan.then);
}

// What an opener does once the pane exists (Windows Terminal: the focus moved back to the asking pane): asked, never
// waited on for a verdict -- the pane opened either way.
function followedUp(then) {
  if (then) quietly(() => spawnSync(then[0], then.slice(1), { stdio: "ignore", timeout: OPEN_TIMEOUT_MS }));
  return true;
}

// The VS Code companion's request (integrations/vscode-orbit-live): a file in the live room it watches, written whole.
// Leaving it is all Orbit does; the companion opens the split, and the viewer's own `ready` says it did.
function requested(request, name) {
  const file = join(liveRoom(), "requests", `${safeName(name)}.json`);
  mkdirSync(dirname(file), { recursive: true });
  return quietly(() => writeAtomic(file, `${JSON.stringify({ ...request, at: nowIso() })}\n`, io, false) ?? true) !== null;
}

// How a viewer sits beside the AI CLI: the share of the width and who keeps the keyboard (live settings, a person's),
// and -- asked only by an opener that needs it -- the processes this one runs under, one of them the terminal's shell.
const besideOf = () => ((pane) => ({ width: pane?.widthPercent ?? 36, focusCli: pane?.focusCli !== false, ancestry: () => proc().ancestry(process.pid) }))(quietly(() => readLive(io, settingsFile(null)).settings.pane));

// A companion is there while its heartbeat is fresh: one file per window, written every few seconds.
const COMPANION_FRESH_MS = 30_000;

const heartbeatFresh = (file) => ((doc) => Number.isFinite(Date.parse(doc?.heartbeatAt)) && Date.now() - Date.parse(doc.heartbeatAt) <= COMPANION_FRESH_MS)(quietly(() => JSON.parse(readFileSync(file, "utf8"))));

const companionSeen = (kind) => quietly(() => readdirSync(join(liveRoom(), "companions")).some((f) => f.startsWith(`${kind}-`) && f.endsWith(".json") && heartbeatFresh(join(liveRoom(), "companions", f)))) === true;

function scriptWritten(script, name, ext = ".command") {
  const file = join(stateRooms(storeBase(ENV)).live, "open", `${safeName(name)}${ext}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, script, { mode: 0o700 });
  chmodSync(file, 0o700);
  return file;
}

// ---- ensure: this session's viewer, opened once and reused (cli/live-ensure.mjs, ADR 0020) ---------------------

const PROCESS = { made: null };

const proc = () => (PROCESS.made ??= createProcess());

const hostId = () => (/^[a-z][a-z0-9-]{0,39}$/.test(ENV.ORBIT_HOST ?? "") ? ENV.ORBIT_HOST : "claude");

const machineName = () => safeName(hostname());

const liveRoom = () => stateRooms(storeBase(ENV)).live;

const entryOf = () => (flag(args, "entry") === "workflow" ? "workflow" : "help");

// The checkout this directory is in, by its id, whether Orbit has written for it yet or not: a session's viewer is
// kept per checkout, and the first /orbit-help in a new checkout comes before any Orbit write there.
function ensurePlace(cwd = process.cwd()) {
  const root = quietly(() => repositoryAt(cwd));
  const loc = root ? located(cwd) : null;
  return root ? { checkout: checkoutId(root), project: loc?.key ?? null, storeRoot: loc?.storeRoot ?? null } : null;
}

// What a person set in Orbit Control › Automation about opening Live by itself: the machine's document, then this
// project's, narrowed (src/automation/settings.mjs). Null when either cannot be read: an unreadable policy opens nothing.
function automationNow(place) {
  const machine = readAutomation(io, join(stateRooms(storeBase(ENV)).automation, "settings.json"));
  const project = place?.storeRoot ? readAutomation(io, join(place.storeRoot, "automation", "settings.json")) : { content: {}, unreadable: null };
  if (machine.unreadable || project.unreadable) return null;
  return ((v) => ({ open: v.live.open, display: v.live.display }))(effectiveOf([{ by: "machine", content: machine.content }, { by: "project", content: project.content }]).values);
}

// The hosts a person said they use interactively (live settings): the only attendance a host with no mark of its own has.
const declaredHosts = () => quietly(() => readLive(io, settingsFile(null)).settings.attendedHosts) ?? [];

function ensureWorld(o) {
  const place = ensurePlace();
  const opener = o.openerOf(ENV, process.platform, binOf, companionSeen);
  const viewer = ({ task, lease }) => ({ argv: o.viewerCommand({ node: process.execPath, cli: fileURLToPath(import.meta.url), task, lease, stay: true }), cwd: process.cwd(), env: o.passedEnv(ENV), ...besideOf() });
  return { io, nowMs: () => Date.now(), nowIso, liveRoom: liveRoom(), machine: machineName(), host: hostId(), session: taskSessionMark(ENV.ORBIT_SESSION), place, settings: () => quietly(() => automationNow(place)), live: switchOf(ENV, "LIVE", "live", true), attended: attendedOf(ENV, declaredHosts()), opener, plan: (v) => o.openPlan(opener, v, binOf), launch: (plan, key) => launched(plan, `viewer-${key}`), viewer, typed: (v) => o.typed(v), alive: (pid) => proc().alive(pid), startedAtOf: (pid) => proc().startedAtOf(pid), token: () => randomBytes(8).toString("hex"), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
}

async function ensured(entry, quiet) {
  const [o, e] = await Promise.all([import("./live-open.mjs"), import("./live-ensure.mjs")]);
  const task = words(args)[0] ?? null;
  if (!o.taskShaped(task)) throw new Refused("a task is named by its id: tsk- and twelve hexadecimal characters");
  const answer = await e.ensureViewer(ensureWorld(o), { entry, task });
  return quiet ? answer : printed(answer, ensureSay);
}

const ensureSay = (r) => `${r.say}${r.opened || !r.command ? "" : `\n  run it in a second terminal: ${r.command}`}`;

// ---- the viewer's side of its lease (src/live/lease.mjs) ----------------------------------------------------

const LEASE_ARG = /^([a-f0-9]{16})\.([a-f0-9]{16})$/;

const leaseArg = () => ((m) => (m ? { key: m[1], owner: m[2] } : null))(LEASE_ARG.exec(String(flag(args, "lease") ?? "")));

// Ready once it has drawn; a beat that also says what it shows and whether a person picked it; a peek between beats
// at what a launcher asked it to show; and what it left for. Each write is this viewer's own, only while it holds
// the lease, and a write that fails is a viewer that keeps showing, never one that crashes.
function leasePort(lease) {
  if (!lease) return null;
  const where = leaseWhere(liveRoom(), machineName(), lease.key);
  const me = { owner: lease.owner };
  return { ready: (f) => quietly(() => viewerReady(io, where, me, { ...f, at: nowIso(), pid: process.pid, pidStartedAt: proc().startedAtOf(process.pid) })), beat: (f) => quietly(() => viewerBeat(io, where, me, { ...f, at: nowIso() })) ?? { held: true, selection: null }, peek: () => ((l) => (l?.owner === me.owner ? l.selection ?? null : null))(quietly(() => readLease(io, where))), left: (why) => quietly(() => viewerLeft(io, where, me, { at: nowIso(), why })) };
}

// This session's viewer as `doctor` says it: whether one is open, and what the last ask came to.
function viewerNow() {
  const key = leaseKey({ host: hostId(), session: taskSessionMark(ENV.ORBIT_SESSION), checkout: ensurePlace()?.checkout });
  const lease = key ? readLease(io, leaseWhere(liveRoom(), machineName(), key)) : null;
  return key ? { lease, liveness: livenessOf(lease, { nowMs: Date.now(), alive: (pid) => proc().alive(pid), startedAtOf: (pid) => proc().startedAtOf(pid) }) } : null;
}

// ---- pane: the view a host docks beside its session (src/live/tui/pane.mjs, 1.8.5) ----------------------------

// 2 (1.8.6, ADR 0022): additive -- the LIVE indicator, task and test progress, the plan as a graph, the normalized
// timeline, and the Plan and Timeline views. A drawer that knows 1 reads a 2 the same way; one that knows 2 draws more.
export const PANE_VERSION = 2;

const PANE_DEFAULT = Object.freeze({ columns: 60, rows: 40 });

const sizeArg = (name) => ((n) => (Number.isInteger(n) && n >= 10 && n <= 1000 ? n : PANE_DEFAULT[name]))(Number(flag(args, name)));

async function pane() {
  const host = await import(`../skills/orbit-learn/hosts/${safeName(flag(args, "host") ?? "claude")}-statusline.mjs`);
  const input = host.sessionOf(quietly(() => JSON.parse(readFileSync(0, "utf8"))), ENV);
  const answer = quietly(() => paneAnswer(input, host)) ?? paneSaying("Orbit Live could not read this session's task here", "warning");
  await new Promise((resolve) => process.stdout.write(`${JSON.stringify(answer)}\n`, resolve));
}

const paneSaying = (text, tone = "subtle") => ({ version: PANE_VERSION, lease: null, held: false, task: null, header: [{ text: " ORBIT LIVE ", tone: "brand" }, { text: `  ${text}`, tone }], overview: [], now: [] });

function paneAnswer(input, host) {
  const root = input?.cwd ? quietly(() => repositoryAt(input.cwd)) : null;
  if (!root) return paneSaying("no repository here: Orbit Live follows a checkout's tasks");
  if (!host.enabled(ENV, io, storeBase(ENV))) return paneSaying("Orbit Live is switched off for this host (live, or ORBIT_LIVE=off)");
  return has(args, "auto") ? paneOpens(input.cwd) : paneShown(input, root, host);
}

const paneShown = (input, root, host) => ({ version: PANE_VERSION, ...paneLease(input, root), ...paneView(located(input.cwd), input), hints: host.PANE_HINTS ?? {} });

// Whether /orbit or /orbit-help opens the pane by itself here: the person's switches (live.open, Live display) and nothing else
// -- a host draws a pane only where a person is, and places it itself. Asking writes nothing, not even the lease.
function paneOpens(cwd) {
  const refused = switchRefusal({ live: true, settings: quietly(() => automationNow(ensurePlace(cwd))) });
  return { version: PANE_VERSION, opens: !refused, why: refused?.why ?? null };
}

// ---- the pane's lease: this session's viewer, while the pane is open ----------------------------------------

const tokenArg = () => ((m) => (m ? { key: m[1], owner: m[2] } : null))(LEASE_ARG.exec(String(flag(args, "lease") ?? "")));

function paneLease(input, root) {
  const key = leaseKey({ host: hostId(), session: input.mark, checkout: checkoutId(root) });
  const where = key ? leaseWhere(liveRoom(), machineName(), key) : null;
  if (!where) return { lease: null, held: false };
  return flag(args, "left") ? paneLeft(where) : paneHeld(where, key, input, root);
}

function paneLeft(where) {
  const me = tokenArg();
  if (me) quietly(() => viewerLeft(io, where, { owner: me.owner }, { at: nowIso(), why: String(flag(args, "left")).slice(0, 60) }));
  return { lease: null, held: false };
}

// Held when the pane already holds it, or when no viewer is there (none, gone, closed, a launch that failed); a
// window a launcher opened, still beating, keeps it -- the pane then shows the task and holds nothing.
const PANE_HOLDS = new Set(["none", "gone", "detached"]);

function paneHeld(where, key, input, root) {
  const me = tokenArg()?.key === key ? tokenArg().owner : null;
  const owner = me ?? randomBytes(8).toString("hex");
  const after = updateLease(io, where, (current) => paneRecord(current, { key, owner, mine: me !== null && current?.owner === me, session: input.mark, checkout: checkoutId(root) }));
  return after?.owner === owner && after.state === "ready" ? { lease: `${key}.${owner}`, held: true } : { lease: null, held: false };
}

function paneRecord(current, p) {
  const at = nowIso();
  if (p.mine) return { ...current, heartbeatAt: at };
  if (!PANE_HOLDS.has(livenessOf(current, { nowMs: Date.now(), alive: (pid) => proc().alive(pid), startedAtOf: () => null }).state)) return null;
  return { ...launching(current, { key: p.key, host: hostId(), session: p.session, checkout: p.checkout, machine: machineName(), owner: p.owner, opener: "pane", at, entry: "pane" }), state: "ready", readyAt: at, heartbeatAt: at };
}

// ---- the pane's picture: the same state the full-screen viewer would hold, laid out for a column ------------------

const framesOf = (c) => [...c.events.map((e) => ({ event: e.source === "task" ? "task-event" : "qa-event", id: c.cursor, data: e })), ...(c.view ? [{ event: "task-view", id: c.cursor, data: { view: c.view } }] : []), ...Object.entries(c.activity ?? {}).map(([action, view]) => ({ event: "activity-view", id: c.cursor, data: { action, revision: view.seq, view } })), ...(c.plan ? [{ event: "plan-view", id: c.cursor, data: { source: "plan", ref: c.plan.ref, revision: c.plan.n, view: c.plan } }] : []), ...(c.terminal ? [{ event: "end", id: c.cursor, data: { reason: "terminal" } }] : [])];

const fedWith = (state, loc, task, role, known) => ((c) => reduceTui(reduceTui(state, { type: "feed-opened", task, role }), { type: "frames", task, frames: framesOf(c) }))(collected(loc, task, known));

// The session's own activity rides along (1.8.7): with no task it IS what the pane shows, beside one it is what the
// host's own tools did since the task began. Read from the session's project root, never the shell's directory.
function paneView(loc, input) {
  const settings = settingsNow(loc);
  const association = loc ? chosen(loc, { explicit: null, mark: input.mark, nowMs: Date.now(), settings }) : { how: "none", task: null, ids: [], createdAt: null };
  const base = initialTui({ association, root: association.task, place: placeOf(loc), columns: sizeArg("columns"), rows: sizeArg("rows"), colour: false, nowMs: Date.now(), settings, auto: true, waiting: !association.task, activity: sessionRead(loc, input.mark, Date.now(), settings), work: workRead(loc, input.mark, Date.now(), settings) });
  const state = association.task ? withChild(fedWith(base, loc, association.task, "root", association.createdAt), loc) : base;
  return { task: association.task, look: { widthPercent: settings.pane?.widthPercent ?? 36, focusCli: settings.pane?.focusCli !== false }, ...paneOf(state) };
}

// A workflow's engineering task is read too, as the full-screen viewer follows it: its checks are what runs now.
const withChild = (state, loc) => ((child) => (child ? fedWith(state, loc, child, "child", null) : state))(tuiChildOf(state.tasks[state.root]?.view));

// ---- the table ------------------------------------------------------------------------------------

const COMMANDS = { status: { run: status }, statusline: { run: statusline }, pane: { run: pane }, watch: { run: watch }, tui: { run: tui }, ensure: { run: () => ensured(entryOf(), has(args, "quiet")) }, open: { run: () => (has(args, "auto") ? ensured("workflow", true) : open()) }, where: { run: where }, doctor: { run: doctor }, pin: { run: pin }, unpin: { run: unpin }, settings: { run: settings } };

if (Object.keys(COMMANDS).sort().join() !== [...OPERATION_NAMES].sort().join() || !OPERATIONS) throw new Error("cli/live.mjs and src/live/governance.mjs disagree about the live commands");

function quietly(fn) {
  try { return fn(); }
  catch { return null; }
}

function help() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const end = lines.findIndex((l) => !l.startsWith("//"));
  console.log(lines.slice(0, end).join("\n"));
}

// The status line and a docked pane answer on every refresh and must never turn a host's row or panel into an error:
// whatever goes wrong there prints nothing (the status line) or says so in the pane, and exits 0. Every other command
// keeps the engine's typed exits.
const ALWAYS_ZERO = { statusline: () => statusline(), pane: () => pane() };

if (Object.hasOwn(ALWAYS_ZERO, cmd ?? "")) ALWAYS_ZERO[cmd]().catch(() => null).then(() => process.exit(0));
if (!Object.hasOwn(ALWAYS_ZERO, cmd ?? "")) command(main);
