// THE BRIEF a repair round is handed: the case's public request, what the verifier saw fail -- each failing group with
// a few of its own inputs, what the contract expects of them and what came back -- the paths a repair may change, the
// checks it is held to, and the budget left. It carries no hidden check's code, no fault, no expected answer the
// round did not already fail, and no patch. The prompt itself only says how to work: read the repository's rules and
// the brief, and drive the ONE engineering task that exists, through Orbit's own loop.
//
//   briefOf(ctx, k, state) -> { md, json }      promptOf(task) -> text      objectiveOf(c) -> sentence (≤ 240)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { candidateFile } from "../core/mutations.mjs";
import { says } from "./judge.mjs";
import { HARNESS, TAMPER } from "./candidate.mjs";

const EXAMPLES = 2;
const GROUPS_SHOWN = 12;

export const objectiveOf = (c) => `Repair Orbit's source so benchmark case ${c.id} ${c.version} holds: ${c.title}. The brief is /run/brief/brief.md; stay inside its allowed paths and add a regression test.`.slice(0, 240);

const failingByGroup = (verification) => Object.entries(verification.hidden.checks.filter((c) => !c.ok).reduce((m, c) => ({ ...m, [c.group]: [...(m[c.group] ?? []), c] }), {}));

const exampleOf = (ctx, check) => ((c) => `  - input: \`${JSON.stringify(c.input).slice(0, 1600)}\`\n    expected: ${says(c.expect)} — ${check.why}`)(ctx.cases.find((x) => x.id === check.id));

const groupText = (ctx, [group, checks]) => [`- **${group}** — ${ctx.spec.GROUPS?.[group] ?? group} (${checks.length} failing)`, ...checks.slice(0, EXAMPLES).map((c) => exampleOf(ctx, c))].join("\n");

const gateText = (v) => v.gates.filter((g) => !g.ok).map((g) => `- gate \`${g.id}\`: ${g.why}`).join("\n") || "- every gate of the case holds";

const probeText = (v) => (v.hidden.error ? `- the subject could not answer at all: ${v.hidden.error.code} ${v.hidden.error.message ?? (v.hidden.error.names ?? []).join(", ")}` : "");

const requestOf = (ctx) => readFileSync(join(ctx.frozenCase, ctx.case.request), "utf8");

// What a SCRIPTED host is handed instead of a model's brief: the control's own definition -- which edits to make in the
// task's workspace, and how to drive the loop. A coding host is never handed one: it carries no fix of any kind.
const scriptRow = (ctx) => (ctx.case.repairs ?? []).find((r) => `scripted:${r.id}` === ctx.host) ?? null;

const scriptOf = (ctx) => ((r) => (r ? { id: r.id, mode: r.script ?? "apply", intent: objectiveOf(ctx.case), definition: candidateFile(ctx.frozenCase, r.candidate) } : null))(scriptRow(ctx));

export function briefOf(ctx, k, state) {
  const v = state.latest;
  const md = [`# Benchmark ${ctx.case.id} ${ctx.case.version} — repair round ${k}`, "", requestOf(ctx).trim(), "", "## What the independent verifier saw", "", probeText(v), ...failingByGroup(v).slice(0, GROUPS_SHOWN).map((g) => groupText(ctx, g)), "", gateText(v), "", "## Where a repair may go", "", `Allowed: ${ctx.case.scope.allow.map((g) => `\`${g}\``).join(", ")}. Never: ${[...HARNESS, ...TAMPER, ...ctx.case.scope.deny].map((g) => `\`${g}\``).join(", ")}.`, "Never change or delete an existing test, skip one, or narrow a run to one test. Add a regression test under `test/` that fails before your change and passes after it.", "", "## What the change is held to", "", `The engine's own declared checks, then, independently and after you stop: the hidden checks of this case, the gates ${ctx.case.checks.gates.map((g) => `\`${g.id}\``).join(", ")}, and your regression test run against the source before and after your change.`, "", "## Budget left", "", `Round ${k} of ${ctx.limits.rounds}; about ${state.left.minutes} minute(s) and ${state.left.usd} USD for this round.`, ""].filter((l) => l !== null).join("\n");
  return { md, json: { round: k, kind: ctx.case.kind, host: ctx.host ?? null, script: scriptOf(ctx), task: state.engTask ?? null, objective: objectiveOf(ctx.case), prompt: promptOf(state.engTask, k), model: ctx.model ?? null, usd: state.left.usd, minutes: state.left.engineeringMinutes, attempts: ctx.case.limits.engineering.attempts, actions: ctx.case.limits.engineering.actions, allowedHost: ctx.allowedHosts[0], outputBytes: ctx.case.limits.runner.outputMb * 1024 * 1024 } };
}

export const promptOf = (task, k) => [
  "You are working inside an Orbit benchmark container. Nobody can answer a question here: where a skill says to ask or tell a person, stop and report instead.",
  "1. Read /work/repo/AGENTS.md first: the repository's rules (Five Lines of Code, the dependency direction, how tests are written) bind every change.",
  "2. Read /run/brief/brief.md: the failure to repair, what the independent verifier saw, the behaviour required, the paths you may change and the budget left.",
  `3. ${task ? `Orbit engineering task ${task} already exists for this repair` : "The round's Orbit engineering task already exists for this repair; `node /work/repo/cli/task.mjs list --json` names it"}. Drive it with the orbit-engineer skill: from /work/repo, \`node cli/autonomous-engineering.mjs context <task> --json\`, then ONE decision at a time to \`step\`, until the engine completes the task or gives a reason to stop. ${k > 1 ? "This is a later round on the same task: read its context, reconcile what did not settle, and go on from where it stands. " : ""}Never start another task, and never run cleanup or remove-workspace.`,
  "4. Make every edit in the workspace path `context` prints, only inside the allowed paths, and add a regression test under test/ that fails before your change and passes after it. Never change or delete an existing test, skip a test, or change package.json, a check or the lint.",
  "5. In REVIEWING, `commit` the verified change before `review`. Never `push`.",
  "When you stop, say in one line where the task stands.",
].join("\n");
