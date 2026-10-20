// The PROMPT ROUTER, on the host's user-prompt event: what this session could
// usefully reach for, added beside the prompt -- or nothing at all.
//
//   prompt (in memory) -> the Effective Resource Registry -> ONE RouteDecision
//     -> at most BUDGET_BYTES of context the host shows the model
//
// It PLANS and never acts: no resource is started, called, installed or
// connected to (src/routing/resolve.mjs). It reads the registry through
// `world.resources()`, which the composition root (cli/router-hook.mjs) binds
// to snapshots on this machine, so it never waits on a network or a server.
//
// The prompt is read here and dropped here. It is not an argument to anything
// that writes, it is not logged, and a failure keeps no finding (`records:
// false`) -- a finding would be one more place a fragment of it could land.
//
// What the SESSION TRAIL is told (src/trace/) is decided HERE, before anything
// that writes is reached: a salted fingerprint of the prompt and its length
// (src/trace/prompt.mjs `promptFacts`), and the decision -- table words and
// resource ids, never the text. `world.traced` receives only those.
//
// A toggle in the plugin's settings (`prompt_router`, on by default), or
// ORBIT_PROMPT_ROUTER=off on one machine. Off, it adds nothing to the prompt, and
// the trail still records that a prompt arrived with routing off.
import { BUDGET_BYTES, formatDecision } from "../../routing/format.mjs";
import { route } from "../../routing/resolve.mjs";
import { promptFacts } from "../../trace/prompt.mjs";

export const router = {
  name: "router",
  on: ["user-prompt"],
  records: false,
  run: (event, world) => answered(event, world, world.routing() ? route(event.prompt ?? "", world.resources()) : null),
};

// ONE advisory line, unless a person switched `trigger.arbitraryPrompt` off or kept a restriction: the
// router SAYS a coordinated workflow could take this prompt. It starts nothing -- this hook plans and never
// acts -- and the line is dropped rather than letting the context pass its byte budget.
const ADVICE = "Orbit coordinates a task by default: a workflow could take this — node <engine>/cli/automation.mjs plan --for=\"<the task>\" shows it; orbit-help starts it.";

const advised = (v) => Boolean(v?.trigger?.arbitraryPrompt);

const withAdvice = (text, world) => (text && advised(world.automation?.()) && Buffer.byteLength(`${text}\n${ADVICE}`) <= BUDGET_BYTES ? `${text}\n${ADVICE}` : text);

function answered(event, world, decision) {
  const text = withAdvice(decision ? formatDecision(decision, { callVia: world.callVia }) : null, world);
  world.traced?.(decision, promptFacts(event.prompt, world.salt?.()), Boolean(text));
  return text ? world.host.formatPromptContext?.(text, world.input) ?? null : null;
}
