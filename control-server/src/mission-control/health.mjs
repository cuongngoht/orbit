// HEALTH: what on this machine needs a person, read off what Orbit already keeps -- the task journals (through the
// same machine view Mission Control draws), the automation documents, the host catalog, the last tool and MCP
// observations. A look runs no probe, detects nothing, starts nothing and writes nothing: a GET.
//
// One ordered table of AREAS; each answers its rows, and an area with nothing to say answers one `ok` row, so a
// page always shows every area and never an empty one it cannot explain. A source that cannot be read is that
// area's `problem`, and costs the other areas nothing. A row may carry ONE action a person takes here (lifting a
// restriction they kept, which names the revision it was read on) or a link to where they act; it never carries
// a command, and nothing here decides a task's verdict.
import { readAutomation } from "../core.mjs";
import { machineFile, projectFile, readinessOf } from "../automation/read.mjs";
import { mcpNow } from "../mcp/view.mjs";
import { registryOf } from "../projects/read.mjs";
import { toolsNow } from "../tools/view.mjs";
import { missionControl } from "./read.mjs";

export const HEALTH_VERSION = 1;

const RUNNING = ["PREPARING", "EXECUTING", "VERIFYING"];

// A running task that has written nothing for this long may be one whose process died: reconcile reads it back.
const STALL_MS = 60 * 60 * 1000;

const LEVELS = ["ok", "info", "attention", "problem"];

const row = (area, level, title, say, extra = {}) => ({ area, level, title, say, ...extra });

// ---- tasks: what is waiting, stuck, stalled, orphaned or unreadable -----------------------------------------

const stalled = (t, nowMs) => RUNNING.includes(t.lifecycle) && nowMs - Date.parse(t.updatedAt ?? 0) > STALL_MS;

const terminalIds = (tasks) => new Set(tasks.filter((t) => t.terminal).map((t) => t.id));

const orphaned = (tasks) => ((ended) => tasks.filter((t) => t.parent && !t.terminal && ended.has(t.parent)))(terminalIds(tasks));

const taskLink = (t) => ({ task: { key: t.project, checkout: t.checkout, task: t.id } });

const TASK_ROWS = [
  (v) => (v.counts.waitingApproval ? [row("tasks", "attention", `${v.counts.waitingApproval} task(s) wait for a person's approval`, "Each names what it wants to do, why and the risk; approving it is spent on that one action.", { link: { to: "approvals" } })] : []),
  (v) => v.tasks.filter((t) => t.lifecycle === "BLOCKED").map((t) => row("tasks", "attention", `Blocked: ${t.objective}`, t.decision?.observed ?? `stopped with ${t.stopReason ?? "a block"}; it names who must act`, { link: taskLink(t) })),
  (v, nowMs) => v.tasks.filter((t) => !t.unreadable && stalled(t, nowMs)).map((t) => row("tasks", "attention", `No progress recorded for over an hour: ${t.objective}`, "Its process may have stopped. Reconcile reads an unsettled step back and never runs it twice.", { link: taskLink(t) })),
  (v) => orphaned(v.tasks.filter((t) => !t.unreadable)).map((t) => row("tasks", "attention", `Its workflow ended, it did not: ${t.objective}`, `Started by ${t.parent}, which is over; a person decides whether to cancel it.`, { link: taskLink(t) })),
  (v) => v.tasks.filter((t) => t.unreadable).map((t) => row("tasks", "problem", `A task cannot be read (${t.id})`, t.why)),
  (v) => v.problems.map((p) => row("tasks", "problem", `The tasks of ${p.name ?? p.project} cannot be read`, p.why)),
];

function taskRows(ctx) {
  const view = missionControl(ctx);
  return TASK_ROWS.flatMap((r) => r(view, ctx.now().getTime()));
}

// ---- resources: tools and Orbit-managed MCP servers a person enabled that are not ready -----------------------

const toolRows = (ctx) => toolsNow(ctx).filter((t) => t.enabled && !t.available).map((t) => row("resources", "attention", `Tool ${t.name ?? t.id} is enabled but not ready`, t.reason ?? `its last observation says ${t.status}`, { link: { to: `tools/${t.id}` } }));

const mcpRows = (ctx) => mcpNow(ctx).filter((m) => m.ownership === "orbit-managed" && m.enabled && !m.available).map((m) => row("resources", "attention", `MCP server ${m.name ?? m.id} is enabled but not usable`, m.why ?? m.reason ?? `its state is ${m.state}`, { link: { to: `mcp/managed/${m.id}` } }));

const resourceRows = (ctx) => [...toolRows(ctx), ...mcpRows(ctx)];

// ---- hosts: what each agentic host can do here -------------------------------------------------------------

const hostRow = (h) => (h.statusLine === "not-installed" ? [row("hosts", "info", `${h.name}: Orbit Live's status line is not installed`, "Optional: node <engine>/cli/host.mjs render --host=claude --kind=statusline, then apply it with --human.")] : []);

const hostRows = (ctx) => readinessOf(ctx).flatMap(hostRow);

// ---- the table -----------------------------------------------------------------------------------------------

const AREAS = [
  { id: "automation", rows: automationRows, ok: "Autonomous by default: a task named to /orbit-help is coordinated, and every action is gated by its own class." },
  { id: "tasks", rows: taskRows, ok: "No task waits for a person, is blocked, stalled or orphaned." },
  { id: "resources", rows: resourceRows, ok: "Every tool and Orbit-managed MCP server that is enabled is ready." },
  { id: "hosts", rows: hostRows, ok: "Every agentic host has what Orbit can use there." },
];

function rowsOf(ctx, area) {
  try { return area.rows(ctx); }
  catch { return [row(area.id, "problem", `Orbit could not read what ${area.id} needs`, "The rest of this page is unaffected; reading it again may succeed.")]; }
}

const areaRows = (ctx, area) => ((rows) => (rows.length ? rows : [row(area.id, "ok", "Nothing needs a person", area.ok)]))(rowsOf(ctx, area));

const worst = (rows) => LEVELS[Math.max(...rows.map((r) => LEVELS.indexOf(r.level)))];

export function missionHealth(ctx) {
  const checks = AREAS.flatMap((a) => areaRows(ctx, a));
  return { version: HEALTH_VERSION, at: ctx.now().toISOString(), status: worst(checks), areas: AREAS.map((a) => a.id), checks, hosts: readinessOf(ctx) };
}

function automationRows(ctx) {
  readAutomation(ctx.world.io, machineFile(ctx));
  for (const project of registryOf(ctx).list()) readAutomation(ctx.world.io, projectFile(ctx, project.key));
  return [];
}
