// WHETHER AN EMPLOYEE'S CODEX MODEL PLANE IS HELD TO ORBIT'S TOOLS -- OBSERVED on the binary installed, never read from
// documentation or a list of switches. Orbit Web stands in for the model provider for one turn, on the loopback:
// `codex exec` is run exactly as an employee's model plane runs it (employee-runtimes.ts codexArgs, the same Orbit entry
// for the model), but with its model provider set to a server here. The request Codex sends a model names every tool it
// offers -- its own, a namespace's, code mode's nested ones -- and the answer then asks for its image viewer once, on a
// file planted beside it, to see that the viewer refuses before it reads. Nothing signs in, no model is called, nothing
// leaves this machine; the scratch home is removed. Held ("yes"): every tool offered is Orbit's own (the bridge's
// namespace), one of the MCP readers that only reach Orbit's bridge, the request-user-input tool, or the image viewer
// seen refusing -- and Orbit's tools are there.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { codexArgs, CODEX_MODEL_FILE, codexToollessArgs } from "../../contexts/execution/infrastructure/employee-runtimes.js";
import type { ProcessPort } from "../../infra/process/process.port.js";

// Orbit's tool bridge, as built beside this module (dist/bridge/main.js): the observation runs the real one.
export const CODEX_BRIDGE_MAIN = fileURLToPath(new URL("../../bridge/main.js", import.meta.url));

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

// ---- what a request offers ----------------------------------------------------------------------------------------------

// Every tool a Responses request offers the model, by name: its `tools` and its `additional_tools` input items,
// namespaces as `namespace.tool`, and the nested tools a code-mode `exec` declares (`exec→tool`).
export function offeredTools(body: unknown): string[] {
  if (!isRecord(body)) return [];
  const out: string[] = [];
  const walk = (t: unknown, prefix: string): void => {
    if (!isRecord(t)) return;
    if (t.type === "namespace" && Array.isArray(t.tools)) {
      for (const x of t.tools) walk(x, `${prefix}${String(t.name)}.`);
      return;
    }
    const name = `${prefix}${typeof t.name === "string" ? t.name : String(t.type)}`;
    out.push(name);
    if (t.name === "exec" && typeof t.description === "string") for (const m of t.description.matchAll(/^### `([^`]+)`/gm)) out.push(`${name}→${m[1]}`);
  };
  for (const t of Array.isArray(body.tools) ? body.tools : []) walk(t, "");
  for (const item of Array.isArray(body.input) ? body.input : []) if (isRecord(item) && item.type === "additional_tools" && Array.isArray(item.tools)) for (const t of item.tools) walk(t, "");
  return out;
}

// The tools of Codex's own an employee's model plane may be offered: the MCP readers (they reach the MCP servers Orbit
// configured -- its bridge alone) and the request-user-input tool (nothing local). The image viewer only once seen
// refusing; the provider's search only where a run asks for it (never in this observation).
const INERT = new Set(["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource", "request_user_input"]);
const ORBIT_NAMESPACE = "mcp__orbit_tools.";
const VIEWER_REFUSED = /not allowed because you do not support image inputs/;

const bare = (name: string): string => name.replace(/^functions\./, "");

export interface CodexSplit {
  split: "yes" | "no" | "unknown";
  reason: string | null;
}

export function splitVerdict(o: { offered: string[]; viewImage: string | null }): CodexSplit {
  const foreign = o.offered.filter((t) => !t.startsWith(ORBIT_NAMESPACE) && !INERT.has(bare(t)) && bare(t) !== "view_image");
  if (foreign.length > 0) return { split: "no", reason: `it offers the model tools of its own: ${foreign.slice(0, 12).join(", ")}` };
  if (!o.offered.some((t) => t.startsWith(ORBIT_NAMESPACE))) return { split: "no", reason: "none of Orbit's tools reached the model" };
  if (o.offered.some((t) => bare(t) === "view_image") && (o.viewImage === null || !VIEWER_REFUSED.test(o.viewImage))) return { split: "no", reason: `its view_image read a file (${(o.viewImage ?? "never asked").slice(0, 120)})` };
  return { split: "yes", reason: null };
}

// ---- the observation ----------------------------------------------------------------------------------------------------

export interface ObserveDeps {
  process: ProcessPort;
  // The codex program and the node that runs Orbit's bridge (this process's own).
  codex: string;
  node: string;
  bridge: string;
  // Where the scratch home is made (and removed).
  scratchParent: string;
  // The environment the CLI runs with, beside its scratch home.
  env: Record<string, string>;
  timeoutMs: number;
}

export interface CodexObservation extends CodexSplit {
  offered: string[];
}

const sse = (res: ServerResponse, type: string, data: Json): void => {
  res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
};

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => resolve(body));
  });

// The stand-in provider: the first turn records the request and answers with one call of the image viewer on the planted
// file (or a message, when no viewer was offered); the second records what came back; the bridge's tool list is one
// hand-in tool.
function standIn(planted: string): { server: ReturnType<typeof createServer>; seen: { first: unknown; viewImage: string | null } } {
  const seen: { first: unknown; viewImage: string | null } = { first: null, viewImage: null };
  let turns = 0;
  const server = createServer((req, res) => {
    void readBody(req).then((text) => {
      if (req.method === "POST" && req.url === "/tools/list") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ tools: [{ name: "submit_handoff", description: "Hand in the result.", inputSchema: { type: "object", properties: { summary: { type: "string" } } } }] }));
        return;
      }
      if (req.method !== "POST" || !/\/responses$/.test(req.url ?? "")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      turns += 1;
      const body = parsed(text);
      res.writeHead(200, { "content-type": "text/event-stream" });
      sse(res, "response.created", { response: { id: `resp_${turns}` } });
      const viewer = turns === 1 ? offeredTools(body).find((t) => bare(t) === "view_image") : undefined;
      if (turns === 1) seen.first = body;
      if (turns === 2 && isRecord(body) && Array.isArray(body.input)) {
        const output = body.input.find((i) => isRecord(i) && i.type === "function_call_output");
        seen.viewImage = isRecord(output) ? (typeof output.output === "string" ? output.output : JSON.stringify(output.output)) : null;
      }
      if (viewer !== undefined) sse(res, "response.output_item.done", { item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "view_image", ...(viewer.startsWith("functions.") ? { namespace: "functions" } : {}), arguments: JSON.stringify({ path: planted }) } });
      else sse(res, "response.output_item.done", { item: { type: "message", role: "assistant", id: `msg_${turns}`, content: [{ type: "output_text", text: "Observed." }] } });
      sse(res, "response.completed", { response: { id: `resp_${turns}`, usage: { input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 } } });
      res.end();
    });
  });
  return { server, seen };
}

// One observation of `model` run with Orbit's `entry` for it (the catalog entry the real run gets).
export async function observeCodexSplit(d: ObserveDeps, o: { model: string; entry: Json }): Promise<CodexObservation> {
  const scratch = mkdtempSync(join(d.scratchParent, "codex-split-"));
  const planted = join(scratch, "planted-login.json");
  writeFileSync(planted, '{"tokens":{"access_token":"orbit-observation-not-a-secret"}}', { mode: 0o600 });
  writeFileSync(join(scratch, CODEX_MODEL_FILE), JSON.stringify({ models: [o.entry] }), { mode: 0o600 });
  const { server, seen } = standIn(planted);
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const args = codexArgs({ model: o.model, effort: null, webSearch: false, bridge: { command: d.node, args: [d.bridge], env: { ORBIT_TOOL_URL: `http://127.0.0.1:${port}/tools`, ORBIT_RUN_TOKEN: "observation" } }, systemPrompt: "Observe.", sessionId: "observation", modelFile: join(scratch, CODEX_MODEL_FILE) });
    const provider = ["-c", 'model_provider="orbit_observation"', "-c", `model_providers.orbit_observation={name="Orbit Web observation",base_url="http://127.0.0.1:${port}/v1",wire_api="responses"}`];
    const r = await d.process.run(d.codex, [...args.slice(0, -1), ...provider, "-"], { cwd: scratch, env: { ...d.env, HOME: scratch, CODEX_HOME: scratch }, input: "Observe.\n", timeoutMs: d.timeoutMs });
    if (seen.first === null) return { split: "unknown", reason: `codex asked no model (${r.timedOut ? "timed out" : `exit ${String(r.code)}`}): ${(r.stderr || r.stdout).trim().split("\n").slice(-1)[0]?.slice(0, 200) ?? ""}`, offered: [] };
    const offered = offeredTools(seen.first);
    return { ...splitVerdict({ offered, viewImage: seen.viewImage }), offered };
  } finally {
    server.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ---- the tool-less observation: a CEO's answer ---------------------------------------------------------------------------

// What the observed request must hold, and must never hold: the fixed prompt Orbit gives (its developer instructions
// reach the model) -- and not a word of a project's AGENTS.md planted where the run starts (Codex reads none of it).
export const TOOLLESS_PROMPT = "orbit-observation: you answer with words only.";
export const TOOLLESS_AGENTS_MARKER = "orbit-observation-agents-md-must-not-be-read";

// What Codex reads from its own home as global instructions whatever it is told (seen on codex-cli 0.169.0: neither
// `--ignore-user-config` nor `project_doc_max_bytes=0` keeps them out) -- the first of these there is. The observation's
// home has none; a run's home is held to having none before it starts (executive-runtimes.ts).
export const CODEX_GLOBAL_INSTRUCTIONS = ["AGENTS.override.md", "AGENTS.md"] as const;

// Held ("yes") for an answer with no tool that acts: every tool offered is one of the MCP readers (no MCP server is
// configured, so they reach nothing), the request-user-input tool, or the image viewer seen refusing; no MCP server's
// tool, no shell, no patch, no sub-agent, no search. The fixed prompt reached the model, and no AGENTS.md did.
export function toollessVerdict(o: { offered: string[]; viewImage: string | null; request: string }): CodexSplit {
  const foreign = o.offered.filter((t) => !INERT.has(bare(t)) && bare(t) !== "view_image");
  if (foreign.length > 0) return { split: "no", reason: `it offers the model tools: ${foreign.slice(0, 12).join(", ")}` };
  if (o.offered.some((t) => bare(t) === "view_image") && (o.viewImage === null || !VIEWER_REFUSED.test(o.viewImage))) return { split: "no", reason: `its view_image read a file (${(o.viewImage ?? "never asked").slice(0, 120)})` };
  if (o.request.includes(TOOLLESS_AGENTS_MARKER)) return { split: "no", reason: "it read a project's AGENTS.md into what the model is told" };
  if (!o.request.includes(TOOLLESS_PROMPT)) return { split: "no", reason: "the fixed system prompt did not reach the model" };
  return { split: "yes", reason: null };
}

// One observation of `model` run as a CEO's answer runs it (codexToollessArgs, Orbit's `entry` for the model), laid out
// as that run is: its home (HOME and CODEX_HOME: Orbit's entry, no instructions) apart from where it starts (a project
// whose AGENTS.md must not be read).
export async function observeCodexToolless(d: ObserveDeps, o: { model: string; entry: Json }): Promise<CodexObservation> {
  const scratch = mkdtempSync(join(d.scratchParent, "codex-toolless-"));
  const home = join(scratch, "home");
  const project = join(scratch, "project");
  mkdirSync(home, { mode: 0o700 });
  mkdirSync(project, { mode: 0o700 });
  const planted = join(project, "planted-login.json");
  writeFileSync(planted, '{"tokens":{"access_token":"orbit-observation-not-a-secret"}}', { mode: 0o600 });
  writeFileSync(join(project, "AGENTS.md"), `# Instructions\n\n${TOOLLESS_AGENTS_MARKER}\n`, { mode: 0o600 });
  writeFileSync(join(home, CODEX_MODEL_FILE), JSON.stringify({ models: [o.entry] }), { mode: 0o600 });
  const { server, seen } = standIn(planted);
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const args = codexToollessArgs({ model: o.model, effort: null, systemPrompt: TOOLLESS_PROMPT, modelFile: join(home, CODEX_MODEL_FILE) });
    const provider = ["-c", 'model_provider="orbit_observation"', "-c", `model_providers.orbit_observation={name="Orbit Web observation",base_url="http://127.0.0.1:${port}/v1",wire_api="responses"}`];
    const r = await d.process.run(d.codex, [...args.slice(0, -1), ...provider, "-"], { cwd: project, env: { ...d.env, HOME: home, CODEX_HOME: home }, input: "Observe.\n", timeoutMs: d.timeoutMs });
    if (seen.first === null) return { split: "unknown", reason: `codex asked no model (${r.timedOut ? "timed out" : `exit ${String(r.code)}`}): ${(r.stderr || r.stdout).trim().split("\n").slice(-1)[0]?.slice(0, 200) ?? ""}`, offered: [] };
    const offered = offeredTools(seen.first);
    return { ...toollessVerdict({ offered, viewImage: seen.viewImage, request: JSON.stringify(seen.first) }), offered };
  } finally {
    server.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}
