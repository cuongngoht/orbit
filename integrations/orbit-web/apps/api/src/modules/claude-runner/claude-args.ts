// The one place Claude Code's command line is written. Headless (`-p`), the prompt on stdin, structured output with
// partial messages, the Orbit plugin (and the chat's project plugins) by directory, a model alias, an effort level, and
// one of the two modes: Autonomous is Claude Code's auto mode (a classifier reviews each action before it runs; in
// `-p` whatever would prompt is denied and reported back as a permission denial), Plan is its plan mode (read and plan,
// change nothing). Pushing and driving GitHub from the agent's shell are refused by rule (deny rules bind in every mode)
// unless a person let Claude Code use GitHub CLI's sign-in; even then the sign-in itself stays out of its reach. There is
// no bypass mode here, and nothing a request says becomes an argument except the model, effort and mode, each checked
// against its closed list first.
import { MODE_PERMISSION, type EffortChoice, type ModeChoice, type ModelChoice } from "@orbit-web/contracts";
import { AZURE_DEVOPS_RESOURCE } from "../sources/azure-parse.js";

export const BASE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "Skill", "Agent", "TodoWrite"];

export const WEB_TOOLS = ["WebFetch", "WebSearch"];

// Defence in depth, not isolation: the agent's shell runs in the same container as the CLIs' sign-ins (README).
// Refused in every run: printing a stored credential through git, and changing git's global configuration.
export const ALWAYS_DENIED = ["Bash(git credential:*)", "Bash(git config --global:*)"];

// Refused unless a person let Claude Code use GitHub CLI's sign-in: pushing, and gh altogether.
export const GITHUB_DENIED = ["Bash(git push:*)", "Bash(gh:*)"];

// Refused even then: gh's own sign-in (printing its token, signing out), and what pushing and opening a pull request
// never needs and a misled agent could make costly -- raw API calls, extensions and aliases, gh's configuration,
// workflows and runs, releases, gists, secrets and variables, the account's keys, codespaces, the organisation and its
// rulesets, caches, and deleting, renaming, archiving or re-configuring a repository. A deny rule matches the command as
// written, so this is defence in depth beside auto mode's classifier, not a wall (README).
const GH_SENSITIVE_COMMANDS = ["auth", "api", "extension", "alias", "config", "workflow", "run", "release", "gist", "secret", "variable", "ssh-key", "gpg-key", "codespace", "org", "ruleset", "cache", "repo delete", "repo edit", "repo rename", "repo archive"];

export const GITHUB_SENSITIVE = GH_SENSITIVE_COMMANDS.map((c) => `Bash(gh ${c}:*)`);

const OPENING =
  "You are running in Orbit Web, in a workspace of this chat's own inside a container. Create, edit, rename and delete " +
  "files there as the task needs, and commit locally when asked. ";

// What this workspace allows, said to Claude Code once, after its own system prompt -- one of two fixed texts, chosen by
// the person's switch, nothing a request or a repository wrote. Without it Claude chains `git commit … && git push …` as
// it would anywhere else, the deny rule refuses the whole command, and the commit is lost with the push.
export const WORKSPACE_NOTES = {
  local:
    OPENING +
    "Pushing and the GitHub CLI are not available here (there is no credential for them, and they are refused by " +
    "rule): never chain a push or a gh command into another command -- the whole command would be refused, with what " +
    "came before it -- but commit on its own, and say that the person pushes.",
  github:
    OPENING +
    "A person let you use GitHub CLI's sign-in: when asked, push the branch you work on to origin and open a pull " +
    "request with gh. Commit first, as a command of its own; never force-push, never push to the default branch " +
    "directly, and never print or move a credential (gh auth is refused).",
} as const;

// Said only when a person let Claude Code use the Azure CLI's sign-in. The image has the Azure CLI and not its
// azure-devops extension (`az boards` stops at an install prompt nobody can answer in a run), and Azure DevOps is read the
// way Orbit Web itself reads it: `az rest` with Azure DevOps' own resource id.
export const AZURE_NOTE =
  "The Azure CLI is signed in to Azure DevOps here (a person let you use its sign-in). Its azure-devops extension " +
  "(az boards, az repos, az pipelines) is not installed, and is not to be installed: read Azure DevOps -- work items, " +
  `repositories, pull requests -- through its REST API with az rest --resource ${AZURE_DEVOPS_RESOURCE}, e.g. a work ` +
  `item with all its fields and links: az rest --method get --resource ${AZURE_DEVOPS_RESOURCE} --url ` +
  "'https://dev.azure.com/<organization>/_apis/wit/workitems/<id>?$expand=all&api-version=7.1'. Never print or move " +
  "a token.";

export interface ClaudeRunOptions {
  model: ModelChoice;
  effort: EffortChoice;
  mode: ModeChoice;
  // A person let Claude Code use the Azure CLI's sign-in; otherwise `az` is refused to it.
  azure: boolean;
  // A person let Claude Code use GitHub CLI's sign-in to push and open pull requests; otherwise both are refused to it.
  github: boolean;
  // Orbit's plugin first, then the chat's project plugins (project.service.ts).
  pluginDirs: string[];
  // The plugins this chat's project declares and Orbit Web installed: enabled for this run only.
  enabledPlugins: Record<string, true>;
  // What auto mode's classifier is told about this place (auto-mode.ts); null leaves the CLI's own.
  autoModeEnvironment: string[] | null;
  // First turn: the id Orbit Web chose for the Claude session. Later turns: the id to resume.
  sessionId: string;
  resume: boolean;
  webTools: boolean;
  maxBudgetUsd: number | null;
  // Paths the agent may not read or write through its file tools (the sign-ins, Orbit Web's own database).
  protectedDirs: string[];
  // A governed run: whether the Constitution lets it run commands in its workspace (Bash), and what it is told about
  // the agent gateway. Absent: as an ungoverned run.
  execute?: boolean;
  governanceNote?: string | null;
}

// A run under governance holds no credential at all: Orbit Web pushes for it, through the agent gateway.
export const GOVERNED_NOTE =
  OPENING +
  "`git push` and the GitHub CLI are refused to you here (there is no credential in this run): never chain one into " +
  "another command -- the whole command would be refused, with what came before it -- but commit on its own, then ask " +
  "Orbit Web's agent gateway to push (below).";

// Claude Code reads a rule path that starts with `//` as an absolute path (a single `/` is relative to the settings
// file), and an Edit rule covers every built-in tool that writes a file.
const fileRules = (dirs: string[]): string[] => dirs.flatMap((d) => [`Read(/${d}/**)`, `Edit(/${d}/**)`]);

export const denyRules = (o: Pick<ClaudeRunOptions, "github" | "azure">): string[] => [...(o.github ? GITHUB_SENSITIVE : GITHUB_DENIED), ...ALWAYS_DENIED, ...(o.azure ? [] : ["Bash(az:*)"])];

// The run's own settings: the project's declared plugins, and -- in Autonomous -- the classifier's environment.
function runSettings(o: ClaudeRunOptions): Record<string, unknown> {
  return {
    ...(Object.keys(o.enabledPlugins).length > 0 ? { enabledPlugins: o.enabledPlugins } : {}),
    ...(o.mode === "autonomous" && o.autoModeEnvironment !== null ? { autoMode: { environment: o.autoModeEnvironment } } : {}),
  };
}

// The web tools are never pre-approved: a fetch can carry data in its URL, so each one goes to auto mode's classifier
// like a `curl` would. Switched off, they are refused outright.
export function claudeArgs(o: ClaudeRunOptions): string[] {
  const settings = runSettings(o);
  const execute = o.execute !== false;
  const allowed = execute ? BASE_TOOLS : BASE_TOOLS.filter((t) => t !== "Bash");
  const governed = o.governanceNote !== undefined && o.governanceNote !== null;
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model",
    o.model,
    "--effort",
    o.effort,
    ...o.pluginDirs.flatMap((dir) => ["--plugin-dir", dir]),
    ...(o.resume ? ["--resume", o.sessionId] : ["--session-id", o.sessionId]),
    "--permission-mode",
    MODE_PERMISSION[o.mode],
    "--allowedTools",
    allowed.join(","),
    "--disallowedTools",
    ...denyRules(o),
    ...fileRules(o.protectedDirs),
    ...(o.webTools ? [] : WEB_TOOLS),
    ...(execute ? [] : ["Bash"]),
    "--append-system-prompt",
    (governed ? [GOVERNED_NOTE, o.governanceNote as string] : [o.github ? WORKSPACE_NOTES.github : WORKSPACE_NOTES.local, ...(o.azure ? [AZURE_NOTE] : [])]).join(" "),
    // The user's settings only: a repository's own .claude/settings.json is untrusted input and could set `env` (an
    // API base URL that would receive the credential) or hooks that run before any tool call.
    "--setting-sources",
    "user",
    "--strict-mcp-config",
    ...(Object.keys(settings).length > 0 ? ["--settings", JSON.stringify(settings)] : []),
    ...(o.maxBudgetUsd !== null ? ["--max-budget-usd", String(o.maxBudgetUsd)] : []),
  ];
}
