// What each HOST can actually do for a mission, cell by cell, and on what grounds. A cell is `verified` only when a
// native acceptance receipt for THIS source (satellite/acceptance/host-acceptance.json, keyed by sourceDigestOf) says
// the capability passed; a cell only CLAIMED verified falls back to `reported` (what the host's own documentation or
// Orbit's docs/hosts.md say) until such a receipt exists. Nothing here ever reports serial execution as parallel.
export const VALUES = Object.freeze(["verified", "reported", "unavailable", "unknown"]);

export const CAPABILITIES = Object.freeze(["nativeAgentDispatch", "parallelism", "toolObservation", "toolOutcomeReliability", "filesystemIsolation", "permissionEnforcement", "modelSelection", "cancellation", "sessionAffinity", "liveIntegration"]);

const docs = (ref) => ({ docs: ref });

const HOSTS_MD = "docs/hosts.md";

const cell = (value, by, extra = {}) => ({ value, by, ...extra });

const claimed = (acceptance, fallback, extra = {}) => ({ value: "verified", by: { acceptance }, fallback, ...extra });

export const HOSTS = Object.freeze({
  claude: {
    nativeAgentDispatch: claimed("claude:agent-dispatch", docs("https://code.claude.com/docs/en/sub-agents")),
    parallelism: claimed("claude:agent-parallel", docs("https://code.claude.com/docs/en/sub-agents"), { max: 20 }),
    toolObservation: cell("reported", docs(`${HOSTS_MD}#claude-code`), { note: "the session's tool calls through the working set; per agent run only with a SubagentStart hook row" }),
    toolOutcomeReliability: cell("reported", docs(`${HOSTS_MD}#claude-code`), { note: "PostToolUseFailure names a failed call" }),
    filesystemIsolation: cell("unavailable", docs(`${HOSTS_MD}#claude-code`), { note: "an agent runs in the checkout; source changes are isolated by an engineering task's own workspace" }),
    permissionEnforcement: cell("reported", docs("https://code.claude.com/docs/en/sub-agents"), { note: "a plugin agent's tools: allowlist is the host's; permissionMode is ignored" }),
    modelSelection: cell("unavailable", docs("https://code.claude.com/docs/en/plugins/components")),
    cancellation: cell("reported", docs("https://code.claude.com/docs/en/sub-agents"), { note: "TaskStop" }),
    sessionAffinity: cell("reported", docs(`${HOSTS_MD}#claude-code`), { note: "ORBIT_SESSION through the session's environment file" }),
    liveIntegration: cell("reported", docs("satellite/docs/hosts.md"), { note: "Satellite Live in a terminal beside the session; no docked pane" }),
  },
  codex: {
    nativeAgentDispatch: cell("unavailable", docs(`${HOSTS_MD}#codex`)),
    parallelism: cell("unavailable", docs(`${HOSTS_MD}#codex`), { max: 1 }),
    toolObservation: cell("reported", docs(`${HOSTS_MD}#codex`), { note: "Bash and apply_patch only" }),
    toolOutcomeReliability: cell("unknown", null),
    filesystemIsolation: cell("unavailable", docs(`${HOSTS_MD}#codex`)),
    permissionEnforcement: cell("unknown", null),
    modelSelection: cell("unavailable", docs(`${HOSTS_MD}#codex`)),
    cancellation: cell("unavailable", docs(`${HOSTS_MD}#codex`)),
    sessionAffinity: cell("reported", docs(`${HOSTS_MD}#codex`), { note: "an explicit binding on every command" }),
    liveIntegration: cell("reported", docs("satellite/docs/hosts.md"), { note: "Satellite Live in a terminal" }),
  },
  antigravity: {
    nativeAgentDispatch: cell("unavailable", docs(`${HOSTS_MD}#antigravity-cli`)),
    parallelism: cell("unavailable", docs(`${HOSTS_MD}#antigravity-cli`), { max: 1 }),
    toolObservation: cell("reported", docs(`${HOSTS_MD}#antigravity-cli`), { note: "PreToolUse and PostToolUse; no session end" }),
    toolOutcomeReliability: cell("unknown", null),
    filesystemIsolation: cell("unavailable", docs(`${HOSTS_MD}#antigravity-cli`)),
    permissionEnforcement: cell("unknown", null),
    modelSelection: cell("unavailable", docs(`${HOSTS_MD}#antigravity-cli`)),
    cancellation: cell("unavailable", docs(`${HOSTS_MD}#antigravity-cli`)),
    sessionAffinity: cell("reported", docs(`${HOSTS_MD}#antigravity-cli`), { note: "an explicit binding on every command" }),
    liveIntegration: cell("reported", docs("satellite/docs/hosts.md"), { note: "Satellite Live in a terminal" }),
  },
  grok: {
    nativeAgentDispatch: cell("unavailable", docs(`${HOSTS_MD}#grok-build`), { note: "the manifest declares no agents" }),
    parallelism: cell("unavailable", docs(`${HOSTS_MD}#grok-build`), { max: 1 }),
    toolObservation: cell("reported", docs(`${HOSTS_MD}#grok-build`), { note: "five measured tools" }),
    toolOutcomeReliability: cell("reported", docs(`${HOSTS_MD}#grok-build`), { note: "exit codes" }),
    filesystemIsolation: cell("unavailable", docs(`${HOSTS_MD}#grok-build`)),
    permissionEnforcement: cell("unknown", null),
    modelSelection: cell("unavailable", docs(`${HOSTS_MD}#grok-build`)),
    cancellation: cell("unavailable", docs(`${HOSTS_MD}#grok-build`)),
    sessionAffinity: cell("reported", docs(`${HOSTS_MD}#grok-build`), { note: "GROK_SESSION_ID" }),
    liveIntegration: cell("reported", docs("satellite/docs/hosts.md"), { note: "Satellite Live in a terminal" }),
  },
  unknown: Object.fromEntries(CAPABILITIES.map((c) => [c, cell("unknown", null, c === "parallelism" ? { max: 1 } : {})])),
});

export const HOST_IDS = Object.freeze(Object.keys(HOSTS));

// A claimed cell, earned or fallen back: `verified` needs a passed result for this very source.
const settled = (c, passed) => (c.value === "verified" && !passed.has(c.by.acceptance) ? { ...c, value: "reported", by: c.fallback, claimed: c.by.acceptance } : c);

export const hostRowOf = (host, passed = new Set()) => Object.fromEntries(CAPABILITIES.map((cap) => [cap, settled((HOSTS[host] ?? HOSTS.unknown)[cap], passed)]));

export const hostsMatrix = (passed = new Set()) => Object.fromEntries(HOST_IDS.map((h) => [h, hostRowOf(h, passed)]));

const DISPATCHES = ["verified", "reported"];

// Serial whenever the host has no native agent dispatch, or a parallelism of one: never shown as parallel.
export const serialOnly = (row) => !DISPATCHES.includes(row.nativeAgentDispatch.value) || (row.parallelism.max ?? 1) < 2 || !DISPATCHES.includes(row.parallelism.value);

export const concurrencyOf = (row, limit) => (serialOnly(row) ? 1 : Math.min(limit, row.parallelism.max ?? 1));
