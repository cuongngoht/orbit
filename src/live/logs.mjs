// Which SANDBOX a task's live console may read, decided once for every viewer. A task's journal CLAIMS an
// environment (its latest `sandbox` receipt); the checkout's own sandboxes are the WITNESS of that claim. A
// log is read only when the two agree, and then only through the runtime's own command, which places and
// scrubs every line (src/runtime/sandbox/view.mjs logsOf). Orbit Control and a terminal ask the same two
// questions here, so a page and `live watch --logs` can never disagree about whose output they may show.
//
//   claimedEnvironment(view)        -> env id | null | { refusal }    what the task's journal names
//   witnessedBy(rows, env, task)     -> row | { refusal }              what the checkout says of it
//   sessionRefusal(session, stream)  -> null | { refusal }             the shape of what a viewer asked for
//
// A refusal is data -- { refusal: "invalid" | "missing" | "conflict", code, why } -- and each caller turns it
// into its own typed stop (Control's HTTP error, the CLI's Refused). Nothing here reads a file or a path.
export const ENV_ID = /^env-[a-f0-9]{12}$/;
export const SESSION_ID = /^rs-[a-f0-9]{12}$/;
export const LOG_STREAMS = Object.freeze(["out", "err"]);

export const NO_SANDBOX = "this task has not asked for a sandbox: the agent's prepare-sandbox makes one, and a viewer starts nothing";

const refusal = (kind, code, why) => ({ refusal: kind, code, why });

export const isRefusal = (x) => Boolean(x && typeof x === "object" && typeof x.refusal === "string");

// The environment the task's LATEST sandbox receipt names, or null.
const latestSandbox = (view) => view.receipts.filter((r) => r.domain === "sandbox").reduce((latest, r) => (latest === null || r.at >= latest.at ? r : latest), null)?.ref ?? null;

export function claimedEnvironment(view) {
  const env = latestSandbox(view);
  if (env !== null && !ENV_ID.test(env)) return refusal("invalid", "INVALID_ENVIRONMENT_ID", "the task's sandbox receipt names an environment that is not env- and twelve hexadecimal characters");
  return env;
}

const ownerOf = (owner) => (typeof owner === "string" ? owner : owner?.id);

export function witnessedBy(rows, env, task) {
  const row = rows.find((s) => s.id === env);
  if (!row) return refusal("missing", "SANDBOX_UNKNOWN", `${env} is not a sandbox this checkout knows`);
  if (ownerOf(row.owner) !== task) return refusal("conflict", "SANDBOX_OWNER_MISMATCH", `${env} is not ${task}'s sandbox: it belongs to another task`);
  return row;
}

export function sessionRefusal(session, stream) {
  if (!SESSION_ID.test(String(session))) return refusal("invalid", "INVALID_SESSION_ID", "a session id is rs- followed by twelve hex characters");
  if (!LOG_STREAMS.includes(stream)) return refusal("invalid", "SANDBOX_QUERY_INVALID", "stream is out or err");
  return null;
}
