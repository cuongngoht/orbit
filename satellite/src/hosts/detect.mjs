// Which HOST a command runs under, from its environment -- asked only by a composition root that passes the
// environment in. An explicit ORBIT_HOST (set by Orbit's own host binding, or a person) always wins; Codex and
// Antigravity shells carry no mark of their own, so they are known only through it.
const HOST_ID = /^(claude|codex|antigravity|grok)$/;

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export const DETECTION = Object.freeze([
  { host: (env) => env.ORBIT_HOST, when: (env) => HOST_ID.test(env.ORBIT_HOST ?? "") },
  { host: () => "claude", when: (env) => env.CLAUDECODE === "1" || Boolean(env.CLAUDE_PLUGIN_ROOT) || Boolean(env.CLAUDE_CODE_ENTRYPOINT) },
  { host: () => "grok", when: (env) => SESSION_ID.test(env.GROK_SESSION_ID ?? "") },
  { host: () => "unknown", when: () => true },
]);

export const hostOf = (env) => DETECTION.find((r) => r.when(env ?? {})).host(env ?? {});
