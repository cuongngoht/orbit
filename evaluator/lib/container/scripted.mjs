#!/usr/bin/env node
// THE SCRIPTED AGENT: what a self-control runs in place of a coding host, in the same container, behind the same
// entry, network and grader. It reasons about nothing: it applies the patch it was handed (or none), and says the
// status it was told to say, in the shape of a coding host's stream-json, so the controller reads it exactly as it reads
// a real host. `sleep` never ends on its own (the wall-time and kill controls). Copied into the container alone.
//
// Handed a plugin directory (a seated control), it also plays a HOST to that plugin's own hooks, as its hooks file
// declares them for Claude Code: a prompt submitted, then one Bash call that runs one of the plugin's commands (the
// hooks before and after it), then the end of the turn -- so the plugin writes its trail as it would in a host's session,
// and the controller is proven to keep it.
//
//   node scripted.mjs patch|noop|sleep <DONE|BLOCKED|NONE> [patch-file] [plugin-dir]      cwd: the task's repository
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const line = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);

const statusText = (status) => (status === "DONE" ? "EVAL_STATUS: DONE" : status === "BLOCKED" ? "EVAL_STATUS: BLOCKED the scripted control was told to stop here" : "");

function applied(file) {
  const r = spawnSync("git", ["apply", "--binary", "--whitespace=nowarn", file], { encoding: "utf8" });
  return { ok: r.status === 0, err: String(r.stderr ?? "").slice(-300) };
}

// One line in the run's store, as an agent's memory would be: a memory track carries the store from run to run, and
// the count of these lines proves it did.
const remembered = () => (process.env.ORBIT_STORE_DIR ? appendFileSync(join(process.env.ORBIT_STORE_DIR, "scripted-runs.log"), `${new Date().toISOString()}\n`) : null);

// The commands the plugin's hooks file declares for one event and tool, as a host matches them (`*` or a regex of names).
function hooksFor(plugin, event, tool) {
  const groups = JSON.parse(readFileSync(join(plugin, "hooks", "hooks.json"), "utf8")).hooks?.[event] ?? [];
  const matches = (m) => !m || m === "*" || !tool || new RegExp(`^(?:${m})$`).test(tool);
  return groups.filter((g) => matches(g.matcher)).flatMap((g) => (g.hooks ?? []).filter((h) => h.type === "command").map((h) => h));
}

function fired(plugin, event, payload, tool) {
  for (const h of hooksFor(plugin, event, tool)) spawnSync("sh", ["-c", h.command], { input: JSON.stringify({ session_id: "scripted-session", hook_event_name: event, cwd: process.cwd(), ...payload }), env: { ...process.env, CLAUDE_PLUGIN_ROOT: plugin }, timeout: (h.timeout ?? 10) * 1000, stdio: ["pipe", "ignore", "ignore"] });
}

// One prompt, one Bash call of a plugin command with its hooks, and the turn's end.
function hostTurn(plugin) {
  const command = `node ${plugin}/cli/help.mjs`;
  const call = { tool_name: "Bash", tool_use_id: "scripted-call-1", tool_input: { command } };
  fired(plugin, "UserPromptSubmit", { prompt: "scripted control: apply the change" });
  fired(plugin, "PreToolUse", call, "Bash");
  const r = spawnSync(process.execPath, [`${plugin}/cli/help.mjs`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  fired(plugin, "PostToolUse", { ...call, tool_response: { stdout: "", stderr: "", exit_code: r.status } }, "Bash");
  fired(plugin, "Stop", { stop_hook_active: false });
}

function main([behaviour, status, file, plugin]) {
  remembered();
  if (plugin && existsSync(join(plugin, "hooks", "hooks.json"))) hostTurn(plugin);
  line({ type: "system", subtype: "init", model: "scripted", session_id: "scripted", tools: [], plugins: [] });
  if (behaviour === "sleep") return setInterval(() => null, 1 << 30);
  const a = behaviour === "patch" ? applied(file) : { ok: true };
  const text = [a.ok ? `scripted ${behaviour} done.` : `the patch did not apply: ${a.err}`, statusText(status)].filter(Boolean).join("\n\n");
  line({ type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "text", text }] } });
  line({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 0, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 }, permission_denials: [], result: text });
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
