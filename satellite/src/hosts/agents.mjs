// Which of the plugin's own AGENT DEFINITIONS carries a permission profile, and the tools each is allowed: the one
// table agents/satellite-*.md frontmatter is held to (test/packaging.test.mjs). The host enforces a definition's
// `tools:` allowlist; a role's name or an instruction can never widen it.
export const PROFILE_AGENTS = Object.freeze({ READ_ONLY: "satellite-reader", DESIGN: "satellite-designer", IMPLEMENT: "satellite-engineer", VERIFY: "satellite-verifier" });

export const AGENT_TOOLS = Object.freeze({ "satellite-reader": ["Read", "Glob", "Grep"], "satellite-designer": ["Read", "Glob", "Grep"], "satellite-engineer": ["Read", "Glob", "Grep", "Bash", "Edit", "Write"], "satellite-verifier": ["Read", "Glob", "Grep", "Bash"] });

export const PLUGIN_NAMESPACE = "orbit";

export const subagentTypeOf = (profile) => `${PLUGIN_NAMESPACE}:${PROFILE_AGENTS[profile]}`;
