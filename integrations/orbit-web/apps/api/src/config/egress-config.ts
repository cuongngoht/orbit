// THE EGRESS PROXY'S OWN SETTINGS, beside config.ts: what the installation sets for the proxy itself, read once at start
// from ORBIT_WEB_EGRESS_* variables. (What an employee may reach, and the usage limits of its runs, are each account's
// own: its policy's `employeeNetwork`, governance-core network.ts.)
import { DEFAULT_MAX_CONNECTIONS_PER_RUN } from "../infra/egress/ledger.js";
import { ConfigError } from "./config.js";

export interface EgressConfig {
  // The most connections ONE run holds open through the proxy at once, whatever its account's policy says: the proxy's
  // own protection, always on (ORBIT_WEB_EGRESS_MAX_CONNECTIONS_PER_RUN, default 256).
  maxConnectionsPerRun: number;
}

const MAX_CAP = 65_535;

export function egressConfig(env: Readonly<Record<string, string | undefined>>): EgressConfig {
  const raw = (env.ORBIT_WEB_EGRESS_MAX_CONNECTIONS_PER_RUN ?? "").trim();
  if (raw === "") return { maxConnectionsPerRun: DEFAULT_MAX_CONNECTIONS_PER_RUN };
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < 1 || n > MAX_CAP) throw new ConfigError(`ORBIT_WEB_EGRESS_MAX_CONNECTIONS_PER_RUN must be a whole number from 1 to ${MAX_CAP}`);
  return { maxConnectionsPerRun: n };
}
