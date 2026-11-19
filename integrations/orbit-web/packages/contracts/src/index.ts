export * from "./dto.js";
export * from "./events.js";
export * from "./models.js";
export * from "./orbit.js";
export * from "./status.js";
export * from "./validate.js";

export const ORBIT_WEB_VERSION = "0.7.0";

// The header every state-changing request carries. A browser cannot add it to a cross-site request without a CORS
// preflight the API never answers, so its presence is part of the CSRF defence.
export const MUTATION_HEADER = "x-orbit-web";
