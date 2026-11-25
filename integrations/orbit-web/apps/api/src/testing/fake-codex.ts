// OPENAI CODEX STAND-INS for the integration tests: the control plane's codex (version, help, sign-in status, model list,
// raw catalog, and the two observations -- an employee's, and a CEO's tool-less answer -- which, like the real binary,
// send the stand-in provider Orbit Web serves one request naming the tools offered, with the developer instructions and
// any AGENTS.md the run reads) and an employee's codex in a model plane (its `exec --json` events, its tool calls through
// Orbit Web's real tool endpoint). Never the codex installed on the machine running the tests: every codex command these
// do not know is answered "not installed".
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Call, FakeChild, FakeProcessPort, SpawnScript } from "./fake-process.js";
import { program } from "./fake-process.js";
import type { EmployeeScript, ToolCaller } from "./fake-sandbox.js";

// A model's whole entry as `codex debug models` prints it (codex-cli 0.169.0, the instructions shortened): code mode,
// the patch tool, sub-agents, the tool search and images -- what an employee's entry takes away.
export const rawCodexEntry = (slug: string, priority: number): Record<string, unknown> => ({
  slug,
  display_name: slug.toUpperCase(),
  description: `The ${slug} model.`,
  default_reasoning_level: "medium",
  supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
  shell_type: "unified_exec",
  visibility: "list",
  priority,
  apply_patch_tool_type: "freeform",
  web_search_tool_type: "text_and_image",
  tool_mode: "code_mode_only",
  experimental_supported_tools: ["clock"],
  node_repl_disabled: false,
  multi_agent_version: "v2",
  input_modalities: ["text", "image"],
  supports_search_tool: true,
  base_instructions: "You are Codex.",
});

const CODEX_MODELS = [rawCodexEntry("gpt-6.1-sol", 1), rawCodexEntry("gpt-5.5", 13)];

const VIEWER_REFUSED = "view_image is not allowed because you do not support image inputs";

// What the observed binary offers a model run with this entry: held (Orbit's entry: the MCP readers, a viewer that
// refuses, and Orbit's tools where its bridge is configured) or its own (code mode, sub-agents).
function offeredFor(entry: Record<string, unknown> | undefined, bridged: boolean): unknown[] {
  const orbit = entry !== undefined && entry.tool_mode === undefined && JSON.stringify(entry.input_modalities) === '["text"]' && entry.supports_search_tool === false;
  if (orbit) {
    return [
      { type: "namespace", name: "functions", tools: ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource", "request_user_input", "view_image"].map((name) => ({ type: "function", name })) },
      ...(bridged ? [{ type: "namespace", name: "mcp__orbit_tools", tools: [{ type: "function", name: "submit_handoff" }] }] : []),
    ];
  }
  return [
    { type: "namespace", name: "functions", tools: [{ type: "custom", name: "exec", description: "### `apply_patch`\n### `exec_command`\n### `view_image`" }, { type: "function", name: "request_user_input" }] },
    { type: "namespace", name: "collaboration", tools: [{ type: "function", name: "spawn_agent" }] },
  ];
}

const argAfter = (args: readonly string[], prefix: string): string | null => {
  const a = args.find((x) => x.startsWith(prefix));
  return a === undefined ? null : a.slice(prefix.length);
};

// An observation, as the binary runs it: one request to the stand-in provider with the tools it offers (Orbit's only
// where its bridge is configured: a CEO's tool-less run has no MCP server), the developer instructions, and the AGENTS.md
// beside it unless project instructions are switched off; when the answer asks for the image viewer, a second request
// with what the viewer said. `offers` replaces what a model is offered (a binary that is not held).
export async function codexObservation(call: Call, offers?: (entry: Record<string, unknown> | undefined, bridged: boolean) => unknown[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const provider = argAfter(call.args, "model_providers.orbit_observation=") ?? "";
  const base = /base_url="([^"]+)"/.exec(provider)?.[1];
  const file = JSON.parse(argAfter(call.args, "model_catalog_json=") ?? '""') as string;
  if (base === undefined || file === "") return { code: 2, stdout: "", stderr: "not an observation" };
  const entry = (JSON.parse(readFileSync(file, "utf8")) as { models: Record<string, unknown>[] }).models[0];
  const bridged = !call.args.includes("mcp_servers={}");
  const offered = (offers ?? offeredFor)(entry, bridged);
  const instructions = argAfter(call.args, "developer_instructions=");
  const agents = join(call.cwd, "AGENTS.md");
  const project = !call.args.includes("project_doc_max_bytes=0") && existsSync(agents) ? readFileSync(agents, "utf8") : null;
  const input = [
    ...(instructions !== null ? [{ type: "message", role: "developer", content: [{ type: "input_text", text: JSON.parse(instructions) as string }] }] : []),
    ...(project !== null ? [{ type: "message", role: "user", content: [{ type: "input_text", text: project }] }] : []),
    { type: "additional_tools", role: "developer", tools: offered },
  ];
  const first = await fetch(`${base}/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: entry?.slug, tools: [], input }) });
  const said = await first.text();
  if (said.includes('"name":"view_image"')) {
    const output = JSON.stringify(entry?.input_modalities) === '["text"]' ? VIEWER_REFUSED : "unable to process image: invalid or unsupported image data";
    await (await fetch(`${base}/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: [{ type: "function_call_output", call_id: "call_1", output }] }) })).text();
  }
  return { code: 0, stdout: '{"type":"thread.started","thread_id":"observation"}\n', stderr: "" };
}

// The control plane's codex: installed (0.169.0), signed in with an API key, its picker's models, its raw catalog, and
// the employee observation.
export function fakeCodexControl(fake: FakeProcessPort): FakeProcessPort {
  return fake
    .on(program("codex"), { run: { code: null, spawnError: "ENOENT" }, spawn: (child) => child.exit(null, null) })
    .on(program("codex", "--version"), { run: { stdout: "codex-cli 0.169.0\n" } })
    .on(program("codex", "--help"), { run: { stdout: "Commands:\n  exec              Run Codex non-interactively [aliases: e]\n  login             Manage login\n" } })
    .on(program("codex", "exec", "--help"), { run: { stdout: "Commands:\n  resume  Resume a previous session by id or pick the most recent with --last\nOptions:\n      --json\n          Print events to stdout as JSONL\n" } })
    .on(program("codex", "exec", "--skip-git-repo-check"), { run: { code: 1, stderr: "Error loading config.toml: unknown variant `?`, expected one of `disabled`, `cached`, `indexed`, `live`\nin `web_search`\n" } })
    .on(program("codex", "login", "--with-api-key"), { run: { stdout: "Successfully logged in\n" } })
    .on(program("codex", "login", "status"), { run: { stderr: "Logged in using an API key - sk-proj-***ABCDE\n" } })
    .on(program("codex", "debug", "models"), { run: { stdout: JSON.stringify({ models: CODEX_MODELS }) } })
    .on(program("codex", "exec", "--json"), { run: (call) => codexObservation(call) })
    .on(program("codex", "app-server"), {
      spawn: (child) => {
        child.onSignal((signal) => child.exit(null, signal));
        child.onInput((text) => {
          if (!text.includes('"model/list"')) return;
          const data = CODEX_MODELS.map((m, i) => ({ id: m.slug, model: m.slug, displayName: m.display_name, description: m.description, hidden: false, isDefault: i === 0, supportedReasoningEfforts: ["low", "medium", "high"].map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })), defaultReasoningEffort: "medium" }));
          setImmediate(() => child.stdout(`${JSON.stringify({ id: 2, result: { data, nextCursor: null } })}\n`));
        });
      },
    });
}

// The bridge's connection, as Codex's MCP table names it.
function codexBridgeOf(args: readonly string[]): { url: string; token: string } {
  const table = argAfter(args, "mcp_servers=") ?? "";
  return { url: /ORBIT_TOOL_URL="([^"]+)"/.exec(table)?.[1] ?? "", token: /ORBIT_RUN_TOKEN="([^"]+)"/.exec(table)?.[1] ?? "" };
}

// An employee's codex in its model plane: `exec --json` events, each tool call through Orbit Web's real tool endpoint as
// the bridge would make it, then its message and the turn's end.
export function scriptedCodexEmployee(script: EmployeeScript): SpawnScript {
  return (child: FakeChild, call: Call) => {
    let prompt = "";
    child.onSignal((signal) => child.exit(null, signal));
    child.onInput((t) => (prompt += t));
    child.onInputClosed(() => {
      void (async () => {
        const bridge = codexBridgeOf(call.args);
        child.line({ type: "thread.started", thread_id: "th_fake" });
        child.line({ type: "turn.started" });
        let n = 0;
        const caller: ToolCaller = {
          prompt,
          args: call.args,
          bridge,
          child,
          call: async (name, args) => {
            n += 1;
            child.line({ type: "item.started", item: { id: `mcp_${n}`, type: "mcp_tool_call", server: "orbit_tools", tool: name, arguments: args, status: "in_progress" } });
            const res = await fetch(`${bridge.url}/call`, { method: "POST", headers: { "content-type": "application/json", "x-orbit-run-token": bridge.token, "x-orbit-web": "1" }, body: JSON.stringify({ name, arguments: args }) });
            const body = (await res.json()) as { text?: string; isError?: boolean; error?: { message?: string } };
            child.line({ type: "item.completed", item: { id: `mcp_${n}`, type: "mcp_tool_call", server: "orbit_tools", tool: name, arguments: args, status: "completed" } });
            return res.status === 200 ? { text: String(body.text ?? ""), isError: body.isError === true } : { text: String(body.error?.message ?? res.status), isError: true };
          },
        };
        try {
          await script(caller);
          child.line({ type: "item.completed", item: { id: "msg", type: "agent_message", text: "Done." } });
          child.line({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
          child.exit(0);
        } catch (err) {
          child.stderr(String(err));
          child.exit(1);
        }
      })();
    });
  };
}
