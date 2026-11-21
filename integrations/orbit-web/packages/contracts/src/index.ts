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

export const ORBIT_WEB_VERSION = "0.8.0";

// The header every state-changing request carries. A browser cannot add it to a cross-site request without a CORS
// preflight the API never answers, so its presence is part of the CSRF defence.
export const MUTATION_HEADER = "x-orbit-web";

// The header that carries this browser session's CSRF token (BrowserSession.csrfToken) on every change: a page of another
// site can neither read the token nor send it.
export const CSRF_HEADER = "x-orbit-csrf";

// The error code of every API call made before THIS browser finished a Claude sign-in (HTTP 401). The web app answers it
// with the sign-in page.
export const CLAUDE_SIGN_IN_REQUIRED = "claude_sign_in_required";

// A Claude sign-in another browser has under way: the CLI runs one at a time.
export const SIGN_IN_BUSY = "sign_in_busy";

// A finished sign-in whose account is not the one the runtime's CLI holds now (it changed in between).
export const IDENTITY_MISMATCH = "identity_mismatch";

// The CLI's word for a Claude account sign-in (`claude auth status` -> authMethod). Nothing else signs Orbit Web in.
export const CLAUDE_ACCOUNT_METHOD = "claude.ai";
