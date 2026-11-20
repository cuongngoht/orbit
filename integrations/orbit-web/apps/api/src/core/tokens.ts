// Injection tokens for what is not a class: the configuration and the process port.
export const APP_CONFIG = Symbol("APP_CONFIG");
export { AGENT_PROCESS_PORT, PROCESS_PORT } from "../infra/process/process.port.js";
