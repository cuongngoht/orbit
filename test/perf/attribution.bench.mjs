// What ATTRIBUTION costs (0.2.2, ADR 0044), measured, never assumed. Skipped in the suite; run it on purpose and read
// the numbers:
//
//   ORBIT_BENCH=1 node --test --test-reporter=spec test/perf/attribution.bench.mjs
//
// Shapes:
//   session     a working-set tail of N lines (12 agents, a quarter of the calls the session's own) folded per agent,
//               as a pane asks every two seconds: the time per fold and what it kept (bounded lists)
//   usage       `trace usage` over N trail events with agents and calls: the time for the whole projection
//   join        Satellite's read-time join of 20 runs with N trail events, as its viewer does on every refresh
// Each prints its median of seven runs and its input's size; nothing here is a budget, only what this machine did.
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { SESSION_LIMITS, sessionActivityOf } from "../../src/live/session.mjs";
import { usageOf } from "../../src/trace/projections/usage.mjs";
import { eventOf } from "../../src/trace/events.mjs";
import { bindingsOf } from "../../satellite/src/hosts/attribution.mjs";
import { modelOf } from "../../satellite/src/mission/fold.mjs";

const skip = !process.env.ORBIT_BENCH;
const T0 = Date.parse("2026-10-30T09:00:00.000Z");
const at = (i) => new Date(T0 + i * 250).toISOString();
const agentOf = (i) => (i % 4 === 0 ? null : `claude:${String(i % 12).padStart(16, "0")}`);

const median = (fn) => {
  const times = Array.from({ length: 7 }, () => ((t) => (fn(), performance.now() - t))(performance.now())).sort((a, b) => a - b);
  return times[3];
};

const line = (i) => ({ t: at(i), ev: i % 7 === 0 ? "pre-tool" : "post-tool", tool: i % 3 ? "command" : "read", paths: i % 3 ? [] : [`src/f${i % 50}.mjs`], tokens: [], cmd: i % 3 ? { class: i % 5 ? "other" : "test", exe: "node", ok: i % 7 === 0 ? null : i % 11 !== 0 } : null, delivery: `claude:${i.toString(16).padStart(16, "0")}`, ...(agentOf(i) ? { agent: agentOf(i), agentType: "orbit:satellite-reader" } : {}) });

const traceEvent = (i) => eventOf(i % 5 ? "tool.used" : "command.ran", { tool: "Read", kind: "read", class: "test", exe: "node", ok: i % 9 !== 0, call: `claude:${i.toString(16).padStart(16, "0")}`, ...(agentOf(i) ? { agent: agentOf(i) } : {}) }, { id: `h-${i}`, at: at(i), session: "claude:0000000000000001", agentHost: "claude" });

// Twenty runs, each launched as its own agent -- the agents the join's tool events below are made by.
const runAgent = (r) => `claude:${String(100 + r).padStart(16, "0")}`;

const launches = Array.from({ length: 20 }, (_, r) => [eventOf("agent.invoked", { id: "orbit:satellite-reader", ours: true, outcome: "started", call: `claude:c${r}`, run: `msn-0123456789ab/arn-${r + 1}` }, { id: `i-${r}`, at: at(r), session: "s" }), eventOf("agent.launched", { id: "orbit:satellite-reader", call: `claude:c${r}`, launched: runAgent(r) }, { id: `l-${r}`, at: at(r), session: "s" })]).flat();

const runEvent = (i) => eventOf("tool.used", { tool: "Read", kind: "read", ok: i % 9 !== 0, call: `claude:${i.toString(16).padStart(16, "0")}`, ...(i % 4 ? { agent: runAgent(i % 20) } : {}) }, { id: `h-${i}`, at: at(i), session: "s", agentHost: "claude" });

const model = modelOf([{ kind: "mission.created", id: "msn-0123456789ab", at: at(0) }, ...Array.from({ length: 20 }, (_, r) => ({ kind: "agentrun.created", id: `arn-${r + 1}`, unit: "wu-1", dispatch: "native", attempt: 1, mode: "EXPLORING", action: `act-${r + 2}`, at: at(r) }))]);

for (const n of [1000, 5000, 20000]) {
  test(`session: a ${n}-line tail folded per agent`, { skip }, () => {
    const lines = Array.from({ length: n }, (_, i) => line(i));
    const ms = median(() => sessionActivityOf(lines, { nowMs: T0 + n * 250, checks: ["test"], coverage: { namesAgents: true } }));
    const a = sessionActivityOf(lines, { nowMs: T0 + n * 250, checks: ["test"], coverage: { namesAgents: true } });
    console.log(`session  ${String(n).padStart(6)} lines  ${ms.toFixed(1).padStart(8)} ms  agents ${a.agents.length} (+${a.agentsCut} cut)  recent ${a.recent.length}/${SESSION_LIMITS.RECENT}`);
  });
  test(`usage: ${n} trail events with agents and calls`, { skip }, () => {
    const events = Array.from({ length: n }, (_, i) => traceEvent(i));
    const ms = median(() => usageOf(events));
    console.log(`usage    ${String(n).padStart(6)} events ${ms.toFixed(1).padStart(8)} ms  agents ${usageOf(events).attribution.byAgent.length}`);
  });
  test(`join: 20 runs with ${n} trail events`, { skip }, () => {
    const trail = [...launches, ...Array.from({ length: n }, (_, i) => runEvent(i))];
    const ms = median(() => bindingsOf({ model, trail }));
    console.log(`join     ${String(n).padStart(6)} events ${ms.toFixed(1).padStart(8)} ms  bound ${[...bindingsOf({ model, trail }).values()].filter((b) => b.hostAgent).length}/20`);
  });
}
