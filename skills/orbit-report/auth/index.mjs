// The AUTH of a connection, bound for the composition roots that need it -- cli/project-report.mjs, cli/requirements.mjs
// and Orbit Control -- once, so none of them can wire a different tool, a different profile or a different adapter.
//
// `createAuth` (src/connections/auth.mjs) is the generic contract; what is added here is what is concrete: which
// adapter answers for which strategy id and the tools port it asks.
// Binding reads and starts nothing.
import { createAuth } from "../../../src/connections/auth.mjs";
import { azureCliAdapter } from "./azure-cli.mjs";
import { createToolsPort } from "./tools.mjs";

// w: { pluginRoot, env, rooms, io, process, secrets, providers, nowMs?, emit?, next?, log? }
export function authFor(w) {
  const nowMs = w.nowMs ?? Date.now;
  const tools = createToolsPort(w);
  const adapters = { "azure-cli": azureCliAdapter({ tools, process: w.process, io: w.io, nowMs, emit: w.emit, next: w.next }) };
  return createAuth({ secrets: w.secrets, adapters, providers: w.providers, nowMs });
}
