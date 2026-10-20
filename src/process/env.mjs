// What a child process is GIVEN of this process's environment: the few names
// any process needs to start at all on Linux, macOS and Windows, and nothing
// else -- because the rest of this environment is where every secret lives.
//
// It belongs to the Process port rather than to one of its callers: a managed
// MCP server (src/mcp/connect.mjs) and a project-report part
// (src/project-report/execute.mjs) are both children that must start without
// seeing what the engine can see, and neither may import the other.
//
// `SystemRoot` is not optional on Windows: Winsock, and with it Python's own
// start-up, fails without it. Windows reads names case-insensitively and
// spawn() keeps the first spelling it meets, so listing both spellings of a
// name is safe.
export const BASE_ENV = ["PATH", "Path", "PATHEXT", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "SystemRoot", "SYSTEMROOT", "windir", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "ComSpec"];

export const baseEnv = (env = {}) => pick(env, BASE_ENV);

// BASE_ENV plus the names a caller declared, read from `env` -- never a value a
// caller typed, so a declared name that is not set is simply absent.
export const childEnv = (env = {}, names = []) => ({ ...baseEnv(env), ...pick(env, names) });

// ONLY the names a caller declared, read from `env`: for a child whose own base environment is not
// this machine's -- a process inside a container is handed these and nothing of the host's.
export const namedEnv = (env = {}, names = []) => pick(env, names);

const pick = (env, names) => Object.fromEntries(names.filter((k) => typeof env[k] === "string").map((k) => [k, env[k]]));
