// HOW AN EMPLOYEE'S PLANES REACH THE WORLD (Execution, ADR 0067), as the deployment sets it -- never a request:
//
//   tool plane   its only way out is Orbit Web's egress proxy for employees (ORBIT_WEB_SANDBOX_EGRESS_PORT, 3128), on the
//                sandbox network, every connection carrying the run's token and decided as that run under its account's
//                policy (AUTONOMOUS or RESTRICTED; private and internal addresses never);
//   model plane  its only way out is the model-plane egress (ORBIT_WEB_MODEL_EGRESS_PORT, 3129): the AI providers' own
//                hosts, a deployment-fixed list per runtime (and the extra hosts the operator names), port 443 only --
//                plus Orbit Web's tool endpoint on the model network, directly.
//
// ORBIT_WEB_SANDBOX_HOST is the name both planes reach Orbit Web by (the container's name on those networks).
import type { RuntimeKind } from "@orbit-web/contracts";
import type { AppConfig } from "../../../config/config.js";

// The hosts each runtime's CLI talks to for its model and its sign-in (with non-essential traffic switched off).
export const PROVIDER_HOSTS: Readonly<Record<RuntimeKind, readonly string[]>> = {
  claude: ["api.anthropic.com", "claude.ai", "console.anthropic.com", "platform.claude.com"],
  codex: ["api.openai.com", "auth.openai.com", "chatgpt.com"],
  agy: ["generativelanguage.googleapis.com", "oauth2.googleapis.com", "accounts.google.com", "www.googleapis.com"],
};

export interface EmployeeNetworkConfig {
  // The name the planes reach Orbit Web by.
  host: string;
  toolEgressPort: number;
  modelEgressPort: number;
  // The hosts a model plane may reach (every runtime's, and the operator's extra ones).
  modelHosts: ReadonlySet<string>;
}

const port = (raw: string | undefined, fallback: number): number => {
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
};

export function employeeNetworkOf(config: AppConfig, container: boolean): EmployeeNetworkConfig {
  const env = config.sourceEnv;
  const governed = config.governance.deployment === "governed" ? config.governance.proxyPort : null;
  const extra = (env.ORBIT_WEB_MODEL_EGRESS_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]{1,253}$/.test(h));
  return {
    host: (env.ORBIT_WEB_SANDBOX_HOST ?? "").trim() || (container ? "orbit-web" : config.governance.agentControlHost),
    toolEgressPort: governed ?? port(env.ORBIT_WEB_SANDBOX_EGRESS_PORT, 3128),
    modelEgressPort: port(env.ORBIT_WEB_MODEL_EGRESS_PORT, 3129),
    modelHosts: new Set([...Object.values(PROVIDER_HOSTS).flat(), ...extra]),
  };
}
