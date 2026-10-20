// Tracked works as control-server answers them, in memory: the list of a checkout's works and one work's view -- the ONE read
// model the terminal and Orbit Live read too. Reads only, like the real routes: a work is never written from a page. An unknown
// work is a 404 in the server's own words. This is a stand-in for the server, not a host: no hook, no session and no task ran.
import type { WorkList, WorkRow, WorkView } from "../features/work/work.types";
import { M_CHECKOUT, M_KEY, TASK } from "./fakeMission";
import { reply, type Call } from "./fakeServer";

export const WORK = "w-0123456789ab";
export const WORK_PAGE = `/work/${M_KEY}/checkouts/${M_CHECKOUT}/works/${WORK}`;
export const WORKS_API = `/api/v1/projects/${M_KEY}/checkouts/${M_CHECKOUT}/works`;

const at = (minute: number) => `2026-10-17T09:${String(minute).padStart(2, "0")}:00.000Z`;

/** A developer's work handed to an autonomous task: reported done with nothing owning that word yet. */
export function workView(over: Partial<WorkView> = {}): WorkView {
  return {
    schema: 1,
    work: WORK,
    title: "Fix the refund limit",
    ref: "PBI-482",
    requirement: { root: null, snapshot: null },
    checkout: M_CHECKOUT,
    tracked: true,
    mode: "autonomous",
    route: { to: "orbit-develop", because: "a small change", skill: "orbit-help", at: at(1) },
    lifecycle: { state: "REPORTED_DONE", word: "REPORTED DONE", glyph: "✓", tone: "success", terminal: true, say: "it was reported done; what stands behind that is the evidence level", why: "refund limit fixed", wait: null },
    liveness: "ENDED",
    evidence: { level: "reported", why: "reported by the host or a person; no owner confirmed it", say: "the host or a person reported an outcome; no owner confirmed it" },
    sessions: [{ session: "0123456789abcdef", host: "claude", state: "ENDED", lastAt: at(9) }],
    tasks: [{ task: TASK, what: "task", role: "handoff", lifecycle: "EXECUTING", stage: "REGRESSION", terminal: false, readable: true, linkedAt: at(4) }],
    handoffs: [{ at: at(4), from: "developer", to: "autonomous", task: TASK, because: "automation took it" }],
    activity: {
      observed: 6,
      partial: false,
      truncated: false,
      files: [{ path: "src/RefundService.cs", attribution: "observed" }, { path: "src/Shared.cs", attribution: "shared" }],
      checks: [{ at: at(6), class: "test", exe: "dotnet", what: "dotnet (named like a test)", result: "exit-ok", current: false }],
    },
    report: { at: at(8), outcome: "done", summary: "refund limit fixed", changed: [], checks: [], proved: ["the unit test ended ok"], unverified: ["the screen was not looked at"], blocked: [], evidence: [`task:${TASK}`] },
    summary: { request: "Fix the refund limit", changes: { files: [], count: 2, shared: 1, basis: "edit tools seen writing these paths -- not the checkout's diff" }, checks: [], proved: ["the unit test ended ok"], unverified: ["the screen was not looked at"], reportedBy: "host-or-person" },
    coverage: { host: "claude", observation: "automatic", edits: "observed", commands: "observed", outcome: "exit status (a failed command is reported as one)", sessionEnd: true, limits: [] },
    warnings: [],
    createdAt: at(0),
    updatedAt: at(8),
    ...over,
  };
}

const rowOf = (v: WorkView): WorkRow => ({ work: v.work, title: v.title, ref: v.ref, mode: v.mode, standing: "REPORTED_DONE", sessions: v.sessions.length, links: v.tasks.length, createdAt: v.createdAt, updatedAt: v.updatedAt });

export interface WorkState {
  view: WorkView | null;
}

const PROJECTS = { projects: [{ key: M_KEY, name: "payments", checkouts: [{ id: M_CHECKOUT, root: "/work/payments", exists: true, host: "laptop", lastSeen: at(9), summary: { understanding: "CURRENT", runtime: "STOPPED", branch: "main" } }] }] };

export function fakeWork(over: Partial<WorkState> = {}) {
  const state: WorkState = { view: workView(), ...over };
  const handle = (call: Call): Response | null => {
    if (call.path === "/api/v1/projects" && call.method === "GET") return reply(200, PROJECTS);
    if (call.path === WORKS_API && call.method === "GET") return reply(200, { works: state.view ? [rowOf(state.view)] : [] } satisfies WorkList);
    if (call.path === `${WORKS_API}/${WORK}` && call.method === "GET") return state.view ? reply(200, { work: state.view }) : reply(404, { error: { code: "WORK_UNKNOWN", message: "no tracked work like that is kept for this checkout" } });
    return null;
  };
  return { handle, state };
}
