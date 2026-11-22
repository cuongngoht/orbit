import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { neutralizedCodexModel } from "../../contexts/execution/infrastructure/employee-runtimes.js";
import { NodeProcessPort } from "../../infra/process/node-process.js";
import { CODEX_BRIDGE_MAIN, observeCodexSplit, offeredTools, splitVerdict } from "./codex-split.js";

// What codex-cli 0.169.0 sent the stand-in model (descriptions cut to what is read): held as an employee's model plane
// is -- every local executor off, Orbit's entry for the model -- and as it is by default.
const HELD = { model: "gpt-6.1-sol", tools: [], input: [{ type: "additional_tools", role: "developer", tools: [{ type: "namespace", name: "functions", tools: [{ type: "function", name: "list_mcp_resources" }, { type: "function", name: "list_mcp_resource_templates" }, { type: "function", name: "read_mcp_resource" }, { type: "function", name: "request_user_input" }, { type: "function", name: "view_image" }] }, { type: "namespace", name: "mcp__orbit_tools", tools: [{ type: "function", name: "shell" }, { type: "function", name: "submit_handoff" }] }] }] };
const DEFAULT = { model: "gpt-6.1-sol", tools: [], input: [{ type: "additional_tools", role: "developer", tools: [{ type: "namespace", name: "functions", tools: [{ type: "custom", name: "exec", description: "### `apply_patch`\n### `exec_command`\n### `view_image`\n### `write_stdin`" }, { type: "function", name: "wait" }, { type: "function", name: "request_user_input" }] }, { type: "namespace", name: "collaboration", tools: [{ type: "function", name: "spawn_agent" }] }] }] };

const REFUSED = "view_image is not allowed because you do not support image inputs";

test("the tools a request offers a model, wherever they are: its tools, its additional tools, namespaces, code mode's nested ones", () => {
  assert.deepEqual(offeredTools(HELD), ["functions.list_mcp_resources", "functions.list_mcp_resource_templates", "functions.read_mcp_resource", "functions.request_user_input", "functions.view_image", "mcp__orbit_tools.shell", "mcp__orbit_tools.submit_handoff"]);
  assert.deepEqual(offeredTools(DEFAULT), ["functions.exec", "functions.exec→apply_patch", "functions.exec→exec_command", "functions.exec→view_image", "functions.exec→write_stdin", "functions.wait", "functions.request_user_input", "collaboration.spawn_agent"]);
  assert.deepEqual(offeredTools({ tools: [{ type: "web_search" }, { type: "function", name: "view_image" }] }), ["web_search", "view_image"]);
  assert.deepEqual(offeredTools("nothing"), []);
});

test("held to Orbit's tools only when every tool offered is Orbit's or inert, and Orbit's are there", () => {
  assert.deepEqual(splitVerdict({ offered: offeredTools(HELD), viewImage: REFUSED }), { split: "yes", reason: null });
  const read = splitVerdict({ offered: offeredTools(HELD), viewImage: "unable to process image: invalid or unsupported image data" });
  assert.equal(read.split, "no");
  assert.match(read.reason ?? "", /view_image read a file/);
  assert.equal(splitVerdict({ offered: offeredTools(HELD), viewImage: null }).split, "no", "a viewer never asked is not known to refuse");
  const open = splitVerdict({ offered: offeredTools(DEFAULT), viewImage: null });
  assert.equal(open.split, "no");
  assert.match(open.reason ?? "", /functions\.exec.*exec_command.*collaboration\.spawn_agent/);
  const none = splitVerdict({ offered: ["functions.request_user_input"], viewImage: null });
  assert.deepEqual(none, { split: "no", reason: "none of Orbit's tools reached the model" });
  assert.equal(splitVerdict({ offered: [...offeredTools(HELD), "web_search"], viewImage: REFUSED }).split, "no", "the provider's search only where a run asks for it");
});

// The observation itself, on the codex binary installed here -- skipped where there is none (the CI): Orbit's entry and
// flags are held; the model's own entry is not.
const codex = spawnSync("codex", ["--version"], { encoding: "utf8" });
test("on the installed codex: Orbit's model plane is held to Orbit's tools, the model's own is not", { skip: codex.status !== 0 ? "codex is not installed here" : false, timeout: 120_000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "codex-split-"));
  try {
    const bundled = spawnSync("codex", ["debug", "models", "--bundled"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: scratch, CODEX_HOME: scratch }, maxBuffer: 8 * 1024 * 1024 });
    const entry = (JSON.parse(bundled.stdout) as { models: Record<string, unknown>[] }).models.find((m) => m.slug === "gpt-6.1-sol" || m.visibility === "list") as Record<string, unknown>;
    const deps = { process: new NodeProcessPort(), codex: "codex", node: process.execPath, bridge: CODEX_BRIDGE_MAIN, scratchParent: scratch, env: { PATH: process.env.PATH ?? "" }, timeoutMs: 60_000 };
    const held = await observeCodexSplit(deps, { model: String(entry.slug), entry: neutralizedCodexModel(entry) });
    assert.equal(held.split, "yes", JSON.stringify(held));
    assert.ok(held.offered.includes("mcp__orbit_tools.submit_handoff"), JSON.stringify(held.offered));
    const own = await observeCodexSplit(deps, { model: String(entry.slug), entry });
    assert.equal(own.split, "no", JSON.stringify(own));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
