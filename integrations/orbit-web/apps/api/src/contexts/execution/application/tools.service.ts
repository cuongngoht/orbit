// THE TOOL PLANE'S DOOR: the tools an employee's model calls (through the `orbit_tools` bridge in its model plane),
// executed IN THE ATTEMPT'S SANDBOX through the sandbox port -- never on Orbit Web's host, never with a credential.
// A call is accepted only from a run's own token, for that run's CURRENT attempt (its fence) while it runs; the shell only
// when the attempt's attestation granted it. Paths are relative to the sandbox's areas and contained there by the
// provider. What a tool reads or writes is never logged; the run keeps counts.
//
// Handing in (`submit_handoff`): the files in /output are staged into the account's immutable artifact store (bytes,
// then their hash verified, then the row), then Work records the handoff -- once per submission key.
import { Inject, Injectable, Optional } from "@nestjs/common";
import { isDeliverableName } from "@orbit-web/contracts";
import { createHash } from "node:crypto";
import { conflictWith, invalid, refused } from "../../shared/domain.js";
import { systemActor } from "../../shared/application/commands.js";
import { ArtifactStore } from "../infrastructure/artifact-store.js";
import { RunRepository, type RunRecord } from "../infrastructure/runs.repository.js";
import { ResearchInputs, type ClaimInput } from "./research-inputs.js";
import { RUN_OUTCOMES, type RunOutcomes, type StagedArtifact } from "./run-outcomes.port.js";
import { SANDBOX_PROVIDER, type AttemptHandle, type SandboxProvider } from "./sandbox.port.js";

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const MAX_READ = 512 * 1024;
const MAX_WRITE = 10 * 1024 * 1024;
const MAX_ARTIFACT = 50 * 1024 * 1024;
const MAX_HANDOFF = 200 * 1024 * 1024;
const MAX_OUTPUT = 64 * 1024;

const obj = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string) => ({ type: "string", description });

const TOOLS: ToolSpec[] = [
  { name: "list_files", description: "List a directory of your workspace (/work, /output, /input, /toolbox, /team).", inputSchema: obj({ path: str("A directory, e.g. /work or /output/reports") }, ["path"]) },
  { name: "read_file", description: "Read a text file of your workspace (up to 512 KiB).", inputSchema: obj({ path: str("The file, e.g. /work/notes.md") }, ["path"]) },
  { name: "write_file", description: "Create or replace a file in /work, /output, /toolbox or /team.", inputSchema: obj({ path: str("The file to write"), content: str("Its whole text") }, ["path", "content"]) },
  { name: "edit_file", description: "Replace one exact occurrence of a text in a file.", inputSchema: obj({ path: str("The file"), old_text: str("Text that occurs exactly once"), new_text: str("Its replacement") }, ["path", "old_text", "new_text"]) },
  { name: "shell", description: "Run a shell command in your sandbox (bash), in /work or a directory under it. Install packages, write and run scripts, build, test.", inputSchema: obj({ command: str("The command line"), cwd: str("A directory under /work (default /work)"), timeout_seconds: { type: "integer", minimum: 1, maximum: 3600 } }, ["command"]) },
  { name: "submit_handoff", description: "Hand in your result once the deliverables are in /output: a short summary and the claims it rests on. Cite a source you were given by its label (S1, S2 ...) and quote the exact words of it the claim rests on: Orbit checks the quote against the source.", inputSchema: obj({ summary: str("What you did and how you checked it"), claims: { type: "array", items: obj({ text: str("A claim of your result"), sources: { type: "array", items: { type: "string" }, description: "Labels of the sources it rests on, e.g. S1" }, quote: str("The exact words of the cited source the claim rests on"), url: str("A web page it rests on, if any") }, ["text"]) } }, ["summary"]) },
  { name: "ask_question", description: "Ask the person who gave you the work a question you cannot continue without. The work waits for the answer.", inputSchema: obj({ question: str("The question") }, ["question"]) },
];

const MEDIA: Record<string, string> = { ".md": "text/markdown", ".txt": "text/plain", ".csv": "text/csv", ".json": "application/json", ".html": "text/html", ".pdf": "application/pdf", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".py": "text/x-python", ".png": "image/png", ".jpg": "image/jpeg" };
const mediaOf = (name: string): string => MEDIA[name.slice(name.lastIndexOf(".")).toLowerCase()] ?? "application/octet-stream";

const AREAS = ["/work", "/output", "/input", "/toolbox", "/team"];
const WRITABLE = ["/work", "/output", "/toolbox", "/team"];

// A path an employee named, held to its areas (exported for its tests). The provider contains it again on its side.
export function pathOf(v: unknown, writable: boolean): string {
  if (typeof v !== "string" || v.length === 0 || v.length > 1024 || v.includes("\0")) throw invalid("bad_path", "A path is required.");
  const p = v.replace(/\/+$/, "") || "/";
  if (p.split("/").includes("..")) throw invalid("bad_path", "A path cannot go above its area.");
  const areas = writable ? WRITABLE : AREAS;
  if (!areas.some((a) => p === a || p.startsWith(`${a}/`))) throw invalid("bad_path", `The path must be under ${areas.join(", ")}.`);
  return p;
}

const text = (v: unknown, name: string, max = MAX_WRITE): string => {
  if (typeof v !== "string") throw invalid("bad_argument", `${name} must be text.`);
  if (Buffer.byteLength(v) > max) throw invalid("too_large", `${name} is larger than ${Math.round(max / 1024)} KiB.`);
  return v;
};

export interface ToolAnswer {
  text: string;
  isError: boolean;
}

@Injectable()
export class ToolsService {
  constructor(
    @Inject(RunRepository) private readonly runs: RunRepository,
    @Inject(ArtifactStore) private readonly artifacts: ArtifactStore,
    @Inject(RUN_OUTCOMES) private readonly outcomes: RunOutcomes,
    @Inject(ResearchInputs) private readonly research: ResearchInputs,
    @Optional() @Inject(SANDBOX_PROVIDER) private readonly provider: SandboxProvider | null = null,
  ) {}

  list(): ToolSpec[] {
    return TOOLS;
  }

  async call(runId: string, name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    const run = await this.runs.byId(runId);
    if (run === null || run.state !== "running" || run.handle === null) throw refused("run_not_running", "This run is not running.");
    if (this.provider === null) throw refused("no_sandbox", "No sandbox provider is configured.");
    const cur = await this.outcomes.current(run.orbitId, run.assignmentId, run.fence);
    if (cur === null || !cur.current) throw refused("attempt_replaced", "This attempt was replaced or stopped: its tools are closed.");
    const h = run.handle;
    switch (name) {
      case "list_files": {
        const entries = await this.provider.list(h, pathOf(args.path, false), 500);
        return { text: entries.map((e) => `${e.type === "dir" ? "d" : "-"} ${e.size}\t${e.path}`).join("\n") || "(empty)", isError: false };
      }
      case "read_file": {
        const bytes = await this.provider.readFile(h, pathOf(args.path, false), MAX_READ);
        if (bytes === null) return { text: "No such file.", isError: true };
        return { text: bytes.toString("utf8"), isError: false };
      }
      case "write_file": {
        const p = pathOf(args.path, true);
        await this.provider.writeFile(h, p, Buffer.from(text(args.content, "content")));
        return { text: `Wrote ${p}.`, isError: false };
      }
      case "edit_file": {
        const p = pathOf(args.path, true);
        const bytes = await this.provider.readFile(h, p, MAX_WRITE);
        if (bytes === null) return { text: "No such file.", isError: true };
        const before = bytes.toString("utf8");
        const old = text(args.old_text, "old_text");
        const at = before.indexOf(old);
        if (at === -1 || before.indexOf(old, at + 1) !== -1) return { text: "old_text must occur exactly once in the file.", isError: true };
        await this.provider.writeFile(h, p, Buffer.from(before.slice(0, at) + text(args.new_text, "new_text") + before.slice(at + old.length)));
        return { text: `Edited ${p}.`, isError: false };
      }
      case "shell":
        return this.shell(run, h, args);
      case "submit_handoff":
        return this.submit(run, h, args);
      case "ask_question": {
        const q = text(args.question, "question", 4000).trim();
        if (q.length === 0) throw invalid("bad_argument", "question must say something.");
        await this.outcomes.question(systemActor(run.orbitId, `run:${run.id}`, `tool:${run.id}`), run.assignmentId, run.fence, q);
        return { text: "Your question was sent. The work now waits for the answer: stop here.", isError: false };
      }
      default:
        throw invalid("unknown_tool", `There is no tool named ${name}.`);
    }
  }

  private async shell(run: RunRecord, h: AttemptHandle, args: Record<string, unknown>): Promise<ToolAnswer> {
    if (run.sandbox?.shell !== true) return { text: `The shell is not available in this attempt: ${run.sandbox?.detail ?? "the sandbox was not attested for it"}. Use the file tools.`, isError: true };
    const command = text(args.command, "command", 64 * 1024);
    const cwd = args.cwd === undefined ? "/work" : pathOf(args.cwd, false);
    if (!(cwd === "/work" || cwd.startsWith("/work/"))) throw invalid("bad_path", "The shell runs in /work or a directory under it.");
    const timeout = typeof args.timeout_seconds === "number" ? Math.min(3600, Math.max(1, Math.floor(args.timeout_seconds))) : 600;
    const r = await this.provider!.exec(h, { argv: ["bash", "-lc", command], cwd: cwd === "/work" ? "." : cwd.slice("/work/".length), timeoutMs: timeout * 1000, maxOutputBytes: MAX_OUTPUT });
    const status = r.timedOut ? "timed out" : r.signal !== null ? `stopped by ${r.signal}` : `exit code ${r.code}`;
    return { text: `${status}${r.truncated ? " (output cut)" : ""}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`, isError: r.code !== 0 };
  }

  private async submit(run: RunRecord, h: AttemptHandle, args: Record<string, unknown>): Promise<ToolAnswer> {
    const summary = text(args.summary, "summary", 8000).trim();
    if (summary.length === 0) throw invalid("bad_argument", "summary must say what was done.");
    const entries = (await this.provider!.list(h, "/output", 200)).filter((e) => e.type === "file");
    const staged: StagedArtifact[] = [];
    let total = 0;
    for (const e of entries) {
      const name = e.path.replace(/^\/?output\//, "").replace(/^\//, "");
      if (!isDeliverableName(name)) return { text: `"${name}" in /output is not a plain file name (letters, digits, dots, dashes, spaces): rename it.`, isError: true };
      if (e.size > MAX_ARTIFACT) return { text: `${name} is larger than ${MAX_ARTIFACT / 1024 / 1024} MiB.`, isError: true };
      const bytes = await this.provider!.readFile(h, `/output/${name}`, MAX_ARTIFACT);
      if (bytes === null) continue;
      total += bytes.length;
      if (total > MAX_HANDOFF) return { text: "The hand-in is larger than 200 MiB in all.", isError: true };
      const stored = await this.artifacts.put(run.orbitId, bytes);
      staged.push({ name, kind: "deliverable", mediaType: mediaOf(name), size: stored.size, sha256: stored.sha256 });
    }
    const asked: ClaimInput[] = Array.isArray(args.claims)
      ? args.claims.slice(0, 100).map((c) => {
          const x = (typeof c === "object" && c !== null ? c : {}) as Record<string, unknown>;
          const url = typeof x.url === "string" && /^https?:\/\//.test(x.url) ? x.url.slice(0, 2000) : null;
          const labels = Array.isArray(x.sources) ? x.sources.filter((l): l is string => typeof l === "string").slice(0, 10).map((l) => l.slice(0, 20)) : [];
          return { text: String(x.text ?? "").slice(0, 2000), sources: labels, quote: typeof x.quote === "string" ? x.quote.slice(0, 1000) : null, url };
        })
      : [];
    const ctx = await this.outcomes.current(run.orbitId, run.assignmentId, run.fence);
    const claims = await this.research.verify(run.orbitId, ctx?.sources ?? [], asked);
    const submissionKey = `${run.id}:${createHash("sha256").update(JSON.stringify({ summary, staged, claims: claims.map((c) => c.text) })).digest("hex").slice(0, 32)}`;
    try {
      const r = await this.outcomes.handoff(systemActor(run.orbitId, `run:${run.id}`, `tool:${run.id}`), run.assignmentId, run.fence, { runId: run.id, summary, artifacts: staged, claims, submissionKey });
      const missingNote = r.missing.length > 0 ? ` The required ${r.missing.join(", ")} ${r.missing.length === 1 ? "is" : "are"} missing from /output -- the reviewer will see that.` : "";
      return { text: `Handed in as revision ${r.revision} (${staged.length} file(s)).${missingNote} Stop here: the reviewer decides next.`, isError: false };
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code?: string }).code === "stale_fence") throw conflictWith("attempt_replaced", "This attempt was replaced: its hand-in was not recorded.");
      throw err;
    }
  }
}
