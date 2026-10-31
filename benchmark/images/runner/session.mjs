#!/usr/bin/env node
// THE SESSION HOST: what a run whose host is `session:<label>` runs in the runner in place of a coding host -- nothing
// that reasons. The operator's own Claude Code session drives the round from OUTSIDE the container: an agent it spawned,
// with none of the operator's context, runs Orbit's own CLIs here with `docker exec` (from /work/repo, the plugin at the
// brief's `plugin`) and touches /work/out/session-done when it stops. This process only says that a session is driving,
// leaves the round's task id where the agent can read it, and waits for that mark; the controller enforces the round's
// deadline whatever happens. The container has no network and no credential: the model is the session's, outside it.
//
// It prints stream-json, the shape the controller reads a host's session in: an init naming `session:<label>` and a
// result. Its turns, tool calls and cost are unknown to it -- the agent's are REPORTED by the session, never here.
//
//   node /bench/session.mjs <tsk-…|->     brief: /run/brief/brief.json      marks: /work/out/session-{ready.json,done}
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const PATHS = { brief: "/run/brief/brief.json", ready: "/work/out/session-ready.json", done: "/work/out/session-done" };

const said = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

const EVERY_MS = 2000;

// Until the agent says it stopped: looked for every two seconds.
const doneMarked = () => new Promise((resolve) => (function look() {
  if (existsSync(PATHS.done)) return resolve(true);
  setTimeout(look, EVERY_MS);
})());

async function main(task) {
  const b = JSON.parse(readFileSync(PATHS.brief, "utf8"));
  said({ type: "system", subtype: "init", model: b.host, session_id: `${b.host}-${b.round ?? 1}`, claude_code_version: null });
  writeFileSync(PATHS.ready, `${JSON.stringify({ task: /^tsk-[a-f0-9]{12}$/.test(task ?? "") ? task : null, round: b.round ?? 1, plugin: b.plugin, at: new Date().toISOString() })}\n`);
  await doneMarked();
  said({ type: "result", subtype: "success", is_error: false, num_turns: null, total_cost_usd: null, result: "the session's agent marked the round done", steps: [] });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv[2]);
