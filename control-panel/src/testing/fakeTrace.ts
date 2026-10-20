// An in-memory stand-in for control-server's SESSION TRAIL reads -- the Trace
// page's turns and the Analytics page's usage -- in the shapes the real ones
// answer with (control-server/src/trace/read.mjs). Like fakeServer it replaces
// fetch and nothing else. The trail holds metadata only, so neither does this:
// there is no prompt text here for a page to show.
import type { Recording, TurnDetail, TurnRow, UsageResponse } from "../features/trace/trace.types";
import type { Call } from "./fakeServer";

// fakeServer's own `reply`, restated: fakeServer answers an empty trail by
// default through this module, and a value import back would make the two a cycle.
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const RECORDING: Recording = { where: "this machine's Orbit store only — never sent anywhere", retentionDays: 90, switch: "the plugin's Trace option, or ORBIT_TRACE=off", never: ["a prompt's text", "a response", "a command's arguments", "a tool's output", "a path", "a file's contents"] };

export function fakeTurn(over: Partial<TurnDetail> = {}): TurnDetail {
  return {
    id: "e-mfx1a2b3-0a1b2c3d",
    session: "s-1",
    project: "p-1",
    at: "2026-09-24T09:00:00.000Z",
    endedAt: "2026-09-24T09:00:42.000Z",
    ms: 42000,
    prompt: { chars: 57, hash: "3f2a9c1b7d4e" },
    routing: {
      routing: "on",
      intent: "development",
      confidence: "high",
      cues: ["implement"],
      requirements: ["development.implementation"],
      graph: [
        { requirement: "development.implementation", level: "required", status: "selected", transitive: false, provider: { kind: "skill", id: "orbit:orbit-develop" } },
        { requirement: "project.context", level: "transitive", status: "selected", transitive: true, provider: { kind: "capability", id: "project.context" } },
      ],
      selected: [{ kind: "skill", id: "orbit:orbit-develop", requirement: "development.implementation" }],
      approval: [],
      blocked: [],
      missing: [],
      injected: true,
    },
    steps: [
      { at: "2026-09-24T09:00:01.000Z", kind: "skill", label: "orbit:orbit-develop", ok: true },
      { at: "2026-09-24T09:00:04.000Z", kind: "orbit", label: "cli/context", ok: true },
      { at: "2026-09-24T09:00:09.000Z", kind: "tool", label: "Read", ok: true },
      { at: "2026-09-24T09:00:30.000Z", kind: "orbit", label: "cli/knowledge verify", ok: false },
    ],
    path: [
      { kind: "skill", label: "orbit:orbit-develop", ok: true, times: 1 },
      { kind: "orbit", label: "cli/context", ok: true, times: 1 },
      { kind: "tool", label: "Read", ok: true, times: 1 },
      { kind: "orbit", label: "cli/knowledge verify", ok: false, times: 1 },
    ],
    followed: { verdict: "followed", say: "the router suggested orbit-develop, and the session used it" },
    outcome: "failed",
    ...over,
  };
}

// A turn as the list shows it -- the server's own rowOf, restated: `suggested`
// is the skills and agents the router selected or put up for approval.
export const rowOf = (t: TurnDetail): TurnRow => ({
  id: t.id,
  session: t.session,
  project: t.project,
  at: t.at,
  endedAt: t.endedAt,
  ms: t.ms,
  prompt: t.prompt,
  intent: t.routing?.intent ?? null,
  confidence: t.routing?.confidence ?? null,
  routing: t.routing?.routing ?? null,
  suggested: [...(t.routing?.selected ?? []), ...(t.routing?.approval ?? [])].filter((e) => e.kind === "skill" || e.kind === "agent").map((e) => ({ kind: e.kind, id: e.id })),
  followed: t.followed,
  outcome: t.outcome,
  steps: t.steps.length,
  path: t.path.slice(0, 12),
});

export function emptyUsage(days: number): UsageResponse {
  return {
    version: 1,
    days,
    recording: RECORDING,
    window: { from: null, to: null, events: 0 },
    totals: { sessions: 0, turns: 0, orbit: 0, shell: 0, tools: 0, skills: 0, agents: 0, failed: { failed: 0, of: 0 } },
    commands: [],
    shell: [],
    skills: [],
    transitions: [],
    paths: [],
    failures: [],
    privilege: { unused: [], unapproved: [], note: "a skill never started in this window is not judged — no evidence either way" },
  };
}

export function fakeUsage(days = 30, over: Partial<UsageResponse> = {}): UsageResponse {
  return {
    ...emptyUsage(days),
    window: { from: "2026-08-25T09:00:00.000Z", to: "2026-09-24T09:00:00.000Z", events: 31 },
    totals: { sessions: 2, turns: 3, orbit: 5, shell: 2, tools: 9, skills: 2, agents: 1, failed: { failed: 1, of: 7 } },
    commands: [
      { key: "cli/context ", id: "cli/context", sub: null, runs: 3, failed: 0, sessions: 2, last: "2026-09-24T09:00:04.000Z" },
      { key: "cli/knowledge verify", id: "cli/knowledge", sub: "verify", runs: 2, failed: 1, sessions: 1, last: "2026-09-24T09:00:30.000Z" },
    ],
    shell: [{ key: "vcs|git", class: "vcs", exe: "git", runs: 2, failed: 0, sessions: 1, last: "2026-09-24T08:10:00.000Z" }],
    skills: [{ id: "orbit-develop", invoked: 2, refused: 0, commands: 5, failed: 1 }],
    transitions: [{ from: "orbit:orbit-develop", to: "cli/context", count: 2 }],
    paths: [{ path: "orbit:orbit-develop → cli/context → cli/knowledge verify ✖", turns: 2 }],
    failures: [{ label: "cli/knowledge verify", failed: 1, of: 2, followedBy: [{ label: "(end of turn)", count: 1 }] }],
    privilege: {
      unused: [{ skill: "orbit-develop", rule: "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/knowledge.mjs why*)" }],
      unapproved: [{ skill: "orbit-develop", command: "cli/trace turns" }],
      note: "a skill never started in this window is not judged — no evidence either way",
    },
    ...over,
  };
}

const daysIn = (path: string) => Number(new URL(path, "http://control.test").searchParams.get("days") ?? "0");

const TURN = /^\/api\/v1\/trace\/turns\/([^/?]+)$/;

// The trail's three reads over what a test seeded; null for anything else, so
// it composes as fakeServer's `extra`.
export function fakeTrail(seed: { turns?: TurnDetail[]; usage?: (days: number) => UsageResponse } = {}) {
  const turns = seed.turns ?? [];
  return (call: Call): Response | null => {
    const one = TURN.exec(call.path);
    if (one) return turnReply(turns, decodeURIComponent(one[1]));
    if (call.path.startsWith("/api/v1/trace/turns")) return reply(200, { version: 1, days: daysIn(call.path), recording: RECORDING, turns: turns.map(rowOf) });
    if (call.path.startsWith("/api/v1/analytics/usage")) return reply(200, (seed.usage ?? emptyUsage)(daysIn(call.path)));
    return null;
  };
}

function turnReply(turns: TurnDetail[], id: string): Response {
  const turn = turns.find((t) => t.id === id);
  if (!turn) return reply(404, { error: { code: "TURN_NOT_FOUND", message: `no turn ${id} in the last 90 days of the trail` } });
  return reply(200, { version: 1, turn });
}
