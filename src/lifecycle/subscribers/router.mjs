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
//
// 0.5.0 (B22, ADR 0050): the decision is RouteDecision v3 -- how much Orbit the
// request needs (src/routing/strategy.mjs) -- from the classification and the facts
// the composition root binds beside it: automation's own `workflowOf` answer, the
// host's row, this checkout's open work and the automation settings, each asked with
// table words (the open-work lookup with the references the prompt names, in
// memory). A prompt the HOST wrote (`synthetic`, a background task's notification)
// is not classified and the registry is not read: the table answers NONE for it.
import { engined } from "../../engined.mjs";
import { classify, marksIn } from "../../routing/classify.mjs";
import { dispatchedBy } from "../../routing/explain.mjs";
import { BUDGET_BYTES, formatDecision } from "../../routing/format.mjs";
import { decide } from "../../routing/resolve.mjs";
import { refsOf } from "../../routing/terms.mjs";
import { promptFacts } from "../../trace/prompt.mjs";

export const router = {
  name: "router",
  on: ["user-prompt"],
  records: false,
  run: (event, world) => answered(event, world, world.routing() ? routed(event, world) : null),
};

// The decision, and the registry it was made over: a parent's line names its agents from the same read.
function routed(event, world) {
  const prompt = event.synthetic === true ? "" : event.prompt ?? "";
  const asked = classify(prompt);
  const effective = event.synthetic === true ? {} : world.resources();
  return { decision: decide(asked, effective, factsOf(event, world, asked, prompt)), dispatches: dispatchedBy(effective), marks: asked.marks };
}

// `observed` (0.6.0, P2): the facts about the session's work that hold now (src/routing/facts.mjs), read off its own
// working set by the root -- so a check that failed after the last prompt shapes this one's decision.
const factsOf = (event, world, asked, prompt) => ({ synthetic: event.synthetic === true, plugin: world.plugin, workflow: world.workflowOf?.({ intent: asked.intent.id, matched: asked.matched, requirements: asked.requirements }) ?? null, host: world.hostRow?.() ?? null, settings: world.automation?.() ?? null, work: world.openWork?.({ refs: refsOf(prompt), continued: asked.marks.includes("continue") }) ?? null, observed: event.synthetic === true ? [] : world.observed?.() ?? [] });

// ONE advisory line, only when the strategy is a COORDINATED workflow (`how: automation`) and a person kept
// `trigger.arbitraryPrompt` on: the router SAYS a coordinated workflow could take this prompt. A specification's goal
// (`how: goal`) is started by its own one command, which the strategy line gives, so it is never also sent to the
// workflow's door. It starts nothing -- this hook plans and never acts -- and the line is dropped rather than letting
// the context pass its byte budget.
const ADVICE = "Orbit coordinates a task by default: a workflow could take this — node <engine>/cli/automation.mjs plan --for=\"<the task>\" shows it; orbit-help starts it.";

const advised = (v, decision) => decision?.strategy?.word === "COORDINATED" && decision.activation?.how === "automation" && Boolean(v?.trigger?.arbitraryPrompt);

// The command it names carries the engine's own path once the root knows it, as the strategy line's does.
const adviceOf = (world) => engined(ADVICE, world.engine);

const withAdvice = (text, world, decision) => ((advice) => (text && advised(world.automation?.(), decision) && Buffer.byteLength(`${text}\n${advice}`) <= BUDGET_BYTES ? `${text}\n${advice}` : text))(adviceOf(world));

function answered(event, world, r) {
  const text = withAdvice(r ? formatDecision(r.decision, { callVia: world.callVia, dispatches: r.dispatches, engine: world.engine }) : null, world, r?.decision);
  world.traced?.(r?.decision ?? null, promptFacts(event.prompt, world.salt?.()), Boolean(text), event.synthetic === true, marksFor(event, r));
  return text ? world.host.formatPromptContext?.(text, world.input) ?? null : null;
}

// The prompt's MARKS for the trail (0.5.0, B22 M3): the classification's when it ran, else read off the prompt alone --
// table words either way, so a Stop hold knows a person said to stop even with routing off. A host's envelope has none.
const marksFor = (event, r) => r?.marks ?? (event.synthetic === true ? [] : marksIn(event.prompt ?? ""));
