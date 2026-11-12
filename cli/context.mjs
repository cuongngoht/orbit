#!/usr/bin/env node
// PROJECT CONTEXT for one task -- the engine's built-in `project.context`,
// which orbit-develop asks for before it reads any source.
//
//   node cli/context.mjs --for="<the task, in one sentence>" [--work=<w-…>] [--json]
//   node cli/context.mjs --with-refs [--work=<w-…>] [--json] < refs.json
//                        stdin: { "task": "…", "refs": [{ "kind": "file|symbol", "ref": "…", "why": "…" }] }
//
// Memory first and bounded to the task: architecture, technology and
// engineering are each asked of their own memory-first command (a CURRENT
// answer costs a few git calls; only a scope the task touches that moved is
// re-read), the working set is counted, and the resolver says which resources
// the task needs (src/context/sections.mjs). Each section is clipped; one that
// cannot answer says UNKNOWN. Nothing here scans the whole repository, installs
// or enables anything, or keeps the task text.
//
// Every command runs through the Process port: argv, never a shell, so a task
// that contains `;` is part of an argument and never a second command.
//
// It opens with STATUS (1.8.9, src/context/status.mjs): one word for how much of
// this context rests on evidence -- NOT_INITIALIZED · BLOCKED · BOOTSTRAPPED ·
// STALE · PARTIAL · READY -- read off what is kept and which sections had
// anything to stand on, never off how many sections came back. `--json` carries
// it as `status`, which a workflow's context step reports as it is.
//
// Then SUFFICIENCY (0.5.0, src/context/sufficiency.mjs): ENOUGH · DISCOVER ·
// ASK, whether what the task touches is grounded well enough to choose scope
// on -- DISCOVER names the targeted reads that would fill the gap, ASK the one
// question already open about the task's own work that only a person answers.
// RELEVANT (src/context/relevance.mjs, composed in cli/context-grounding.mjs)
// lists what the task touches -- files, symbols, components and checks, each
// with its class, its evidence, its freshness and who found it -- from what the
// owners already hold, at most 40 with the rest counted. `--with-refs` adds the
// host's own references: each is verified against the tracked tree, and one the
// tree does not hold is refused by name and never listed. `--json` carries
// `relevant`, `relevance` (the counts, every refused reference, and every
// direct file no relation adapter reads) and `sufficiency`.
//
// SUFFICIENCY also answers three LEVELS (0.6.0): whether there is enough to
// investigate, to change and to conclude, each with what it rests on or still
// misses -- one line each, and `sufficiency.levels` in `--json`. `--work=<w-…>`
// names the task's own work: its checkpoints are the ROUNDS of a bounded
// discovery loop (src/work/rounds.mjs) -- the round state is printed (`rounds`
// in `--json`), and a DISCOVER target that a settled, unmoved need already
// answered is not offered again. It only reads; `work need | settle |
// checkpoint | resume` write.
//
// Exit 0 = printed (a section may still say UNKNOWN) · 2 = bad usage.
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realWorld } from "../skills/orbit-control/world.mjs";
import { createArchitecture } from "../src/architecture/store.mjs";
import { envelopeOf } from "../src/context/refs.mjs";
import { relevanceLines } from "../src/context/relevance.mjs";
import { SECTION_LINES, SECTIONS, sectionOf, taskOf, workingSetSection } from "../src/context/sections.mjs";
import { blockedOf, statusOf } from "../src/context/status.mjs";
import { levelLines, sufficiencyLines } from "../src/context/sufficiency.mjs";
import { Refused } from "../src/errors.mjs";
import { projectCapabilities } from "../src/extensions/capabilities.mjs";
import { printable } from "../src/printable.mjs";
import { createProcess } from "../src/process/index.mjs";
import { command } from "../src/project/command.mjs";
import { loadProject } from "../src/project/index.mjs";
import { knownCheckout } from "../src/project/repository.mjs";
import { workingSetDir } from "../src/project/runtime.mjs";
import { effectiveResourcesOf } from "../src/resources/compose.mjs";
import { formatDecision } from "../src/routing/format.mjs";
import { route } from "../src/routing/resolve.mjs";
import { createWorkingSet } from "../src/engineering/working-set/store.mjs";
import { fold } from "../src/engineering/working-set/fold.mjs";
import { machineContext } from "../src/store/context.mjs";
import { realIo } from "../src/store/io.mjs";
import { groundingOf } from "./context-grounding.mjs";

import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
const ENV = commandEnvironment(process.env, process.argv);
const nativeFactory = await (await import("../skills/orbit-learn/hosts/resources.mjs")).resourceFactory(ENV);

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const SECTION_TIMEOUT_MS = 180_000;
const USAGE = 'usage: node cli/context.mjs --for="<the task, in one sentence>" [--work=<w-…>] [--json] · node cli/context.mjs --with-refs [--work=<w-…>] [--json] < { "task": "…", "refs": [{ "kind": "file|symbol", "ref": "…", "why": "…" }] }';

const forFlag = (args) => args.find((a) => a.startsWith("--for="))?.slice(6);

const withRefs = (envelope, flagged) => (envelope.problem ? envelope : { task: envelope.task ?? flagged, refs: envelope.refs });

// What the task is, and what the host proposed: `--with-refs` reads the envelope on stdin, `--for-stdin` the task alone.
function inputOf(args) {
  if (args.includes("--with-refs") && args.includes("--for-stdin")) return { problem: '--with-refs and --for-stdin both read stdin: put the task in the envelope\'s "task"' };
  if (args.includes("--with-refs")) return withRefs(envelopeOf(readFileSync(0, "utf8")), forFlag(args));
  return { task: args.includes("--for-stdin") ? readFileSync(0, "utf8") : forFlag(args), refs: [] };
}

const INPUT = inputOf(argv);
const TASK = taskOf(INPUT.task);

// `--work=<w-…>` (0.6.0, U2): the task's own work, whose checkpoints are the rounds of this look. Read, never written.
const WORK_ID = /^w-[0-9a-f]{12}$/;
const WORK = argv.find((a) => a.startsWith("--work="))?.slice(7) ?? null;

async function main() {
  refusedInput();
  const project = quietly(() => loadProject(ENV, process.cwd()));
  const ran = preflight(project);
  return shown(statusFor(project, ran.sections), ran.sections, route(TASK, await resources(project)), groundingFor(project, ran.worked));
}

function refusedInput() {
  if (INPUT.problem) throw new Refused(INPUT.problem);
  if (!TASK) throw new Refused(USAGE);
  if (WORK !== null && !WORK_ID.test(WORK)) throw new Refused(`--work names a work by its id (w- and twelve hex digits): ${USAGE}`);
}

// What the context amounts to, asked AFTER every section ran: `architecture ensure` may just have learned what there
// was to learn, and a word taken before it would describe a project that no longer exists.
const statusFor = (project, sections) => statusOf({ bound: knownCheckout(project), sections: sections.map(({ id, known }) => ({ id, known })), architecture: architectureCounts(project), blocked: blockedOf(sections) });

function architectureCounts(project) {
  const arch = project ? quietly(() => createArchitecture(machineContext({ project, config: project.config }, ENV).store.root, realIo())) : null;
  const all = quietly(() => arch?.all()) ?? [];
  return { total: all.length, stale: all.filter((f) => f.status === "stale").length, scanned: Boolean(quietly(() => arch?.model().model)) };
}

const processes = createProcess({ timeoutMs: SECTION_TIMEOUT_MS });

const asked = (s) => sectionOf(s, processes.run(process.execPath, [join(PLUGIN_ROOT, s.argv(TASK)[0]), ...s.argv("").slice(1).filter((a) => !a.startsWith("--for=")), "--for-stdin"], { input: TASK, env: ENV }));

// What the latest session read, changed and ran, and how many sessions are kept: asked once, for the WORKING SET
// section and for what the task touches.
function workedOn(project) {
  if (!project) return { latest: null, sessions: 0 };
  const ws = createWorkingSet(workingSetDir(project), realIo());
  return { latest: fold(currentLines(ws)), sessions: realIo().list(ws.dir).filter((n) => n.endsWith(".jsonl")).length };
}

async function resources(project) {
  const caps = project ? await quietlyAsync(() => projectCapabilities(project, ENV)) : [];
  return effectiveResourcesOf({ ...realWorld({ pluginRoot: PLUGIN_ROOT, projectRoot: process.cwd(), env: ENV, nativeFactory }), capabilities: () => caps ?? [] });
}

// The knowledge owner's own answer for the task, as its JSON: asked only when the store holds a claim.
const claimsAnswer = () => ((r) => (r.ok ? JSON.parse(r.out) : null))(processes.run(process.execPath, [join(PLUGIN_ROOT, "cli", "knowledge.mjs"), "claims", "--for-stdin", "--json"], { input: TASK, env: ENV }));

const groundingFor = (project, worked) => groundingOf({ env: ENV, pluginRoot: PLUGIN_ROOT, cwd: process.cwd(), project, task: TASK, refs: INPUT.refs ?? [], workingSet: worked.latest, claims: claimsAnswer, work: WORK });

function shown(status, sections, decision, grounding) {
  if (argv.includes("--json")) return console.log(JSON.stringify({ status, sections, decision, ...grounding }, null, 2));
  opening(status, grounding.sufficiency, grounding.rounds);
  for (const s of sections) console.log(`== ${s.title} ==\n${s.lines.join("\n")}\n`);
  closing(decision, grounding);
  unknowns(sections);
}

const opening = (status, sufficiency, rounds) => console.log(`STATUS  ${status.word} -- ${status.because}\n${[...sufficiencyLines(sufficiency), ...levelLines(sufficiency), ...roundLines(sufficiency, rounds)].map(printable).join("\n")}\n\nPROJECT CONTEXT  memory first, bounded to the task\n`);

// The round state of `--work=`'s loop, and how many targets were not offered again because what answered them holds.
const withheldLine = (s) => (s.withheld ? [`  withheld    ${s.withheld} target(s) a settled, unmoved need already answered`] : []);

const roundLines = (s, r) => (!r ? [] : r.problem ? [`ROUNDS  ${r.problem}`] : [`ROUNDS  ${r.work} · ${r.rounds} of ${r.max} · ${r.stop ? `STOP (${r.row})` : "go on"} -- ${r.because}`, ...withheldLine(s)]);

function closing(decision, grounding) {
  console.log(`== RELEVANT ==\n${relevanceLines(grounding.relevant, grounding.relevance, SECTION_LINES).join("\n")}\n`);
  console.log(`== RESOURCES ==\n${formatDecision(decision, { callVia: `node ${join(PLUGIN_ROOT, "cli", "mcp.mjs")} call` }) ?? "nothing beyond what this session already has"}`);
}

function unknowns(sections) {
  const gaps = sections.filter((s) => !s.known);
  if (gaps.length) console.log(`\nUNKNOWN\n${gaps.map((s) => `  ${s.id} -- a gap, not permission to guess`).join("\n")}`);
}

function quietly(fn) {
  try { return fn(); }
  catch { return null; }
}

async function quietlyAsync(fn) {
  try { return await fn(); }
  catch { return null; }
}

command(main);

function currentLines(ws) { return ENV.ORBIT_SESSION ? ws.read(ENV.ORBIT_SESSION) : ENV.ORBIT_HOST_PROTOCOL === "2" ? [] : ws.latest(); }

function preflight(project) {
  if (project?.isolated) processes.run(process.execPath, [join(PLUGIN_ROOT, 'cli/finalize.mjs')], { env: ENV, timeoutMs: 15000 });
  const sections = SECTIONS.map(asked);
  const worked = workedOn(project);
  return { worked, sections: [...sections, workingSetSection(worked.latest, worked.sessions)] };
}
