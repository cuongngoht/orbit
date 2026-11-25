// A CONNECTION'S CONFIG HOME: `<data>/connections/<OrbitId>/<connectionId>/`, one directory per runtime in it -- where
// the CLI keeps its own login (Claude Code: CLAUDE_CONFIG_DIR=<home>/claude; Codex: CODEX_HOME=<home>/codex; Antigravity:
// its settings under HOME=<home>/agy). Nothing of one connection's is in another's, and nothing of an account's is in
// another account's. The path is built from ids the server made (UUIDs) and nothing else; anything else is refused.
//
// The account's own credential variables of the server (CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY, ...) never reach a
// CLI through here: a connection's CLI finds its login in its home, or -- an API-key connection -- is handed its own key
// from the credential store (credentials.ts) by whoever starts it.
import type { RuntimeKind } from "@orbit-web/contracts";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The home's name in the database (relative to the connections room).
export function homeOf(accountId: string, connectionId: string): string {
  if (!UUID.test(accountId) || !UUID.test(connectionId)) throw new Error("a connection's home is named by an account's and a connection's ids only");
  return `${accountId}/${connectionId}`;
}

// The home itself, from the name the database keeps -- which is held to the same shape before it is joined to anything.
export function homePath(config: AppConfig, home: string): string {
  const [accountId, connectionId, ...rest] = home.split("/");
  if (rest.length > 0 || accountId === undefined || connectionId === undefined) throw new Error("a connection's home must be <account>/<connection>");
  return join(config.data.connections, homeOf(accountId, connectionId));
}

// Where a runtime's CLI keeps its login in a connection's home.
export const runtimeDir = (config: AppConfig, home: string, runtime: RuntimeKind): string => join(homePath(config, home), runtime);

// The variables that point a runtime's CLI at that directory -- and nothing else.
export function homeEnv(runtime: RuntimeKind, dir: string): Record<string, string> {
  if (runtime === "claude") return { CLAUDE_CONFIG_DIR: dir };
  if (runtime === "codex") return { CODEX_HOME: dir };
  return { HOME: dir };
}

export function ensureHome(config: AppConfig, home: string, runtime: RuntimeKind): string {
  const dir = runtimeDir(config, home, runtime);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// The login a CLI left in the home goes, and the home is empty again (Disconnect).
export function emptyHome(config: AppConfig, home: string, runtime: RuntimeKind): void {
  rmSync(runtimeDir(config, home, runtime), { recursive: true, force: true });
  ensureHome(config, home, runtime);
}

// The whole home goes (a connection removed).
export function removeHome(config: AppConfig, home: string): void {
  rmSync(homePath(config, home), { recursive: true, force: true });
}
