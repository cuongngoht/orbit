// ONE QA ROUND with a real coding host: the runner container -- the plugin read-only (its autonomous-qa is the relay's
// client), the application's PUBLIC material read-only (its accepted requirement, its contracts and its accepted plan;
// never its source, which is where a variant is planted), a mailbox it writes requests into and reads answers from,
// and the runner's own store -- while the controller answers that mailbox through the engine beside it, one request at
// a time, for this run's investigation only. The host is told nothing of what was planted, and nothing it sends is
// evidence: what the investigation came to is read off the engine's journal afterwards.
//
//   ranQaRound(ctx, k, s) -> { error, container, runner, host, egress, relay: { served } }
//   s = { investigation, serve, deadlineMs }          serveOf(ctx, engine, investigation) -> serve
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fresh, roundRan, runnerSpecOf } from "../core/runner.mjs";
import { admitted, relayServer } from "./relay.mjs";

// What the coding host is told, beside the brief: the one thing to do, and that nobody will answer it.
export const qaPromptOf = (investigation) => [
  "You are the coding host of an Orbit QA benchmark round, and there is no person to answer you.",
  "Read /run/brief/brief.md first: it says what to do and which investigation is open.",
  `Use the orbit-qa skill (Orbit's autonomous QA) to work investigation ${investigation} one decision at a time through \`node /work/repo/cli/autonomous-qa.mjs …\`, until the engine gives a reason to stop; then finish it.`,
  "The application runs in an isolated sandbox only the engine reaches: every test you design runs there, through the engine.",
  "Never pass --human, never change a setting, never answer, release or cancel anything: those are a person's.",
].join("\n");

const briefMd = (ctx, k, s) => [readFileSync(join(ctx.frozenCase, ctx.case.request), "utf8").trim(), "", "## This round", "", `- The open investigation: \`${s.investigation}\`.`, "- Its commands: `node /work/repo/cli/autonomous-qa.mjs context|step|derive|checkpoint|reconcile|show|report|finish --investigation=" + s.investigation + "` (a decision on stdin for `step`).", "- The application's accepted requirement, contracts and plan: `/work/target/`.", `- Round ${k} of ${ctx.limits.rounds}; about ${Math.round(s.deadlineMs / 60000)} minute(s) and ${ctx.limits.usd} USD.`, ""].join("\n");

function qaBriefWritten(ctx, k, s) {
  const dir = fresh(ctx, "rounds", String(k), "brief");
  writeFileSync(join(dir, "brief.json"), `${JSON.stringify({ kind: "qa", round: k, investigation: s.investigation, prompt: qaPromptOf(s.investigation), model: ctx.model ?? null, usd: ctx.limits.usd, allowedHost: ctx.allowedHosts[0], outputBytes: ctx.case.limits.runner.outputMb * 1024 * 1024 }, null, 2)}\n`);
  writeFileSync(join(dir, "brief.md"), briefMd(ctx, k, s));
  return dir;
}

// The mailbox of a round, made new: requests the runner writes, answers it can only read, and the controller's log.
const mailboxOf = (ctx, k) => ({ requests: fresh(ctx, "rounds", String(k), "relay", "requests"), responses: fresh(ctx, "rounds", String(k), "relay", "responses"), log: ctx.room.at("rounds", String(k), "relay", "relay.jsonl") });

const qaRunnerSpec = (ctx, net, k, d) => runnerSpecOf(ctx, net, k, [{ source: ctx.pluginDir, target: "/work/repo", readOnly: true }, { source: ctx.runnerStore, target: "/work/store", readOnly: false }, { source: d.out, target: "/work/out", readOnly: false }, { source: d.brief, target: "/run/brief", readOnly: true }, { source: ctx.room.at("public"), target: "/work/target", readOnly: true }, { source: d.relay.requests, target: "/work/relay/requests", readOnly: false }, { source: d.relay.responses, target: "/work/relay/responses", readOnly: true }], { ORBIT_QA_RELAY: "/work/relay" });

export async function ranQaRound(ctx, k, s) {
  const d = { brief: qaBriefWritten(ctx, k, s), out: fresh(ctx, "rounds", String(k), "out"), relay: mailboxOf(ctx, k) };
  const server = relayServer(d.relay, s.serve);
  const ran = await roundRan(ctx, k, (net) => qaRunnerSpec(ctx, net, k, d), { deadlineMs: s.deadlineMs, out: d.out }).finally(() => server.stop());
  return { ...ran, relay: { served: server.state.served, log: d.relay.log } };
}

const secondsOf = (ctx, budget) => (budget === "step" ? ctx.case.limits.engine.stepSeconds : ctx.case.limits.engine.callSeconds);

const answerOf = (r) => ({ exit: r.timedOut ? 3 : (r.status ?? (r.ok ? 0 : 3)), stdout: r.out ?? "", stderr: r.err || r.error || "" });

// What a request admitted to the relay runs: the engine's own CLI, bounded by the case's time for a step or a call.
export const serveOf = (ctx, engine, investigation) => ({ admit: (req) => admitted(req, investigation), run: async (a) => answerOf(await engine.cli("autonomous-qa.mjs", a.argv, { input: a.stdin, seconds: secondsOf(ctx, a.budget) })) });

// A scripted host asks the same way a coding host's request is served, admission included -- only in this process.
export const askOf = (serve) => async (argv, stdin) => ((a) => (a.refused ? { exit: 2, stdout: "", stderr: `REFUSED ${a.refused}\n` } : serve.run(a)))(serve.admit({ argv, stdin }));
