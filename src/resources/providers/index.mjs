// The providers the Effective Resource Registry composes, one per family, in
// reading order. A new family is a provider here and a row in FAMILIES
// (src/resources/model.mjs); nothing that READS the registry changes.
import { agentProvider, skillProvider } from "./components.mjs";
import { capabilityProvider } from "./capabilities.mjs";
import { mcpProvider } from "./mcp.mjs";
import { toolProvider } from "./tools.mjs";

export const PROVIDERS = [skillProvider, agentProvider, mcpProvider, toolProvider, capabilityProvider];
