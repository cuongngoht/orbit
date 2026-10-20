// Who is signed in to Claude Code on this machine, as Claude Code itself records
// it -- concrete host knowledge, so it lives here beside the MCP and lifecycle
// adapters and not in src/. Orbit Control shows it in its top bar.
//
// READ from <config>/.claude.json (CLAUDE_CONFIG_DIR, or the home directory),
// and from that file only the signed-in account's PROFILE: a display name, an
// email address, an organization and a role (`PROFILE`). Nothing else in it is
// looked at or returned -- an API key a Console login may keep there included.
// Nothing is read from the OS keychain or from Claude Code's credentials file,
// there is no token anywhere in this path, and nothing reaches the network:
// Orbit never reads, holds or uses a Claude credential. A token is Claude
// Code's, for Claude Code.
import { claudeConfigFile } from "./claude-mcp.mjs";

export const PROFILE = [["displayName", "displayName"], ["emailAddress", "email"], ["organizationName", "organization"], ["organizationRole", "role"]];
const LIMIT = 200;

// deps: { env, home, io }
export function createClaudeAccount(deps) {
  return { host: "claude", account: () => profileOf(parsed(deps.io.read(claudeConfigFile(deps.env, deps.home)))) };
}

function profileOf(config) {
  const account = config?.oauthAccount;
  if (!account || typeof account !== "object" || Array.isArray(account)) return { signedIn: false };
  return { signedIn: true, ...Object.fromEntries(PROFILE.filter(([from]) => typeof account[from] === "string" && account[from].trim()).map(([from, to]) => [to, account[from].trim().slice(0, LIMIT)])) };
}

function parsed(text) {
  try { return text ? JSON.parse(text) : null; }
  catch { return null; }
}
