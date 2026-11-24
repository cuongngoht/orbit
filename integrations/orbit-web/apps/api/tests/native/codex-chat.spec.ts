// THE NATIVE TIER: what only a REAL binary can show, run where the pinned CLI is installed and its own sandbox runs (npm
// run test:native -w @orbit-web/api) and never in the deterministic tier (scripts/ci.mjs). Skipped, saying why,
// where codex's sandbox does not run: a skip here is reported as a skip, never as a pass.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { codexChatArgs } from "../../src/modules/claude-runner/codex-chat.js";

const base = { model: "gpt-6.1-sol", effort: "medium", mode: "autonomous" as const, webTools: true, execute: true, note: null, threadId: null, images: [], confine: null };

// On the codex installed here, where its sandbox runs (skipped elsewhere, the CI among them): a model asking a chat's
// codex to read another account's sign-in gets "Operation not permitted"; its own room it reads and writes.
const sandboxRuns = ((): boolean => {
  const r = spawnSync("codex", ["sandbox", "--", "true"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: tmpdir(), CODEX_HOME: mkdtempSync(join(tmpdir(), "codex-sb-")) } });
  return r.status === 0;
})();

async function askedToRun(command: string, confineRoot: string, room: string, home: string): Promise<string> {
  let turns = 0;
  let output = "";
  const sse = (res: ServerResponse, type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      if (!/\/responses$/.test(req.url ?? "")) return void res.writeHead(404).end();
      turns += 1;
      if (turns === 2) output = JSON.stringify((JSON.parse(body) as { input?: unknown[] }).input ?? []);
      res.writeHead(200, { "content-type": "text/event-stream" });
      sse(res, "response.created", { response: { id: `r${turns}` } });
      sse(res, "response.output_item.done", { item: turns === 1 ? { type: "function_call", id: "fc", call_id: "c1", name: "exec_command", arguments: JSON.stringify({ cmd: command }) } : { type: "message", role: "assistant", id: "m", content: [{ type: "output_text", text: "ok" }] } });
      sse(res, "response.completed", { response: { id: `r${turns}`, usage: { input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 } } });
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const args = codexChatArgs({ ...base, model: "gpt-5.5", effort: null, webTools: false, confine: { denied: [confineRoot], room: [room] } });
  const provider = ["-c", 'model_provider="p"', "-c", `model_providers.p={name="p",base_url="http://127.0.0.1:${port}/v1",wire_api="responses"}`];
  const run = spawn("codex", [...args.slice(0, -1), "--ephemeral", ...provider, "-"], { cwd: room, env: { PATH: process.env.PATH ?? "", HOME: home, CODEX_HOME: home } });
  run.stdin.end("go\n");
  await new Promise((r) => run.on("exit", r));
  server.close();
  return output;
}

test("on the installed codex, a chat's confined commands read nothing of another account's, and their own room", { skip: sandboxRuns ? false : "codex's sandbox does not run here", timeout: 120_000 }, async () => {
  const data = realpathSync(mkdtempSync(join(tmpdir(), "codex-confine-")));
  try {
    mkdirSync(join(data, "connections", "b", "codex"), { recursive: true });
    mkdirSync(join(data, "connections", "a", "codex"), { recursive: true });
    mkdirSync(join(data, "workspaces", "s1", "repository"), { recursive: true });
    writeFileSync(join(data, "connections", "b", "codex", "auth.json"), "ANOTHER-ACCOUNT-SIGN-IN");
    writeFileSync(join(data, "workspaces", "s1", "repository", "hello.txt"), "hello from the room");
    const room = join(data, "workspaces", "s1");
    const home = join(data, "connections", "a", "codex");
    const other = await askedToRun(`cat ${join(data, "connections", "b", "codex", "auth.json")}`, data, room, home);
    assert.match(other, /Operation not permitted|Permission denied/);
    assert.doesNotMatch(other, /ANOTHER-ACCOUNT-SIGN-IN/);
    const own = await askedToRun(`cat ${join(room, "repository", "hello.txt")}`, data, room, home);
    assert.match(own, /hello from the room/);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});
