// A SANDBOX PROVIDER FOR TESTS: everything in memory -- a desk per employee (with its toolbox), a workspace per
// assignment, the files of each area -- and a model plane that is a FakeProcessPort the test scripts (the scripted
// employee below calls Orbit Web's real tool endpoint over HTTP with its run's token, as the real bridge would). What it
// attests is what the test sets (a shell by default). It isolates nothing: it is the logic's stand-in, never evidence of
// isolation (the container provider's own tests are).
import type { EnforcementLevel, UsageView } from "@orbit-web/contracts";
import type { AreaState, AttemptEvidence, AttemptHandle, AttemptSpec, AttemptStatus, ExecRequest, ExecResult, FileEntry, HostCapabilities, ProvisionResult, SandboxIds, SandboxProvider } from "../contexts/execution/application/sandbox.port.js";
import { FakeProcessPort, type Call, type FakeChild, type SpawnScript } from "./fake-process.js";

interface Attempt {
  handle: AttemptHandle;
  spec: AttemptSpec;
  running: boolean;
  removed: boolean;
  oom: { modelPlane: boolean; toolPlane: boolean };
}

const HARD: EnforcementLevel = "HARD_ENFORCED";

const usage = (): UsageView => ({ cpuSeconds: 1.5, memoryCurrentMiB: 120, memoryPeakMiB: 180, oomKilled: false, pidsPeak: 12, diskUsedMiB: 3, networkBytesIn: 0, networkBytesOut: 0, sampledAt: new Date().toISOString() });

export class FakeSandboxProvider implements SandboxProvider {
  readonly kind = "container" as const;
  readonly cli = new FakeProcessPort();
  // By sandbox id: the desk's files ("work/…", "toolbox/…") and its version.
  readonly desks = new Map<string, { version: number; files: Map<string, Buffer>; publishedBy: string | null }>();
  // By assignment id: the workspace's files ("/work/…", "/output/…", "/toolbox/…").
  readonly workspaces = new Map<string, Map<string, Buffer>>();
  readonly attempts = new Map<string, Attempt>();
  readonly execs: { dispatchKey: string; argv: string[]; cwd: string | undefined }[] = [];
  // What the test controls.
  shell = true;
  provisionFailures = 0;
  findFails = false;
  // How the provider reads an input's bytes from Orbit Web's own store (bound by the test to the real reader).
  readInput: ((storePath: string) => Promise<Buffer>) | null = null;
  exec_: (req: ExecRequest) => ExecResult = (req) => ({ code: 0, signal: null, stdout: `ran: ${req.argv.slice(2).join(" ")}`, stderr: "", timedOut: false, truncated: false });

  async probe(): Promise<HostCapabilities> {
    return {
      provider: "container",
      runtime: { reachable: true, version: "fake", cgroup: "v2", detail: "in memory" },
      limits: { cpu: HARD, memory: HARD, pids: HARD, evidence: "fake" },
      storage: { mechanism: "none", areas: [], hostDiskProtection: HARD, evidence: "fake", probedAt: new Date().toISOString() } as never,
      host: { cpuMillis: 4000, memoryMiB: 16384, storageMiB: 200_000 },
      shellPossible: true,
      probedAt: new Date().toISOString(),
    };
  }

  async provisionEmployee(ids: SandboxIds, quotas: { deskMiB: number; cacheMiB: number }): Promise<ProvisionResult> {
    if (this.provisionFailures > 0) {
      this.provisionFailures -= 1;
      throw new Error("the fake volume could not be made");
    }
    if (!this.desks.has(ids.sandboxId)) this.desks.set(ids.sandboxId, { version: 0, files: new Map(), publishedBy: null });
    return {
      state: "READY",
      reason: null,
      areas: [
        { area: "desk", quotaMiB: quotas.deskMiB, level: HARD, evidence: "fake: an over-quota write was refused", usedMiB: 0 },
        { area: "cache", quotaMiB: quotas.cacheMiB, level: HARD, evidence: "fake: an over-quota write was refused", usedMiB: 0 },
      ],
    };
  }

  async archiveEmployee(): Promise<void> {}

  async measure(): Promise<AreaState[]> {
    return [];
  }

  async prepareWorkspace(ids: SandboxIds, assignmentId: string, scratchMiB: number): Promise<AreaState> {
    if (!this.workspaces.has(assignmentId)) {
      const desk = this.desks.get(ids.sandboxId);
      const files = new Map<string, Buffer>();
      for (const [p, b] of desk?.files ?? []) files.set(`/${p}`, Buffer.from(b));
      this.workspaces.set(assignmentId, files);
    }
    return { area: "scratch", quotaMiB: scratchMiB, level: HARD, evidence: "fake", usedMiB: 0 };
  }

  async publishWorkspace(ids: SandboxIds, assignmentId: string, expectedDeskVersion: number): Promise<{ published: boolean; deskVersion: number; changed: string[]; reason: string | null }> {
    const desk = this.desks.get(ids.sandboxId);
    const ws = this.workspaces.get(assignmentId);
    if (desk === undefined || ws === undefined) return { published: false, deskVersion: desk?.version ?? 0, changed: [], reason: "nothing to publish" };
    if (desk.publishedBy === assignmentId) return { published: true, deskVersion: desk.version, changed: [], reason: null };
    if (desk.version !== expectedDeskVersion) return { published: false, deskVersion: desk.version, changed: [], reason: "the desk moved" };
    const changed: string[] = [];
    for (const [p, b] of ws) {
      if (!p.startsWith("/work/") && !p.startsWith("/toolbox/")) continue;
      const key = p.slice(1);
      if (!desk.files.get(key)?.equals(b)) changed.push(key);
      desk.files.set(key, Buffer.from(b));
    }
    desk.version += 1;
    desk.publishedBy = assignmentId;
    return { published: true, deskVersion: desk.version, changed, reason: null };
  }

  async removeWorkspace(_ids: SandboxIds, assignmentId: string): Promise<{ gone: boolean; detail: string }> {
    this.workspaces.delete(assignmentId);
    return { gone: true, detail: "removed" };
  }

  async startAttempt(spec: AttemptSpec): Promise<AttemptHandle> {
    const prior = this.attempts.get(spec.dispatchKey);
    if (prior !== undefined && !prior.removed) return prior.handle;
    const handle: AttemptHandle = {
      runId: spec.runId,
      dispatchKey: spec.dispatchKey,
      toolPlane: `tool-${spec.dispatchKey}`,
      modelPlane: `model-${spec.dispatchKey}`,
      provider: "container",
      createdAt: new Date().toISOString(),
      modelPlaneHome: "/connection",
      modelPlaneCwd: "/run",
      bridgeCommand: { command: "node", args: ["/opt/orbit-web/bridge/main.js"] },
    };
    this.attempts.set(spec.dispatchKey, { handle, spec, running: true, removed: false, oom: { modelPlane: false, toolPlane: false } });
    const files = this.files(handle);
    for (const i of spec.inputs) {
      if (this.readInput === null) throw new Error("this fake provider was given inputs but no way to read them");
      files.set(`/input/${i.name}`, await this.readInput(i.storePath));
    }
    return handle;
  }

  async find(dispatchKey: string): Promise<AttemptStatus | null> {
    if (this.findFails) throw new Error("the fake allocator does not answer");
    const a = this.attempts.get(dispatchKey);
    if (a === undefined || a.removed) return null;
    return { handle: a.handle, toolPlaneRunning: a.running, modelPlaneRunning: a.running, oomKilled: a.oom };
  }

  async attest(handle: AttemptHandle): Promise<AttemptEvidence> {
    const at = new Date().toISOString();
    const spec = this.attempt(handle).spec;
    return {
      attestation: { provider: "container", state: "attested", shell: this.shell, detail: this.shell ? "Isolated from Orbit Web and every other attempt (fake)." : "No shell in this attempt (fake).", checks: [{ name: "fake", ok: true, detail: null }], checkedAt: at },
      applied: { cpuMillis: spec.resources.cpuMillis, memoryMiB: spec.resources.memoryMiB, pidsLimit: spec.resources.pidsLimit, readBackAt: at },
      observed: { cpuQuota: `${spec.resources.cpuMillis * 100} 100000`, memoryLimit: String(spec.resources.memoryMiB * 1024 * 1024), pidsMax: String(spec.resources.pidsLimit), storage: [{ area: "scratch", level: HARD, evidence: "fake" }], at },
    };
  }

  modelPlane(): FakeProcessPort {
    return this.cli;
  }

  async exec(handle: AttemptHandle, req: ExecRequest): Promise<ExecResult> {
    this.execs.push({ dispatchKey: handle.dispatchKey, argv: req.argv, cwd: req.cwd });
    return this.exec_(req);
  }

  async readFile(handle: AttemptHandle, path: string, maxBytes: number): Promise<Buffer | null> {
    const b = this.files(handle).get(path);
    return b === undefined ? null : b.subarray(0, maxBytes);
  }

  async writeFile(handle: AttemptHandle, path: string, bytes: Buffer): Promise<void> {
    this.files(handle).set(path, Buffer.from(bytes));
  }

  async list(handle: AttemptHandle, dir: string, maxEntries: number): Promise<FileEntry[]> {
    const prefix = `${dir.replace(/\/+$/, "")}/`;
    const out: FileEntry[] = [];
    for (const [p, b] of this.files(handle)) if (p.startsWith(prefix)) out.push({ path: p.slice(prefix.length), type: "file", size: b.length });
    return out.sort((a, b) => a.path.localeCompare(b.path)).slice(0, maxEntries);
  }

  async usage(): Promise<{ modelPlane: UsageView | null; toolPlane: UsageView | null }> {
    return { modelPlane: usage(), toolPlane: usage() };
  }

  async stop(handle: AttemptHandle): Promise<void> {
    const a = this.attempts.get(handle.dispatchKey);
    if (a !== undefined) a.running = false;
  }

  async remove(handle: AttemptHandle): Promise<{ gone: boolean; detail: string }> {
    const a = this.attempts.get(handle.dispatchKey);
    if (a !== undefined) {
      a.running = false;
      a.removed = true;
    }
    return { gone: true, detail: "removed" };
  }

  // The workspace of the attempt's assignment.
  private files(handle: AttemptHandle): Map<string, Buffer> {
    const a = this.attempt(handle);
    let ws = this.workspaces.get(a.spec.assignmentId);
    if (ws === undefined) {
      ws = new Map();
      this.workspaces.set(a.spec.assignmentId, ws);
    }
    return ws;
  }

  private attempt(handle: AttemptHandle): Attempt {
    const a = this.attempts.get(handle.dispatchKey);
    if (a === undefined) throw new Error(`no attempt ${handle.dispatchKey}`);
    return a;
  }
}

// ---- the scripted employee -----------------------------------------------------------------------------------------

export interface ToolCaller {
  call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  prompt: string;
  args: string[];
  // The bridge's connection as the model plane was given it (a test may knock on other doors with the run's token).
  bridge: { url: string; token: string };
  child: FakeChild;
}

// What the scripted CLI does once started: the tool calls of one attempt (through Orbit Web's real tool endpoint).
export type EmployeeScript = (tools: ToolCaller) => Promise<void>;

// The bridge's connection, as the model plane's MCP config names it.
function bridgeOf(args: string[]): { url: string; token: string } {
  const i = args.indexOf("--mcp-config");
  const config = JSON.parse(args[i + 1] ?? "{}") as { mcpServers?: Record<string, { env?: Record<string, string> }> };
  const env = config.mcpServers?.orbit_tools?.env ?? {};
  return { url: env.ORBIT_TOOL_URL ?? "", token: env.ORBIT_RUN_TOKEN ?? "" };
}

// A Claude Code stand-in that speaks its stream-json, reports the init line Orbit Web expects (or `init` given), calls
// the tools the script asks through the tool endpoint, and ends with a result line.
export function scriptedEmployee(script: EmployeeScript, o: { init?: (tools: string[]) => Record<string, unknown>; exitCode?: number } = {}): SpawnScript {
  return (child: FakeChild, call: Call) => {
    let prompt = "";
    // Like a real CLI: a signal ends it (what it had not done yet is never done).
    child.onSignal((signal) => child.exit(null, signal));
    child.onInput((t) => (prompt += t));
    child.onInputClosed(() => {
      void (async () => {
        const bridge = bridgeOf(call.args);
        const tools = ["TodoWrite", "mcp__orbit_tools__list_files", "mcp__orbit_tools__read_file", "mcp__orbit_tools__write_file", "mcp__orbit_tools__edit_file", "mcp__orbit_tools__shell", "mcp__orbit_tools__submit_handoff", "mcp__orbit_tools__ask_question"];
        const model = call.args[call.args.indexOf("--model") + 1] ?? "unknown";
        child.line(o.init?.(tools) ?? { type: "system", subtype: "init", session_id: "fake-session", model, tools, mcp_servers: [{ name: "orbit_tools", status: "connected" }], plugins: [], claude_code_version: "2.1.330" });
        let n = 0;
        const caller: ToolCaller = {
          prompt,
          args: call.args,
          bridge,
          child,
          call: async (name, args) => {
            n += 1;
            child.line({ type: "assistant", message: { content: [{ type: "tool_use", id: `t${n}`, name: `mcp__orbit_tools__${name}`, input: args }] } });
            const res = await fetch(`${bridge.url}/call`, { method: "POST", headers: { "content-type": "application/json", "x-orbit-run-token": bridge.token, "x-orbit-web": "1" }, body: JSON.stringify({ name, arguments: args }) });
            const body = (await res.json()) as { text?: string; isError?: boolean; error?: { message?: string } };
            return res.status === 200 ? { text: String(body.text ?? ""), isError: body.isError === true } : { text: String(body.error?.message ?? res.status), isError: true };
          },
        };
        try {
          await script(caller);
          child.line({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.0123, num_turns: n + 1, duration_ms: 1500, result: "done" });
          child.exit(o.exitCode ?? 0);
        } catch (err) {
          child.stderr(String(err));
          child.exit(1);
        }
      })();
    });
  };
}
