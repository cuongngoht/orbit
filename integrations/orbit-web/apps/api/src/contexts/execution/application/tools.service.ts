// THE TOOL PLANE'S DOOR: the tools an employee's model calls (through the `orbit_tools` bridge in its model plane),
// executed IN THE ATTEMPT'S SANDBOX through the sandbox port -- never on Orbit Web's host, never with a credential.
// A call is accepted only from a run's own token, for that run's CURRENT attempt (its fence) while it runs; the shell only
// when the attempt's attestation granted it. Paths are relative to the sandbox's areas and contained there by the
// provider. What a tool reads or writes is never logged; the run keeps counts.
//
// Handing in (`submit_handoff`): the files in /output are staged into the account's immutable artifact store (bytes,
// then their hash verified, then the row), then Work records the handoff -- once per submission key.
//
// The account's connectors (GitHub, Azure DevOps) the employee was let use add their tools (CONNECTOR_TOOLS): Orbit Web
// asks them with its own sign-in, never the sandbox.
import { Inject, Injectable, Optional } from "@nestjs/common";
import { checkHireAssistant, CLARIFICATION_KINDS, isDeliverableName, type HireAssistantRequest } from "@orbit-web/contracts";
import { createHash } from "node:crypto";
import { conflictWith, invalid, refused } from "../../shared/domain.js";
import { employeeActor, OfficeGovernance, systemActor, type Actor } from "../../shared/application/commands.js";
import { Db } from "../../../infra/db/db.js";
import { DepartmentPoliciesService } from "../../../modules/governance/department-policies.service.js";
import { RevisionsService } from "../../../modules/governance/revisions.service.js";
import { ArtifactStore } from "../infrastructure/artifact-store.js";
import { areaWords, FILE_AREAS, readOnlyAreaOf, TOOLBOX } from "../infrastructure/sandbox/allocator-protocol.js";
import { RunRepository, type RunRecord } from "../infrastructure/runs.repository.js";
import type { GovernanceContext } from "../../../modules/auth/principal.js";
import { CONNECTOR_TOOLS, type ConnectorTools } from "./connector-tools.port.js";
import { ResearchInputs, type ClaimInput } from "./research-inputs.js";
import { RUN_OUTCOMES, type AttemptContext, type RunOutcomes, type StagedArtifact } from "./run-outcomes.port.js";
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
  { name: "list_files", description: `List a directory of your workspace: ${areaWords()}. /input holds what was handed to you.`, inputSchema: obj({ path: str("A directory, e.g. /work or /output/reports") }, ["path"]) },
  { name: "read_file", description: `Read a text file of your workspace (up to 512 KiB): ${areaWords()}. /input holds what was handed to you, read-only.`, inputSchema: obj({ path: str("The file, e.g. /work/notes.md") }, ["path"]) },
  { name: "write_file", description: `Create or replace a file in ${areaWords({ write: true })}.`, inputSchema: obj({ path: str("The file to write"), content: str("Its whole text") }, ["path", "content"]) },
  { name: "edit_file", description: "Replace one exact occurrence of a text in a file.", inputSchema: obj({ path: str("The file"), old_text: str("Text that occurs exactly once"), new_text: str("Its replacement") }, ["path", "old_text", "new_text"]) },
  { name: "shell", description: "Run a shell command in your sandbox (bash), in /work or a directory under it. Install packages, write and run scripts, build, test.", inputSchema: obj({ command: str("The command line"), cwd: str("A directory under /work (default /work)"), timeout_seconds: { type: "integer", minimum: 1, maximum: 3600 } }, ["command"]) },
  { name: "submit_handoff", description: "Hand in your result once the deliverables are in /output: a short summary and the claims it rests on. Cite a source you were given by its label (S1, S2 ...) and quote the exact words of it the claim rests on: Orbit checks the quote against the source.", inputSchema: obj({ summary: str("What you did and how you checked it"), claims: { type: "array", items: obj({ text: str("A claim of your result"), sources: { type: "array", items: { type: "string" }, description: "Labels of the sources it rests on, e.g. S1" }, quote: str("The exact words of the cited source the claim rests on"), url: str("A web page it rests on, if any") }, ["text"]) } }, ["summary"]) },
];

// Asked of its lead (a part) or of the person who gave the work (the root): the tool says which.
const askOf = (lead: { name: string } | null): ToolSpec => ({
  name: "ask_question",
  description: `Ask ${lead === null ? "the person who gave you the work" : `your lead, ${lead.name},`} a question you cannot continue without. Your attempt ends there: you continue, once, with the answer.`,
  inputSchema: obj({ question: str("The question") }, ["question"]),
});

// Offered only to an employee who may give work to colleagues -- or, the CEO or a manager in force, engage a temporary
// assistant within its quota.
const DELEGATE: ToolSpec = {
  name: "delegate",
  description: "Give parts of your assignment to the employees or departments you may give work to (you stay responsible). Each part: a short key, an employee (id or exact name) OR a department (id or exact name: its manager takes it), a title and goal, the files it must produce, its acceptance criteria, the keys of parts it must wait for, the sources it may read (share_sources) and what it receives of a part it waits for (receives: its summary, or in full). A part reads nothing you do not share. As the CEO or a department's manager you may instead engage a temporary assistant for a part (hire), within your quota: a manager's joins its department for this mission and takes the part; the CEO names the department it joins, whose manager takes the part. It is released when this mission ends. Your attempt ends: you are woken to review what they hand in, or to answer what they ask. /team is shared only with the colleagues of your own department.",
  inputSchema: obj(
    {
      parts: {
        type: "array",
        items: obj(
          {
            key: str("A short key: lower-case letters, digits, dashes"),
            employee: str("An employee you may give work to: id or exact name"),
            department: str("Or a department you may give work to: id or exact name (its manager takes the part)"),
            hire: {
              ...obj({ name: str("Its name"), title: str("Its title, e.g. Research assistant"), duties: str("What it does"), skills: { type: "array", items: { type: "string" } }, languages: { type: "array", items: { type: "string" } } }, ["name", "title"]),
              description: "Or a temporary assistant you engage for this part, instead of naming someone (counts against your quota of assistants; released when this mission ends). The CEO names the department it joins too.",
            },
            title: str("A short title"),
            goal: str("What this part must achieve"),
            deliverables: { type: "array", items: { type: "string" } },
            criteria: { type: "array", items: { type: "string" } },
            waits_for: { type: "array", items: { type: "string" } },
            share_sources: { type: "array", items: { type: "string" }, description: "Labels of the sources you were given that this part may read (S1, S2 ...), or [\"all\"]. Nothing is shared unless you say." },
            receives: { type: "array", items: obj({ from: str("The key of a part this one waits for"), as: { type: "string", enum: ["summary", "full"] } }, ["from", "as"]), description: "The accepted hand-in of a part it waits for: its summary alone, or in full (its files too)." },
          },
          ["key", "title", "goal"],
        ),
      },
    },
    ["parts"],
  ),
};
const REVIEW_UNIT: ToolSpec = {
  name: "review_unit",
  description: "Record your decision on a part your team handed in: accept it, or ask for a revision saying what must change (its colleague works on it again). Call this tool once for each part awaiting acceptance — writing review comments in text does not record a decision. Name the digest of the revision you reviewed. Their files are in /input.",
  inputSchema: obj(
    {
      part: str("The part's key (e.g. research or ngoc-data-supply), not the employee's name"),
      decision: { type: "string", enum: ["accept", "revise"] },
      digest: str("The 64-character hex digest of the hand-in you reviewed"),
      criteria: str("Required when decision is revise: specific changes required. Optional note when decision is accept"),
    },
    ["part", "decision"],
  ),
};
const ANSWER_QUESTION: ToolSpec = {
  name: "answer_question",
  description: "Answer a question your team asked you (its [q:<id>]): the colleague who asked continues, once, with your answer.",
  inputSchema: obj({ question_id: str("The question's id, as [q:<id>] shows it"), answer: str("Your answer") }, ["question_id", "answer"]),
};
const ESCALATE_QUESTION: ToolSpec = {
  name: "escalate_question",
  description: "Move a question your team asked you one level up, when it is not yours to answer: to your own lead, never to the CEO nor to the person who gave the work (there you decide, with your best judgment).",
  inputSchema: obj({ question_id: str("The question's id"), why: { type: "string", enum: ["information", "human_decision", "beyond_authority", "deadline", "unanswered"] }, note: str("Why you cannot answer it") }, ["question_id", "why"]),
};

// Offered only to an employee holding an appointment in force: a department's manager proposes for its department, the
// CEO for the company or any department. A DRAFT only: the owner validates, simulates and publishes it (or not).
const PROPOSE_POLICY: ToolSpec = {
  name: "propose_policy",
  description: "Propose a policy change for the owner to review: your department's policy (as its manager) or, as the CEO, the company's or any department's. Give the whole document you propose. It is only a draft: nothing changes until the owner publishes it.",
  inputSchema: obj(
    {
      scope: { type: "string", enum: ["department", "company"] },
      department: str("The department's id or exact name (a manager may name only its own)"),
      document: { type: "object", description: "The whole policy document you propose: a DepartmentPolicy for a department, the account's policy for the company" },
    },
    ["scope", "document"],
  ),
};

const MEDIA: Record<string, string> = { ".md": "text/markdown", ".txt": "text/plain", ".csv": "text/csv", ".json": "application/json", ".html": "text/html", ".pdf": "application/pdf", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".py": "text/x-python", ".png": "image/png", ".jpg": "image/jpeg" };
const mediaOf = (name: string): string => MEDIA[name.slice(name.lastIndexOf(".")).toLowerCase()] ?? "application/octet-stream";

// The areas the file tools reach: the one declaration the sandbox holds them to (allocator-protocol.ts), with the desk's
// toolbox under its own name.
const AREAS = [...FILE_AREAS.map((a) => a.root), TOOLBOX.path];
const WRITABLE = [...FILE_AREAS.filter((a) => a.writable).map((a) => a.root), TOOLBOX.path];

// A path an employee named, held to its areas (exported for its tests). The provider contains it again on its side.
export function pathOf(v: unknown, writable: boolean): string {
  if (typeof v !== "string" || v.length === 0 || v.length > 1024 || v.includes("\0")) throw invalid("bad_path", "A path is required.");
  const p = v.replace(/\/+$/, "") || "/";
  if (p.split("/").includes("..")) throw invalid("bad_path", "A path cannot go above its area.");
  const readOnly = writable ? readOnlyAreaOf(p) : null;
  if (readOnly !== null) throw invalid("bad_path", `${readOnly} is read-only: it holds what was handed to you. Write under ${areaWords({ write: true })}.`);
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
    @Inject(OfficeGovernance) private readonly governance: OfficeGovernance,
    @Inject(RevisionsService) private readonly revisions: RevisionsService,
    @Inject(DepartmentPoliciesService) private readonly departmentPolicies: DepartmentPoliciesService,
    @Inject(Db) private readonly db: Db,
    @Optional() @Inject(CONNECTOR_TOOLS) private readonly connectors: ConnectorTools | null = null,
  ) {}

  // The tools of this run: everyone's, a team's where it applies, and the connectors' the employee was let use.
  async list(runId: string): Promise<ToolSpec[]> {
    const run = await this.runs.byId(runId);
    if (run === null) return [...TOOLS, askOf(null)];
    const ctx = await this.outcomes.current(run.orbitId, run.assignmentId, run.fence);
    if (ctx === null) return [...TOOLS, askOf(null)];
    const team = ctx.team;
    // What its role withholds (Work's roles): never offered -- and refused at the door below.
    const connectors = this.connectors === null || team.connectorsDenied !== null ? [] : await this.connectors.tools(run.orbitId, run.employeeId);
    const offered = [...TOOLS, askOf(team.lead), ...(team.canDelegate ? [DELEGATE] : []), ...(team.units.length > 0 ? [REVIEW_UNIT] : []), ...(team.questions.length > 0 ? [ANSWER_QUESTION, ESCALATE_QUESTION] : []), ...(ctx.employee.appointment?.active === true ? [PROPOSE_POLICY] : []), ...connectors];
    return offered.filter((t) => !team.denied.some((d) => d.name === t.name));
  }

  // `governance`: the run's own context (its token's), which a connector's ask is decided as.
  async call(runId: string, name: string, args: Record<string, unknown>, governance: GovernanceContext | null = null): Promise<ToolAnswer> {
    const run = await this.runs.byId(runId);
    if (run === null || run.state !== "running" || run.handle === null) throw refused("run_not_running", "This run is not running.");
    if (this.provider === null) throw refused("no_sandbox", "No sandbox provider is configured.");
    const cur = await this.outcomes.current(run.orbitId, run.assignmentId, run.fence);
    if (cur === null || !cur.current) throw refused("attempt_replaced", "This attempt was replaced or stopped: its tools are closed.");
    const h = run.handle;
    // A tool its role withholds is refused here too, saying why (it was never offered: a model may still name it).
    const isConnector = this.connectors?.owns(name) === true;
    const withheld = cur.team.denied.find((d) => d.name === name)?.why ?? (isConnector ? cur.team.connectorsDenied : null);
    if (withheld !== null) return { text: withheld, isError: true };
    if (isConnector) {
      if (this.connectors === null) throw refused("no_connectors", "No connector is bound.");
      if (governance === null) throw refused("no_context", "A connector's tool is asked only through the tool door.");
      return this.connectors.call(governance, run.orbitId, run.employeeId, name, args);
    }
    // /team exists only in a mission that has a team room.
    for (const k of ["path", "cwd"]) {
      const v = args[k];
      if (typeof v === "string" && (v === "/team" || v.startsWith("/team/")) && cur.team.room === null) return { text: "There is no team room in this mission: /team is not yours to use here.", isError: true };
    }
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
        return this.submit(run, h, args, this.actorOf(run, governance));
      case "delegate":
        return this.delegate(run, args, this.actorOf(run, governance));
      case "review_unit": {
        const part = text(args.part, "part", 40).trim();
        const decision = args.decision === "accept" || args.decision === "revise" ? args.decision : null;
        if (decision === null) throw invalid("bad_argument", "decision must be accept or revise.");
        const criteria = args.criteria === undefined ? "" : text(args.criteria, "criteria", 4000);
        const digest = typeof args.digest === "string" && /^[0-9a-f]{64}$/.test(args.digest.trim()) ? args.digest.trim() : null;
        const said = await this.outcomes.reviewUnit(this.actorOf(run, governance), run.assignmentId, run.fence, part, decision, criteria, digest);
        return { text: said, isError: false };
      }
      case "answer_question": {
        const id = text(args.question_id, "question_id", 64).trim().replace(/^\[?q:/, "").replace(/\]$/, "");
        const answer = text(args.answer, "answer", 4000).trim();
        if (answer.length === 0) throw invalid("bad_argument", "answer must say something.");
        return { text: await this.outcomes.answerQuestion(this.actorOf(run, governance), run.assignmentId, run.fence, id, answer), isError: false };
      }
      case "escalate_question": {
        const id = text(args.question_id, "question_id", 64).trim().replace(/^\[?q:/, "").replace(/\]$/, "");
        const why = CLARIFICATION_KINDS.find((k) => k === args.why);
        if (why === undefined) throw invalid("bad_argument", `why must be one of ${CLARIFICATION_KINDS.join(", ")}.`);
        const note = args.note === undefined ? "" : text(args.note, "note", 1000);
        return { text: await this.outcomes.escalateQuestion(this.actorOf(run, governance), run.assignmentId, run.fence, id, why, note), isError: false };
      }
      case "propose_policy":
        return this.proposePolicy(run, args, governance, cur.employee.appointment);
      case "ask_question": {
        const q = text(args.question, "question", 4000).trim();
        if (q.length === 0) throw invalid("bad_argument", "question must say something.");
        await this.outcomes.question(this.actorOf(run, governance), run.assignmentId, run.fence, q);
        return { text: `Your question was sent to ${cur.team.lead === null ? "the person who gave you the work" : cur.team.lead.name}. Your attempt ends here: you continue, once, with the answer. Stop here.`, isError: false };
      }
      default:
        throw invalid("unknown_tool", `There is no tool named ${name}.`);
    }
  }

  // What the attempt asks is asked AS the employee (its run's own context, from its token); only a caller with no such
  // context (an in-process test) stands in as the run.
  private actorOf(run: RunRecord, governance: GovernanceContext | null): Actor {
    return governance !== null ? employeeActor(governance, run.id) : systemActor(run.orbitId, `run:${run.id}`, `tool:${run.id}`);
  }

  private async delegate(run: RunRecord, args: Record<string, unknown>, actor: Actor): Promise<ToolAnswer> {
    const ctx = await this.outcomes.current(run.orbitId, run.assignmentId, run.fence);
    if (ctx === null || !ctx.team.canDelegate) {
      const full = ctx !== null && ctx.team.role === "manager_alone" && ctx.team.assistants !== null && ctx.team.assistants.max > 0;
      return { text: full ? `Nobody else works in your department now, and your ${ctx?.team.assistants?.max ?? 0} temporary assistants are all engaged: do it yourself.` : "You hold no appointment or grant that lets you give work to others: do it yourself.", isError: true };
    }
    if (!Array.isArray(args.parts)) throw invalid("bad_argument", "parts must be a list.");
    const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20).map((x) => x.slice(0, 300)) : []);
    const name = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 120) : undefined);
    // An assistant a part hires, held to the contract (an argument it cannot be is said, for the model to correct).
    const hireOf = (key: unknown, v: unknown): HireAssistantRequest | undefined => {
      if (v === undefined || v === null) return undefined;
      const checked = checkHireAssistant(v);
      if (!checked.ok) throw invalid("bad_argument", `"${String(key ?? "")}": hire ${checked.errors.join("; ")}.`);
      return checked.value;
    };
    const units = args.parts.slice(0, 20).map((p) => {
      const x = (typeof p === "object" && p !== null ? p : {}) as Record<string, unknown>;
      const hire = hireOf(x.key, x.hire);
      return {
        key: String(x.key ?? "").trim(),
        employee: name(x.employee),
        department: name(x.department),
        ...(hire !== undefined ? { hire } : {}),
        title: String(x.title ?? "").slice(0, 120),
        goal: String(x.goal ?? "").slice(0, 8000),
        deliverables: list(x.deliverables).filter((n) => isDeliverableName(n)).map((n) => ({ name: n, required: true })),
        acceptanceCriteria: list(x.criteria),
        dependsOn: list(x.waits_for),
        shareSources: list(x.share_sources),
        receives: (Array.isArray(x.receives) ? x.receives : []).slice(0, 20).flatMap((r) => {
          const y = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
          return typeof y.from === "string" ? [{ from: y.from.trim().slice(0, 64), as: y.as === "full" ? ("full" as const) : ("summary" as const) }] : [];
        }),
      };
    });
    const r = await this.outcomes.delegate(actor, run.assignmentId, run.fence, units);
    const engaged = r.engaged.length === 0 ? "" : ` Engaged for this mission: ${r.engaged.join(", ")} (released when it ends).`;
    return { text: `Gave ${r.parts} part(s) to your team.${engaged} Your attempt ends here: you are woken to review what they hand in, or to answer what they ask. Stop here.`, isError: false };
  }

  // An appointee's draft, decided as the employee (governance.policy.propose) and kept as a draft its owner decides on.
  private async proposePolicy(run: RunRecord, args: Record<string, unknown>, governance: GovernanceContext | null, appointment: AttemptContext["employee"]["appointment"]): Promise<ToolAnswer> {
    if (appointment === null || !appointment.active) return { text: "Only an appointee in force (the CEO, a department's manager) proposes a policy.", isError: true };
    if (governance === null || governance.principal.kind !== "agent") throw refused("no_context", "A policy is proposed only through the tool door.");
    if (typeof args.document !== "object" || args.document === null || Array.isArray(args.document)) throw invalid("bad_argument", "document must be the whole policy you propose.");
    await this.governance.authorize(employeeActor(governance, run.id), "governance.policy.propose", run.orbitId, { account: run.orbitId });
    if (args.scope === "company") {
      if (appointment.role !== "ceo") return { text: "Only the CEO proposes a change to the company's policy: propose your department's.", isError: true };
      const draft = await this.revisions.propose(governance, args.document);
      return { text: `Proposed the company's policy as draft ${draft.id}: the owner reviews it; nothing changes until they publish it.`, isError: false };
    }
    if (args.scope !== "department") throw invalid("bad_argument", "scope must be department or company.");
    const named = typeof args.department === "string" ? args.department.trim() : "";
    const departmentId = appointment.role === "manager" ? appointment.departmentId : await this.departmentNamed(run.orbitId, named);
    if (departmentId === null) return { text: `There is no department "${named}".`, isError: true };
    if (appointment.role === "manager" && named !== "" && named !== departmentId && (await this.departmentNamed(run.orbitId, named)) !== departmentId) return { text: "A manager proposes only its own department's policy.", isError: true };
    const draft = await this.departmentPolicies.propose(governance, departmentId, args.document);
    return { text: `Proposed the department's policy as draft ${draft.id}: the owner reviews it; nothing changes until they publish it.`, isError: false };
  }

  private async departmentNamed(orbitId: string, named: string): Promise<string | null> {
    if (named === "") return null;
    const r = await this.db.one("SELECT id FROM workforce.departments WHERE account_id = $1 AND archived_at IS NULL AND (id::text = $2 OR lower(name) = lower($2))", [orbitId, named]);
    return r === null ? null : String(r.id);
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

  private async submit(run: RunRecord, h: AttemptHandle, args: Record<string, unknown>, actor: Actor): Promise<ToolAnswer> {
    const summary = text(args.summary, "summary", 8000).trim();
    if (summary.length === 0) throw invalid("bad_argument", "summary must say what was done.");
    // Decided as the employee before anything is staged: a policy that does not let it publish stores nothing.
    await this.outcomes.mayPublish(actor, run.assignmentId, run.fence);
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
      const r = await this.outcomes.handoff(actor, run.assignmentId, run.fence, { runId: run.id, summary, artifacts: staged, claims, submissionKey });
      const missingNote = r.missing.length > 0 ? ` The required ${r.missing.join(", ")} ${r.missing.length === 1 ? "is" : "are"} missing from /output -- the reviewer will see that.` : "";
      return { text: `Handed in as revision ${r.revision} (${staged.length} file(s)).${missingNote} Stop here: the reviewer decides next.`, isError: false };
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code?: string }).code === "stale_fence") throw conflictWith("attempt_replaced", "This attempt was replaced: its hand-in was not recorded.");
      throw err;
    }
  }
}
