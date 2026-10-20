// A CHECK: one build or test command the checkout itself DECLARED, run in the task's workspace.
//
// Where a check comes from is the runtime subject's understanding of the primary checkout
// (src/runtime/components.mjs): a command a manifest named, tokenized without a shell, with the
// purpose its name says. Only `safe` ones -- an argument list, never a shell line -- and only the
// build and test purposes. The host chooses one BY ID; it never supplies an argument, so nothing a
// model writes becomes part of a command.
//
// The run goes through the Process port it is handed (argv, `shell: false`, Windows shims inside
// the port), with the working directory held inside the workspace, the environment a child needs
// to start plus the names a person set for the component (never the rest), a deadline and an
// output cap. What it printed is kept bounded and scrubbed in the orchestration room, and shown on
// request; the task journal keeps a receipt reference and a sentence, never a line of it.
//
// While it runs (1.8.5, ADR 0020) an OBSERVATION, when the composition root binds one, is handed
// every chunk as it arrives (`runObserved`) and settled when the command ends: what it read is
// written beside the task, never in it, and its summary rides along with the answer. It adds
// nothing to the command -- no argument, no variable, no reporter -- and changes no fact of the
// answer: `lines`, `status`, `timedOut` and `cut` are exactly what they are without it, so a
// baseline and a later run are compared on the same output (failure.mjs exactOf). A port with no
// `runObserved`, or no observer, runs as before.
import { join } from "node:path";
import { contained } from "../project/boundary.mjs";
import { childEnv } from "../process/env.mjs";
import { scrub } from "../scrub.mjs";
import { summaryOf } from "./activity/fold.mjs";
import { CHECK_OUTPUT_BYTES, CHECK_TIMEOUT_MS, LOG_BYTES, PURPOSES } from "./vocab.mjs";

const runnable = (x) => PURPOSES.includes(x.purpose) && x.safe === true && Array.isArray(x.argv) && x.argv.length > 0;

const checkOf = (component) => (x) => ({ id: x.id, purpose: x.purpose, component: component.key, declaredAs: x.declaredAs, argv: x.argv, cwd: x.cwd ?? "." });

// The declared checks of a checkout, from runtime understanding's components.
export const checksOf = (components) => (components ?? []).flatMap((c) => (c.commands ?? []).filter(runnable).map(checkOf(c)));

// Whether a test command was declared at all, even one that needs a shell.
export const unsafeTestsOf = (components) => (components ?? []).some((c) => (c.commands ?? []).some((x) => x.purpose === "test" && x.safe !== true));

// What a check may tell a host about itself, without its argument list.
export const briefOf = (c) => ({ id: c.id, purpose: c.purpose, component: c.component, declaredAs: c.declaredAs });

const MAX_LINES = 4000;

const tail = (text, bytes) => (text.length > bytes ? text.slice(text.length - bytes) : text);

const outputOf = (r) => `${r.out ?? ""}${r.err ? `\n${r.err}` : ""}`;

const firstLine = (text) => String(text ?? "").trim().split("\n")[0].slice(0, 200) || null;

// Whether what is kept is less than what was printed: a tail is not the whole, and a whole-output identity
// (failure.mjs exactOf) is never taken of a part.
const cut = (r) => r.overflow === true || outputOf(r).length > LOG_BYTES || outputOf(r).split(/\r?\n/).length > MAX_LINES;

// The port's answer as facts: did it start, did it run out of time, how did it exit -- and whether an observer that
// was handed its output stopped on an error of its own (a fact about the observation, never about the check).
const answerOf = (r, ms) => ({ ok: r.ok === true, started: r.unstarted !== true, timedOut: r.timedOut === true, overflow: r.overflow === true, cut: cut(r), status: Number.isInteger(r.status) ? r.status : null, durationMs: ms, reason: r.ok ? null : scrub(firstLine(r.error)), lines: tail(outputOf(r), LOG_BYTES).split(/\r?\n/).slice(-MAX_LINES), observerFailed: r.observerFailed === true });

// deps: { process, env, envNamesOf(component), clock() -> ms, keep(at, text), timeoutMs?, observer?(command, at) }
export function createCheckRunner(deps) {
  return { run: (command, at) => ran({ timeoutMs: CHECK_TIMEOUT_MS, ...deps }, command, at) };
}

// `at`: { task, dir (the workspace), ref (chk-<n>), action, attempt, why }
async function ran(deps, command, at) {
  const began = deps.clock();
  const watch = observing(deps, command, at);
  const answer = answerOf(await executed(deps, command, at, watch), deps.clock() - began);
  deps.keep(at, scrub(answer.lines.join("\n")));
  return { ...answer, observation: watch ? settledSummary(watch, answer) : null };
}

const optsOf = (deps, command, at) => ({ cwd: contained(at.dir, join(at.dir, command.cwd)), env: childEnv(deps.env, deps.envNamesOf(command.component)), timeoutMs: deps.timeoutMs, maxBuffer: CHECK_OUTPUT_BYTES });

const executed = (deps, command, at, watch) => (watch && typeof deps.process.runObserved === "function" ? deps.process.runObserved(command.argv[0], command.argv.slice(1), { ...optsOf(deps, command, at), observe: watch.chunk }) : Promise.resolve(deps.process.run(command.argv[0], command.argv.slice(1), optsOf(deps, command, at))));

// An observer that cannot even be made is no observer: the check runs exactly as it would have.
function observing(deps, command, at) {
  try { return deps.observer?.(command, at) ?? null; }
  catch { return null; }
}

// What the check's record keeps of the observation: its bounded summary, or why there is none.
function settledSummary(watch, answer) {
  try { return summaryOf(watch.settled(answer)); }
  catch (e) { return { state: "unknown", gaps: [`the observation could not be settled: ${scrub(String(e?.message ?? e)).slice(0, 160)}`], complete: false }; }
}
