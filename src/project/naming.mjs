// Orbit public identity — pure data, no I/O.

export const PRODUCT = "Orbit";
export const BRAND = "Orbit";
export const TAGLINE = "From Goal to Verified Outcome";
export const PLUGIN_ID = "orbit";
export const CLI_NAME = "orbit";
export const ENGINE = "Orbit Engine";
export const LIVE = "Orbit Live";
export const CONTROL = "Orbit Control";
export const GOAL = "Orbit Goal Orchestrator";
export const STORE = "Orbit Store";
export const VSCODE_COMPANION = "Orbit Live Companion";

export function canonicalSkill(name) {
  return String(name ?? "").split(":").pop();
}

export function canonicalAgent(name) {
  return String(name ?? "");
}

export function pluginIds() {
  return [PLUGIN_ID];
}

export const SKILL_SWITCH = Object.freeze({
  orbit: "skill_orbit",
  "orbit-help": "skill_help",
  "orbit-develop": "skill_developer",
  "orbit-engineer": "skill_autonomous_engineering",
  "orbit-qa": "skill_autonomous_qa",
  "orbit-requirements": "skill_requirements",
  "orbit-architecture": "skill_architecture",
  "orbit-runtime": "skill_runtime_discover",
  "orbit-dotnet": "skill_dotnet_intelligence",
  "orbit-test-plan": "skill_qa_plan",
  "orbit-ui-test": "skill_drive_ui",
  "orbit-test-suite": "skill_run_tests",
  "orbit-ui-map": "skill_map_ui",
  "orbit-ui-explore": "skill_explore_ui",
  "orbit-learn": "skill_learn_ui",
  "orbit-sql": "skill_connect_sql",
  "orbit-browser": "skill_open_browser",
  "orbit-qc-builder": "skill_qc_tool_builder",
  "orbit-report": "skill_project_reporter",
  "orbit-control": "skill_control",
  "orbit-release": "skill_ship_plugin",
});

export function skillSwitchKey(skillName) {
  const canonical = canonicalSkill(skillName);
  return SKILL_SWITCH[canonical] ?? null;
}
