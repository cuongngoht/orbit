// PREFLIGHT: what must hold here before a ship builds or runs anything -- an ordered table over facts the ship gathered
// by asking (the checkout's own git, the benchmark's `list` and `doctor`, which credential NAMES are set), first failing
// row decides. Nothing is installed, fixed or worked around: a machine with no Docker, a harness someone edited, a
// catalog that drifted or no credential is a code and a sentence, and the ship stops there -- BLOCKED, resumable.
// A credential's VALUE is never read: only whether a name is set.
//
//   preflightOf(f) -> { ok, state, code, says, failing: [{ code, says }] }      PREFLIGHT · CREDENTIAL_NAMES
//   hostOf(probe) -> { ok, state, code, says }     the runner image's Claude Code, as `doctor --host` answered
//   f: { harness, node, protectedDirty, listed, drift, doctor, env, policy }
export const CREDENTIAL_NAMES = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"];

const endpointOf = (env) => {
  try { return env.ANTHROPIC_BASE_URL ? new URL(env.ANTHROPIC_BASE_URL).hostname.toLowerCase() : null; }
  catch { return "an unreadable URL"; }
};

export const PREFLIGHT = [
  { code: "HARNESS_ABSENT", state: "BLOCKED", fails: (f) => !f.harness, says: () => "no benchmark harness here (benchmark/run.mjs): a ship runs from Orbit's own clone, never from an installed plugin" },
  { code: "NODE", state: "BLOCKED", fails: (f) => f.node < 20, says: (f) => `Node ${f.node} -- Orbit needs 20 or later` },
  { code: "PROTECTED_DIRTY", state: "REFUSED", fails: (f) => f.protectedDirty.length > 0, says: (f) => `uncommitted changes under paths the ship judges with (${f.protectedDirty.slice(0, 5).join(", ")}${f.protectedDirty.length > 5 ? ", …" : ""}): commit or remove them, then ship` },
  { code: "CATALOG_UNREADABLE", state: "BLOCKED", fails: (f) => !f.listed, says: (f) => `the benchmark could not list its suites: ${f.listErr ?? "no answer"}` },
  { code: "CATALOG_DRIFT", state: "REFUSED", fails: (f) => f.drift.length > 0, says: (f) => `the release policy and the suites disagree: ${f.drift.slice(0, 4).join("; ")}` },
  { code: "DOCKER", state: "BLOCKED", fails: (f) => !f.doctor?.docker?.version, says: (f) => `Docker does not answer here (${f.doctor?.docker?.missing?.slice(0, 200) ?? "no answer"}): every row runs in containers` },
  { code: "AUTH_MISSING", state: "BLOCKED", fails: (f) => !CREDENTIAL_NAMES.some((n) => f.env[n]), says: () => "no credential for the coding host is set, by name (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN): every model-carried row needs the real Claude Code, and a ship never falls back to another host" },
  { code: "ENDPOINT", state: "BLOCKED", fails: (f) => endpointOf(f.env) !== null && !f.policy.host.endpoints.includes(endpointOf(f.env)), says: (f) => `ANTHROPIC_BASE_URL points the host at ${endpointOf(f.env)}, which the release policy does not name (${f.policy.host.endpoints.join(", ")}): a model behind another endpoint is never taken for the real one` },
];

export function preflightOf(f) {
  const failing = PREFLIGHT.filter((r) => r.fails(f)).map((r) => ({ code: r.code, state: r.state, says: r.says(f) }));
  return failing.length ? { ok: false, ...failing[0], failing } : { ok: true, state: "OK", code: "OK", says: "Docker answers, the harness and the catalog hold, a credential is set by name", failing: [] };
}

// The host probe's own answer, in the ship's words: only OK lets a cycle go on.
export const hostOf = (probe) => (probe?.ok ? { ok: true, state: "OK", code: "OK", says: probe.says } : { ok: false, state: "BLOCKED", code: probe?.code ?? "CLI_UNAVAILABLE", says: probe?.says ?? "the runner image's Claude Code could not be asked" });
