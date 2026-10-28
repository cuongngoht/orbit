// What must hold before an investigation may do ANYTHING in a browser -- one
// ordered table, asked two ways:
//
//   blockers(world)   every row that fails, as data -- what `plan` prints, with
//                     no browser touched and nothing written
//   gate(world)       the first row that fails, THROWN -- what every action
//                     asks, so no route around the table exists
//
// A row applies only when the world carries what it asks about: planning has no
// browser host, so the host rows are silent there and speak at the first action.
// `stop` is the typed outcome: a person's approval that is missing is Refused
// (2), a machine that cannot answer is Blocked (3). Neither is ever a finding
// about the product.
//
// world: { on (the skill's switch), settings, environment, mode, model,
//          identity, host, edge, now, runtime }
//
// `runtime` is handed in by the composition root and only when the approved environment is on
// this machine: what this checkout's own runtime says about it (src/runtime/origin.mjs), or, for a
// task's sandbox, { environment, task, sourceTree, taskTree, current } (src/investigation/sandbox.mjs).
// The investigation imports nothing of the runtime subject, and a world without it is silent here.
import { Blocked, Refused } from "../errors.mjs";
import { MODE_IDS, modeOf, needsApproval } from "./vocab.mjs";

const OFF = "a person switched autonomous QA off for this project — they turn it back on in Orbit Control (Autonomous QA), or relay `node cli/autonomous-qa.mjs settings set enabled=true --human`";
const hostOf = (origin) => { try { return new URL(origin).hostname; } catch { return null; } };
// The minutes budget runs from the start of the CURRENT stretch of work: the
// investigation's start, or the latest resume. A paused investigation resumed
// the next day is not Blocked forever by yesterday's clock; what bounds the
// whole of it is the cumulative action and decision budgets, which never reset.
const deadline = (w) => Date.parse(w.model.resumed?.at(-1)?.at ?? w.model.meta.at) + w.settings.limits.minutes * 60000;

export const GATES = [
  { id: "SWITCHED_OFF", stop: "refused", applies: (w) => w.on !== undefined, fails: (w) => w.on === false, say: () => "the orbit-qa-agent skill is switched off on this machine (plugin option skill_autonomous_qa / ORBIT_SKILL_AUTONOMOUS_QA)" },
  { id: "DISABLED", stop: "refused", applies: () => true, fails: (w) => !w.settings.enabled, say: () => OFF },
  { id: "NO_ENVIRONMENT", stop: "refused", applies: () => true, fails: (w) => !w.environment, say: (w) => (w.settings.environments.length ? `name the environment with --env=<${w.settings.environments.map((e) => e.id).join("|")}>` : "no environment is approved: a person declares one ({ id, origin, kind, modes }) in Orbit Control or with settings set --human") },
  { id: "UNKNOWN_MODE", stop: "refused", applies: () => true, fails: (w) => !modeOf(w.mode), say: (w) => `"${w.mode}" is not a mode — ${MODE_IDS.join(", ")}` },
  { id: "NOT_APPROVED", stop: "refused", applies: (w) => Boolean(w.environment && modeOf(w.mode)), fails: (w) => needsApproval(w.mode) && !(w.environment.modes ?? []).includes(w.mode), say: (w) => `${w.mode} is not approved on ${w.environment.id} — only a person adds it to that environment's modes` },
  { id: "PRODUCTION", stop: "refused", applies: (w) => Boolean(w.environment && modeOf(w.mode)), fails: (w) => w.environment.kind === "production" && !modeOf(w.mode).production, say: (w) => `${w.mode} never runs on a production environment, approved or not` },
  { id: "CANCELLED", stop: "refused", applies: (w) => Boolean(w.model), fails: (w) => Boolean(w.model.cancelled), say: (w) => `investigation ${w.model.meta.id} was cancelled — start a new one` },
  { id: "NOT_ACTIVE", stop: "refused", applies: (w) => Boolean(w.model?.lifecycle), fails: (w) => w.model.lifecycle !== "active" && w.model.lifecycle !== "cancelled", say: (w) => `investigation ${w.model.meta.id} is ${w.model.lifecycle} — ${w.model.lifecycle === "paused" ? "resume it first (autonomous-qa resume)" : "start a new one to look again"}` },
  { id: "ACTION_BUDGET", stop: "refused", applies: (w) => Boolean(w.model && w.acting), fails: (w) => w.model.actions.length >= w.settings.limits.actions, say: (w) => `the action budget is spent (${w.settings.limits.actions}, settings limits.actions) — report what was seen, or a person raises the limit` },
  { id: "DEADLINE", stop: "blocked", applies: (w) => Boolean(w.model && w.acting && w.now), fails: (w) => w.now() > deadline(w), say: (w) => `the investigation's ${w.settings.limits.minutes} minute budget is spent (settings limits.minutes)` },
  { id: "IDENTITY", stop: "refused", applies: (w) => Boolean(w.identity), fails: (w) => !w.settings.identities.includes(w.identity), say: (w) => `identity "${w.identity}" is not one a person approved (settings identities: ${w.settings.identities.join(", ") || "none"})` },
  { id: "RUNTIME_BLOCKED", stop: "blocked", applies: (w) => Boolean(w.runtime && w.environment), fails: (w) => w.runtime.served === false, say: (w) => (w.environment.origin ? `this checkout's runtime declares ${w.runtime.component} at ${w.environment.origin}, and nothing answers there — ${w.runtime.next}` : `the sandbox ${w.environment.id} is not ready — ${w.runtime.next}`) },
  { id: "RUNTIME_STALE", stop: "blocked", applies: (w) => Boolean(w.runtime?.environment), fails: (w) => w.runtime.current === false, say: (w) => `the approved sandbox ${w.runtime.environment} runs source tree ${w.runtime.sourceTree}, but task ${w.runtime.task} now holds source tree ${w.runtime.taskTree}; restart the sandbox before verifying it` },
  { id: "NOT_ISOLATED", stop: "blocked", applies: (w) => Boolean(modeOf(w.mode)?.isolated), fails: (w) => w.runtime?.isolated !== true, say: (w) => `${w.mode} runs generated tests only where the task's sandbox PROVED isolation (ADR 0038) — ${w.runtime?.environment ? `sandbox ${w.runtime.environment} attests none` : "no sandbox is bound"}; a native or dev container sandbox proves nothing` },
  { id: "NO_FIXTURE", stop: "blocked", applies: (w) => Boolean(modeOf(w.mode)?.grants), fails: (w) => !w.runtime?.fixture, say: (w) => `${w.mode} writes only into a fixture of the run's own, and none is prepared — the sandbox mints a fresh namespace per run before anything is written` },
  { id: "WORKER_ONLY", stop: "refused", applies: (w) => w.host !== undefined, fails: (w) => w.environment?.isolated === true, say: (w) => `the sandbox ${w.environment.id} is isolated: nothing on this machine reaches inside it, so it is verified only by a generated version its own worker runs (run-version) — never by this machine's browser` },
  { id: "NO_BROWSER", stop: "refused", applies: (w) => w.host !== undefined, fails: (w) => w.host === "NONE", say: () => "no browser session is open — open one for this environment (orbit-browser), then act again" },
  { id: "BROWSER_BUSY", stop: "blocked", applies: (w) => w.host !== undefined, fails: (w) => w.host === "BUSY", say: () => "the browser session is not answering — retry once it settles" },
  { id: "SIGNED_OUT", stop: "refused", applies: (w) => w.host !== undefined, fails: (w) => w.host === "SIGNIN", say: () => "the session is parked on a sign-in page — a person signs in; a signed-out session is never a finding" },
  { id: "WRONG_HOST", stop: "refused", applies: (w) => w.host !== undefined && Boolean(w.environment), fails: (w) => w.host !== hostOf(w.environment.origin), say: (w) => `the browser is on ${w.host}, not on the approved environment ${w.environment.id} (${hostOf(w.environment.origin)})` },
  { id: "DESTRUCTIVE", stop: "refused", applies: (w) => Boolean(w.edge), fails: (w) => w.edge.destructive === true, say: (w) => `${w.edge.from}/${w.edge.via} is DESTRUCTIVE — autonomous QA never touches one, in any mode` },
  { id: "WRITES", stop: "refused", applies: (w) => Boolean(w.edge && modeOf(w.mode)), fails: (w) => w.edge.writes && !controlWrites(w.mode), say: (w) => `${w.edge.from}/${w.edge.via} may change data (${w.edge.why}) and ${w.mode} mode does not write through the screen — explore-write, approved for this environment, does; fixture-write writes only through capabilities a grant covers` },
];

// A mode that writes through the SCREEN: one that mutates and is not held to grants. Under
// fixture-write every write goes through a capability a grant covers, never a control.
export const controlWrites = (mode) => Boolean(modeOf(mode)?.mutates && !modeOf(mode)?.grants);

export const blockers = (w) => GATES.filter((g) => g.applies(w) && g.fails(w)).map((g) => ({ id: g.id, stop: g.stop, say: g.say(w) }));

export function gate(w) {
  const first = GATES.find((g) => g.applies(w) && g.fails(w));
  if (!first) return null;
  throw first.stop === "blocked" ? new Blocked(first.say(w)) : new Refused(first.say(w));
}
