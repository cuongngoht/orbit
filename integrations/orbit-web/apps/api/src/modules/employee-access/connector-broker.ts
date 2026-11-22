// AN EMPLOYEE'S ASKS OF THE ACCOUNT'S CONNECTORS, made by Orbit Web with the installation's own sign-ins -- GitHub CLI's
// (`gh api`) and the Azure CLI's (`az rest`, Azure DevOps' resource) -- on the control plane: the sign-in never reaches an
// employee's sandbox. Each ask is held to what the employee was let use (the connector, and every repository or the
// chosen ones -- an Azure DevOps project's work items and wiki with a chosen repository's project), then decided by the
// account's policy (`tool.connector`, the repository or project its resource), recorded, and answered as data the
// employee must not take instructions from, cut to a size. Reads only: nothing here writes to a repository or a board.
import { Inject, Injectable } from "@nestjs/common";
import { ACCESS_CONNECTOR_LABELS, type AccessConnector } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import type { ConnectorTools } from "../../contexts/execution/application/connector-tools.port.js";
import type { ToolAnswer, ToolSpec } from "../../contexts/execution/application/tools.service.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { azureEnv, ghEnv } from "../../infra/process/env.js";
import { PROCESS_PORT, succeeded, type ProcessPort, type RunResult } from "../../infra/process/process.port.js";
import { redactSecrets } from "../../infra/security/redact.js";
import type { GovernanceContext } from "../auth/principal.js";
import { PolicyService } from "../governance/policy.service.js";
import { AZURE_DEVOPS_RESOURCE } from "../sources/azure-parse.js";
import { inScope, parseWorkItemUrl, untrusted, workItemText } from "./connector-text.js";
import { ConnectorWrites, type ConnectorWrite } from "./connector-writes.js";
import { ConnectionGrantStore } from "./grants.store.js";

const obj = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });

const GITHUB_TOOLS: ToolSpec[] = [
  { name: "github_issue", description: "Read a GitHub issue -- its text, labels and comments -- of a repository you were let use.", inputSchema: obj({ repository: str("owner/name"), number: int("The issue's number") }, ["repository", "number"]) },
  { name: "github_pull_request", description: "Read a GitHub pull request -- its text and the files it changes -- of a repository you were let use.", inputSchema: obj({ repository: str("owner/name"), number: int("The pull request's number") }, ["repository", "number"]) },
  { name: "github_file", description: "Read a file, or list a directory, of a GitHub repository you were let use (at a branch, tag or commit; the default branch when none).", inputSchema: obj({ repository: str("owner/name"), path: str("The file or directory, e.g. docs/spec.md"), ref: str("A branch, tag or commit (optional)") }, ["repository", "path"]) },
];

const AZURE_TOOLS: ToolSpec[] = [
  {
    name: "azure_devops_work_item",
    description: "Read an Azure DevOps work item -- its fields, description, acceptance criteria, comments and its attachments' names -- by its URL (https://dev.azure.com/<organization>/<project>/_workitems/edit/<id>), or by organization, project and id. Only in a project you were let use.",
    inputSchema: obj({ url: str("The work item's URL"), organization: str("The organization (without a URL)"), project: str("The project (without a URL)"), id: int("The work item's id (without a URL)") }, []),
  },
  { name: "azure_devops_query", description: "Find work items with a WIQL query in an Azure DevOps project you were let use: their ids, types, titles and states (at most 200).", inputSchema: obj({ organization: str("The organization"), project: str("The project"), wiql: str("The query, e.g. SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active'") }, ["organization", "project", "wiql"]) },
  { name: "azure_devops_wiki_page", description: "Read a page of an Azure DevOps project's wiki, in a project you were let use.", inputSchema: obj({ organization: str("The organization"), project: str("The project"), wiki: str("The wiki's name or id"), path: str("The page's path, e.g. /Requirements/Export") }, ["organization", "project", "wiki", "path"]) },
  { name: "azure_devops_file", description: "Read a file, or list a folder, of an Azure DevOps repository you were let use (at a branch; the default one when none).", inputSchema: obj({ organization: str("The organization"), project: str("The project"), repository: str("The repository's name"), path: str("The file, e.g. /docs/spec.md"), branch: str("A branch (optional)") }, ["organization", "project", "repository", "path"]) },
];

// What an employee let WRITE may also propose: each write decided by the account's policy (by default, the owner approves
// that exact write first -- connector-writes.ts).
const WRITE_TOOLS: Record<AccessConnector, ToolSpec[]> = {
  github: [{ name: "github_comment", description: "Propose a comment on a GitHub issue or pull request of a repository you were let write to. It is written once the account's policy allows it -- by default after a person approves it.", inputSchema: obj({ repository: str("owner/name"), number: int("The issue's or pull request's number"), text: str("The comment (Markdown)") }, ["repository", "number", "text"]) }],
  azure: [
    { name: "azure_devops_comment", description: "Propose a comment on an Azure DevOps work item of a project you were let write to, by its URL or by organization, project and id. It is written once the account's policy allows it -- by default after a person approves it.", inputSchema: obj({ url: str("The work item's URL"), organization: str("The organization (without a URL)"), project: str("The project (without a URL)"), id: int("The work item's id (without a URL)"), text: str("The comment (HTML or plain text)") }, ["text"]) },
    { name: "azure_devops_set_state", description: "Propose a new state for an Azure DevOps work item of a project you were let write to (e.g. Active, Resolved, Closed). It is set once the account's policy allows it -- by default after a person approves it.", inputSchema: obj({ url: str("The work item's URL"), organization: str("The organization (without a URL)"), project: str("The project (without a URL)"), id: int("The work item's id (without a URL)"), state: str("The state's name, as the work item's process names it") }, ["state"]) },
  ],
};

const TOOLS: Record<AccessConnector, ToolSpec[]> = { github: GITHUB_TOOLS, azure: AZURE_TOOLS };
const WRITE_NAMES = new Set([...WRITE_TOOLS.github, ...WRITE_TOOLS.azure].map((t) => t.name));
const NAMES = new Set([...GITHUB_TOOLS, ...AZURE_TOOLS].map((t) => t.name).concat([...WRITE_NAMES]));

const GITHUB_REPO = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;
const ORGANIZATION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// eslint-disable-next-line no-control-regex -- control characters are what is refused
const NAME = /^[^/?#\\\u0000-\u001f]{1,256}$/;
const answer = (text: string, isError = false): ToolAnswer => ({ text, isError });
const enc = encodeURIComponent;

class Refusal extends Error {}
const refuse = (message: string): never => {
  throw new Refusal(message);
};

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, name: string, max = 4000): string => (typeof v === "string" && v.trim() !== "" && v.length <= max ? v.trim() : refuse(`${name} is required (text of at most ${max} characters).`));
const named = (v: unknown, name: string, pattern = NAME): string => (typeof v === "string" && pattern.test(v.trim()) ? v.trim() : refuse(`${name} must be a plain name.`));
const number = (v: unknown, name: string): number => (typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1e10 ? v : refuse(`${name} must be a positive whole number.`));
// A path inside a repository: no way above its root.
const repoPath = (v: unknown): string => {
  const p = text(v, "path", 1024).replace(/^\/+/, "");
  if (p.split("/").some((s) => s === ".." || s === ".")) refuse("path cannot climb out of the repository.");
  return p;
};

interface Target {
  owner: string;
  project: string | null;
  name?: string;
}

@Injectable()
export class ConnectorBroker implements ConnectorTools {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(ConnectionGrantStore) private readonly grants: ConnectionGrantStore,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(ConnectorWrites) private readonly writes: ConnectorWrites,
  ) {}

  async tools(orbitId: string, employeeId: string): Promise<ToolSpec[]> {
    const live = await this.grants.live(orbitId, employeeId);
    return [...live.entries()].flatMap(([c, g]) => [...TOOLS[c], ...(g.write ? WRITE_TOOLS[c] : [])]);
  }

  owns(name: string): boolean {
    return NAMES.has(name);
  }

  async call(ctx: GovernanceContext, orbitId: string, employeeId: string, name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    const connector: AccessConnector = name.startsWith("github_") ? "github" : "azure";
    const label = ACCESS_CONNECTOR_LABELS[connector];
    try {
      const grant = (await this.grants.live(orbitId, employeeId)).get(connector);
      if (grant === undefined) refuse(`You were not let use ${label}: a person lets you on your Access page (Office → your page → Access).`);
      const target = this.targetOf(name, args);
      if (!inScope(grant?.repositories ?? null, target)) refuse(`${this.said(target)} is not among the repositories you were let use on ${label}.`);
      const resource = connector === "github" ? `github:${target.owner}/${target.name ?? ""}` : `azure-devops:${target.owner}/${target.project ?? ""}`;
      const decision = await this.policy.decide(ctx, { action: "tool.connector", resource, scope: "ACCOUNT_EMPLOYEE", params: { connector: resource } });
      if (decision.verdict !== "allow") refuse(`The account's policy in effect does not let you use ${resource} (${decision.reasonCodes.join(", ") || decision.verdict}; decision ${decision.decisionId}).`);
      // A write passes every gate a read does first (above: the grant, its scope, the policy's word on this resource),
      // then its own: let write, the item its project's, and the write's own decision (connector-writes.ts).
      if (WRITE_NAMES.has(name)) {
        if (grant?.write !== true) refuse(`You were let read ${label}, not write to it: a person lets you write on your Access page.`);
        const write = this.writeOf(name, args, target);
        if (write.connector === "azure") await this.ownItem(write.owner, write.container, write.item);
        return await this.writes.propose(ctx, write);
      }
      return answer(await this.ask(name, args, target));
    } catch (err) {
      if (err instanceof Refusal) return answer(err.message, true);
      throw err;
    }
  }

  // A work item is written to only under its own project's address (the API answers any of the organization's).
  private async ownItem(org: string, project: string, id: number): Promise<void> {
    const item = await this.az(`${this.base(org, project)}/_apis/wit/workitems/${id}?fields=System.TeamProject&api-version=7.1`);
    const own = isRecord(item) && isRecord(item.fields) ? String(item.fields["System.TeamProject"] ?? "") : "";
    if (own.toLowerCase() !== project.toLowerCase()) refuse(`Work item ${id} is not a work item of ${org}/${project}.`);
  }

  // What a write tool proposes: on which item, and what.
  private writeOf(name: string, args: Json, t: Target): ConnectorWrite {
    if (name === "github_comment") return { connector: "github", operation: "comment", owner: t.owner, container: t.name ?? "", item: number(args.number, "number"), value: text(args.text, "text", 8000) };
    const id = typeof args.url === "string" ? (parseWorkItemUrl(args.url)?.id ?? 0) : number(args.id, "id");
    if (name === "azure_devops_set_state") return { connector: "azure", operation: "state", owner: t.owner, container: t.project ?? "", item: id, value: named(args.state, "state") };
    return { connector: "azure", operation: "comment", owner: t.owner, container: t.project ?? "", item: id, value: text(args.text, "text", 8000) };
  }

  private said(t: Target): string {
    return t.project === null ? `${t.owner}/${t.name ?? ""}` : t.name === undefined ? `The project ${t.owner}/${t.project}` : `${t.owner}/${t.project}/${t.name}`;
  }

  // What an ask reaches: a GitHub repository, an Azure DevOps project, or one of its repositories.
  private targetOf(name: string, args: Json): Target {
    if (name.startsWith("github_")) {
      const m = GITHUB_REPO.exec(typeof args.repository === "string" ? args.repository.trim() : "");
      if (m === null) return refuse("repository must be owner/name.");
      return { owner: m[1] as string, project: null, name: m[2] as string };
    }
    if ((name === "azure_devops_work_item" || name === "azure_devops_comment" || name === "azure_devops_set_state") && typeof args.url === "string") {
      const ref = parseWorkItemUrl(args.url);
      if (ref === null) return refuse("url must be an Azure DevOps work item's URL: https://dev.azure.com/<organization>/<project>/_workitems/edit/<id>.");
      return { owner: ref.organization, project: ref.project };
    }
    const base = { owner: named(args.organization, "organization", ORGANIZATION), project: named(args.project, "project") };
    return name === "azure_devops_file" ? { ...base, name: named(args.repository, "repository") } : base;
  }

  private async ask(name: string, args: Json, t: Target): Promise<string> {
    switch (name) {
      case "github_issue":
        return this.githubIssue(`${t.owner}/${t.name ?? ""}`, number(args.number, "number"));
      case "github_pull_request":
        return this.githubPull(`${t.owner}/${t.name ?? ""}`, number(args.number, "number"));
      case "github_file":
        return this.githubFile(`${t.owner}/${t.name ?? ""}`, repoPath(args.path), args.ref === undefined ? null : named(args.ref, "ref"));
      case "azure_devops_work_item": {
        const id = typeof args.url === "string" ? (parseWorkItemUrl(args.url)?.id ?? 0) : number(args.id, "id");
        return this.workItem(t.owner, t.project ?? "", id);
      }
      case "azure_devops_query":
        return this.query(t.owner, t.project ?? "", text(args.wiql, "wiql", 32_000));
      case "azure_devops_wiki_page":
        return this.wiki(t.owner, t.project ?? "", named(args.wiki, "wiki"), `/${repoPath(args.path)}`);
      case "azure_devops_file":
        return this.azureFile(t.owner, t.project ?? "", t.name ?? "", repoPath(args.path), args.branch === undefined ? null : named(args.branch, "branch"));
      default:
        return refuse(`There is no tool named ${name}.`);
    }
  }

  // ---- GitHub ------------------------------------------------------------------------------------------------------

  private async gh(path: string): Promise<unknown> {
    const r = await this.process.run(this.config.binaries.gh, ["api", "--hostname", "github.com", path], { cwd: this.config.controlHome, env: ghEnv(this.config), timeoutMs: 60_000, maxOutputBytes: 16 * 1024 * 1024 });
    return this.json(r, "GitHub");
  }

  private async githubIssue(repo: string, n: number): Promise<string> {
    const [issue, comments] = await Promise.all([this.gh(`repos/${repo}/issues/${n}`), this.gh(`repos/${repo}/issues/${n}/comments?per_page=100`)]);
    const i = isRecord(issue) ? issue : {};
    const labels = Array.isArray(i.labels) ? i.labels.map((l) => (isRecord(l) ? String(l.name ?? "") : "")).filter((x) => x !== "") : [];
    const lines = [`Issue #${n} of ${repo}: ${String(i.title ?? "")}`, `State: ${String(i.state ?? "?")} · by ${isRecord(i.user) ? String(i.user.login ?? "?") : "?"} · ${String(i.created_at ?? "")}`];
    if (labels.length > 0) lines.push(`Labels: ${labels.join(", ")}`);
    lines.push("", String(i.body ?? "(no text)"));
    const list = Array.isArray(comments) ? comments.filter(isRecord) : [];
    if (list.length > 0) lines.push("", "Comments:");
    for (const c of list) lines.push(`${isRecord(c.user) ? String(c.user.login ?? "?") : "?"} (${String(c.created_at ?? "")}): ${String(c.body ?? "")}`);
    return untrusted(`GitHub issue ${repo}#${n}`, lines.join("\n"));
  }

  private async githubPull(repo: string, n: number): Promise<string> {
    const [pull, files] = await Promise.all([this.gh(`repos/${repo}/pulls/${n}`), this.gh(`repos/${repo}/pulls/${n}/files?per_page=100`)]);
    const p = isRecord(pull) ? pull : {};
    const ref = (v: unknown) => (isRecord(v) ? String(v.ref ?? "?") : "?");
    const lines = [`Pull request #${n} of ${repo}: ${String(p.title ?? "")}`, `State: ${String(p.state ?? "?")}${p.merged === true ? " (merged)" : ""} · ${ref(p.head)} → ${ref(p.base)} · by ${isRecord(p.user) ? String(p.user.login ?? "?") : "?"}`, "", String(p.body ?? "(no text)")];
    const list = Array.isArray(files) ? files.filter(isRecord) : [];
    if (list.length > 0) lines.push("", "Files:", ...list.map((f) => `${String(f.status ?? "")} ${String(f.filename ?? "")} (+${String(f.additions ?? 0)} -${String(f.deletions ?? 0)})`));
    return untrusted(`GitHub pull request ${repo}#${n}`, lines.join("\n"));
  }

  private async githubFile(repo: string, path: string, ref: string | null): Promise<string> {
    const body = await this.gh(`repos/${repo}/contents/${path.split("/").map(enc).join("/")}${ref === null ? "" : `?ref=${enc(ref)}`}`);
    if (Array.isArray(body)) return untrusted(`GitHub ${repo}/${path} (a directory)`, body.filter(isRecord).map((e) => `${e.type === "dir" ? "d" : "-"} ${String(e.path ?? e.name ?? "")}`).join("\n"));
    const f = isRecord(body) ? body : {};
    if (f.encoding !== "base64" || typeof f.content !== "string") return refuse(`${repo}/${path} is not a file GitHub gave the text of (a link, a submodule, or larger than GitHub answers inline).`);
    return untrusted(`GitHub ${repo}/${path}`, Buffer.from(f.content, "base64").toString("utf8"));
  }

  // ---- Azure DevOps ------------------------------------------------------------------------------------------------

  private async az(url: string, body?: unknown): Promise<unknown> {
    const args = ["rest", "--method", body === undefined ? "get" : "post", "--url", url, "--resource", AZURE_DEVOPS_RESOURCE, "--output", "json", ...(body === undefined ? [] : ["--headers", "Content-Type=application/json", "--body", JSON.stringify(body)])];
    const r = await this.process.run(this.config.binaries.az, args, { cwd: this.config.controlHome, env: azureEnv(this.config), timeoutMs: 60_000, maxOutputBytes: 16 * 1024 * 1024 });
    return this.json(r, "Azure DevOps");
  }

  private base(org: string, project: string): string {
    return `https://dev.azure.com/${enc(org)}/${enc(project)}`;
  }

  private async workItem(org: string, project: string, id: number): Promise<string> {
    const [item, comments] = await Promise.all([this.az(`${this.base(org, project)}/_apis/wit/workitems/${id}?$expand=all&api-version=7.1`), this.az(`${this.base(org, project)}/_apis/wit/workItems/${id}/comments?api-version=7.1-preview.4`).catch(() => null)]);
    // The item says its own project: one outside what was asked is not answered.
    const own = isRecord(item) && isRecord(item.fields) ? String(item.fields["System.TeamProject"] ?? project) : project;
    if (own.toLowerCase() !== project.toLowerCase()) return refuse(`Work item ${id} is in the project ${org}/${own}, not ${org}/${project}.`);
    return untrusted(`Azure DevOps work item ${org}/${project} #${id}`, workItemText(item, comments));
  }

  private async query(org: string, project: string, wiql: string): Promise<string> {
    const found = await this.az(`${this.base(org, project)}/_apis/wit/wiql?api-version=7.1`, { query: wiql });
    const ids = (isRecord(found) && Array.isArray(found.workItems) ? found.workItems : []).map((w) => (isRecord(w) ? Number(w.id) : NaN)).filter((n) => Number.isInteger(n)).slice(0, 200);
    if (ids.length === 0) return untrusted(`Azure DevOps query in ${org}/${project}`, "No work item matches.");
    const items = await this.az(`${this.base(org, project)}/_apis/wit/workitems?ids=${ids.join(",")}&fields=System.Id,System.WorkItemType,System.Title,System.State,System.TeamProject&api-version=7.1`);
    // WIQL reaches the whole organization: a work item of another project -- one not granted -- is never said.
    const own = (w: Json) => isRecord(w.fields) && String(w.fields["System.TeamProject"] ?? "").toLowerCase() === project.toLowerCase();
    const list = (isRecord(items) && Array.isArray(items.value) ? items.value.filter(isRecord) : []).filter(own);
    const rows = list.map((w) => {
      const f = isRecord(w.fields) ? w.fields : {};
      return `${String(w.id)} · ${String(f["System.WorkItemType"] ?? "")} · ${String(f["System.State"] ?? "")} · ${String(f["System.Title"] ?? "")}`;
    });
    return untrusted(`Azure DevOps query in ${org}/${project}`, rows.join("\n"));
  }

  // A wiki named by id or name is first held to the project granted: Azure DevOps may answer another project's wiki
  // under this project's address, and that one is never read.
  private async wiki(org: string, project: string, wiki: string, path: string): Promise<string> {
    const [meta, own] = await Promise.all([this.az(`${this.base(org, project)}/_apis/wiki/wikis/${enc(wiki)}?api-version=7.1`), this.az(`https://dev.azure.com/${enc(org)}/_apis/projects/${enc(project)}?api-version=7.1`)]);
    const wikiProject = isRecord(meta) ? String(meta.projectId ?? "") : "";
    const projectId = isRecord(own) ? String(own.id ?? "") : "";
    if (wikiProject === "" || wikiProject.toLowerCase() !== projectId.toLowerCase()) return refuse(`The wiki ${wiki} is not a wiki of ${org}/${project}.`);
    const page = await this.az(`${this.base(org, project)}/_apis/wiki/wikis/${enc(wiki)}/pages?path=${enc(path)}&includeContent=true&api-version=7.1`);
    const content = isRecord(page) && typeof page.content === "string" ? page.content : "";
    return untrusted(`Azure DevOps wiki ${org}/${project} ${wiki}${path}`, content || "(the page is empty)");
  }

  // A folder is listed (one level); a file is read.
  private async azureFile(org: string, project: string, repo: string, path: string, branch: string | null): Promise<string> {
    const version = branch === null ? "" : `&versionDescriptor.version=${enc(branch)}&versionDescriptor.versionType=branch`;
    const items = `${this.base(org, project)}/_apis/git/repositories/${enc(repo)}/items?path=${enc(`/${path}`)}`;
    const level = await this.az(`${items}&recursionLevel=OneLevel${version}&$format=json&api-version=7.1`);
    const entries = isRecord(level) && Array.isArray(level.value) ? level.value.filter(isRecord) : [];
    const self = entries.find((e) => String(e.path ?? "").replace(/\/+$/, "") === `/${path}`.replace(/\/+$/, ""));
    if (self?.isFolder === true) {
      const inside = entries.filter((e) => e !== self).map((e) => `${e.isFolder === true ? "d" : "-"} ${String(e.path ?? "")}`);
      return untrusted(`Azure DevOps ${org}/${project}/${repo}/${path} (a folder)`, inside.join("\n") || "(empty)");
    }
    const item = await this.az(`${items}&includeContent=true${version}&$format=json&api-version=7.1`);
    const content = isRecord(item) && typeof item.content === "string" ? item.content : null;
    if (content === null) return refuse(`${org}/${project}/${repo}/${path} is not a file Azure DevOps gave the text of.`);
    return untrusted(`Azure DevOps ${org}/${project}/${repo}/${path}`, content);
  }

  // A service's JSON answer, or a refusal that says what it answered (masked, short).
  private json(r: RunResult, service: string): unknown {
    if (!succeeded(r)) return refuse(`${service} did not answer this (${redactSecrets(`${r.stderr || r.stdout}`.trim()).slice(0, 400) || `exit ${r.code ?? r.spawnError}`}). If it is a sign-in, a person checks Settings → Connectors.`);
    try {
      return JSON.parse(r.stdout) as unknown;
    } catch {
      return refuse(`${service}'s answer was not JSON.`);
    }
  }
}
