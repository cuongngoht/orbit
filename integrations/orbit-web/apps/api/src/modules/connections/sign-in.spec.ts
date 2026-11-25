import assert from "node:assert/strict";
import { test } from "node:test";
import { readClaudeLogin, readCodexLogin, SIGN_IN_READERS, signsInHere } from "./sign-in.js";

// What `claude auth login --claudeai` printed on Claude Code 2.1.328 (the state shortened).
const CLAUDE_PROMPT =
  "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&response_type=code&state=ysA25xLb\nPaste code here if prompted > ";

// What `codex login --device-auth` printed on codex-cli 0.169.0.
const CODEX_DEVICE = [
  "Welcome to Codex [v0.169.0]",
  "OpenAI's command-line coding agent",
  "",
  "Follow these steps to sign in with ChatGPT using device code authorization:",
  "",
  "1. Open this link in your browser and sign in to your account",
  "   https://auth.openai.com/codex/device",
  "",
  "2. Enter this one-time code (expires in 15 minutes)",
  "   VQZB-WOWS4",
  "",
  "Continue only if you started this login in Codex. If a website or another person gave you this code, cancel.",
  "",
].join("\n");

test("Claude Code's sign-in: the URL after `visit:`, and that it waits for the code a person pastes back", () => {
  assert.deepEqual(readClaudeLogin("Opening browser to sign in…\n"), { url: null, needsCode: false }, "nothing to act on yet");
  const f = readClaudeLogin(CLAUDE_PROMPT);
  assert.equal(f.url, "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&response_type=code&state=ysA25xLb");
  assert.equal(f.needsCode, true);
  assert.equal(SIGN_IN_READERS.claude?.ready(f), true);
  assert.equal(readClaudeLogin(`\u001b[2m${CLAUDE_PROMPT}\u001b[0m`).url, f.url, "a colour code is not part of the URL");
});

test("Codex's device sign-in: the link to open and the one-time code to enter there -- nothing is pasted back", () => {
  const half = readCodexLogin(CODEX_DEVICE.split("2. Enter")[0] as string);
  assert.equal(half.url, "https://auth.openai.com/codex/device");
  assert.equal(half.code, null);
  assert.equal(SIGN_IN_READERS.codex?.ready(half), false, "not ready before the code is printed");
  const f = readCodexLogin(CODEX_DEVICE);
  assert.deepEqual(f, { url: "https://auth.openai.com/codex/device", code: "VQZB-WOWS4" });
  assert.equal(SIGN_IN_READERS.codex?.ready(f), true);
  assert.equal(readCodexLogin(CODEX_DEVICE).needsCode, undefined, "Codex asks for nothing back");
  assert.deepEqual(readCodexLogin(`\u001b[94m${CODEX_DEVICE}\u001b[0m`), f, "colour codes are not read as part of either");
});

test("only a subscription whose CLI has a sign-in Orbit Web can relay is signed in from its card -- never Antigravity's", () => {
  assert.equal(signsInHere({ runtime: "claude", method: "subscription" }), true);
  assert.equal(signsInHere({ runtime: "codex", method: "subscription" }), true);
  assert.equal(signsInHere({ runtime: "agy", method: "subscription" }), false, "agy has no sign-in command, and its terms do not permit one");
  assert.equal(signsInHere({ runtime: "claude", method: "api_key" }), false);
  assert.equal(signsInHere({ runtime: "claude", method: "cloud" }), false);
});
