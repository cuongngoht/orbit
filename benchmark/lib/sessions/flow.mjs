// THE FLOW of one SESSIONS benchmark run (0.5.0, backlog B3, ADR 0054): a QA case worked in two sessions over ONE
// checkout of the application and the stores the first one left -- does memory make the second session better, and
// never worse? Every phase is the QA flow's own (lib/qa/flow.mjs), read off the task's journal the same way, so a run
// interrupted anywhere is carried on from there and a host's round is never sent again.
//
//   attempt 1 (`fresh`)
//     ENVIRONMENT  benchmark.learn.target    session 1's application -- the planted one, or the clean one when the case
//                                            learns on what the code then moves away from -- assembled fresh in the
//                                            one checkout both sessions share, seated, its sandbox up, inv-1 opened
//     TESTING      benchmark.learn.qa        session 1's round, with memory on: it LEARNS
//     REVIEWING    benchmark.learn.readback  what inv-1 came to, finished (its checkpoint projects into knowledge), read
//     ENVIRONMENT  benchmark.carry           what session 1 left is carried over as it is -- the engine's store, the
//                                            host's Orbit store, the host's own home -- the application moved to the
//                                            planted variant when session 1 learned on the clean one, and the case's
//                                            POISON planted in the host's own memory; what was kept is recorded
//     ENVIRONMENT  benchmark.target          session 2: the same checkout, a sandbox and an investigation of its own
//     TESTING      benchmark.qa              session 2's round, on the run's MEMORY ARM: `on` as a person has it, `off`
//                                            with ORBIT_LEARN=off and ORBIT_HOST_MEMORY=off in every Orbit process of it
//     REVIEWING    benchmark.readback        what inv-2 came to, and the host's work there (decisions, designs refused)
//     REGRESSION   benchmark.confirm         inv-2's contradictions replayed on the clean application, as for QA
//   ending       the QA judge's verdict on session 2 -- the very rows a QA run of the case is held to
//
// A control's scripted hosts run in this process as a QA control's do: session 1 by its learning host (`learnHost`,
// the reference by default), session 2 by its own -- and session 2's host is handed what the earlier session left and
// what its memory says, so the hosts only a second session can be (lib/qa/hosts.mjs) can act on them.
//
//   carriedSessions(ctx) -> { outcome, exit, summary }      learnSession(ctx) · measuredSession(ctx) · ARM_ENV · HOME
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha } from "../../../src/hash.mjs";
import { docRead } from "../core/room.mjs";
import { blocked, carriedBy, closedWith, confirmedEnding, engineOf, phase, QA_TYPES, sessionRan, show } from "../qa/flow.mjs";

export const LEARN_TYPES = { target: "benchmark.learn.target", qa: "benchmark.learn.qa", readback: "benchmark.learn.readback" };

// The phases a host's round runs under: never sent again.
export const ROUND_TYPES = [LEARN_TYPES.qa, QA_TYPES.qa];

// What each memory arm sets in every Orbit process of the second session: the host's plugin and the engine beside the
// controller alike. `on` is the default a person has.
export const ARM_ENV = { on: {}, off: { ORBIT_LEARN: "off", ORBIT_HOST_MEMORY: "off" } };

// Where the host's own home is, in the runner, for both sessions of a run: kept in the run's room between them, so
// what the host's own memory holds after session 1 is what session 2 starts with.
export const HOME = "/work/home";

// Where Claude Code keeps its own memory of a project, under the host's home: the project being the directory it runs
// in, /work/repo, by its path with each separator a dash.
export const MEMORY_DIR = [".claude", "projects", "-work-repo", "memory"];

const sharedDir = (ctx) => ctx.room.at("targets", "sessions", ctx.case.target.stack);

const homeDir = (ctx) => ((dir) => (mkdirSync(dir, { recursive: true }), dir))(ctx.room.at("home"));

const runnerOf = (ctx, arm) => ({ mounts: [{ source: homeDir(ctx), target: HOME, readOnly: false }], values: { HOME, ...ARM_ENV[arm] } });

const learnVariant = (ctx) => (ctx.case.sessions.learn === "clean" ? ctx.case.target.clean : ctx.case.target.variant);

// Session 1: the application assembled fresh in the shared checkout, carried by the run's host -- or a control's
// learning host -- with memory on: it learns.
export const learnSession = (ctx) => ({ key: "learn", variant: learnVariant(ctx), dir: sharedDir(ctx), task: `${learnVariant(ctx)}\u0000learn`, fresh: true, round: 1, of: 2, host: ctx.host === "coding-host" ? ctx.host : ctx.learnHost ?? "reference", types: LEARN_TYPES, env: {}, runner: runnerOf(ctx, "on"), says: ctx.case.sessions.learn === "clean" ? "with nothing planted, for the first session to learn on" : "with its variant planted, for the first session to learn on" });

// Session 2: the same checkout as session 1 left it -- moved, when it learned on the clean application -- the run's own
// host, and memory as its arm says.
export const measuredSession = (ctx) => ({ key: "measured", variant: ctx.case.target.variant, dir: sharedDir(ctx), task: `${ctx.case.target.variant}\u0000measured`, fresh: false, round: 2, of: 2, host: ctx.host, types: QA_TYPES, env: ARM_ENV[ctx.memory ?? "on"], runner: runnerOf(ctx, ctx.memory ?? "on"), says: "with its variant planted, for the second session", scripted: handedOf });

// ---- what a second session's scripted host is handed ---------------------------------------------------------------------

const settledDoc = (ctx, type) => ((a) => (a ? docRead(ctx.room, `steps/${a.id}.json`) : null))((show(ctx).actions ?? []).filter((x) => x.type === type && x.state === "succeeded").at(-1));

// The versions session 1 froze, with the shape each was for: what a host that carries its evidence over would run.
const versionsOf = (lines) => lines.filter((l) => l.kind === "version").map((v) => ({ version: v.version, shape: lines.find((o) => o.kind === "obligation" && o.obligation === lines.find((d) => d.kind === "designed" && d.design === v.design)?.obligation)?.shape ?? null })).filter((v) => v.shape);

async function earlierOf(ctx) {
  const inv = settledDoc(ctx, LEARN_TYPES.target)?.investigation ?? null;
  const e = await engineOf(ctx, learnSession(ctx));
  return { investigation: inv, versions: inv ? versionsOf(e.journal(inv)) : [] };
}

// What the host's memory says, as the run planted it: the poison's lesson and stale fact -- or nothing.
const memoryOf = (ctx) => ((p) => (p ? { skip: p.skip, stale: p.stale } : null))(settledDoc(ctx, "benchmark.carry")?.poison ?? null);

async function handedOf(ctx) {
  const earlier = await earlierOf(ctx);
  return { earlier: () => earlier, memory: () => memoryOf(ctx) };
}

// ---- what is carried from session 1 to session 2 -------------------------------------------------------------------------

const MAX_FILES = 20000;

// A kept store, as data: how many files, how many bytes -- bounded, a link never followed (a link is no file here).
function sizeOf(dir) {
  const files = existsSync(dir) ? readdirSync(dir, { recursive: true }).slice(0, MAX_FILES).map((rel) => join(dir, rel)).filter((f) => lstatSync(f, { throwIfNoEntry: false })?.isFile()) : [];
  return { files: files.length, bytes: files.reduce((n, f) => n + lstatSync(f).size, 0) };
}

const notesIn = (ctx) => ((dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".md")).sort() : []))(join(homeDir(ctx), ...MEMORY_DIR));

const investigationsIn = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((rel) => /(^|[\\/])autonomous-qa[\\/]investigations[\\/][^\\/]+$/.test(rel)).map((rel) => rel.split(/[\\/]/).at(-1)).sort() : []);

// What session 2 starts from, as the stores hold it once session 1 ended (and before anything is planted).
const keptOf = (ctx) => ({ engine: { ...sizeOf(ctx.engineStore), investigations: investigationsIn(ctx.engineStore) }, runner: sizeOf(ctx.runnerStore), home: { ...sizeOf(homeDir(ctx)), notes: notesIn(ctx) } });

// The poison, planted in the host's own memory as the host would keep a note: the note itself, and a line pointing at it
// in the memory's index.
function planted(ctx) {
  const dir = join(homeDir(ctx), ...MEMORY_DIR);
  const text = readFileSync(join(ctx.frozenCase, ctx.case.poison.note), "utf8");
  mkdirSync(dir, { recursive: true });
  [["MEMORY.md", `- [what the last session settled](${noteName(ctx)}) — read it before testing again\n`], [noteName(ctx), text]].forEach(([name, body]) => writeFileSync(join(dir, name), body));
  return { into: "host-memory", at: [HOME, ...MEMORY_DIR, noteName(ctx)].join("/"), digest: sha(text), skip: ctx.case.poison.skip, stale: ctx.case.poison.stale };
}

const noteName = (ctx) => ctx.case.poison.note.split("/").at(-1);

// The code moved under what session 1 learned: the planted variant committed over the shared checkout.
const movedOf = async (ctx) => (ctx.case.sessions.learn === "clean" ? { from: ctx.case.target.clean, to: ctx.case.target.variant, commit: await (await engineOf(ctx, learnSession(ctx))).movedTo(ctx.case.target.variant) } : null);

async function carryBody(ctx) {
  const kept = keptOf(ctx);
  const moved = await movedOf(ctx);
  const poison = ctx.case.poison ? planted(ctx) : null;
  return { doc: { arm: ctx.memory ?? "on", kept, moved, poison }, summary: `${kept.engine.investigations.length} investigation(s) and ${kept.home.notes.length} host memory note(s) kept${moved ? `; the application moved to ${moved.to}` : ""}${poison ? "; a poisoned note planted in the host's memory" : ""}` };
}

// ---- the whole run --------------------------------------------------------------------------------------------------------

async function sessions(ctx) {
  const learned = await sessionRan(ctx, learnSession(ctx));
  if (learned.blocked) return closedWith(ctx, blocked(`the learning session: ${learned.blocked}`));
  await phase(ctx, { type: "benchmark.carry", stage: "ENVIRONMENT", because: "what the learning session left, carried to the next as it is", label: "the stores kept, the code moved, the poison planted", body: () => carryBody(ctx) });
  const m = await sessionRan(ctx, measuredSession(ctx));
  return m.blocked ? closedWith(ctx, blocked(m.blocked)) : confirmedEnding(ctx, m.rb);
}

export const carriedSessions = (ctx) => carriedBy(ctx, sessions, ROUND_TYPES);
