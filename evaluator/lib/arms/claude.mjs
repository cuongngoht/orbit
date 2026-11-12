// THE CLAUDE CODE ARMS: the pinned Claude Code from the tools volume, headless, with the same flags for every arm --
// the same tools allowed, web lookups refused for every arm (no answer looked up on the internet), settings from the
// fresh home only, no MCP server, no session kept, the same model, effort, USD cap and turn cap. The ONLY difference
// between `claude` and `claude+orbit` is `--plugin-dir`, the plugin archive of the revision the arm names. The host's
// built-in plugins are off in both (HOST_SETTINGS).
import { PLUGIN_DIR_IN_CONTAINER, preparedPlugin, resolvedPlugin } from "./plugin.mjs";
import { TOOLS_MOUNT } from "../core/versions.mjs";

export const ALLOWED_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "Skill", "Agent", "TodoWrite"];

export const DISALLOWED_TOOLS = ["WebFetch", "WebSearch"];

// The names Claude Code reads its credential under; the controller hands one by NAME, never by value.
export const CREDENTIAL_NAMES = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"];

export const hostArgs = (o) => [`${TOOLS_MOUNT}/bin/claude`, "-p", "--output-format", "stream-json", "--verbose", ...(o.pluginDir ? ["--plugin-dir", o.pluginDir] : []), "--permission-mode", "dontAsk", "--allowedTools", ALLOWED_TOOLS.join(","), "--disallowedTools", DISALLOWED_TOOLS.join(","), "--setting-sources", "user", "--strict-mcp-config", "--no-session-persistence", "--model", o.model, "--effort", o.effort, "--max-budget-usd", String(o.usd), "--max-turns", String(o.turns)];

const credentialOf = (def) => def.credential ?? "CLAUDE_CODE_OAUTH_TOKEN";

// The plugins this Claude Code version ships built in and loads in every session, whatever the arm (seen on its init
// line). They are switched off for every Claude Code arm alike by the user settings of the run's fresh home -- the
// only settings source a run reads -- so the one plugin an arm differs by is the one under test.
export const BUILTIN_PLUGINS = ["cc-plugin-agents-md", "cc-plugin-privacy", "cc-plugin-plugin-authoring"];

export const HOST_SETTINGS = { enabledPlugins: Object.fromEntries(BUILTIN_PLUGINS.map((p) => [`${p}@builtin`, false])) };

export const HOME_FILES = [{ path: "/work/home/.claude/settings.json", text: `${JSON.stringify(HOST_SETTINGS, null, 2)}\n` }];

function base(id, def, kind) {
  return {
    id,
    kind,
    def,
    runsOn: "container",
    charges: true,
    needsNetwork: true,
    credentialNames: [credentialOf(def)],
    homeFiles: HOME_FILES,
    control: {},
    validate: () => [...(CREDENTIAL_NAMES.includes(credentialOf(def)) ? [] : [`credential must be one of ${CREDENTIAL_NAMES.join(", ")}`]), ...Object.keys(def).filter((k) => !["kind", "credential", "rev"].includes(k)).map((k) => `${k} is not a field of a ${kind} arm`)],
    freeze: () => ({}),
    files: () => [],
    argv: (ctx) => hostArgs({ model: ctx.model, effort: ctx.effort, usd: ctx.limits.usd, turns: ctx.limits.turns, pluginDir: null }),
  };
}

export const claudeArm = (id, def) => ({ ...base(id, def, "claude"), validate: () => [...base(id, def, "claude").validate(), ...(def.rev ? ["a plain arm takes no rev"] : [])] });

// + a plugin: the archive of `rev` (a tag or a commit of the plugin repository), frozen to its commit when the campaign
// begins, copied into the container, and named to Claude Code with --plugin-dir.
export function orbitArm(id, def) {
  const b = base(id, def, "claude+orbit");
  return {
    ...b,
    validate: () => [...b.validate(), ...(typeof def.rev === "string" && def.rev ? [] : ["rev (a tag or commit of the plugin repository) is required"])],
    freeze: (ctx) => resolvedPlugin(ctx.pluginRepo, def.rev),
    files: (ctx) => ((p) => [{ kind: "plugin", from: p.dir, to: "/opt", digest: p.digest, files: p.files }])(preparedPlugin(ctx.home, ctx.pluginRepo, ctx.frozen.commit)),
    argv: (ctx) => hostArgs({ model: ctx.model, effort: ctx.effort, usd: ctx.limits.usd, turns: ctx.limits.turns, pluginDir: PLUGIN_DIR_IN_CONTAINER }),
    pluginDir: PLUGIN_DIR_IN_CONTAINER,
  };
}
