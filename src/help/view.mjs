// The project navigator's one view: PROJECT, the TASK's intent when one was
// named, what is known, what is not, what blocks a plan, and exactly one
// recommendation with its reason. Printed or
// `--json` — the same gathered state either way, so neither form can drift
// from the other.
import { out } from "../query/format.mjs";
import { blockersOf, gatherState, taskArg, unknownOf } from "./model.mjs";
import { recommend } from "./vocab.mjs";

export function help(ctx, args) {
  const state = gatherState(ctx, taskArg(args));
  const route = recommend(state);
  if (args.includes("--json")) return out(JSON.stringify(payload(ctx, state, route), null, 2));
  printed(ctx, state, route);
}

function payload(ctx, state, route) {
  return { project: ctx.config.name, status: state.status, understanding: state, unknown: unknownOf(state), blockers: blockersOf(ctx), capabilities: ctx.capabilities ?? [], next: route.id, run: route.run, because: route.because(state) };
}

function printed(ctx, state, route) {
  heading(ctx, state);
  understanding(state);
  for (const [title, rows] of listed(ctx, state)) section(title, rows);
  nextSection(route, state);
}

const listed = (ctx, state) => [["UNKNOWN", unknownOf(state)], ["BLOCKERS", blockersOf(ctx)], ["CAPABILITIES", capabilityRows(ctx, state)]];

// 1.8.9: STATUS -- how much of what is known here rests on evidence (src/context/status.mjs) -- says first whether
// this project is understood, bootstrapped, or not yet known at all.
function heading(ctx, state) {
  out(`PROJECT       ${ctx.config.name}`);
  out(`STATUS        ${state.status.word} — ${state.status.because}\n`);
  if (state.task) out(`TASK          ${state.task.intent} (${state.task.confidence} confidence)\n`);
}

// What Orbit can do here, said when nobody named a task: one line per workflow that ships, from the plugin's own
// catalog (handed in by cli/help.mjs) -- a list of doors, never a recommendation.
const capabilityRows = (ctx, state) => (state.task ? [] : (ctx.capabilities ?? []).map((c) => `${c.id.padEnd(30)} ${c.summary}`));

function understanding(state) {
  out("UNDERSTANDING");
  for (const line of understandingRows(state)) out(line);
}

const understandingRows = (state) => [
  `  architecture   ${state.architecture.total} fact(s) — ${state.architecture.fresh} fresh · ${state.architecture.stale} stale · ${state.architecture.unknown} unknown`,
  `  engineering    ${state.engineering.total} fact(s) — ${state.engineering.enforced} enforced · ${state.engineering.adopted} adopted · ${state.engineering.stale} stale`,
  `  working set    ${state.workingSet.sessions} session(s) kept here — the latest read ${state.workingSet.read} · changed ${state.workingSet.changed} · ran ${state.workingSet.commands} command(s)`,
  `  work           ${state.work.total} kept — ${state.work.open} resting on a requirement not yet complete · ${state.work.blocked} blocked`,
  `  map            ${state.map.screens} screen(s) · ${state.map.edges} edge(s)`,
  `  qa plan(s)     ${state.qa.plans} — ${state.qa.clean} clean · ${state.qa.errors} with error(s)`,
  `  lessons        ${state.learn.total} — ${state.learn.validated} validated · ${state.learn.candidate} candidate`,
];

function section(title, rows) {
  if (!rows.length) return;
  out(`\n${title}`);
  for (const r of rows) out(`  ${r}`);
}

function nextSection(route, state) {
  out(`\nNEXT          ${route.run}`);
  out(`BECAUSE       ${route.because(state)}`);
}

// A checkout the navigator cannot read (no UI test data) still answers a named task Automation would take:
// a coordinated workflow needs no UI map, so its one recommendation does not wait on one. Same two shapes;
// what could not be read is said under UNKNOWN. Null when Automation would not take the task -- the caller
// then refuses exactly as before.
const UNREAD = "this checkout's UI test data — the navigator could not read it (a coordinated workflow does not need it)";

export function automationOnly(automation, task, args, project) {
  const state = { architecture: { total: 1, stale: 0 }, map: { screens: 1 }, qa: { plans: 1, errors: 0 }, work: { open: 0 }, task: { intent: null }, automation };
  const route = recommend(state);
  if (route.id !== "automation" || !task) return null;
  return args.includes("--json") ? out(JSON.stringify({ project, understanding: null, unknown: [UNREAD], blockers: [], next: route.id, run: route.run, because: route.because(state) }, null, 2)) : out([`PROJECT       ${project ?? "(not read)"}`, `\nUNKNOWN\n  ${UNREAD}`, `\nNEXT          ${route.run} --for="<the task>"`, `BECAUSE       ${route.because(state)}`].join("\n"));
}
