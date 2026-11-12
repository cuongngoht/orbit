// THE MINI-SWE-AGENT ARMS: a second coding host, so a gain can be told apart as the plugin's or the host's -- a 2 x 2
// of {Claude Code, mini-SWE-agent} x {plain, + the plugin}. mini-SWE-agent (pinned, in a uv virtualenv under
// $ORBIT_EVAL_HOME/tools/) runs on the HOST through lib/arms/mini-driver.py and acts in the SAME task container every arm
// gets (its Docker environment, attached, runs each command by `docker exec`), so that container needs no network at
// all: the model is called from the host process. Model, effort, step limit (= the Claude arms' turns), USD cap and
// wall time are the campaign's, the prompt is the same task text and closing paragraph; the configuration is
// mini-SWE-agent's own default (`mini.yaml`), with only what running it unattended against that container needs.
//
// `mini+orbit` copies in the same plugin archive as the Claude Code plugin arm (Node is in the tools volume both arms
// mount) and adds ONE paragraph to the system template: the plugin's skills as a host would list them (each one's name
// and description, read from its SKILL.md) and how to use one. Listed, never ordered. mini-SWE-agent has no hooks and
// no Skill tool, so this arm measures what an agent understands and does with the plugin through a shell -- never what
// the plugin's hooks add.
//
// The credential: ORBIT_EVAL_ANTHROPIC_API_KEY, by name; the controller maps it to ANTHROPIC_API_KEY in the environment
// of the one driver process and nowhere else. A `deterministic` arm (self-checks) runs mini-SWE-agent's own
// DeterministicModel through a control patch, with no model and no credential.
//
//   ensureMini(home) -> { ok, python, version }    skillsOf(pluginDir) -> [{ id, name, description }]
//   listingOf(pluginDir, inContainer) -> paragraph   miniArm(id, def) · miniOrbitArm(id, def)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanEnv, run } from "../core/proc.mjs";
import { ensureDir, EVALUATOR_DIR, writeText } from "../core/util.mjs";
import { MINI_PYTHON, MINI_SWE_AGENT_VERSION, TOOLS_MOUNT } from "../core/versions.mjs";
import { PLUGIN_DIR_IN_CONTAINER, preparedPlugin, resolvedPlugin } from "./plugin.mjs";

export const MINI_CREDENTIAL = "ORBIT_EVAL_ANTHROPIC_API_KEY";

// The name the model client reads; set in the driver's environment alone, from MINI_CREDENTIAL's value.
export const MINI_CREDENTIAL_AS = "ANTHROPIC_API_KEY";

export const DRIVER = join(EVALUATOR_DIR, "lib", "arms", "mini-driver.py");

// What the driver may see of this environment besides the credential: how to find docker and the network, nothing else.
const HOST_NAMES = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy"];

// Every Bash command a Claude Code arm runs may take up to BASH_DEFAULT_TIMEOUT_MS (1800 s); a mini command the same.
export const COMMAND_TIMEOUT_SECONDS = 1800;

// `bash -c`, not mini's default `bash -lc`: a login shell's /etc/profile resets PATH, and every arm's commands must see
// the container's own environment (PATH with the tools volume, HOME, ORBIT_STORE_DIR), as a Claude Code arm's do.
export const INTERPRETER = ["bash", "-c"];

const venvOf = (home) => join(home, "tools", `mini-swe-agent-${MINI_SWE_AGENT_VERSION}`);

const pythonOf = (home) => join(venvOf(home), "bin", "python");

export function ensureMini(home) {
  if (existsSync(join(venvOf(home), "READY"))) return { ok: true, python: pythonOf(home), version: MINI_SWE_AGENT_VERSION };
  ensureDir(join(home, "tools"));
  const env = cleanEnv(process.env, [...HOST_NAMES, "SSL_CERT_FILE", "UV_CACHE_DIR"]);
  const steps = [["uv", "venv", "-q", "--clear", "--python", MINI_PYTHON, venvOf(home)], ["uv", "pip", "install", "-q", "--python", pythonOf(home), `mini-swe-agent==${MINI_SWE_AGENT_VERSION}`]];
  for (const argv of steps) {
    const r = run(argv, { env, timeoutMs: 1800000 });
    if (!r.ok) return { ok: false, why: `${argv.slice(0, 3).join(" ")}: ${String(r.err).trim().slice(-300)}` };
  }
  writeText(join(venvOf(home), "READY"), `mini-swe-agent==${MINI_SWE_AGENT_VERSION}\n`);
  return { ok: true, python: pythonOf(home), version: MINI_SWE_AGENT_VERSION };
}

// ---- the skill listing ----------------------------------------------------------------------------------------------------

// One frontmatter value: plain, quoted, or a folded (>) / literal (|) block, as a SKILL.md writes them.
function valueOf(lines, key) {
  const i = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (i < 0) return null;
  const rest = lines[i].slice(key.length + 1).trim();
  if (!/^[>|][+-]?$/.test(rest)) return rest.replace(/^(["'])(.*)\1$/, "$2");
  const block = [];
  for (const l of lines.slice(i + 1)) {
    if (l.trim() && !/^\s/.test(l)) break;
    block.push(l.trim());
  }
  return rest.startsWith(">") ? block.join(" ").replace(/\s+/g, " ").trim() : block.join("\n").trim();
}

export function frontmatterOf(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text));
  const lines = m ? m[1].split(/\r?\n/) : [];
  return { name: valueOf(lines, "name"), description: valueOf(lines, "description"), hidden: valueOf(lines, "disable-model-invocation") === "true" };
}

// The skills a host lists to its model: every skills/<id>/SKILL.md with a name and description, not marked hidden.
export function skillsOf(pluginDir) {
  const dir = join(pluginDir, "skills");
  if (!existsSync(dir)) return [];
  const ids = readdirSync(dir).filter((id) => existsSync(join(dir, id, "SKILL.md"))).sort();
  return ids.map((id) => ({ id, ...frontmatterOf(readFileSync(join(dir, id, "SKILL.md"), "utf8")) })).filter((s) => s.name && s.description && !s.hidden);
}

export function listingOf(pluginDir, inContainer = PLUGIN_DIR_IN_CONTAINER) {
  const skills = skillsOf(pluginDir);
  return [
    `A plugin is installed at ${inContainer}. These are its skills (each one's name and description):`,
    "",
    ...skills.map((s) => `- ${s.name} (${inContainer}/skills/${s.id}/SKILL.md): ${s.description}`),
    "",
    `To use a skill, read ${inContainer}/skills/<id>/SKILL.md and follow it. Its commands run as \`node ${inContainer}/cli/<x>.mjs ...\`; ORBIT_STORE_DIR is already set in this environment.`,
  ].join("\n");
}

const pluginMeta = (pluginDir) => ((f) => (existsSync(f) ? ((j) => [{ name: j.name, version: j.version }])(JSON.parse(readFileSync(f, "utf8"))) : []))(join(pluginDir, ".claude-plugin", "plugin.json"));

// ---- the arms -------------------------------------------------------------------------------------------------------------

const FIELDS = ["kind", "rev", "deterministic"];

// A deterministic arm's steps: mini-SWE-agent's own test model applying a control patch of the task and submitting; with
// a plugin, it first reads a skill and runs one of the plugin's commands, so both are proven reachable through the shell.
function deterministicSteps(def, withPlugin) {
  const plugin = withPlugin ? [{ content: "THOUGHT: read the coordinator skill.", command: `head -5 ${PLUGIN_DIR_IN_CONTAINER}/skills/orbit-help/SKILL.md` }, { content: "THOUGHT: ask the plugin where its data lives.", command: `node ${PLUGIN_DIR_IN_CONTAINER}/cli/query.mjs storage --json` }] : [];
  return [...plugin, { content: "THOUGHT: apply the change.", command: "git apply --binary --whitespace=nowarn /opt/evalrun/agent/control.patch && git status --short" }, { content: "Done.\n\nEVAL_STATUS: DONE", command: "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT" }];
}

function base(id, def, kind, withPlugin) {
  const scripted = typeof def.deterministic === "string";
  const credentialNames = scripted ? [] : [MINI_CREDENTIAL];
  return {
    id,
    kind,
    def,
    runsOn: "host",
    charges: !scripted,
    needsNetwork: false,
    credentialNames,
    containerCredentialNames: [],
    control: {},
    pluginDir: withPlugin ? PLUGIN_DIR_IN_CONTAINER : null,
    validate: () => [...Object.keys(def).filter((k) => !FIELDS.includes(k)).map((k) => `${k} is not a field of a ${kind} arm`), ...(scripted && !/^[a-z]+$/.test(def.deterministic) ? ["deterministic names the task's control patch to apply (gold)"] : []), ...(withPlugin ? (typeof def.rev === "string" && def.rev ? [] : ["rev (a tag or commit of the plugin repository) is required"]) : def.rev ? ["a plain arm takes no rev"] : [])],
    freeze: (ctx) => (withPlugin ? resolvedPlugin(ctx.pluginRepo, def.rev) : {}),
    files: (ctx) => [{ kind: "agent", from: join(EVALUATOR_DIR, "lib", "container", "hold.mjs"), name: "hold.mjs" }, ...(scripted ? [{ kind: "agent", bytes: ctx.task.controlPatch(def.deterministic), name: "control.patch" }] : []), ...(withPlugin ? ((p) => [{ kind: "plugin", from: p.dir, to: "/opt", digest: p.digest, files: p.files }])(preparedPlugin(ctx.home, ctx.pluginRepo, ctx.frozen.commit)) : [])],
    argv: () => [`${TOOLS_MOUNT}/bin/node`, "/opt/evalrun/agent/hold.mjs"],
    host: (ctx) => hostRun(ctx, def, withPlugin, credentialNames),
  };
}

// What the driver is handed: its config (written to `configFile`), its argv and its environment.
function hostRun(ctx, def, withPlugin, credentialNames) {
  const tools = ensureMini(ctx.home);
  if (!tools.ok) return { infra: { code: "HOST_TOOL", says: tools.why } };
  const plugin = withPlugin ? preparedPlugin(ctx.home, ctx.pluginRepo, ctx.frozen.commit).dir : null;
  const config = { container: ctx.container, cwd: ctx.task.repo, task: ctx.prompt, model: ctx.campaign.model, effort: ctx.campaign.effort, steps: ctx.limits.turns, costUsd: ctx.limits.usd, commandTimeout: COMMAND_TIMEOUT_SECONDS, interpreter: INTERPRETER, config: "mini.yaml", systemExtra: plugin ? listingOf(plugin) : null, trajectory: ctx.trajectory, deterministic: typeof def.deterministic === "string" ? deterministicSteps(def, withPlugin) : null, plugins: plugin ? pluginMeta(plugin) : [], skills: plugin ? skillsOf(plugin).map((s) => s.name) : [] };
  return { argv: [tools.python, DRIVER, ctx.configFile], config, env: driverEnv(ctx, credentialNames), version: tools.version };
}

// The driver's environment: docker and the network's names, the CA a TLS-inspecting proxy needs, a config directory of
// its own, and -- for a model arm -- the credential, read from its name and set under the name the client reads.
export function driverEnv(ctx, credentialNames, env = process.env) {
  const ca = ctx.caFile ? { SSL_CERT_FILE: ctx.caFile, REQUESTS_CA_BUNDLE: ctx.caFile } : {};
  const key = credentialNames.includes(MINI_CREDENTIAL) && env[MINI_CREDENTIAL] ? { [MINI_CREDENTIAL_AS]: env[MINI_CREDENTIAL] } : {};
  return { ...cleanEnv(env, HOST_NAMES), ...ca, MSWEA_SILENT_STARTUP: "1", MSWEA_GLOBAL_CONFIG_DIR: ctx.configDir, LITELLM_LOCAL_MODEL_COST_MAP: "True", PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1", ...key };
}

export const miniArm = (id, def) => base(id, def, "mini", false);

export const miniOrbitArm = (id, def) => base(id, def, "mini+orbit", true);
