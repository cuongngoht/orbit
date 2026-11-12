#!/usr/bin/env node
// THE SCRIPTED AGENT: what a self-control runs in place of a coding host, in the same container, behind the same
// entry, network and grader. It reasons about nothing: it applies the patch it was handed (or none), and says the
// status it was told to say, in the shape of a coding host's stream-json, so the controller reads it exactly as it reads
// a real host. `sleep` never ends on its own (the wall-time and kill controls). Copied into the container alone.
//
//   node scripted.mjs patch|noop|sleep <DONE|BLOCKED|NONE> [patch-file]      cwd: the task's repository
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const line = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);

const statusText = (status) => (status === "DONE" ? "EVAL_STATUS: DONE" : status === "BLOCKED" ? "EVAL_STATUS: BLOCKED the scripted control was told to stop here" : "");

function applied(file) {
  const r = spawnSync("git", ["apply", "--binary", "--whitespace=nowarn", file], { encoding: "utf8" });
  return { ok: r.status === 0, err: String(r.stderr ?? "").slice(-300) };
}

function main([behaviour, status, file]) {
  line({ type: "system", subtype: "init", model: "scripted", session_id: "scripted", tools: [], plugins: [] });
  if (behaviour === "sleep") return setInterval(() => null, 1 << 30);
  const a = behaviour === "patch" ? applied(file) : { ok: true };
  const text = [a.ok ? `scripted ${behaviour} done.` : `the patch did not apply: ${a.err}`, statusText(status)].filter(Boolean).join("\n\n");
  line({ type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "text", text }] } });
  line({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 0, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 }, permission_denials: [], result: text });
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
