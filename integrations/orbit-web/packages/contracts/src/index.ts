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

export const ORBIT_WEB_VERSION = "0.8.0";

// The header every state-changing request carries. A browser cannot add it to a cross-site request without a CORS
// preflight the API never answers, so its presence is part of the CSRF defence.
export const MUTATION_HEADER = "x-orbit-web";

// The error code of every API call made before Orbit Web is signed in to a Claude account (HTTP 401). The web app
// answers it with the sign-in page.
export const CLAUDE_SIGN_IN_REQUIRED = "claude_sign_in_required";

// The CLI's word for a Claude account sign-in (`claude auth status` -> authMethod). Nothing else signs Orbit Web in.
export const CLAUDE_ACCOUNT_METHOD = "claude.ai";
