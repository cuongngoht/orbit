export * from "./connectors.js";
export * from "./dto.js";
export * from "./events/index.js";
export * from "./governance.js";
export * from "./images.js";
export * from "./models.js";
export * from "./orbit.js";
export * from "./project.js";
export * from "./research.js";
export * from "./status.js";
export * from "./validate.js";
export * from "./ai-connections.js";
export * from "./identity.js";
export * from "./resources.js";
export * from "./workforce.js";
export * from "./executive.js";

export const ORBIT_WEB_VERSION = "0.8.1";

// The header every state-changing request carries. A browser cannot add it to a cross-site request without a CORS
// preflight the API never answers, so its presence is part of the CSRF defence.
export const MUTATION_HEADER = "x-orbit-web";

// The header that carries this browser session's CSRF token (AuthSession.csrfToken, identity.ts) on every change: a page
// of another site can neither read the token nor send it.
export const CSRF_HEADER = "x-orbit-csrf";

// The Claude CLI's word for a Claude subscription's sign-in (`claude auth status` -> authMethod): what a Claude Code
// connection of the `subscription` method is signed in with (ai-connections.ts).
export const CLAUDE_ACCOUNT_METHOD = "claude.ai";
export * from "./updates.js";
export * from "./employee-access.js";
export * from "./mcp-servers.js";
export * from "./desks.js";
export * from "./runtime-security.js";
