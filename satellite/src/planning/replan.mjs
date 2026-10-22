// When the evidence MOVES the plan: an ordered table of triggers, each asked after an agent run ended or a dispatch
// was denied. A trigger's response is the engine's (retry the unit, stop the mission) or a request for the host to
// propose a revision -- which the engine validates (graph.mjs) within Orbit's execution.maxReplans. Nothing here
// rewrites a plan by itself, and nothing retries without limit.
import { NO_PROGRESS_REPEATS } from "../mission/vocab.mjs";

export const FAILURES = Object.freeze(["insufficient", "violated", "interrupted"]);

// c: { at, outcome, repeats, attemptsLeft, proposes, unit }
export const TRIGGERS = Object.freeze([
  { id: "NO_PROGRESS", at: "ended", when: (c) => c.repeats >= NO_PROGRESS_REPEATS, response: "stop", stop: "NO_PROGRESS", say: (c) => `${c.unit} failed ${c.repeats} times the same way` },
  { id: "CHANGE_PROPOSED", at: "ended", when: (c) => Boolean(c.proposes), response: "replan", say: (c) => `the run of ${c.unit} proposed a change to the plan; the host decides whether to revise it` },
  { id: "UNIT_BLOCKED", at: "ended", when: (c) => c.outcome === "blocked", response: "replan", say: (c) => `${c.unit} is blocked: a revision, a skip or a stop is needed` },
  { id: "UNIT_FAILED", at: "ended", when: (c) => FAILURES.includes(c.outcome) && c.attemptsLeft > 0, response: "retry", say: (c) => `${c.unit} ended ${c.outcome}; ${c.attemptsLeft} attempt(s) left, so it is ready again` },
  { id: "ATTEMPTS_SPENT", at: "ended", when: (c) => FAILURES.includes(c.outcome), response: "replan", say: (c) => `${c.unit} spent its attempts; only a revision (within maxReplans) or a stop moves it` },
  { id: "PERMISSION_DENIED", at: "denied", when: () => true, response: "replan", say: (c) => `an action${c.unit ? ` for ${c.unit}` : ""} was denied by policy` },
  { id: "HANDOFF_REJECTED", at: "handoff", when: () => true, response: "replan", say: (c) => `a handoff ${c.unit} needs was rejected` },
  { id: "NONE", at: "ended", when: () => true, response: "none", say: () => "" },
]);

export const TRIGGER_IDS = Object.freeze(TRIGGERS.map((t) => t.id));

export const triggerOf = (c) => TRIGGERS.find((t) => t.at === c.at && t.when(c)) ?? null;
